/* Ortega for the current 2x2 facelet state. No game history or external solver. */
import {applyAlg,getPermutation,isSolved,parseAlg,solvedState} from './core.mjs';

export const TWO_METHOD='Ortega';
export const TWO_STAGE_NAMES=Object.freeze({D_FACE:'Первая сторона · Ortega',OLL:'Противоположная сторона · OLL',PBL:'Оба слоя · PBL',DONE:'Куб 2×2 собран'});
const OPPOSITE=[3,4,5,0,1,2];
const CORNERS=[[3,4,9],[2,8,17],[0,16,21],[1,20,5],[13,11,6],[12,19,10],[14,23,18],[15,7,22]];
const CORNER_COLORS=CORNERS.map(indices=>indices.map(i=>Math.floor(i/4)));
const OUTER=Object.freeze(['R','U','F','L','D','B'].flatMap(f=>[f,f+"'",f+'2']));
const LABELS=Uint32Array.from({length:24},(_,i)=>i);
const now=()=>globalThis.performance?.now?.()??Date.now();
const equal=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const face=(state,index,color)=>[0,1,2,3].every(i=>state[index*4+i]===color);
export const isFirstSide2=(state,color=0)=>face(state,3,color);
export const isOriented2=(state,color=0)=>isFirstSide2(state,color)&&face(state,0,OPPOSITE[color]);

/** 2x2 has no edge parity restriction: all eight corner permutations are legal. */
export function validate2(state){
  const errors=[];
  if(!state||state.length!==24)return {valid:false,errors:['Ожидаются 24 наклейки куба 2×2.']};
  const counts=Array(6).fill(0);
  for(const c of state){if(!Number.isInteger(c)||c<0||c>5)return {valid:false,errors:['Каждая наклейка должна иметь один из шести цветов.']};counts[c]++;}
  if(counts.some(c=>c!==4))errors.push('Каждый цвет должен встречаться четыре раза.');
  const used=new Set();let twist=0;
  for(const indices of CORNERS){
    const colors=indices.map(i=>state[i]),orientation=colors.findIndex(c=>c===0||c===3);
    const corner=orientation<0?-1:CORNER_COLORS.findIndex(c=>c.every((v,i)=>v===colors[(orientation+i)%3]));
    if(corner<0||used.has(corner))errors.push('Неверный или повторяющийся угловой элемент.');
    used.add(corner);twist+=Math.max(0,orientation);
  }
  if(twist%3)errors.push('Сумма разворотов углов невозможна на настоящем кубе.');
  return {valid:errors.length===0,errors};
}

// Same-colour corner abstraction: C(8,4)*3^4 = 5670 states. Each bit is a
// physical sticker location, so all 18 transitions come directly from core.
let crossTable=null;
const movePerms=OUTER.map(token=>{
  const p=getPermutation(2,token),forward=new Uint8Array(24);
  for(let dest=0;dest<24;dest++)forward[p[dest]]=dest;
  return forward;
});
function moveMask(mask,permutation){let result=0;for(let i=0;i<24;i++)if(mask&(1<<i))result|=1<<permutation[i];return result;}
function colorMask(state,color){let mask=0;for(let i=0;i<24;i++)if(state[i]===color)mask|=1<<i;return mask;}
export function buildFirstSideTable2(){
  if(crossTable)return crossTable;
  const goal=15<<12,distances=new Map([[goal,0]]),queue=[goal];let maxDepth=0;
  for(let head=0;head<queue.length;head++){
    const mask=queue[head],depth=distances.get(mask)+1;
    for(const p of movePerms){const next=moveMask(mask,p);if(!distances.has(next)){distances.set(next,depth);queue.push(next);maxDepth=Math.max(maxDepth,depth);}}
  }
  if(distances.size!==5670)throw new Error('Внутренняя таблица первой стороны не прошла проверку полноты.');
  crossTable={distances,states:distances.size,maxDepth};return crossTable;
}

