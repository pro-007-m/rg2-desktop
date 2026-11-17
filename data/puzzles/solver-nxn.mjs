/* State-only RG2 adapter for the separately attributed GPL RCube backend.
 * See vendor/rcube/NOTICE.md, LICENSE.txt, SOURCE.json and complete source snapshot.
 * This labels the constructive method honestly; it does not label it CFOP.
 */
import {RCube} from './vendor/rcube/rcube.mjs';
import {solvedState,validateState,isSolved,applyAlg,parseAlg,formatMove} from './core.mjs';
import {CORNER_FACELETS,validate as validate3} from '../solver/core.mjs';
const TO_RC=[4,1,0,5,3,2],FROM_RC=[2,1,5,4,0,3];
const PHASES={centers:'Собрать центры',corners:'Поставить и развернуть углы',edges:'Собрать рёбра'};

function cancelled(signal){if(signal?.aborted)throw new DOMException('Расчёт отменён.','AbortError');}
function checkSize(size){if(!Number.isInteger(size)||size<4||size>50)throw new RangeError('Конструктивный метод поддерживает кубы от 4×4 до 50×50.');}
function equal(a,b){return a.length===b.length&&a.every((value,index)=>value===b[index]);}
function normalizeInput(input,size,initial){
  checkSize(size);validateState(input,size,{colors:true});
  const goal=initial===undefined?solvedState(size):initial;
  validateState(goal,size,{colors:true});if(!isSolved(goal,size))throw new TypeError('Начальная цветовая схема должна быть собранным кубом.');
  const area=size*size,goalColors=Array.from({length:6},(_,face)=>goal[face*area]);
  const colorToCanonical=new Uint8Array(6);goalColors.forEach((color,face)=>{colorToCanonical[color]=face;});
  const counts=new Uint32Array(6);for(const color of input)counts[color]++;
  if(counts.some(count=>count!==area))throw new TypeError('Количество наклеек каждого цвета должно совпадать с площадью грани.');
  const normalized=Uint32Array.from(input,color=>colorToCanonical[color]);
  // Corner legality can be checked independently of NxN wing/center parities.
  // Fixed solved 3x3 edges may give PARITY for perfectly legal even-NxN corners.
  const cornerTemplate=Uint8Array.from({length:54},(_,i)=>Math.floor(i/9));
  for(const triple of CORNER_FACELETS)for(const index of triple){
    const face=Math.floor(index/9),row=Math.floor(index%9/3),column=index%3;
    cornerTemplate[index]=normalized[face*area+(row===0?0:size-1)*size+(column===0?0:size-1)];
  }
  const invalid=validate3(cornerTemplate).errors.filter(error=>error.code!=='PARITY');
  if(invalid.length)throw new TypeError('Состояние углов куба недопустимо: '+invalid.map(error=>error.message).join(' '));
  return {normalized,goalColors};
}
function goalSatisfied(state,size,part){
  const m=size-1,area=size*size;
  for(let face=0;face<6;face++){
    const wanted=TO_RC[face],value=(r,c)=>state[face*area+r*size+c];
    if(part==='centers'){
      for(let r=1;r<m;r++)for(let c=1;c<m;c++)if(value(r,c)!==wanted)return false;
    }else if(part==='corners'){
      for(const r of [0,m])for(const c of [0,m])if(value(r,c)!==wanted)return false;
    }else{
      for(let i=1;i<m;i++)for(const [r,c] of [[0,i],[m,i],[i,0],[i,m]])if(value(r,c)!==wanted)return false;
    }
  }return true;
}
function simplify(tokens){
  const stack=[];
  for(const token of tokens){
    const base=token.replace(/[2']$/,''),turns=token.endsWith('2')?2:token.endsWith("'")?3:1;
    if(stack.at(-1)?.base===base){const previous=stack.pop();const sum=(previous.turns+turns)%4;if(sum)stack.push({base,turns:sum});}
    else stack.push({base,turns});
  }
  return stack.map(({base,turns})=>base+(turns===2?'2':turns===3?"'":''));
}
export async function solveNxN(input,size,options={}){
  cancelled(options.signal);
  const started=performance.now(),{normalized,goalColors}=normalizeInput(input,size,options.initialState);
  const original=Uint32Array.from(input);
  const timeoutMs=options.timeoutMs??150000,maxMoves=options.maxMoves??200000;
  if(!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>180000||!Number.isInteger(maxMoves)||maxMoves<1||maxMoves>200000)throw new RangeError('Неверный лимит расчёта.');
  const coverage={sizes:[4,50],stateOnly:true,historyRequired:false,method:'constructive',verified:true};
  if(isSolved(original,size))return {method:'constructive',title:'Конструктивный',moves:[],state:original,stages:[],coverage,elapsedMs:performance.now()-started};
  let activePhase='centers';
  const notify=progress=>{cancelled(options.signal);if(typeof options.onProgress==='function')options.onProgress({stage:activePhase,title:PHASES[activePhase],method:'constructive',...progress});};
  const cube=new RCube(size,Uint32Array.from(normalized,color=>TO_RC[color]),{signal:options.signal,timeoutMs,maxMoves,onProgress:progress=>notify({moves:progress.moves})});
  const restoreColors=()=>Uint32Array.from(cube.state,color=>goalColors[FROM_RC[color]]);
  const stages=[];let previous=original;
  function runPhase(stage,action){
    activePhase=stage;const start=cube.moves.length;notify({moves:start});action();cancelled(options.signal);
    const moves=simplify(cube.moves.slice(start)),state=restoreColors();
    // Output is independently replayed through the application's exact move engine.
    if(!equal(applyAlg(previous,size,moves),state))throw new Error('Проверка последовательности ходов не прошла.');
    if(!goalSatisfied(cube.state,size,stage))throw new Error('Этап сборки не достиг своей цели.');
    if(moves.length)stages.push({id:`constructive-${stage}`,stage,title:PHASES[stage],method:'constructive',moves,state});
    previous=state;
  }
  if(!goalSatisfied(cube.state,size,'centers'))runPhase('centers',()=>{cube.AlignTrueCenters();cube.SolveCenters();});
  cube.Stage=15;
  if(!goalSatisfied(cube.state,size,'corners'))runPhase('corners',()=>cube.SolveCorners());
  cube.Stage=16;
  if(!goalSatisfied(cube.state,size,'edges'))runPhase('edges',()=>{
    if(cube.IsEven)cube.SolveEdgesEven();
    else{cube.SolveEdgesOdd();if(!goalSatisfied(cube.state,size,'edges'))cube.SolveEdgesOdd();}
  });
  const moves=stages.flatMap(stage=>stage.moves),state=restoreColors();
  if(!isSolved(state,size)||!equal(previous,state)||!cube.IsCubeSolved())throw new Error('Итоговая проверка сборки не прошла.');
  notify({moves:cube.moves.length,done:true});
  return {method:'constructive',title:'Конструктивный',moves,state,stages,coverage,rawMoveCount:cube.moves.length,elapsedMs:performance.now()-started};
}
export async function suggestNxN(input,size,options={}){
  const solution=await solveNxN(input,size,options),next=solution.stages[0];
  if(!next)return {stage:'solved',title:'Куб собран',method:'constructive',candidates:[],coverage:solution.coverage,plan:[]};
  return {stage:next.stage,title:next.title,method:'constructive',candidates:[{...next,moves:[...next.moves],state:next.state.slice(),verified:true}],
    coverage:solution.coverage,plan:solution.stages.map(stage=>({stage:stage.stage,title:stage.title,moves:stage.moves.length})),elapsedMs:solution.elapsedMs};
}

/** Inspect a real reduction, rather than merely sampling a possibly unpaired cube. */
export function extractVirtual3(input,size){
  checkSize(size);validateState(input,size,{colors:true});
  const area=size*size,mid=size>>1,q=[0,mid,size-1],state=new Uint8Array(54);
  let centers=true,paired=true;
  for(let f=0;f<6;f++){
    const value=(r,c)=>input[f*area+r*size+c],center=value(mid,mid);
    for(let r=1;r<size-1;r++)for(let c=1;c<size-1;c++)if(value(r,c)!==center)centers=false;
    for(let i=1;i<size-1;i++){
      if(value(0,i)!==value(0,mid)||value(size-1,i)!==value(size-1,mid)||value(i,0)!==value(mid,0)||value(i,size-1)!==value(mid,size-1))paired=false;
    }
    for(let r=0;r<3;r++)for(let c=0;c<3;c++)state[f*9+r*3+c]=value(q[r],q[c]);
  }
  const validation=validate3(state),readyFor3=centers&&paired&&validation.valid;
  return {valid:readyFor3,readyFor3,centers,paired,state,validation};
}

/** Lift the three logical layers to outer / complete inner block / outer. */
export function lift3Algorithm(algorithm,size){
  checkSize(size);
  return parseAlg(algorithm,3).map(move=>{
    const layers=[];
    for(const layer of move.layers){
      if(layer===0)layers.push(0);
      else if(layer===2)layers.push(size-1);
      else for(let i=1;i<size-1;i++)layers.push(i);
    }
    return formatMove({axis:move.axis,layers,turns:move.turns},size);
  });
}

// Primary 4x4 reference: CubeSkills beginner tutorial, PLL parity.
// The generalization replaces each 4x4 half-block by its even-N half-block.
// Its full NxN permutation is independently checked in the reduction tests.
export function pllParityAlgorithm(size){
  checkSize(size);if(size%2)throw new RangeError('PLL-паритет применяется только к чётному размеру.');
  const half=size/2,inner=half===2?'2R2':`2-${half}Rw2`,upper=`${half}Uw2`;
  return [inner,'U2',inner,upper,inner,upper];
}

const MIDGES=new Map();
function middleEdgeLocations(size){
  if(MIDGES.has(size))return MIDGES.get(size);
  const probe=new RCube(size,Uint32Array.from({length:6*size*size},(_,i)=>i)),pairs=[];
  for(let edge=0;edge<12;edge++){
    probe.SetDestinationEdge(edge,true);pairs.push(...probe.GetRightEdgeColors(probe.Mid));probe.SetDestinationEdge(edge,false);
  }
  const result=Uint32Array.from(pairs);MIDGES.set(size,result);return result;
}

/** Centres and paired edges, leaving the actual 3x3 stage to CFOP/COLL. */
export async function reduceNxN(input,size,options={}){
  cancelled(options.signal);
  const started=performance.now(),{normalized,goalColors}=normalizeInput(input,size,options.initialState),original=Uint32Array.from(input);
  const timeoutMs=options.timeoutMs??150000,maxMoves=options.maxMoves??200000;
  if(!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>180000||!Number.isInteger(maxMoves)||maxMoves<1||maxMoves>200000)throw new RangeError('Неверный лимит расчёта.');
  const before=extractVirtual3(original,size),coverage={sizes:[4,50],stateOnly:true,historyRequired:false,method:'reduction',verified:true};
  if(before.readyFor3)return {method:'reduction',title:'Редукция + CFOP',moves:[],state:original,stages:[],virtualState:before.state,readyFor3:true,coverage,rawMoveCount:0,elapsedMs:performance.now()-started};
  let activePhase='REDUCTION_CENTERS',current=original;
  const phaseTitles={REDUCTION_CENTERS:'Центры · редукция',REDUCTION_EDGES:'Спаривание рёбер · редукция',REDUCTION_PARITY:'Чётность перестановок · PLL-паритет'};
  const notify=progress=>{cancelled(options.signal);options.onProgress?.({stage:activePhase,title:phaseTitles[activePhase],method:'reduction',...progress});};
  const cube=new RCube(size,Uint32Array.from(normalized,color=>TO_RC[color]),{signal:options.signal,timeoutMs,maxMoves,onProgress:p=>notify({moves:p.moves})});
  const restored=()=>Uint32Array.from(cube.state,color=>goalColors[FROM_RC[color]]),stages=[];
  function runPhase(stage,action,goal){
    activePhase=stage;const start=cube.moves.length;notify({moves:start});action();cancelled(options.signal);
    const moves=simplify(cube.moves.slice(start)),state=restored();
    if(!equal(applyAlg(current,size,moves),state))throw new Error('Ходы редукции не воспроизвели вычисленное состояние.');
    if(!goal(state))throw new Error('Этап редукции не достиг своей цели.');
    if(moves.length)stages.push({id:stage.toLowerCase(),stage,title:phaseTitles[stage],method:'reduction',moves,state});
    current=state;
  }
  if(!goalSatisfied(cube.state,size,'centers'))runPhase('REDUCTION_CENTERS',()=>{cube.AlignTrueCenters();cube.SolveCenters();},state=>extractVirtual3(state,size).centers);
  let status=extractVirtual3(current,size);
  if(!status.paired||!status.validation.valid&&status.validation.errors.some(error=>error.code!=='PARITY')){
    cube.Stage=16;
    if(!cube.IsEven){
      // The true edge/corner permutation of an odd cube is already a legal 3x3.
      // Pair wings to those *current* true middle edges, not canonical solved edges.
      cube.edgeColorMap=Array.from(middleEdgeLocations(size),index=>cube.state[index]);
      cube.skipTrueMidges=true;
    }
    runPhase('REDUCTION_EDGES',()=>cube.SolveEdgesEven(),state=>{const s=extractVirtual3(state,size);return s.centers&&s.paired;});
    status=extractVirtual3(current,size);
  }
  let parityMoves=0;
  if(!status.validation.valid){
    if(size%2||status.validation.errors.some(error=>error.code!=='PARITY'))throw new Error('После редукции осталось недопустимое виртуальное состояние 3×3.');
    activePhase='REDUCTION_PARITY';const moves=pllParityAlgorithm(size);notify({moves:cube.moves.length});
    if(cube.moves.length+moves.length>maxMoves)throw new Error('RCube move budget exceeded');
    const state=applyAlg(current,size,moves),next=extractVirtual3(state,size);
    if(!next.readyFor3)throw new Error('Исправление PLL-паритета не прошло независимую проверку.');
    stages.push({id:'reduction-parity',stage:activePhase,title:phaseTitles[activePhase],method:'reduction',moves,state});
    current=state;status=next;parityMoves=moves.length;
  }
  if(!status.readyFor3)throw new Error('Редукция не подготовила корректный куб 3×3.');
  notify({moves:cube.moves.length+parityMoves,done:true});
  return {method:'reduction',title:'Редукция + CFOP',moves:stages.flatMap(stage=>stage.moves),state:current,stages,virtualState:status.state,readyFor3:true,coverage,rawMoveCount:cube.moves.length+parityMoves,elapsedMs:performance.now()-started};
}

export async function suggestReduction(input,size,options={}){
  const result=await reduceNxN(input,size,options),next=result.stages[0];
  if(!next)return {stage:'REDUCED',title:'Куб подготовлен к CFOP',method:'reduction',readyFor3:true,virtualState:result.virtualState,candidates:[],coverage:result.coverage,plan:[]};
  return {stage:next.stage,title:next.title,method:'reduction',readyFor3:false,candidates:[{...next,moves:[...next.moves],state:next.state.slice(),verified:true}],coverage:result.coverage,
    plan:result.stages.map(s=>({stage:s.stage,title:s.title,moves:s.moves.length})),elapsedMs:result.elapsedMs};
}
