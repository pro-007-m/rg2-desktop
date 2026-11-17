/* Constructive dodecahedral reduction written for RG2. Current colours only.
 * Base corners/middle edges use the separately attributed cubing.js SGS bridge.
 * Extra physical orbits are solved with isolated, verified 3-cycle commutators.
 * No scramble, labels, or game-history witness enters this module.
 */
import {createPolyPuzzle,getPolyPermutation,normalizePolyMove,applyPolyAlg,isPolySolved} from './poly-core.mjs';
import {suggestPoly} from './solver-poly.mjs';
const cache=new Map();
const aborted=signal=>{if(signal?.aborted)throw new DOMException('Расчёт отменён','AbortError');};
const dot=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0);
const sparse=p=>new Map(Array.from(p).flatMap((v,i)=>v!==i?[[i,v]]:[]));
const inverse=p=>new Map([...p].map(([a,b])=>[b,a]));
function compose(a,b){const out=new Map();for(const i of new Set([...a.keys(),...b.keys()])){const mid=b.get(i)??i,v=a.get(mid)??mid;if(v!==i)out.set(i,v);}return out;}
const comm=(a,b)=>compose(compose(compose(a,b),inverse(a)),inverse(b));
const invertWord=(word,puzzle)=>[...word].reverse().map(m=>normalizePolyMove({...puzzle.parseMove(m),turns:-puzzle.parseMove(m).turns},puzzle).token);
const concatComm=(a,b,puzzle)=>[...a,...b,...invertWord(a,puzzle),...invertWord(b,puzzle)];
const conjugate=(p,g)=>new Map([...p].map(([a,b])=>[g.get(a)??a,g.get(b)??b]));
function unionOrbits(count,perms){const parent=Uint32Array.from({length:count},(_,i)=>i),root=i=>parent[i]===i?i:parent[i]=root(parent[i]);for(const p of perms)for(let i=0;i<count;i++)parent[root(i)]=root(p[i]);const groups=new Map();for(let i=0;i<count;i++){const r=root(i);if(!groups.has(r))groups.set(r,[]);groups.get(r).push(i);}const groupsList=[...groups.values()],index=new Uint32Array(count);groupsList.forEach((g,j)=>g.forEach(i=>index[i]=j));return {groups:groupsList,index};}
export function buildModel(kind,order){
  const puzzle=createPolyPuzzle(kind,order),cells=new Map(),pieceOf=new Uint32Array(puzzle.faceletCount);
  for(const f of puzzle.facelets){const key=puzzle.axes.map(a=>a.thresholds.filter(c=>dot(a.normal,f.center)<c-1e-8).length).join(',');if(!cells.has(key))cells.set(key,[]);cells.get(key).push(f.index);}
  const pieces=[...cells.values()];pieces.forEach((fs,i)=>fs.forEach(f=>pieceOf[f]=i));
  const generators=[];
  for(const axis of puzzle.axes)for(let layer=0;layer<axis.layerCount;layer++){
    const move=normalizePolyMove({axis:axis.id,layers:[layer],turns:1},puzzle),permutation=getPolyPermutation(puzzle,move),piecePermutation=Uint32Array.from(pieces,fs=>pieceOf[permutation[fs[0]]]);
    for(let i=0;i<pieces.length;i++)if(pieces[i].some(f=>pieceOf[permutation[f]]!==piecePermutation[i]))throw Error('piece split');
    generators.push({axis:axis.id,layer,token:move.token,word:[move.token],permutation,piecePermutation,p:sparse(piecePermutation)});
  }
  const orbitData=unionOrbits(pieces.length,generators.map(g=>g.piecePermutation)),facetData=unionOrbits(puzzle.faceletCount,generators.map(g=>g.permutation));
  const pieceFacets=pieces.map(fs=>[...fs].sort((a,b)=>facetData.index[a]-facetData.index[b]));
  const orbits=orbitData.groups.map((indices,id)=>({id,indices,coloured:indices.some(i=>pieces[i].some(f=>!puzzle.facelets[f].black)),stickers:pieces[indices[0]].length,oriented:pieces[indices[0]].length===new Set(pieces[indices[0]].map(f=>facetData.index[f])).size}));
  return {puzzle,pieces,pieceOf,pieceFacets,generators,orbits,orbitOf:orbitData.index,facetOrbits:facetData.groups,facetOrbitOf:facetData.index,goal:puzzle.solvedState()};
}
function cycle3(p){if(p.size!==3)return null;const a=Math.min(...p.keys()),b=p.get(a),c=p.get(b);return c!==a&&p.get(c)===a?[a,b,c]:null;}
export function findSeeds(model){
  const {puzzle,generators,orbits,orbitOf}=model,wanted=new Set(orbits.filter(o=>o.coloured&&o.indices.length===60).map(o=>o.id)),found=new Map();
  const adjacent=puzzle.axes.find(a=>a.id!==puzzle.axes[0].id&&dot(a.normal,puzzle.axes[0].normal)>.4).id,H=[];
  for(const a of generators.filter(g=>g.axis===puzzle.axes[0].id))for(const b of generators.filter(g=>g.axis===adjacent))if(a.layer||b.layer){const p=comm(a.p,b.p);if(p.size)H.push({p,word:concatComm(a.word,b.word,puzzle),a,b});}
  let examined=0;
  function direct(p,word){const cycle=cycle3(p);if(!cycle)return;const id=orbitOf[cycle[0]];if(wanted.has(id)&&!found.has(id)&&cycle.every(i=>orbitOf[i]===id))found.set(id,{cycle,word,permutation:p});}
  for(const h of H){let power=new Map();for(let i=0;i<5;i++)power=compose(power,h.p);direct(power,Array.from({length:5},()=>h.word).flat());}
  // Turning every near-A slab except row j makes the off-diagonal cycles
  // length five. The remaining odd-order middle-row cycle has length three.
  // Fifth power therefore isolates that group without a long cancellation list.
  const firstAxis=generators.filter(g=>g.axis===puzzle.axes[0].id);
  for(const b of generators.filter(g=>g.axis===adjacent&&g.layer>0)){
    let a=new Map();for(const g of firstAxis)if(g.layer!==b.layer)a=compose(a,g.p);
    const ranges=[firstAxis.filter(g=>g.layer<b.layer),firstAxis.filter(g=>g.layer>b.layer)].filter(r=>r.length),word=ranges.map(r=>normalizePolyMove({axis:r[0].axis,layers:r.map(g=>g.layer),turns:1},puzzle).token),h=comm(a,b.p),algorithm=concatComm(word,b.word,puzzle);let power=new Map();for(let i=0;i<5;i++)power=compose(power,h);direct(power,Array.from({length:5},()=>algorithm).flat());
  }
  function accept(h,g,word){examined++;const p=comm(h.p,conjugate(h.p,g)),cycle=cycle3(p);if(!cycle)return;const id=orbitOf[cycle[0]];if(!wanted.has(id)||found.has(id)||cycle.some(i=>orbitOf[i]!==id))return;const conjugated=[...word,...h.word,...invertWord(word,puzzle)];found.set(id,{cycle,word:concatComm(h.word,conjugated,puzzle),permutation:p});}
  function wordPoint(word){let p=new Map();for(const token of word){const parsed=puzzle.parseMove(token),g=generators.find(g=>g.axis===parsed.axis&&g.layer===parsed.layers[0]);let power=new Map();for(let i=0;i<(parsed.turns+5)%5;i++)power=compose(power,g.p);p=compose(p,power);}return p;}
  for(const h of H)for(const word of [['F2','A2'],['A',normalizePolyMove({...puzzle.parseMove(h.b.token),turns:2},puzzle).token],['C','A'],['A',normalizePolyMove({...puzzle.parseMove(h.a.token),turns:2},puzzle).token]])accept(h,wordPoint(word),word);
  if(found.size===wanted.size)return {found,wanted,examined,firstFound:found.size,missing:[],recipesOnly:true};
  throw new Error('Конструктивные коммутаторы не прошли проверку полноты орбит.');
}
export function tableForOrbit(model,orbit,seed){
  const ids=orbit.indices,count=ids.length,local=new Int32Array(model.pieces.length).fill(-1);ids.forEach((id,i)=>local[id]=i);
  const generators=[],seen=new Set();
  for(const g of model.generators)for(const reverse of [false,true]){
    const p=reverse?inverse(g.p):g.p,permutation=Uint8Array.from(ids,id=>local[p.get(id)??id]),key=Array.from(permutation).join(',');
    if(permutation.every((v,i)=>v===i)||seen.has(key))continue;seen.add(key);generators.push({permutation,word:reverse?invertWord(g.word,model.puzzle):g.word});
  }
  const canonical=(a,b,c)=>a<b&&a<c?[a,b,c]:b<c?[b,c,a]:[c,a,b];
  const code=(a,b,c)=>(a*count+b)*count+c;
  const root=canonical(...seed.cycle.map(i=>local[i])),rootCode=code(...root),limit=count**3,previous=new Int32Array(limit).fill(-1),used=new Int16Array(limit).fill(-1),queue=new Int32Array(limit);let length=1;queue[0]=rootCode;previous[rootCode]=rootCode;
  for(let head=0;head<length;head++){
    const key=queue[head],a=Math.floor(key/(count*count)),b=Math.floor(key/count)%count,c=key%count;
    for(let i=0;i<generators.length;i++){
      const p=generators[i].permutation,[x,y,z]=canonical(p[a],p[b],p[c]),next=code(x,y,z);if(previous[next]>=0)continue;
      previous[next]=key;used[next]=i;queue[length++]=next;
    }
  }
  if(length!==count*(count-1)*(count-2)/3)throw new Error('Таблица сопряжений не покрывает все тройки деталей.');
  function algorithm(a,b,c){const cycle=canonical(local[a],local[b],local[c]),key=code(...cycle);if(previous[key]<0)throw Error('3-cycle outside conjugacy');const path=[];let cursor=key;while(cursor!==rootCode){path.push(...generators[used[cursor]].word);cursor=previous[cursor];}
    // Path is reversed already: newest conjugation precedes the old macro.
    return [...path,...seed.word,...invertWord(path,model.puzzle)];
  }
  return {count:length,generators:generators.length,algorithm};
}
export function solveOrbitColours(model,state,orbit,table,{signal}={}){
  const {puzzle,pieceFacets}=model,ids=orbit.indices,goal=puzzle.solvedState(),signature=(s,id)=>pieceFacets[id].map(f=>s[f]).join(','),desired=new Map(ids.map(id=>[id,signature(goal,id)]));
  let current=Uint32Array.from(state),moves=[],steps=0;
  while(true){
    aborted(signal);
    const colours=new Map(ids.map(id=>[id,signature(current,id)])),wrong=ids.filter(id=>colours.get(id)!==desired.get(id));if(!wrong.length)break;if(++steps>ids.length+2)throw Error('orbit loop');
    let chosen=null;
    for(const a of wrong){const aColour=colours.get(a),wanted=desired.get(a);
      for(const b of ids){if(a===b||colours.get(b)!==wanted)continue;
        for(const c of ids){if(c===a||c===b)continue;
          const before=Number(colours.get(a)===desired.get(a))+Number(colours.get(b)===desired.get(b))+Number(colours.get(c)===desired.get(c));
          const after=1+Number(colours.get(c)===desired.get(b))+Number(aColour===desired.get(c)),gain=after-before;
          if(gain>0&&(!chosen||gain>chosen.gain))chosen={a,b,c,gain};
        }
      }
      if(chosen?.gain===3)break;
    }
    if(!chosen)throw Error(`no coloured 3cycle, wrong=${wrong.length}`);
    const alg=table.algorithm(chosen.a,chosen.b,chosen.c),next=applyPolyAlg(current,puzzle,alg);
    const expected=Uint32Array.from(current);
    for(const [dest,source] of [[chosen.a,chosen.b],[chosen.b,chosen.c],[chosen.c,chosen.a]])for(let i=0;i<pieceFacets[dest].length;i++)expected[pieceFacets[dest][i]]=current[pieceFacets[source][i]];
    if(expected.some((v,i)=>v!==next[i]))throw Error('macro permutation mismatch');
    moves.push(...alg);current=next;
  }
  return {state:current,moves,steps};
}

