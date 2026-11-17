import assert from 'node:assert/strict';
import {FACE_NAMES,solvedState,applyMove,applyAlg,isSolved,faceletGeometry,geometryToFacelet,getPermutation,
  permutationCacheStats,clearPermutationCache,createPuzzle,validateState,sizeOf} from '../data/puzzles/core.mjs';
import {parseAlg,parseMove,normalizeMove,invertAlg,invertMove,formatMove,formatAlg} from '../data/puzzles/notation.mjs';
import {generateScramble,scrambleState} from '../data/puzzles/scramble.mjs';
import {createSession,restoreSession} from '../data/puzzles/history.mjs';
import * as oracle from '../data/solver/core.mjs';
let seed=0x8a12fed3;
const rng=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/0x100000000;};
const unique=size=>Uint32Array.from({length:6*size*size},(_,i)=>i);
let assertions=0;
function equal(actual,expected,message){assert.deepEqual(actual,expected,message);assertions++;}

for(let size=2;size<=50;size++) {
  const initial=unique(size),colors=solvedState(size),count=initial.length;
  assert.equal(sizeOf(colors),size);assert.equal(isSolved(colors,size),true);
  assert.equal(isSolved(applyAlg(colors,size,"x y' z2"),size),true);
  assert.equal(isSolved(applyMove(colors,size,'x'),size,{rotationAgnostic:false}),false);
  for(let index=0;index<count;index++) {
    const item=faceletGeometry(size,index);
    assert.equal(geometryToFacelet(size,item.position,item.normal),index);
  }
  const tokens=['R','L','U','D','F','B','x','y','z',`${size-1}Rw`,`${size}R`,`${size}L`];
  if(size===2)tokens.splice(tokens.indexOf('1Rw'),1);
  if(size>2)tokens.push('2R',`${size-1}Lw`);
  if(size%2)tokens.push('M','E','S');
  for(const token of tokens) {
    const move=parseMove(token,size),moved=applyMove(initial,size,move),permutation=getPermutation(size,move);
    assert.ok(permutation instanceof Uint32Array);assert.equal(new Set(permutation).size,count);
    equal(moved,permutation,`dest→source permutation ${size}/${token}`);
    equal(applyMove(moved,size,invertMove(move,size)),initial,`inverse ${size}/${token}`);
    equal(applyAlg(initial,size,[move,move,move,move]),initial,`four turns ${size}/${token}`);
    equal(applyMove(initial,size,parseMove(formatMove(move,size),size)),moved,`notation roundtrip ${size}/${token}`);
  }
  const moves=generateScramble(size,{length:31,rng});
  const result=applyAlg(initial,size,moves);
  equal(applyAlg(result,size,invertAlg(moves,size)),initial,`full scramble inverse ${size}`);
  equal(initial,unique(size),'input never mutated');
  for(const move of moves)assert.equal(new Set(move.layers).size,move.layers.length);
  assert.equal(isSolved(applyMove(colors,size,'R'),size),false);
}

// Existing solver is the independent reference for 3x3 sticker order and signs.
for(const token of ['R','L','U','D','F','B','M','E','S','Rw','Lw','Uw','Dw','Fw','Bw','x','y','z',"2R'",'2L','3Rw',"3Lw'"]) {
  const labeled=unique(3);
  equal(applyAlg(labeled,3,token),Uint32Array.from(oracle.applyAlg(Uint8Array.from(labeled),token)),`3x3 oracle ${token}`);
}
for(let sample=0;sample<50;sample++) {
  const algorithms=generateScramble(3,{length:30,rng}),text=formatAlg(algorithms,3);
  equal(applyAlg(solvedState(3),3,text),Uint32Array.from(oracle.applyAlg(oracle.SOLVED,text)),'3x3 random oracle');
  assert.equal(oracle.validate(Uint8Array.from(applyAlg(solvedState(3),3,text))).valid,true);
}
for(let i=0;i<54;i++) {
  const item=faceletGeometry(3,i),old=oracle.FACELETS[i];
  equal(item.position.map(v=>v-1),old.position,'3x3 geometry order');equal(item.normal,old.normal,'3x3 normal');
}

