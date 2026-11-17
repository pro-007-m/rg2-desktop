/* RG2's own state-only pyramid reduction, orders 4–20.
 * The small coupled quotient uses an offline, exact Schreier–Sims chain.
 * Remaining physical groups use conjugated isolated 3-cycle commutators.
 * Its tables are generated from our geometry, never an APK or move history.
 */
import {applyPolyAlg,getPolyPermutation,isPolySolved,normalizePolyMove} from './poly-core.mjs';
import {buildModel,tableForOrbit,solveOrbitColours} from './solver-poly-large.mjs';
import {PYRAMID_TABLES} from './solver-poly-pyramid-data.mjs';
const cache=new Map(),method='Группы деталей · редукция';
const abort=signal=>{if(signal?.aborted)throw new DOMException('Расчёт отменён','AbortError');};
const inverse=p=>{const q=new Uint16Array(p.length);p.forEach((v,i)=>q[v]=i);return q;};
const compose=(a,b)=>Uint16Array.from(b,v=>a[v]);
const identity=n=>Uint16Array.from({length:n},(_,i)=>i);
const isIdentity=p=>p.every((v,i)=>v===i);
const invertWord=(word,puzzle)=>[...word].reverse().map(token=>{const move=puzzle.parseMove(token);return normalizePolyMove({...move,turns:-move.turns},puzzle).token;});
function simplified(word,puzzle){
  const result=[];
  for(const token of word){const move=puzzle.parseMove(token),last=result.length?puzzle.parseMove(result.at(-1)):null;
    if(last&&last.axis===move.axis&&last.whole===move.whole&&String(last.layers)===String(move.layers)){
      result.pop();const turns=(last.turns+move.turns+6)%3;if(turns)result.push(normalizePolyMove({...move,turns},puzzle).token);
    }else result.push(token);
  }return result;
}
function makeQuotient(model,core,rawChain){
  const {puzzle,pieces,pieceFacets,goal}=model,indices=[];
  for(const orbit of core)for(const piece of orbit.indices)indices.push(...(orbit.oriented?[pieceFacets[piece][0]]:pieces[piece]));
  const local=new Map(indices.map((f,i)=>[f,i])),permutations=new Map();
  function wordPermutation(word){let result=identity(indices.length);
    for(const token of word){if(!permutations.has(token)){
      const full=getPolyPermutation(puzzle,token),p=Uint16Array.from(indices,f=>{const v=local.get(full[f]);if(v===undefined)throw new Error('Неполная базовая группа пирамиды.');return v;});permutations.set(token,p);
    }result=compose(result,permutations.get(token));}return result;
  }
  const bases=[],chain=rawChain.map(([base,entries])=>{
    const trans=Array(indices.length);
    for(const [image,algorithm] of entries){const word=algorithm?algorithm.split(' '):[],p=wordPermutation(word);
      if(p[base]!==image||bases.some(b=>p[b]!==b)||new Set(p).size!==p.length)throw new Error('Таблица пирамиды не совпадает с геометрией.');
      trans[image]={p,inverse:inverse(p),word};
    }if(!trans[base]||!isIdentity(trans[base].p))throw new Error('В таблице отсутствует единичная перестановка.');
    bases.push(base);return {base,trans};
  });
  function permutation(state){const result=new Uint16Array(indices.length);
    for(const orbit of core){
      const signature=(s,piece)=>{const colors=pieceFacets[piece].map(f=>s[f]);return (orbit.oriented?colors:colors.sort((a,b)=>a-b)).join(',');},sourceByColors=new Map();
      for(const piece of orbit.indices){const key=signature(goal,piece);if(sourceByColors.has(key))throw new Error('Базовые детали не различаются по цветам.');sourceByColors.set(key,piece);}
      for(const piece of orbit.indices){const source=sourceByColors.get(signature(state,piece));if(source===undefined)throw new TypeError('Недопустимые цвета базовой детали пирамиды.');
        for(const facelet of (orbit.oriented?[pieceFacets[piece][0]]:pieces[piece])){
          const from=orbit.oriented?pieceFacets[source][0]:pieces[source].find(f=>goal[f]===state[facelet]);
          if(from===undefined)throw new TypeError('Недопустимая ориентация детали пирамиды.');result[local.get(facelet)]=local.get(from);
        }
      }
    }if(new Set(result).size!==result.length)throw new TypeError('Повторяющаяся базовая деталь пирамиды.');return result;
  }
  function solvePermutation(input){let remainder=input,word=[];
    for(const {base,trans} of chain){const step=trans[remainder[base]];if(!step)throw new TypeError('Состояние пирамиды не принадлежит допустимой группе.');remainder=compose(step.inverse,remainder);word.push(...step.word);}
    if(!isIdentity(remainder))throw new TypeError('Состояние пирамиды не проходит проверку достижимости.');return simplified(invertWord(word,puzzle),puzzle);
  }
  // Verify every legal primitive against the generated chain. This also
  // detects geometry/table drift before any user state is processed.
  for(const g of model.generators)solvePermutation(wordPermutation(g.word));
  return {indices,solve:state=>solvePermutation(permutation(state))};
}
function makeModel(puzzle){
  const raw=PYRAMID_TABLES[puzzle.order];if(!raw)throw new RangeError('Нет конструктивной таблицы этого размера.');
  const model=buildModel('pyramid',puzzle.order),seeds=new Map(),labels=Uint32Array.from({length:puzzle.faceletCount},(_,i)=>i);
  for(const [id,algorithm] of raw.seeds){
    const orbit=model.orbits[id],word=algorithm.split(' '),full=applyPolyAlg(labels,puzzle,word),moving=[];
    if(!orbit?.oriented||orbit.indices.length!==12)throw new Error('Неверная дополнительная группа пирамиды.');
    for(const piece of model.pieces.keys())if(model.pieceOf[full[model.pieces[piece][0]]]!==piece)moving.push(piece);
    if(moving.length!==3||moving.some(piece=>model.orbitOf[piece]!==id))throw new Error('Коммутатор пирамиды не изолирует три детали.');
    const a=Math.min(...moving),b=model.pieceOf[full[model.pieces[a][0]]],c=model.pieceOf[full[model.pieces[b][0]]];
    if(c===a||model.pieceOf[full[model.pieces[c][0]]]!==a)throw new Error('Неверный цикл коммутатора пирамиды.');
    const source=new Map([[a,b],[b,c],[c,a]]);
    for(let f=0;f<full.length;f++){const piece=model.pieceOf[f],which=model.pieceFacets[piece].indexOf(f),expected=source.has(piece)?model.pieceFacets[source.get(piece)][which]:f;if(full[f]!==expected)throw new Error('Коммутатор затрагивает посторонние наклейки.');}
    seeds.set(id,{cycle:[a,b,c],word});
  }
  const core=raw.core.map(id=>model.orbits[id]);
  if(core.some(o=>!o)||new Set([...raw.core,...seeds.keys()]).size!==model.orbits.length)throw new Error('Таблица не покрывает все группы пирамиды.');
  const quotient=makeQuotient(model,core,raw.chain),fixed=core.flatMap(o=>o.indices.flatMap(piece=>model.pieces[piece])).filter(f=>!puzzle.facelets[f].black);
  return {model,seeds,core,quotient,fixed,tables:new Map()};
}
function modelFor(puzzle){if(cache.has(puzzle.id)){const value=cache.get(puzzle.id);cache.delete(puzzle.id);cache.set(puzzle.id,value);return value;}const value=makeModel(puzzle);while(cache.size>=2)cache.delete(cache.keys().next().value);cache.set(puzzle.id,value);return value;}
function checkGroupColours(model,state,orbit){
  const signature=(s,piece)=>model.pieceFacets[piece].map(f=>s[f]).join(','),counts=new Map();
  for(const piece of orbit.indices){const key=signature(model.goal,piece);counts.set(key,(counts.get(key)||0)+1);}
  for(const piece of orbit.indices){const key=signature(state,piece);counts.set(key,(counts.get(key)||0)-1);}
  if([...counts.values()].some(v=>v!==0))throw new TypeError('Цвета дополнительной группы пирамиды недопустимы.');
}
export async function suggestLargePyramid(input,puzzle,{signal,onProgress}={}){
  const started=performance.now();abort(signal);if(puzzle.kind!=='pyramid'||puzzle.order<4||puzzle.order>20)throw new RangeError('Метод предназначен для пирамид размеров 4–20.');
  onProgress?.({phase:'mapping',message:'Проверяю конструктивную таблицу пирамиды…'});
  const state=Uint32Array.from(input),{model,seeds,quotient,fixed,tables}=modelFor(puzzle),fixedIndices=[...fixed],extras=model.orbits.filter(o=>seeds.has(o.id)),phaseCount=1+extras.length;
  const coverage={complete:true,supported:true,provedAllStages:true,historyRequired:false,extraOrbits:extras.length,method};
  const candidate=(stage,title,moves,after,phaseIndex,newlyFixedIndices)=>({stage,title,method,candidates:[{id:`${puzzle.id}-${stage}`,stage,title,method,moves,state:after,moveCount:moves.length,fixedIndices:[...fixedIndices],newlyFixedIndices,phaseIndex,phaseCount,claim:'Фиксирует группу деталей, сохраняя все предыдущие группы.'}],coverage:{...coverage,elapsedMs:performance.now()-started}});
  if(fixed.some(f=>state[f]!==model.goal[f])){
    onProgress?.({phase:'base',message:'Собираю вершины, базовые рёбра и связанные группы…'});
    const moves=quotient.solve(state),after=applyPolyAlg(state,puzzle,moves);
    if(!moves.length||fixed.some(f=>after[f]!==model.goal[f]))throw new Error('Базовая цепочка пирамиды не собрала выбранные детали.');
    return candidate('CORE','Вершины и связанные группы',moves,after,1,[...fixed]);
  }
  for(let i=0;i<extras.length;i++){
    abort(signal);const orbit=extras[i],indices=orbit.indices.flatMap(piece=>model.pieces[piece]);checkGroupColours(model,state,orbit);
    if(indices.every(f=>state[f]===model.goal[f])){fixedIndices.push(...indices);continue;}
    onProgress?.({phase:'orbit',message:`Собираю дополнительную группу ${i+1} из ${extras.length}…`});
    if(!tables.has(orbit.id)){while(tables.size>=2)tables.delete(tables.keys().next().value);tables.set(orbit.id,tableForOrbit(model,orbit,seeds.get(orbit.id)));}
    const solution=solveOrbitColours(model,state,orbit,tables.get(orbit.id),{signal});
    if(fixedIndices.some(f=>solution.state[f]!==state[f]))throw new Error('Коммутатор пирамиды затронул ранее собранные детали.');
    fixedIndices.push(...indices);return candidate(`ORBIT_${i+1}`,`${orbit.stickers===2?'Рёбра':'Центры'} · группа ${i+1} из ${extras.length}`,solution.moves,solution.state,2+i,indices);
  }
  if(!isPolySolved(state,puzzle))throw new Error('Конечная проверка пирамиды не пройдена.');
  return {stage:'DONE',title:'Пирамида собрана',method,candidates:[],coverage:{...coverage,elapsedMs:performance.now()-started}};
}