export function baseProjection(model){
  const base=createPolyPuzzle('dodecahedron',model.puzzle.order%2?3:2),simple=buildModel('dodecahedron',model.puzzle.order%2?3:2),key=(pieces,puzzle,piece,index)=>`${pieces[piece].map(f=>puzzle.facelets[f].faceIndex).sort((a,b)=>a-b).join(',')}/${puzzle.facelets[index].faceIndex}`;
  const byKey=new Map();for(const orbit of model.orbits)if(orbit.indices.length<=30)for(const piece of orbit.indices)for(const f of model.pieces[piece])byKey.set(key(model.pieces,model.puzzle,piece,f),f);
  const mapping=Uint32Array.from(base.facelets,f=>{const result=byKey.get(key(simple.pieces,base,simple.pieceOf[f.index],f.index));if(result===undefined)throw Error('base mapping absent');return result;});
  return {puzzle:base,mapping,project:state=>Uint32Array.from(mapping,i=>state[i])};
}
export async function solveDodeca(state,model,seeds){
  const started=performance.now(),projection=baseProjection(model);let current=Uint32Array.from(state),moves=[],stages=[];
  for(let i=0;!isPolySolved(projection.project(current),projection.puzzle);i++){
    if(i>60)throw Error('base loop');const candidate=(await suggestPoly(projection.project(current),projection.puzzle)).candidates[0];if(!candidate)throw Error('base candidate absent');
    const after=applyPolyAlg(current,model.puzzle,candidate.moves);
    if(candidate.state.some((v,i)=>v!==projection.project(after)[i]))throw Error('base projection does not commute');
    current=after;moves.push(...candidate.moves);stages.push({kind:'base',moves:candidate.moves.length});
  }
  for(const orbit of model.orbits.filter(o=>seeds.found.has(o.id))){
    const table=tableForOrbit(model,orbit,seeds.found.get(orbit.id)),solution=solveOrbitColours(model,current,orbit,table);current=solution.state;moves.push(...solution.moves);stages.push({kind:'extra',orbit:orbit.id,moves:solution.moves.length,steps:solution.steps});
  }
  if(!isPolySolved(current,model.puzzle))throw Error('final not solved');return {state:current,moves,stages,ms:performance.now()-started};
}

