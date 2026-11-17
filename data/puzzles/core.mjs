/* Pure surface-facelet NxN mathematics. No floating point or renderer state. */
import {assertSize,normalizeMove,parseAlg} from './notation.mjs';
export {parseAlg,normalizeMove};
export {parseMove,invertMove,invertAlg,formatMove,formatAlg} from './notation.mjs';
export const FACE_NAMES=Object.freeze(['U','R','F','D','L','B']);
const NORMALS=Object.freeze([[0,1,0],[1,0,0],[0,0,1],[0,-1,0],[-1,0,0],[0,0,-1]].map(Object.freeze));
const AXIS_INDEX={x:0,y:1,z:2};
const CACHE_MAX_ENTRIES=128,CACHE_MAX_BYTES=8*1024*1024;
const cache=new Map();let cachedBytes=0;

export function solvedState(size) {
  assertSize(size);const area=size*size;
  return Uint32Array.from({length:6*area},(_,i)=>Math.floor(i/area));
}
export function sizeOf(state) {
  const size=Math.sqrt((state?.length||0)/6);assertSize(size);return size;
}
export function validateState(state,size,{colors=false}={}) {
  assertSize(size);
  if(!(Array.isArray(state)||ArrayBuffer.isView(state))||state.length!==6*size*size)throw new TypeError('Число наклеек не соответствует размеру куба.');
  if(state instanceof Uint32Array && !colors)return true;
  for(const value of state)if(!Number.isInteger(value)||value<0||value>0xffffffff||(colors&&value>5))throw new TypeError('Неверное значение наклейки.');
  return true;
}
export function faceletGeometry(size,index) {
  assertSize(size);const area=size*size;
  if(!Number.isInteger(index)||index<0||index>=6*area)throw new RangeError('Неверный номер наклейки.');
  const f=Math.floor(index/area),row=Math.floor((index%area)/size),column=index%size,m=size-1,r=row,c=column;
  const position=[
    [c,m,r],[m,m-r,m-c],[c,m-r,m],[c,0,m-r],[0,m-r,c],[m-c,m-r,0],
  ][f];
  return {index,face:FACE_NAMES[f],faceIndex:f,row,column,position,normal:[...NORMALS[f]]};
}
export function geometryToFacelet(size,position,normal) {
  assertSize(size);const m=size-1;
  if(!Array.isArray(position)||position.length!==3||position.some(v=>!Number.isInteger(v)||v<0||v>m)||!Array.isArray(normal)||normal.length!==3)throw new TypeError('Неверные координаты наклейки.');
  const [x,y,z]=position,[nx,ny,nz]=normal;let face,row,column;
  if(nx===0&&ny===1&&nz===0&&y===m){face=0;row=z;column=x;}
  else if(nx===1&&ny===0&&nz===0&&x===m){face=1;row=m-y;column=m-z;}
  else if(nx===0&&ny===0&&nz===1&&z===m){face=2;row=m-y;column=x;}
  else if(nx===0&&ny===-1&&nz===0&&y===0){face=3;row=m-z;column=x;}
  else if(nx===-1&&ny===0&&nz===0&&x===0){face=4;row=m-y;column=z;}
  else if(nx===0&&ny===0&&nz===-1&&z===0){face=5;row=m-y;column=m-x;}
  else throw new RangeError('Нормаль не соответствует поверхности куба.');
  return face*size*size+row*size+column;
}
function rotate(position,axis,turns,size,normal=false) {
  let [x,y,z]=position;const m=normal?0:size-1;
  for(let i=0,count=(turns+4)%4;i<count;i++) {
    if(axis==='x')[y,z]=[m-z,y];
    else if(axis==='y')[x,z]=[z,m-x];
    else [x,y]=[m-y,x];
  }
  return [x||0,y||0,z||0];
}
function permutationEntry(size,input) {
  const move=normalizeMove(input,size),key=`${size}:${move.axis}:${move.layers[0]}-${move.layers.at(-1)}:${move.turns}`;
  if(cache.has(key)) {const hit=cache.get(key);cache.delete(key);cache.set(key,hit);return hit;}
  const count=6*size*size,permutation=Uint32Array.from({length:count},(_,i)=>i),axis=AXIS_INDEX[move.axis];
  const lo=move.layers[0],hi=move.layers.at(-1);
  for(let source=0;source<count;source++) {
    const sticker=faceletGeometry(size,source),layer=sticker.position[axis];
    if(layer<lo||layer>hi)continue;
    const destination=geometryToFacelet(size,rotate(sticker.position,move.axis,move.turns,size),rotate(sticker.normal,move.axis,move.turns,size,true));
    permutation[destination]=source;
  }
  const changed=[];for(let i=0;i<count;i++)if(permutation[i]!==i)changed.push(i);
  const moved=Uint32Array.from(changed),bytes=permutation.byteLength+moved.byteLength;
  const entry={permutation,moved,bytes};
  while(cache.size&&(cache.size>=CACHE_MAX_ENTRIES||cachedBytes+bytes>CACHE_MAX_BYTES)) {
    const oldest=cache.keys().next().value;cachedBytes-=cache.get(oldest).bytes;cache.delete(oldest);
  }
  cache.set(key,entry);cachedBytes+=bytes;return entry;
}
/** Destination-to-source permutation; callers receive a copy, never cache storage. */
export function getPermutation(size,move) {assertSize(size);return permutationEntry(size,move).permutation.slice();}
export function permutationCacheStats() {return {entries:cache.size,bytes:cachedBytes,maxEntries:CACHE_MAX_ENTRIES,maxBytes:CACHE_MAX_BYTES};}
export function clearPermutationCache() {cache.clear();cachedBytes=0;}
export function applyMove(state,size,move) {
  validateState(state,size);const entry=permutationEntry(size,move),result=Uint32Array.from(state);
  for(const destination of entry.moved)result[destination]=state[entry.permutation[destination]];
  return result;
}
export function applyAlg(state,size,algorithm) {
  validateState(state,size);const moves=parseAlg(algorithm,size),result=Uint32Array.from(state),scratch=new Uint32Array(result.length);
  for(const move of moves) {
    const {permutation,moved}=permutationEntry(size,move);
    for(const destination of moved)scratch[destination]=result[permutation[destination]];
    for(const destination of moved)result[destination]=scratch[destination];
  }
  return result;
}
export function replay(size,algorithm,initialState=solvedState(size)) {return applyAlg(initialState,size,algorithm);}
const solvedOrientations=(()=>{
  const queue=[[0,1,2,3,4,5]],seen=new Set();
  for(let next=0;next<queue.length;next++) {
    const pattern=queue[next],key=pattern.join(',');if(seen.has(key))continue;seen.add(key);
    for(const axis of ['x','y','z']) {
      const rotated=[];
      for(let face=0;face<6;face++) {
        const normal=rotate(NORMALS[face],axis,1,2,true);
        const destination=NORMALS.findIndex(candidate=>candidate.every((v,i)=>v===normal[i]));
        rotated[destination]=pattern[face];
      }
      if(!seen.has(rotated.join(',')))queue.push(rotated);
    }
  }
  return seen;
})();
export function isSolved(state,size,{rotationAgnostic=true}={}) {
  validateState(state,size);const area=size*size,pattern=[];
  for(let face=0;face<6;face++) {
    const color=state[face*area];if(color>5)return false;pattern.push(color);
    for(let i=1;i<area;i++)if(state[face*area+i]!==color)return false;
  }
  return rotationAgnostic?solvedOrientations.has(pattern.join(',')):pattern.every((color,i)=>color===i);
}
export function createPuzzle(size) {
  assertSize(size);
  return Object.freeze({id:`${size}x${size}x${size}`,size,faceletCount:6*size*size,faceNames:FACE_NAMES,
    solvedState:()=>solvedState(size),applyMove:(state,move)=>applyMove(state,size,move),applyAlg:(state,alg)=>applyAlg(state,size,alg),
    isSolved:(state,options)=>isSolved(state,size,options),faceletGeometry:index=>faceletGeometry(size,index),
  });
}
