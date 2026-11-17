/* Random legal turns for the virtual game; not a uniform random-state WCA scrambler. */
import {assertSize,normalizeMove,formatAlg} from './notation.mjs';
import {solvedState,applyAlg} from './core.mjs';
const AXES=['x','y','z'];
function randomUnit() {
  if(globalThis.crypto?.getRandomValues) {
    const buffer=new Uint32Array(1);globalThis.crypto.getRandomValues(buffer);return buffer[0]/0x100000000;
  }
  return Math.random();
}
export function generateScramble(size,{length=Math.max(20,size*5),rng=randomUnit,inner=size>3,wide=size>3}={}) {
  assertSize(size);
  if(!Number.isInteger(length)||length<0||length>10000)throw new RangeError('Длина скрамбла должна быть от 0 до 10000.');
  if(typeof rng!=='function')throw new TypeError('Источник случайных чисел должен быть функцией.');
  const integer=count=>{
    const value=rng();if(!Number.isFinite(value)||value<0||value>=1)throw new RangeError('Источник случайных чисел вернул значение вне [0, 1).');
    return Math.floor(value*count);
  };
  const moves=[];let previous='';
  for(let step=0;step<length;step++) {
    const options=AXES.filter(axis=>axis!==previous),axis=options[integer(options.length)],negative=integer(2)===0;
    const modes=['outer'];if(inner&&size>2)modes.push('inner');if(wide&&size>2)modes.push('wide');
    const mode=modes[integer(modes.length)];let start=0,end=0;
    if(mode==='inner')start=end=1+integer(size-2);
    else if(mode==='wide')end=1+integer(size-2);
    if(!negative)[start,end]=[size-1-end,size-1-start];
    const layers=Array.from({length:end-start+1},(_,i)=>start+i),turns=[-1,1,2][integer(3)];
    moves.push(normalizeMove({axis,layers,turns},size));previous=axis;
  }
  return moves;
}
export function scrambleState(size,options) {
  const moves=generateScramble(size,options);
  return {moves,alg:formatAlg(moves,size),state:applyAlg(solvedState(size),size,moves)};
}
