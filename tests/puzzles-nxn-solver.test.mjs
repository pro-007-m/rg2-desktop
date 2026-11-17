import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {solveNxN,suggestNxN} from '../data/puzzles/solver-nxn.mjs';
import {solvedState,applyAlg,isSolved} from '../data/puzzles/core.mjs';
import {generateScramble} from '../data/puzzles/scramble.mjs';
let seed=0x197c3ba2,cases=0;const rng=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/0x100000000;};
const measurements=[];
for(const size of [4,5,6,7,8,9,10,11,16,20,25,32,49,50])for(let sample=0;sample<(size<12?6:3);sample++){
  const initial=applyAlg(solvedState(size),size,sample%3===0?'x':sample%3===1?"y z'":'z2 x'),moves=generateScramble(size,{length:Math.max(40,size*6),rng});
  const input=applyAlg(initial,size,moves),unchanged=input.slice(),progress=[];
  // Only the state and solved color frame are passed: no scramble/history input.
  const solution=await solveNxN(input,size,{initialState:initial,onProgress:p=>progress.push(p)});
  assert.equal(isSolved(solution.state,size),true,`${size}/${sample} solves`);
  assert.deepEqual(applyAlg(input,size,solution.moves),solution.state,'full independent move replay');
  assert.deepEqual(input,unchanged,'input is immutable');assert.equal(solution.method,'constructive');
  assert.ok(progress.length>0&&progress.at(-1).done);assert.equal(solution.coverage.historyRequired,false);
  let state=input;for(const stage of solution.stages){state=applyAlg(state,size,stage.moves);assert.deepEqual(state,stage.state,'verified stage state');}
  assert.deepEqual(state,solution.state);cases++;
  if(sample===0&&[4,5,10,25,50].includes(size))measurements.push({size,moves:solution.moves.length,raw:solution.rawMoveCount,ms:Math.round(solution.elapsedMs)});
}
const n=5,start=applyAlg(solvedState(n),n,generateScramble(n,{length:45,rng}));let current=start;
const stages=[];
for(let i=0;i<4;i++){
  const suggestion=await suggestNxN(current,n);if(!suggestion.candidates.length)break;
  const candidate=suggestion.candidates[0];stages.push(candidate.stage);current=applyAlg(current,n,candidate.moves);assert.deepEqual(current,candidate.state);
}
assert.equal(isSolved(current,n),true,'iterative suggestions advance to solved');assert.equal(new Set(stages).size,stages.length,'completed stages do not repeat');
assert.equal((await suggestNxN(solvedState(50),50)).candidates.length,0);
const controller=new AbortController();controller.abort();await assert.rejects(solveNxN(start,5,{signal:controller.signal}),error=>error.name==='AbortError');
await assert.rejects(solveNxN(start,5,{maxMoves:1}),/budget/i);
await assert.rejects(solveNxN(start,5,{timeoutMs:0}));
await assert.rejects(solveNxN(new Uint32Array(54),3));await assert.rejects(solveNxN(new Uint32Array(96),4));
const invalid=start.slice();[invalid[0],invalid[1]]=[invalid[1],invalid[0]];invalid[0]=99;await assert.rejects(solveNxN(invalid,5));
// Upstream evidence/notice files are shipped intact and the JS component is attributed.
const manifest=JSON.parse(readFileSync(new URL('../data/puzzles/vendor/rcube/SOURCE.json',import.meta.url)));
for(const file of manifest.files){const bytes=readFileSync(new URL('../data/puzzles/vendor/rcube/'+file.path,import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);}
assert.match(readFileSync(new URL('../data/puzzles/vendor/rcube/rcube.mjs',import.meta.url),'utf8'),/GPL-3\.0-only/);
console.log(`PASS NxN constructive: ${cases} legal states, odd/even4..50, changed goal frames, all full/stage replays, iterative suggestions, abort/budgets and source hashes.`);
console.log(JSON.stringify({environment:'local Node; measured solve+internal replay; not an Android benchmark',measurements}));