// Formulas already present in RG2's ORTEGA-1 / ORTEGA-2 lessons. We verify
// every selected sequence against the current facelet state before returning it.
// The catalogue is mathematical notation, never code/assets from another APK.
export const ORTEGA_OLL=Object.freeze([
  ['Sune',"R U R' U R U2 R'"],
  ['AntiSune',"R' U' R U' R' U2 R"],
  ['T-OLL',"R U R' U' F' U' F"],
  ['L-OLL',"R U2 R' U2 F' U' F"],
  ['U-OLL',"F R U R' U' F'"],
  ['Pi-OLL',"F (R U R' U')2 F'"],
  ['H-OLL',"R2 U2 R U2 R2"],
].map(([caseId,alg])=>Object.freeze({caseId,alg,source:'ORTEGA-1'})));
export const ORTEGA_PBL=Object.freeze([
  ['PBL #1',"R U2 R' U' R U2 L' U R' U' L"],
  ['PBL #1b',"R' F R' F2 R U' R' F2 R2"],
  ['PBL #2',"R U' R' U' F2 U' R U R' D R2"],
  ['PBL #3',"R2 U' R2 U2 F2 U' R2"],
  ['PBL #3b',"R2 U' B2 U2 R2 U' R2"],
  ['PBL #4',"R U' F U2 F' U R'"],
  ['PBL #4b',"R U R U' B2 U R' U' R'"],
  ['PBL #5',"R' U L' U' R2 U' R' U2 R U'"],
  ['PBL #6',"R' F R' F2 R U' R"],
  ['PBL #6b',"R U' L U2 R' U L'"],
  ['PBL #7',"R2 B2 R2"],
  ['PBL #8',"R U' R' U' F2 U' R U R' D F2 R2"],
].map(([caseId,alg])=>Object.freeze({caseId,alg,source:'ORTEGA-2'})));
const turns=face=>[[],[face],[face+'2'],[face+"'"]];
function tokens(alg){return parseAlg(alg,2).map(m=>m.token);}
function compact(moves){const out=[];for(const token of moves){const last=out.at(-1);if(last?.[0]===token[0]){const power=t=>t.endsWith('2')?2:t.endsWith("'")?3:1,n=(power(last)+power(token))%4;out.pop();if(n)out.push(token[0]+(n===2?'2':n===3?"'":''));}else out.push(token);}return out;}
function compiled(record,moves){return {...record,moves,permutation:Uint8Array.from(applyAlg(LABELS,2,moves))};}
let ollLibrary=null,pblLibrary=null;
function libraries(){
  if(ollLibrary)return;
  ollLibrary=[];pblLibrary=[];
  for(const record of ORTEGA_OLL)for(const u of turns('U'))ollLibrary.push(compiled(record,compact([...u,...tokens(record.alg)])));
  // Independent U and D setup/AUF covers all 24*24 permutations of both layers.
  const pblRecords=[{caseId:'AUF',alg:'',source:'ORTEGA-2'},...ORTEGA_PBL];
  const flip={U:'D',D:'U',R:'R',L:'L',F:'B',B:'F'};
  for(const original of pblRecords)for(const upsideDown of [false,true]){
    // x2-conjugate the notation into the same world frame, rather than asking
    // the player to keep their chosen bottom colour on top after an algorithm.
    const body=tokens(original.alg).map(t=>upsideDown?flip[t[0]]+t.slice(1):t);
    const record={...original,caseId:original.caseId+(upsideDown?' · слои наоборот':'')};
    if(!isOriented2(applyAlg(solvedState(2),2,body),3))continue;
    for(const u of turns('U'))for(const d of turns('D'))for(const finalU of turns('U'))for(const finalD of turns('D')){
      const moves=compact([...u,...d,...body,...finalU,...finalD]);
      pblLibrary.push(compiled(record,moves));
    }
  }
  const compare=(a,b)=>a.moves.length-b.moves.length||a.moves.join(' ').localeCompare(b.moves.join(' '));
  ollLibrary.sort(compare);pblLibrary.sort(compare);
}
function permuted(state,p){return Uint32Array.from(p,index=>state[index]);}
function abortIfRequested(signal){if(signal?.aborted)throw new DOMException('Расчёт отменён','AbortError');}
function candidate(state,moves,stage,extra={}){
  const after=applyAlg(state,2,moves);
  return {id:`ortega-${stage}-${moves.join('_')}`,stage,title:TWO_STAGE_NAMES[stage],method:TWO_METHOD,moves,state:after,htm:moves.length,...extra};
}
export function next2Stage(state,{crossColor=0}={}){
  if(isSolved(state,2))return 'DONE';
  if(!isFirstSide2(state,crossColor))return 'D_FACE';
  return isOriented2(state,crossColor)?'PBL':'OLL';
}

