/* State-based polyhedral hints. Local cubing.js SGS tables retain their licence. */
import {applyPolyAlg,getPolyPermutation,isPolySolved,normalizePolyMove} from './poly-core.mjs';

export const POLY_METHOD='Группы деталей · SGS';
const bridgeCache=new Map();
const now=()=>globalThis.performance?.now?.()??Date.now();
const abort=signal=>{if(signal?.aborted)throw new DOMException('Расчёт отменён','AbortError');};
const signature=p=>Array.from(p).join(',');
const dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);
function inverse(p){const q=new Uint32Array(p.length);for(let i=0;i<p.length;i++)q[p[i]]=i;return q;}
function compose(a,b){return Uint32Array.from(b,i=>a[i]);}
function layoutFor(kpuzzle){let offset=0;return kpuzzle.definition.orbits.map(orbit=>{const entry={...orbit,offset};offset+=orbit.numPieces*orbit.numOrientations;return entry;});}
function expanded(transformation,layout){
  const result=new Uint32Array(layout.reduce((n,o)=>n+o.numPieces*o.numOrientations,0));
  for(const orbit of layout){const t=transformation.transformationData[orbit.orbitName],n=orbit.numOrientations;
    for(let p=0;p<orbit.numPieces;p++)for(let o=0;o<n;o++)result[orbit.offset+p*n+o]=orbit.offset+t.permutation[p]*n+(o-t.orientationDelta[p]+n)%n;
  }return result;
}
function orbitsOf(permutations){
  const seen=new Set(),result=[];
  for(let i=0;i<permutations[0].length;i++)if(!seen.has(i)){
    const orbit=[i];seen.add(i);
    for(let q=0;q<orbit.length;q++)for(const p of permutations){const next=p[orbit[q]];if(!seen.has(next)){seen.add(next);orbit.push(next);}}
    result.push(orbit);
  }return result;
}
function conjugacy(ours,theirs){
  const ownOrbits=orbitsOf(ours),otherOrbits=orbitsOf(theirs),mapping=new Int32Array(ours[0].length).fill(-1),back=new Int32Array(mapping.length).fill(-1);
  for(const orbit of ownOrbits){let matched=false;
    for(const other of otherOrbits){if(other.length!==orbit.length||back[other[0]]>=0)continue;
      for(const seed of other){
        const local=new Map([[orbit[0],seed]]),reverse=new Map([[seed,orbit[0]]]),queue=[orbit[0]];let valid=true;
        for(let q=0;q<queue.length&&valid;q++)for(let g=0;g<ours.length;g++){
          const a=ours[g][queue[q]],b=theirs[g][local.get(queue[q])];
          if(local.has(a)){if(local.get(a)!==b){valid=false;break;}}
          else if(reverse.has(b)){valid=false;break;}
          else{local.set(a,b);reverse.set(b,a);queue.push(a);}
        }
        if(valid&&local.size===orbit.length){for(const [a,b] of local){mapping[a]=b;back[b]=a;}matched=true;break;}
      }if(matched)break;
    }if(!matched)return null;
  }return Uint32Array.from(mapping);
}
function axisAssignments(puzzle,kpuzzle,names){
  const ours=puzzle.axes.map((a,i)=>puzzle.axes.map((b,j)=>i!==j&&dot(a.normal,b.normal)>.4));
  const supports=names.map(name=>{const p=kpuzzle.moveToTransformation(name).transformationData.CORNERS;return new Set(p.permutation.flatMap((v,i)=>(v!==i||p.orientationDelta[i])?[i]:[]));});
  const theirs=names.map((_,i)=>names.map((_,j)=>i!==j&&[...supports[i]].filter(v=>supports[j].has(v)).length===2));
  // A tetrahedron's vertex graph is K4; the two icosahedral face graphs are
  // matched by adjacency. Fixing the first axis removes arbitrary global pose.
  if(puzzle.kind==='pyramid')for(let i=0;i<ours.length;i++)for(let j=0;j<ours.length;j++)ours[i][j]=theirs[i][j]=i!==j;
  const result=[],mapping=Array(names.length).fill(-1),used=new Set([0]);mapping[0]=0;
  function visit(){
    if(used.size===names.length){result.push([...mapping]);return;}
    let own=-1,best=-1;
    for(let i=0;i<mapping.length;i++)if(mapping[i]<0){const score=mapping.reduce((n,v,j)=>n+(v>=0&&ours[i][j]?1:0),0);if(score>best){own=i;best=score;}}
    for(let other=0;other<names.length;other++)if(!used.has(other)&&mapping.every((v,j)=>v<0||ours[own][j]===theirs[other][v])){mapping[own]=other;used.add(other);visit();used.delete(other);mapping[own]=-1;}
  }visit();return result;
}
function mappedPermutation(own,mapping){const result=new Uint32Array(mapping.length);for(let dest=0;dest<own.length;dest++)result[mapping[dest]]=mapping[own[dest]];return result;}
function primitiveTranslations(puzzle,mapping){
  const translations=new Map(),whole=[];
  for(const axis of puzzle.axes){
    const ranges=[];for(let a=0;a<axis.layerCount;a++)for(let b=a;b<axis.layerCount;b++)ranges.push({layers:Array.from({length:b-a+1},(_,j)=>a+j)});
    ranges.push({layers:Array.from({length:axis.bandCount},(_,i)=>i),whole:true});
    for(const range of ranges)for(let amount=1;amount<axis.order;amount++){
      const move=normalizePolyMove({axis:axis.id,...range,turns:amount},puzzle),p=mappedPermutation(getPolyPermutation(puzzle,move),mapping),key=signature(p),previous=translations.get(key);
      if(!previous||move.token.length<previous.join(' ').length)translations.set(key,[move.token]);
      if(move.whole)whole.push({p,moves:[move.token]});
    }
  }
  // Whole-cube symmetry moves in the SGS data may use edge/vertex axes that
  // differ from the public face axes. Generate the small 12/60 rotation group.
  const identity=Uint32Array.from({length:mapping.length},(_,i)=>i),queue=[{p:identity,moves:[]}],seen=new Set([signature(identity)]);
  for(let q=0;q<queue.length;q++)for(const generator of whole){
    const p=compose(queue[q].p,generator.p),key=signature(p);if(seen.has(key))continue;seen.add(key);
    const moves=[...queue[q].moves,...generator.moves];queue.push({p,moves});if(!translations.has(key))translations.set(key,moves);
  }
  if(seen.size!==(puzzle.kind==='pyramid'?12:60))throw new Error('Не удалось проверить группу пространственных вращений.');
  return translations;
}
async function makeBridge(puzzle,{signal,onProgress}={}){
  abort(signal);onProgress?.({phase:'mapping',message:'Проверяю соответствие деталей математической модели…'});
  const [{puzzles},{KPattern},sgsModule]=await Promise.all([import('./vendor/cubing/puzzles/index.js'),import('./vendor/cubing/kpuzzle/index.js'),import('./vendor/cubing/chunks/search-dynamic-sgs-side-events-5GQDHSJR.js')]);
  const kpuzzle=puzzle.kind==='pyramid'?await puzzles.pyraminx.kpuzzle():await sgsModule.cachedMegaminxKPuzzleWithoutMO();
  const sgs=puzzle.kind==='pyramid'?await sgsModule.sgsDataPyraminx():await sgsModule.cachedSGSDataMegaminx(),layout=layoutFor(kpuzzle);
  const domainSize=layout.reduce((sum,o)=>sum+o.numPieces*o.numOrientations,0);
  if(domainSize!==puzzle.faceletCount)throw new Error('Размер модели не соответствует таблице групп деталей.');
  const names=puzzle.kind==='pyramid'?['U','L','R','B']:['U','R','F','L','BL','BR','FR','FL','DL','DR','B','D'];
  const assignments=axisAssignments(puzzle,kpuzzle,names);let mapping=null;
  mappingSearch: for(const assignment of assignments)for(const sign of [1,-1]){
    abort(signal);const own=[],vendor=[];
    for(let i=0;i<puzzle.axes.length;i++){
      const axis=puzzle.axes[i],name=names[assignment[i]],body=puzzle.kind==='pyramid'?axis.id:axis.id;
      own.push(getPolyPermutation(puzzle,body));vendor.push(expanded(kpuzzle.moveToTransformation(name+(sign<0?"'":'')),layout));
      if(puzzle.kind==='pyramid'){own.push(getPolyPermutation(puzzle,axis.id.toLowerCase()));vendor.push(expanded(kpuzzle.moveToTransformation(name.toLowerCase()+(sign<0?"'":'')),layout));}
      own.push(getPolyPermutation(puzzle,axis.id+'v'));vendor.push(expanded(kpuzzle.moveToTransformation(name+'v'+(sign<0?"'":'')),layout));
    }
    mapping=conjugacy(own,vendor);if(mapping)break mappingSearch;
  }
  if(!mapping)throw new Error('Таблица решателя не совпадает с перестановками этой модели.');
  const back=inverse(mapping),translations=primitiveTranslations(puzzle,mapping),solvedColors=new Uint32Array(mapping.length);
  for(const item of puzzle.facelets)solvedColors[mapping[item.index]]=item.faceIndex;
  function patternOf(state){
    const vendorColors=new Uint32Array(mapping.length);for(let i=0;i<state.length;i++)vendorColors[mapping[i]]=state[i];
    const data={};
    for(const orbit of layout){const n=orbit.numOrientations,pieces=[],orientation=[],used=new Set();
      const uncoloured=Array.from({length:orbit.numPieces*n},(_,i)=>vendorColors[orbit.offset+i]).every(v=>v===puzzle.blackColor);
      for(let p=0;p<orbit.numPieces;p++){
        let found=null;
        if(uncoloured)found={piece:p,twist:0};
        else for(let q=0;q<orbit.numPieces&&!found;q++)for(let twist=0;twist<n;twist++){
          if(Array.from({length:n},(_,j)=>vendorColors[orbit.offset+p*n+j]).every((v,j)=>v===solvedColors[orbit.offset+q*n+(j-twist+n)%n])){found={piece:q,twist};break;}
        }
        if(!found||used.has(found.piece))throw new TypeError('Неверный или повторяющийся элемент головоломки.');
        used.add(found.piece);pieces.push(found.piece);orientation.push(found.twist);
      }data[orbit.orbitName]={pieces,orientation};
    }return new KPattern(kpuzzle,data);
  }
  function translate(alg){
    const moves=[];
    for(const node of alg.experimentalExpand()){
      if(!node.quantum)continue;
      const p=expanded(kpuzzle.moveToTransformation(node),layout),found=translations.get(signature(p));
      if(!found)throw new Error(`Поворот ${node.toString()} не выражен в обозначениях текущей модели.`);
      moves.push(...found);
    }return moves;
  }
  return {kpuzzle,KPattern,layout,sgs,mapping,back,patternOf,translate};
}
async function bridgeFor(puzzle,options){const key=puzzle.id;if(!bridgeCache.has(key))bridgeCache.set(key,makeBridge(puzzle,options).catch(e=>{bridgeCache.delete(key);throw e;}));return bridgeCache.get(key);}
function checkInput(state,puzzle){
  if(!state||state.length!==puzzle.faceletCount)throw new TypeError('Неверная длина состояния головоломки.');
  const expected=Array(puzzle.faceCount+1).fill(0),actual=Array(puzzle.faceCount+1).fill(0);
  for(const f of puzzle.facelets)expected[f.color]++;
  for(const c of state){if(!Number.isInteger(c)||c<0||c>puzzle.blackColor)throw new TypeError('Неверный цвет наклейки.');actual[c]++;}
  if(actual.some((n,i)=>n!==expected[i]))throw new TypeError('Число наклеек каждого цвета не соответствует головоломке.');
}
function pieceIndices(bridge,location){const orbit=bridge.layout.find(o=>o.orbitName===location.orbitName);return Array.from({length:orbit.numOrientations},(_,j)=>bridge.back[orbit.offset+location.permutationIdx*orbit.numOrientations+j]);}
function fixed(transformation,location){const orbit=transformation.transformationData[location.orbitName],i=location.permutationIdx;return orbit.permutation[i]===i&&orbit.orientationDelta[i]===0;}
function suggestTips2(state,puzzle,signal,started){
  const tips=puzzle.axes.map(axis=>{
    const permutation=getPolyPermutation(puzzle,axis.id.toLowerCase());
    return {axis,indices:Array.from(permutation).flatMap((v,i)=>v!==i?[i]:[])};
  });
  const moving=new Set(tips.flatMap(t=>t.indices)),centers=puzzle.facelets.filter(f=>!moving.has(f.index)).map(f=>f.index);
  const queue=[puzzle.solvedState()],seen=new Set();let target=null;
  for(let q=0;q<queue.length;q++){
    abort(signal);const current=queue[q],key=signature(current);if(seen.has(key))continue;seen.add(key);
    if(centers.every(i=>state[i]===current[i])){target=current;break;}
    for(const axis of puzzle.axes){const next=applyPolyAlg(current,puzzle,axis.id+'v');if(!seen.has(signature(next)))queue.push(next);}
  }
  if(!target)throw new TypeError('Центральные наклейки пирамиды не образуют допустимую пространственную ориентацию.');
  const protectedIndices=[...centers];
  for(let i=0;i<tips.length;i++){
    const {axis,indices}=tips[i];
    if(indices.every(index=>state[index]===target[index])){protectedIndices.push(...indices);continue;}
    for(const turns of [1,-1]){
      const token=normalizePolyMove({axis:axis.id,layers:[0],turns},puzzle).token,after=applyPolyAlg(state,puzzle,token);
      if(!indices.every(index=>after[index]===target[index]))continue;
      const fixedIndices=[...protectedIndices,...indices];
      if(!fixedIndices.every(index=>after[index]===target[index]))throw new Error('Поворот вершины затронул ранее собранную группу.');
      const stage=`TIPS_${i+1}`,title=`Вершина ${axis.id}`,method='Независимые вершины';
      return {stage,title,method,candidates:[{id:`${puzzle.id}-${stage}`,stage,title,method,moves:[token],state:after,htm:1,fixedIndices,newlyFixedIndices:indices,phaseIndex:i+1,phaseCount:4,claim:'Разворачивает одну независимую вершину, сохраняя остальные группы.'}],coverage:{complete:true,supported:true,provedAllStages:true,groups:4,elapsedMs:now()-started}};
    }
    throw new TypeError('Цвета вершины не соответствуют допустимому повороту пирамиды.');
  }
  throw new Error('Не найдена несобранная вершина.');
}

