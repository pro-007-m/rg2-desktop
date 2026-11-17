/* Sessions store an exact legal history from solved; no arbitrary color input. */
import {assertSize,parseAlg,parseMove,invertMove,MAX_ALG_MOVES} from './notation.mjs';
import {solvedState,applyMove,applyAlg,isSolved} from './core.mjs';
const SCHEMA='rg2-nxn-session',VERSION=1,MAX_SERIALIZED_BYTES=8*1024*1024;

export class PuzzleSession {
  #size;#state;#moves=[];#cursor=0;
  constructor(size) {this.#size=assertSize(size);this.#state=solvedState(size);}
  get size(){return this.#size;}
  get state(){return this.#state.slice();}
  get cursor(){return this.#cursor;}
  get historyLength(){return this.#moves.length;}
  get moves(){return [...this.#moves];}
  get canUndo(){return this.#cursor>0;}
  get canRedo(){return this.#cursor<this.#moves.length;}
  get solved(){return isSolved(this.#state,this.#size);}
  apply(move) {
    const parsed=parseMove(move,this.#size);this.applyAlg([parsed]);return parsed;
  }
  applyAlg(algorithm) {
    const parsed=parseAlg(algorithm,this.#size);
    if(!parsed.length)return [];
    if(this.#cursor+parsed.length>MAX_ALG_MOVES)throw new RangeError('История содержит слишком много ходов.');
    const nextState=applyAlg(this.#state,this.#size,parsed);
    this.#moves=this.#moves.slice(0,this.#cursor).concat(parsed);
    this.#cursor=this.#moves.length;this.#state=nextState;return parsed;
  }
  undo() {
    if(!this.canUndo)return false;
    const next=applyMove(this.#state,this.#size,invertMove(this.#moves[this.#cursor-1],this.#size));
    this.#cursor--;this.#state=next;return true;
  }
  redo() {
    if(!this.canRedo)return false;
    this.#state=applyMove(this.#state,this.#size,this.#moves[this.#cursor]);this.#cursor++;return true;
  }
  reset() {this.#state=solvedState(this.#size);this.#moves=[];this.#cursor=0;}
  toJSON(){return {schema:SCHEMA,version:VERSION,size:this.#size,moves:this.#moves.map(move=>move.token),cursor:this.#cursor};}
  serialize(){return JSON.stringify(this.toJSON());}
  static restore(input) {
    if(typeof input==='string') {
      if(input.length>MAX_SERIALIZED_BYTES)throw new RangeError('Файл сессии слишком большой.');
      input=JSON.parse(input);
    }
    if(!input||typeof input!=='object'||Array.isArray(input)||(Object.getPrototypeOf(input)!==Object.prototype&&Object.getPrototypeOf(input)!==null))throw new TypeError('Неверный формат сессии.');
    const keys=Object.keys(input);
    if(keys.some(key=>!['schema','version','size','moves','cursor'].includes(key))||input.schema!==SCHEMA||input.version!==VERSION)throw new TypeError('Неизвестный формат сессии.');
    const size=assertSize(input.size);
    if(!Array.isArray(input.moves)||input.moves.length>MAX_ALG_MOVES||!Number.isInteger(input.cursor)||input.cursor<0||input.cursor>input.moves.length)throw new TypeError('Неверная история сессии.');
    const moves=input.moves.map(token=>{
      if(typeof token!=='string'||token.length>64)throw new TypeError('Неверный ход в истории.');
      return parseMove(token,size);
    });
    const session=new PuzzleSession(size);
    session.#moves=moves;session.#cursor=input.cursor;
    session.#state=applyAlg(solvedState(size),size,moves.slice(0,input.cursor));
    return session;
  }
}
export function createSession(size){return new PuzzleSession(size);}
export function restoreSession(input){return PuzzleSession.restore(input);}