/** Returns one real Ortega stage; maxMs limits query work, never invents a result. */
export function suggest2(input,{crossColor=0,maxMs=1500,maxCandidates=3,signal}={}){
  abortIfRequested(signal);
  if(!Number.isInteger(crossColor)||crossColor<0||crossColor>5)throw new RangeError('Выбери цвет нижней стороны.');
  const validation=validate2(input);if(!validation.valid)throw new TypeError(validation.errors.join(' '));
  const state=Uint32Array.from(input),stage=next2Stage(state,{crossColor}),started=now(),candidates=[],seen=new Set();
  const limit=Math.max(1,Math.min(12,Number.isInteger(maxCandidates)?maxCandidates:3)),budget=Number.isFinite(maxMs)?Math.max(1,maxMs):1500;
  function add(moves,metadata={}){
    const key=moves.join(' ');if(seen.has(key))return;seen.add(key);
    const value=candidate(state,moves,stage,metadata);
    const valid=stage==='D_FACE'?isFirstSide2(value.state,crossColor):stage==='OLL'?isOriented2(value.state,crossColor):isSolved(value.state,2);
    if(!valid)throw new Error('Найденный этап Ortega не прошёл проверку состояния.');
    candidates.push(value);
  }
  if(stage==='DONE')return {stage,title:TWO_STAGE_NAMES[stage],method:TWO_METHOD,candidates,coverage:{complete:true,elapsedMs:now()-started,message:'Все шесть сторон собраны.'}};
  if(stage==='D_FACE'){
    const table=buildFirstSideTable2(),initial=colorMask(state,crossColor),distance=table.distances.get(initial);
    if(distance===undefined)throw new Error('Сторона не найдена в полной таблице допустимых состояний.');
    function descend(mask,path){
      if(candidates.length>=limit)return;
      abortIfRequested(signal);
      if(path.length&&now()-started>budget&&candidates.length)return;
      const depth=table.distances.get(mask);
      if(!depth){add(path,{caseId:'Первая сторона',source:'ORTEGA-0',claim:'Кратчайший путь к выбранной нижней стороне (HTM).',distance});return;}
      for(let i=0;i<OUTER.length;i++){
        const next=moveMask(mask,movePerms[i]);
        if(table.distances.get(next)===depth-1)descend(next,[...path,OUTER[i]]);
        if(candidates.length>=limit)return;
      }
    }
    descend(initial,[]);
    return {stage,title:TWO_STAGE_NAMES[stage],method:TWO_METHOD,candidates,coverage:{complete:true,states:table.states,maxDepth:table.maxDepth,optimalHtm:distance,elapsedMs:now()-started}};
  }
  libraries();
  const library=stage==='OLL'?ollLibrary:pblLibrary;
  let inspected=0,timedOut=false;
  for(const record of library){
    abortIfRequested(signal);inspected++;
    const after=permuted(state,record.permutation),valid=stage==='OLL'?isOriented2(after,crossColor):isSolved(after,2);
    if(valid){add(record.moves,{caseId:record.caseId,source:record.source,claim:stage==='OLL'?'Алгоритм OLL из урока RG2 Ortega.':'Алгоритм PBL из урока RG2 Ortega с доводками U/D.'});if(candidates.length>=limit)break;}
    if(inspected%32===0&&now()-started>budget){timedOut=true;break;}
  }
  return {stage,title:TWO_STAGE_NAMES[stage],method:TWO_METHOD,candidates,coverage:{complete:!timedOut,inspected,library:library.length,elapsedMs:now()-started,message:candidates.length?'Этап проверен на текущей раскраске.':timedOut?'Истёк лимит поиска; повтори с большим maxMs.':'Состояние не покрыто проверенной библиотекой Ortega.'}};
}