function cachedModel(puzzle){
  if(cache.has(puzzle.id)){const value=cache.get(puzzle.id);cache.delete(puzzle.id);cache.set(puzzle.id,value);return value;}
  const model=buildModel(puzzle.kind,puzzle.order),seeds=findSeeds(model),projection=baseProjection(model),value={model,seeds,projection,tables:new Map()};
  while(cache.size>=2)cache.delete(cache.keys().next().value);cache.set(puzzle.id,value);return value;
}
function canonicalFrame(state,puzzle){
  if(isPolySolved(state,puzzle,{rotationAgnostic:false}))return [];
  const queue=[{state,moves:[]}],seen=new Set();
  for(let head=0;head<queue.length;head++){
    const node=queue[head],key=Array.from(node.state).join(',');if(seen.has(key))continue;seen.add(key);
    if(isPolySolved(node.state,puzzle,{rotationAgnostic:false}))return node.moves;
    for(const axis of puzzle.axes){const token=axis.id+'v',next=applyPolyAlg(node.state,puzzle,token);if(!seen.has(Array.from(next).join(',')))queue.push({state:next,moves:[...node.moves,token]});}
  }
  throw new Error('Не удалось восстановить цветовую ориентацию додекаэдра.');
}
function goalCounts(model,state,orbit){
  const signature=(s,id)=>model.pieceFacets[id].map(i=>s[i]).join(','),counts=new Map();
  for(const id of orbit.indices){const key=signature(model.goal,id);counts.set(key,(counts.get(key)||0)+1);}
  for(const id of orbit.indices){const key=signature(state,id);counts.set(key,(counts.get(key)||0)-1);}
  if([...counts.values()].some(n=>n!==0))throw new TypeError('Цвета группы деталей не соответствуют достижимому состоянию.');
}
export async function suggestLargeDodeca(input,puzzle,{signal,onProgress}={}){
  const started=performance.now();aborted(signal);
  if(puzzle.kind!=='dodecahedron'||puzzle.order<4||puzzle.order>20)throw new RangeError('Метод предназначен для додекаэдров размеров 4–20.');
  const state=Uint32Array.from(input),{model,seeds,projection,tables}=cachedModel(puzzle),small=projection.project(state),method='Группы деталей · редукция';
  const coverage={complete:true,supported:true,provedAllStages:true,historyRequired:false,extraOrbits:seeds.wanted.size,method};
  const candidate=(stage,title,moves,after,fixedIndices,phaseIndex,newlyFixedIndices=fixedIndices)=>({stage,title,method,candidates:[{id:`${puzzle.id}-${stage}`,stage,title,method,moves,state:after,moveCount:moves.length,fixedIndices,newlyFixedIndices,phaseIndex,phaseCount:50+seeds.wanted.size,claim:'Сохраняет собранную базу и все предыдущие группы деталей.'}],coverage:{...coverage,elapsedMs:performance.now()-started}});
  if(isPolySolved(small,projection.puzzle)){
    const orientation=canonicalFrame(small,projection.puzzle);
    if(orientation.length)return candidate('FRAME','Рабочая ориентация',orientation,applyPolyAlg(state,puzzle,orientation),[],0);
  }else{
    onProgress?.({phase:'base',message:'Собираю базовые углы и средние рёбра…'});
    const result=await suggestPoly(small,projection.puzzle,{signal,onProgress}),choice=result.candidates[0];
    if(!choice)throw new Error('Нет алгоритма для базовой группы деталей.');
    const after=applyPolyAlg(state,puzzle,choice.moves),projected=projection.project(after);
    if(projected.some((v,i)=>v!==choice.state[i]))throw new Error('Редукция не совпадает с базовой перестановкой.');
    return candidate(result.stage,choice.title,choice.moves,after,choice.fixedIndices.map(i=>projection.mapping[i]),choice.phaseIndex,choice.newlyFixedIndices.map(i=>projection.mapping[i]));
  }
  const fixedIndices=Array.from(projection.mapping).filter(i=>!puzzle.facelets[i].black),extras=model.orbits.filter(o=>seeds.wanted.has(o.id));
  for(let i=0;i<extras.length;i++){
    aborted(signal);const orbit=extras[i],indices=orbit.indices.flatMap(id=>model.pieces[id]);goalCounts(model,state,orbit);
    if(indices.every(index=>state[index]===puzzle.facelets[index].color)){fixedIndices.push(...indices);continue;}
    onProgress?.({phase:'orbit',message:`Собираю дополнительную группу ${i+1} из ${extras.length}…`});
    if(!tables.has(orbit.id)){while(tables.size>=2)tables.delete(tables.keys().next().value);tables.set(orbit.id,tableForOrbit(model,orbit,seeds.found.get(orbit.id)));}
    const solution=solveOrbitColours(model,state,orbit,tables.get(orbit.id),{signal}),moves=solution.moves,after=solution.state;
    if(fixedIndices.some(index=>after[index]!==state[index]))throw new Error('Алгоритм затронул ранее собранную группу.');
    fixedIndices.push(...indices);return candidate(`ORBIT_${i+1}`,`${orbit.stickers===2?'Рёбра':'Центры'} · группа ${i+1} из ${extras.length}`,moves,after,fixedIndices,51+i,indices);
  }
  if(!isPolySolved(state,puzzle))throw new Error('Все группы обработаны, но итоговая проверка не пройдена.');
  return {stage:'DONE',title:'Додекаэдр собран',method,candidates:[],coverage:{...coverage,elapsedMs:performance.now()-started}};
}
