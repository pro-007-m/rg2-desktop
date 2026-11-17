import * as cube from './core.mjs';
import {generateScramble} from './scramble.mjs';
import {validate as validate3,isSolved as isSolved3} from '../solver/core.mjs';

export const GAME_SCHEMA='rg2-puzzle-game',GAME_VERSION=1,MAX_HISTORY=200000;
export const FAMILY_NAMES={cube:'Куб',pyramid:'Пирамида',dodecahedron:'Додекаэдр'};
export function normalizeSpec(value={}){
  const kind=value.kind??'cube',size=Number(value.size??value.order??3),max=kind==='cube'?50:20;
  if(!Object.hasOwn(FAMILY_NAMES,kind)||!Number.isInteger(size)||size<2||size>max)throw new RangeError(`Размер должен быть целым числом от 2 до ${max}.`);
  return {kind,size};
}
export async function puzzleAdapter(spec){
  spec=normalizeSpec(spec);
  if(spec.kind==='cube')return {spec,solved:()=>cube.solvedState(spec.size),apply:(s,m)=>cube.applyMove(s,spec.size,m),parse:a=>cube.parseAlg(a,spec.size),inverse:m=>cube.invertMove(m,spec.size),format:m=>cube.formatMove(m,spec.size),isSolved:s=>spec.size===3?isSolved3(s):cube.isSolved(s,spec.size),scramble:()=>generateScramble(spec.size),puzzle:null};
  const poly=await import('./poly-core.mjs'),puzzle=poly.createPolyPuzzle(spec.kind,spec.size);
  return {spec,puzzle,solved:()=>puzzle.solvedState(),apply:(s,m)=>poly.applyPolyMove(s,puzzle,m),parse:a=>poly.parsePolyAlg(a,puzzle),inverse:m=>poly.invertPolyMove(m,puzzle),format:m=>poly.formatPolyMove(m,puzzle),isSolved:s=>poly.isPolySolved(s,puzzle),scramble:()=>poly.generatePolyScramble(puzzle)};
}
export async function createGame(spec,{initialState=null,crossColor=0}={}){
  const adapter=await puzzleAdapter(spec);let initial=adapter.solved();
  if(initialState){
    if(adapter.spec.kind!=='cube'||adapter.spec.size!==3||!validate3(initialState).valid)throw new TypeError('Передать раскраску можно только для корректного куба 3×3.');
    initial=Uint32Array.from(initialState);
  }else if(adapter.spec.kind==='cube')initial=orientSolved(adapter.spec.size,crossColor);
  return new Game(adapter,initial);
}
export function orientSolved(size,color=0){
  return cube.applyAlg(cube.solvedState(size),size,frameToCross(cube.solvedState(size),size,color));
}
export function frameToCross(initial,size,color=0){
  const queue=[{state:Uint32Array.from(initial),moves:[]}],seen=new Set();
  for(let head=0;head<queue.length;head++){
    const {state,moves}=queue[head],key=cube.FACE_NAMES.map((_,i)=>state[i*size*size]).join(',');
    if(state[3*size*size]===Number(color))return moves;
    if(seen.has(key))continue;seen.add(key);
    for(const m of ['x','y','z']){const next=cube.applyMove(state,size,m),k=cube.FACE_NAMES.map((_,i)=>next[i*size*size]).join(',');if(!seen.has(k))queue.push({state:next,moves:[...moves,m]});}
  }
  throw new RangeError('В цветовой схеме нет выбранного цвета.');
}
export class Game{
  constructor(adapter,initial){this.adapter=adapter;this.spec=adapter.spec;this.initial=Uint32Array.from(initial);this.state=this.initial.slice();this.goal=adapter.spec.kind==='cube'&&adapter.spec.size===3?Uint32Array.from({length:54},(_,i)=>initial[Math.floor(i/9)*9+4]):adapter.isSolved(initial)?this.initial.slice():adapter.solved();this.moves=[];this.turnCounts=[0];this.cursor=0;this.scramble='';this.segments=[];this.assisted=false;this.elapsed=0;this.startedAt=null;this.scrambleEnd=0;this.createdAt=Date.now();}
  get solved(){return this.adapter.isSolved(this.state);}
  get canUndo(){return this.cursor>0;}
  get canRedo(){return this.cursor<this.moves.length;}
  get playerMoves(){return Math.max(0,this.turnCounts[this.cursor]-this.turnCounts[Math.min(this.cursor,this.scrambleEnd)]);}
  isRotation(move){return this.spec.kind==='cube'?move.layers.length===this.spec.size:move.whole===true;}
  // A planned camera/frame change must not alter the goal before its moves commit.
  setCrossFrame(color){return this.spec.kind==='cube'?frameToCross(this.goal,this.spec.size,color):[];}
  syncGoal(command=null){
    if(this.spec.kind!=='cube')return;
    const n=this.spec.size,area=n*n;
    if(command&&this.isRotation(command))this.goal=this.adapter.apply(this.goal,command);
    if(n%2===1){const middle=Math.floor(n/2);this.goal=Uint32Array.from({length:6*area},(_,i)=>this.state[Math.floor(i/area)*area+middle*n+middle]);return;}
    // Even cubes have no fixed centre. Once all centre blocks are uniform they
    // define the current frame, including after lifted M/E/S reduction moves.
    if(n===2){if(this.solved)this.goal=this.state.slice();return;}
    const colors=[];
    for(let face=0;face<6;face++){
      const offset=face*area,color=this.state[offset+n+1];
      for(let row=1;row<n-1;row++)for(let column=1;column<n-1;column++)if(this.state[offset+row*n+column]!==color)return;
      colors.push(color);
    }
    const candidate=Uint32Array.from({length:6*area},(_,i)=>colors[Math.floor(i/area)]);
    if(cube.isSolved(candidate,n))this.goal=candidate;
  }
  start(){if(this.startedAt===null)this.startedAt=performance.now();}
  stop(){if(this.startedAt!==null){this.elapsed+=Math.max(0,performance.now()-this.startedAt);this.startedAt=null;}}
  get time(){return this.elapsed+(this.startedAt===null?0:Math.max(0,performance.now()-this.startedAt));}
  apply(move,{source='manual',stage=null}={}){
    const parsed=this.adapter.parse(typeof move==='string'?move:[move]);if(parsed.length!==1)throw new TypeError('Ожидается один ход.');
    if(this.cursor>=MAX_HISTORY)throw new RangeError('История заполнена. Сохрани партию и начни новую.');
    const command=parsed[0],next=this.adapter.apply(this.state,command);
    if(this.cursor<this.moves.length){this.moves=this.moves.slice(0,this.cursor);this.turnCounts=this.turnCounts.slice(0,this.cursor+1);this.scrambleEnd=Math.min(this.scrambleEnd,this.cursor);this.scramble=this.moves.slice(0,this.scrambleEnd).map(m=>this.adapter.format(m)).join(' ');this.segments=this.segments.filter(s=>s.start<this.cursor).map(s=>({...s,end:Math.min(s.end,this.cursor)}));}
    if(source==='manual'&&this.cursor>=this.scrambleEnd&&!this.isRotation(command))this.start();
    if(source==='solver')this.assisted=true;
    this.moves.push(command);this.turnCounts.push(this.turnCounts.at(-1)+(this.isRotation(command)?0:1));this.cursor++;this.state=next;this.syncGoal(command);
    if(stage){const last=this.segments.at(-1);if(last&&last.title===stage&&last.end===this.cursor-1)last.end=this.cursor;else this.segments.push({title:String(stage).slice(0,160),start:this.cursor-1,end:this.cursor});}
    if(this.solved)this.stop();return command;
  }
  undo(){if(!this.canUndo)return null;this.stop();const m=this.adapter.inverse(this.moves[this.cursor-1]);this.state=this.adapter.apply(this.state,m);this.cursor--;this.syncGoal(m);return m;}
  redo(){if(!this.canRedo)return null;this.stop();const m=this.moves[this.cursor++];this.state=this.adapter.apply(this.state,m);this.syncGoal(m);return m;}
  applyInstant(algorithm,options){const moves=this.adapter.parse(algorithm);for(const m of moves)this.apply(m,options);return moves;}
  resetAttempt(){this.stop();this.state=this.initial.slice();this.goal=this.adapter.isSolved(this.initial)?this.initial.slice():this.adapter.solved();this.syncGoal();this.cursor=0;for(let i=0;i<this.scrambleEnd;i++){this.state=this.adapter.apply(this.state,this.moves[i]);this.syncGoal(this.moves[i]);this.cursor++;}this.elapsed=0;this.assisted=false;}
  markScramble(moves){this.scramble=moves.map(m=>this.adapter.format(m)).join(' ');this.scrambleEnd=this.cursor;this.elapsed=0;this.startedAt=null;}
  toJSON(){return {schema:GAME_SCHEMA,version:GAME_VERSION,spec:this.spec,initial:[...this.initial],goal:[...this.goal],moves:this.moves.map(m=>m.token??this.adapter.format(m)),cursor:this.cursor,scramble:this.scramble,scrambleEnd:this.scrambleEnd,segments:this.segments,assisted:this.assisted,elapsed:this.time,createdAt:this.createdAt};}
}
export async function restoreGame(input){
  if(typeof input==='string'){if(input.length>8*1024*1024)throw new RangeError('Файл партии больше 8 МБ.');input=JSON.parse(input);}
  if(!input||input.schema!==GAME_SCHEMA||input.version!==GAME_VERSION)throw new TypeError('Неизвестный формат партии.');
  const adapter=await puzzleAdapter(input.spec),solved=adapter.solved(),colors=adapter.spec.kind==='cube'?6:adapter.puzzle.faceCount+1;
  if(!Array.isArray(input.initial)||input.initial.length!==solved.length||input.initial.some(c=>!Number.isInteger(c)||c<0||c>=colors))throw new TypeError('Повреждено исходное состояние.');
  const initial=Uint32Array.from(input.initial);
  if(adapter.spec.kind==='cube'&&adapter.spec.size===3?!validate3(initial).valid:!adapter.isSolved(initial))throw new TypeError('Исходное состояние не соответствует поддерживаемой головоломке.');
  if(!Array.isArray(input.moves)||input.moves.length>MAX_HISTORY||input.moves.some(m=>typeof m!=='string'||m.length>64)||!Number.isInteger(input.cursor)||input.cursor<0||input.cursor>input.moves.length)throw new TypeError('Повреждена история ходов.');
  const game=new Game(adapter,initial),parsed=input.moves.map(m=>{const list=adapter.parse(m);if(list.length!==1)throw new TypeError('Неверный ход.');return list[0];});
  game.moves=parsed;game.cursor=input.cursor;game.turnCounts=[0];for(const move of parsed)game.turnCounts.push(game.turnCounts.at(-1)+(game.isRotation(move)?0:1));
  if(input.goal!==undefined){if(!Array.isArray(input.goal)||input.goal.length!==initial.length||input.goal.some(c=>!Number.isInteger(c)||c<0||c>=colors)||!adapter.isSolved(input.goal)||(adapter.spec.kind==='cube'&&adapter.spec.size===3&&!validate3(input.goal).valid))throw new TypeError('Повреждена цветовая схема цели.');}
  // Reconstruct the frame from the same timeline as the state. This also repairs
  // old saves made before a queued frame rotation had actually finished.
  for(let i=0;i<game.cursor;i++){game.state=adapter.apply(game.state,parsed[i]);game.syncGoal(parsed[i]);}
  game.scrambleEnd=Number.isInteger(input.scrambleEnd)&&input.scrambleEnd>=0&&input.scrambleEnd<=parsed.length?input.scrambleEnd:0;
  game.scramble=parsed.slice(0,game.scrambleEnd).map(m=>adapter.format(m)).join(' ');
  game.segments=Array.isArray(input.segments)?input.segments.filter(s=>s&&typeof s.title==='string'&&Number.isInteger(s.start)&&Number.isInteger(s.end)&&s.start>=0&&s.end>s.start&&s.end<=parsed.length).map(s=>({title:s.title.slice(0,160),start:s.start,end:s.end})):[];
  game.assisted=input.assisted===true;game.elapsed=Number.isFinite(input.elapsed)&&input.elapsed>=0?Math.min(input.elapsed,365*86400000):0;game.createdAt=Number.isSafeInteger(input.createdAt)&&input.createdAt>0?input.createdAt:Date.now();
  return game;
}