export async function suggestPoly(input,puzzle,{signal,onProgress}={}){
  const started=now();abort(signal);checkInput(input,puzzle);const state=Uint32Array.from(input);
  if(isPolySolved(state,puzzle))return {stage:'DONE',title:'Головоломка собрана',method:POLY_METHOD,candidates:[],coverage:{complete:true,elapsedMs:now()-started}};
  if(puzzle.kind==='pyramid'&&puzzle.order===2)return suggestTips2(state,puzzle,signal,started);
  if(puzzle.kind==='dodecahedron'&&puzzle.order>=4){const {suggestLargeDodeca}=await import('./solver-poly-large.mjs');return suggestLargeDodeca(state,puzzle,{signal,onProgress});}
  if(puzzle.kind==='pyramid'&&puzzle.order>=4){const {suggestLargePyramid}=await import('./solver-poly-pyramid.mjs');return suggestLargePyramid(state,puzzle,{signal,onProgress});}
  if(puzzle.order!==3&&!(puzzle.kind==='dodecahedron'&&puzzle.order===2))return {stage:'UNSUPPORTED',title:'Конструктивная таблица этого размера ещё не подготовлена',method:POLY_METHOD,candidates:[],coverage:{complete:false,supported:false,message:'Таблицы стандартного размера не описывают дополнительные группы деталей этого порядка.'}};
  const bridge=await bridgeFor(puzzle,{signal,onProgress});abort(signal);
  let transformation=bridge.patternOf(state).experimentalToTransformation(),first=null;const initialTransformation=transformation,protectedLocations=[],prefixActions=[];
  onProgress?.({phase:'groups',message:'Фиксирую последовательность групп деталей…'});
  for(let i=0;i<bridge.sgs.ordering.length;i++){
    abort(signal);const step=bridge.sgs.ordering[i],inv=transformation.invert();let key='';
    for(const loc of step.pieceOrdering){const orbit=inv.transformationData[loc.orbitName];key+=` ${orbit.permutation[loc.permutationIdx]} ${orbit.orientationDelta[loc.permutationIdx]}`;}
    const action=step.lookup[key];if(!action)throw new TypeError('Состояние не принадлежит допустимой группе вращений этой головоломки.');
    const previous=transformation;transformation=transformation.applyTransformation(action.transformation);
    if(!previous.isIdentical(transformation))prefixActions.push(action);
    protectedLocations.push(...step.pieceOrdering);
    if(protectedLocations.some(loc=>!fixed(transformation,loc)))throw new Error('Этап не сохранил ранее собранные группы деталей.');
    if(!first&&step.pieceOrdering.some(loc=>!fixed(initialTransformation,loc)&&pieceIndices(bridge,loc).some(index=>!puzzle.facelets[index].black))){
      first={i,actions:[...prefixActions],after:transformation,protectedLocations:[...protectedLocations],newLocations:step.pieceOrdering};
    }
  }
  if(!transformation.isIdentityTransformation())throw new Error('Конструктивная цепочка не завершилась собранным состоянием.');
  if(!first)throw new Error('Нет следующей группы цветных деталей.');
  const moves=first.actions.flatMap(action=>bridge.translate(action.alg)),after=applyPolyAlg(state,puzzle,moves),fixedIndices=[...new Set(first.protectedLocations.flatMap(loc=>pieceIndices(bridge,loc)))].filter(index=>!puzzle.facelets[index].black);
  for(const index of fixedIndices)if(after[index]!==puzzle.facelets[index].faceIndex)throw new Error('Проверка реально собранных наклеек этапа не пройдена.');
  const stage=`SGS_${first.i+1}`,title=`Группа деталей ${first.i+1} из ${bridge.sgs.ordering.length}`;
  return {stage,title,method:POLY_METHOD,candidates:[{id:`${puzzle.id}-${stage}`,stage,title,method:POLY_METHOD,moves,state:after,htm:moves.length,fixedIndices,newlyFixedIndices:[...new Set(first.newLocations.flatMap(loc=>pieceIndices(bridge,loc)))].filter(index=>!puzzle.facelets[index].black),phaseIndex:first.i+1,phaseCount:bridge.sgs.ordering.length,source:'cubing.js 0.66.1 · SGS',claim:'Фиксирует указанную группу и сохраняет все предыдущие группы.'}],coverage:{complete:true,supported:true,provedAllStages:true,groups:bridge.sgs.ordering.length,elapsedMs:now()-started}};
}