// Width, exact inner slice and contiguous interval are different operations.
equal(applyAlg(unique(7),7,'3Rw'),applyAlg(unique(7),7,'R 2R 3R'),'wide comprises three slices');
equal(applyAlg(unique(7),7,'2-4Rw'),applyAlg(unique(7),7,'2R 3R 4R'),'range comprises exact slices');
equal(applyAlg(unique(50),50,'50Rw'),applyAlg(unique(50),50,'x'),'whole width aliases rotation');
equal(applyAlg(unique(50),50,'50Lw'),applyAlg(unique(50),50,"x'"),'negative whole width direction');
equal(applyAlg(unique(5),5,'r'),applyAlg(unique(5),5,'Rw'),'lowercase wide');
equal(applyAlg(unique(5),5,'[R,U]'),applyAlg(unique(5),5,"R U R' U'"),'commutator');
equal(applyAlg(unique(5),5,'[R:U]'),applyAlg(unique(5),5,"R U R'"),'conjugate');
equal(applyAlg(unique(5),5,"(R U)3'"),applyAlg(unique(5),5,"U' R' U' R' U' R'"),'group inverse repeat');
equal(parseAlg("R4 U0 // comment\n F² R’2",3).map(move=>move.token),['F2','R2'],'normalized Unicode and zero turns');
assert.ok(Math.max(...getPermutation(50,'R'))>255,'large sticker indices never truncate');
assert.equal(getPermutation(50,'R').length,15000);
const mutable=getPermutation(3,'R');mutable.fill(0);assert.equal(new Set(getPermutation(3,'R')).size,54,'cache cannot be poisoned');
assert.equal(isSolved(new Uint32Array(54),3),false,'one color is not solved');
const mirrored=solvedState(3);for(let i=0;i<9;i++){mirrored[i+9]=4;mirrored[i+36]=1;}
assert.equal(isSolved(mirrored,3),false,'arbitrary face swap is not a proper cube rotation');

for(const bad of [0,1,51,2.5,NaN,'3'])assert.throws(()=>solvedState(bad));
for(const token of ['0R','51R','1Rw','3-2Rw','2-2Rw','Rww','Rxyz?','2x','R\'\'','(R','[R,U','3Mw'])assert.throws(()=>parseAlg(token,50),token);
assert.throws(()=>parseAlg('M',4));assert.throws(()=>parseAlg('(R)200001',3));assert.throws(()=>parseAlg('('.repeat(30)+'R'+')'.repeat(30),3));
assert.throws(()=>normalizeMove({axis:'x',layers:[0,2],turns:1},3));assert.throws(()=>normalizeMove({axis:'x',layers:[0,0],turns:1},3));
assert.throws(()=>normalizeMove({axis:'x',layers:[0],turns:1,token:'R'},3));
assert.throws(()=>validateState([-1,...new Array(23).fill(0)],2));assert.throws(()=>validateState(new Uint32Array(25),2));
assert.throws(()=>generateScramble(3,{rng:()=>1}));

const session=createSession(7);session.applyAlg('R U 3Rw 2-4Fw');const end=session.state;
assert.equal(session.cursor,4);assert.equal(session.undo(),true);assert.equal(session.undo(),true);
const encoded=session.serialize(),restored=restoreSession(encoded);equal(restored.state,session.state,'restore cursor state');
assert.equal(restored.canRedo,true);assert.equal(restored.redo(),true);assert.equal(restored.redo(),true);equal(restored.state,end,'redo restored branch');
while(restored.undo()){}assert.equal(restored.solved,true);assert.equal(restored.undo(),false);
restored.redo();restored.apply('F');assert.equal(restored.canRedo,false,'new branch truncates redo');
const leaked=restored.state;leaked.fill(99);assert.notEqual(restored.state[0],99,'session state cannot mutate externally');
const before=restored.serialize();assert.throws(()=>restored.applyAlg('R BAD'));assert.equal(restored.serialize(),before,'bad batch is atomic');
restored.reset();assert.equal(restored.historyLength,0);assert.equal(restored.solved,true);
for(const patch of [{version:2},{size:51},{cursor:-1},{cursor:999},{moves:['51R']},{moves:[{axis:'x'}]},{evil:true}])assert.throws(()=>restoreSession({...JSON.parse(encoded),...patch}));
assert.throws(()=>restoreSession('{"__proto__":{},"schema":"rg2-nxn-session","version":1,"size":3,"moves":[],"cursor":0}'));
const large=createSession(50);large.applyAlg(generateScramble(50,{length:100,rng}));large.undo();equal(restoreSession(large.serialize()).state,large.state,'large session roundtrip');
assert.equal(scrambleState(3,{length:0}).alg,'');
assert.equal(createPuzzle(4).faceletCount,96);assert.deepEqual(FACE_NAMES,['U','R','F','D','L','B']);

// Cache is bounded even when hopping among many large sizes and slice intervals.
clearPermutationCache();
for(let depth=1;depth<=49;depth++)for(const axis of ['x','y','z'])getPermutation(50,{axis,layers:[depth],turns:1});
for(let width=2;width<=50;width++)for(const axis of ['x','y','z'])getPermutation(50,{axis,layers:Array.from({length:width},(_,i)=>i),turns:-1});
const stats=permutationCacheStats();assert.ok(stats.entries<=stats.maxEntries&&stats.bytes<=stats.maxBytes);
console.log(`PASS puzzles core: sizes2..50, ${assertions} equality properties, 3x3 oracle, notation, sessions, cache (${stats.entries} entries/${stats.bytes} bytes).`);