const DB_NAME='rg2-puzzle-games',STORE='sessions';
async function database(){return new Promise((resolve,reject)=>{const request=indexedDB.open(DB_NAME,1);request.onupgradeneeded=()=>request.result.createObjectStore(STORE);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
export async function saveGame(game){const json={...game.toJSON(),updatedAt:Date.now()};try{const db=await database();await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE);store.put(json,'current');store.put(json,`${game.spec.kind}-${game.spec.size}-${game.createdAt}`);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();try{localStorage.removeItem('rg2.puzzles.fallback');localStorage.setItem('rg2.puzzles.lastSpec',JSON.stringify(game.spec));}catch{}}catch{if(JSON.stringify(json).length<2*1024*1024)localStorage.setItem('rg2.puzzles.fallback',JSON.stringify(json));else throw new Error('Не удалось сохранить длинную партию. Экспортируй её в файл.');}}
export async function loadGame(){let record=null;try{const db=await database();record=await new Promise((resolve,reject)=>{const req=db.transaction(STORE).objectStore(STORE).get('current');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});db.close();}catch{}try{const fallback=JSON.parse(localStorage.getItem('rg2.puzzles.fallback'));if(fallback&&(!record||fallback.updatedAt>record.updatedAt))record=fallback;}catch{}return record?restoreGame(record):null;}
export async function listGames(){try{const db=await database(),list=await new Promise((resolve,reject)=>{const result=[],req=db.transaction(STORE).objectStore(STORE).openCursor();req.onsuccess=()=>{const cursor=req.result;if(!cursor){resolve(result);return;}if(cursor.key!=='current'){const v=cursor.value;result.push({key:cursor.key,spec:v.spec,cursor:v.cursor,updatedAt:v.updatedAt});}cursor.continue();};req.onerror=()=>reject(req.error);});db.close();return list.sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,30);}catch{return [];}}
export async function loadSavedGame(key){if(typeof key!=='string'||key==='current'||key.length>100)throw new TypeError('Неверная партия.');const db=await database(),record=await new Promise((resolve,reject)=>{const req=db.transaction(STORE).objectStore(STORE).get(key);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});db.close();return restoreGame(record);}
