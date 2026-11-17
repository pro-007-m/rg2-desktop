/* NxN notation. Layers use integer indices from the negative to positive axis. */
export const MAX_ALG_MOVES = 200000;
const FACES = {R:['x',-1],L:['x',1],U:['y',-1],D:['y',1],F:['z',-1],B:['z',1]};
const POSITIVE = {x:'R',y:'U',z:'F'}, NEGATIVE = {x:'L',y:'D',z:'B'};
const AXES = ['x','y','z'];

export function assertSize(size) {
  if (!Number.isInteger(size) || size < 2 || size > 50) throw new RangeError('Размер куба должен быть целым числом от 2 до 50.');
  return size;
}
function quarterTurns(value) {
  if (!Number.isSafeInteger(value)) throw new TypeError('Поворот должен быть целым числом.');
  const n = ((value % 4) + 4) % 4;
  return n === 3 ? -1 : n;
}
const suffix = amount => amount === 2 ? '2' : amount === -1 ? "'" : '';
function descriptorToken(move,size) {
  const {axis,layers,turns} = move;
  if (layers.length === size) return axis + suffix(quarterTurns(-turns));
  const negative = layers[0] === 0;
  const face = (negative ? NEGATIVE : POSITIVE)[axis];
  const from = negative ? layers[0]+1 : size-layers.at(-1);
  const to = negative ? layers.at(-1)+1 : size-layers[0];
  const base = from === to ? (from === 1 ? face : from+face)
    : from === 1 ? (to === 2 ? '' : to)+face+'w' : `${from}-${to}${face}w`;
  return base + suffix(quarterTurns(turns*(negative ? 1 : -1)));
}
function sameMove(a,b) {
  return a.axis === b.axis && a.turns === b.turns && a.layers.length === b.layers.length && a.layers.every((layer,i) => layer === b.layers[i]);
}
export function normalizeMove(input,size) {
  assertSize(size);
  if (typeof input === 'string') return parseMove(input,size);
  if (!input || typeof input !== 'object' || !AXES.includes(input.axis) || !Array.isArray(input.layers)) throw new TypeError('Неверный формат хода.');
  if (!input.layers.length || input.layers.length > size) throw new RangeError('Не выбраны слои поворота.');
  const layers = [...input.layers].sort((a,b) => a-b);
  for (let i=0;i<layers.length;i++) {
    if (!Number.isInteger(layers[i]) || layers[i]<0 || layers[i]>=size || (i && layers[i]!==layers[i-1]+1)) {
      throw new RangeError('Слои должны образовывать непрерывный диапазон без повторений.');
    }
  }
  const turns = quarterTurns(input.turns);
  if (!turns) throw new RangeError('Ход должен менять положение куба.');
  const move = {axis:input.axis,layers:Object.freeze(layers),turns};
  let token = descriptorToken(move,size);
  if (input.token !== undefined) {
    if (typeof input.token !== 'string') throw new TypeError('Обозначение хода должно быть строкой.');
    const preferred = rawMove(input.token,size);
    if (!preferred || !sameMove(move,preferred)) throw new TypeError('Обозначение хода не соответствует его слоям и направлению.');
    token = preferred.token;
  }
  return Object.freeze({...move,token});
}
function rawMove(text,size) {
  // A prefix without w is one inner slice; a prefix with w is a block width.
  const match = /^(?:(\d+)(?:-(\d+))?)?([URFDLBurfdlbMESmesxyzXYZ])([wW]?)([0-9']*)$/.exec(text);
  if (!match) throw new SyntaxError(`Неизвестный ход: ${text}`);
  const [,first,last,letter,w,s] = match;
  let power = 1, prime = false, numberSeen = false;
  for (let i=0;i<s.length;) {
    if (s[i] === "'") {
      if (prime) throw new SyntaxError('Повторный штрих хода.');
      prime = true;i++;
    } else {
      if (numberSeen) throw new SyntaxError('Повторная степень хода.');
      const part = /^\d+/.exec(s.slice(i))[0];
      power = Number(part);numberSeen = true;i += part.length;
      if (!Number.isSafeInteger(power)) throw new RangeError('Слишком большая степень хода.');
    }
  }
  const amount = quarterTurns(power*(prime ? -1 : 1));
  const lowerWide = /[urfdlb]/.test(letter), upper = letter.toUpperCase();
  const wide = Boolean(w) || lowerWide;
  let axis,sign,layers,base;
  if (/[xyz]/i.test(letter)) {
    if (first || last || wide) throw new SyntaxError('У вращения всего куба нет номера слоя.');
    axis=letter.toLowerCase();sign=-1;layers=Array.from({length:size},(_,i)=>i);base=axis;
  } else if (/[MES]/.test(upper)) {
    if (first || last || wide || size%2===0) throw new SyntaxError('M/E/S обозначают единственный средний слой нечётного куба; для чётного укажите слой числом.');
    [axis,sign] = {M:['x',1],E:['y',1],S:['z',-1]}[upper];
    layers=[(size-1)/2];base=upper;
  } else {
    [axis,sign]=FACES[upper];
    const start = last ? Number(first) : wide ? 1 : Number(first || 1);
    const end = last ? Number(last) : wide ? Number(first || 2) : start;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start<1 || end<start || end>size || (last && start===end) || (wide && !last && end<2)) throw new RangeError('Диапазон слоёв не подходит для этого куба.');
    const negative = sign===1;
    layers=Array.from({length:end-start+1},(_,i)=>negative ? start+i-1 : size-end+i);
    base = last ? `${start}-${end}${upper}w` : wide ? (end===2 ? '' : end)+upper+'w' : (start===1 ? '' : start)+upper;
    if (layers.length===size) {
      base=axis;
      sign=-1;
    }
  }
  // A whole block from the negative face turns opposite to x/y/z.
  const actualAmount = layers.length===size && /[URFDLB]/.test(upper) && FACES[upper][1]===1 ? quarterTurns(-amount) : amount;
  if (!actualAmount) return null;
  return Object.freeze({axis,layers:Object.freeze(layers),turns:quarterTurns(sign*actualAmount),token:base+suffix(actualAmount)});
}
function normalizeText(input) {
  if (input.length>2000000) throw new RangeError('Алгоритм слишком длинный.');
  return input.replace(/[’‘′`´ʼ]/g,"'").replace(/″|²/g,'2').replace(/\/\/[^\r\n]*/g,'').replace(/\u00a0/g,' ');
}
export function parseAlg(input,size) {
  assertSize(size);
  if (Array.isArray(input)) {
    const out=[];
    for (const item of input) {
      const moves=typeof item==='string' || Array.isArray(item) ? parseAlg(item,size) : [normalizeMove(item,size)];
      if (out.length+moves.length>MAX_ALG_MOVES) throw new RangeError('Алгоритм содержит слишком много ходов.');
      for(const move of moves)out.push(move);
    }
    return out;
  }
  if (typeof input!=='string') throw new TypeError('Алгоритм должен быть строкой или массивом ходов.');
  const text=normalizeText(input);let cursor=0;
  const fail=message=>{throw new SyntaxError(`${message} (позиция ${cursor+1})`);};
  const skip=()=>{while(cursor<text.length && /\s|[·.]/.test(text[cursor]))cursor++;};
  function append(out,moves) {
    if(out.length+moves.length>MAX_ALG_MOVES)throw new RangeError('Алгоритм содержит слишком много ходов.');
    for(const move of moves)out.push(move);
  }
  function invert(moves) { return [...moves].reverse().map(move=>invertMove(move,size)); }
  function groupSuffix(moves) {
    skip();let count=1;
    if(/[0-9]/.test(text[cursor]||'')) {
      const start=cursor;while(/[0-9]/.test(text[cursor]||''))cursor++;
      count=Number(text.slice(start,cursor));
      if(!Number.isSafeInteger(count)||count>MAX_ALG_MOVES)fail('Слишком большое повторение');
    }
    skip();if(text[cursor]==="'"){moves=invert(moves);cursor++;}
    if(count*moves.length>MAX_ALG_MOVES)fail('Слишком большое повторение');
    const out=[];for(let i=0;i<count;i++)append(out,moves);return out;
  }
  function sequence(stops='',depth=0) {
    if(depth>24)fail('Слишком глубокая вложенность');
    const out=[];
    while(true) {
      skip();const char=text[cursor];if(!char||stops.includes(char))return out;
      if(char==='(') {
        cursor++;const moves=sequence(')',depth+1);if(text[cursor]!==')')fail('Не закрыта скобка');
        cursor++;append(out,groupSuffix(moves));
      } else if(char==='[') {
        cursor++;const left=sequence(',:]',depth+1),separator=text[cursor++];
        if(separator===']'){append(out,groupSuffix(left));continue;}
        if(separator!==','&&separator!==':')fail('Ожидается , или :');
        const right=sequence(']',depth+1);if(text[cursor]!==']'||!left.length||!right.length)fail('Неверный коммутатор');
        cursor++;const moves=[];append(moves,left);append(moves,right);append(moves,invert(left));if(separator===',')append(moves,invert(right));
        append(out,groupSuffix(moves));
      } else {
        const match=/^(?:(?:\d+)(?:-\d+)?)?[URFDLBurfdlbMESmesxyzXYZ][wW]?[0-9']*/.exec(text.slice(cursor));
        if(!match)fail('Неизвестный ход');
        const move=rawMove(match[0],size);cursor+=match[0].length;if(move)append(out,[move]);
      }
    }
  }
  const out=sequence();skip();if(cursor!==text.length)fail('Лишняя закрывающая скобка');return out;
}
export function parseMove(input,size) {
  if(typeof input!=='string')return normalizeMove(input,size);
  const moves=parseAlg(input,size);
  if(moves.length!==1)throw new SyntaxError('Ожидается один непустой ход.');
  return moves[0];
}
export function invertMove(input,size) {
  const move=normalizeMove(input,size);
  const token=move.token.endsWith('2')?move.token:move.token.endsWith("'")?move.token.slice(0,-1):move.token+"'";
  return normalizeMove({axis:move.axis,layers:[...move.layers],turns:-move.turns,token},size);
}
export function invertAlg(input,size) {return parseAlg(input,size).reverse().map(move=>invertMove(move,size));}
export function formatMove(input,size) {return normalizeMove(input,size).token;}
export function formatAlg(input,size) {return parseAlg(input,size).map(move=>move.token).join(' ');}
