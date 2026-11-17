import assert from 'node:assert/strict';
import {reduceNxN,suggestReduction,extractVirtual3,lift3Algorithm,pllParityAlgorithm} from '../data/puzzles/solver-nxn.mjs';
import {solvedState,applyAlg,isSolved} from '../data/puzzles/core.mjs';
import {applyAlg as apply3,validate as validate3,CORNER_FACELETS} from '../data/solver/core.mjs';
import {generateScramble} from '../data/puzzles/scramble.mjs';
let seed=0x1707a419,cases=0,parities=0;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
const measurements=[];
for(let n=4;n<=50;n++){
  const count=[4,5,6,7,8,9,10,11,16,20,25,32,49,50].includes(n)?3:1;
  for(let sample=0;sample<count;sample++){
    const initial=applyAlg(solvedState(n),n,sample===0?'x2':sample===1?"y z'":'z2 x'),input=applyAlg(initial,n,generateScramble(n,{length:Math.max(40,n*4),rng:random})),unchanged=input.slice();
    const result=await reduceNxN(input,n,{initialState:initial}),status=extractVirtual3(result.state,n);
    assert.ok(result.readyFor3&&status.valid&&status.centers&&status.paired&&validate3(result.virtualState).valid,`real reduction ${n}/${sample}`);
    assert.deepEqual(input,unchanged,'source is immutable');assert.deepEqual(applyAlg(input,n,result.moves),result.state,'full independent replay');
    let current=input;
    for(const stage of result.stages){
      if(stage.stage==='REDUCTION_EDGES'){
        const oldCorners=extractVirtual3(current,n).state,newCorners=extractVirtual3(stage.state,n).state;
        for(const indices of CORNER_FACELETS)for(const i of indices)assert.equal(newCorners[i],oldCorners[i],'wing pairing does not solve or change the corners');
      }
      current=applyAlg(current,n,stage.moves);assert.deepEqual(current,stage.state,'stage replay');
      if(stage.stage==='REDUCTION_PARITY')parities++;
    }
    assert.deepEqual(current,result.state);assert.ok(result.stages.every(s=>!s.stage.includes('CORNERS')));cases++;
    if(sample===0&&[4,5,10,25,50].includes(n))measurements.push({size:n,moves:result.moves.length,ms:Math.round(result.elapsedMs),stages:result.stages.map(s=>s.stage)});
  }
}

// Every even size has a real paired-edge parity permutation. Repair it without
// relying on a scramble or hidden history, and retain the actual NxN grouping.
for(let n=4;n<=50;n+=2){
  const state=applyAlg(solvedState(n),n,pllParityAlgorithm(n)),before=extractVirtual3(state,n);
  assert.ok(before.centers&&before.paired&&!before.valid);assert.deepEqual(before.validation.errors.map(e=>e.code),['PARITY']);
  const reduced=await reduceNxN(state,n);assert.equal(reduced.stages.length,1);assert.equal(reduced.stages[0].stage,'REDUCTION_PARITY');assert.ok(extractVirtual3(reduced.state,n).valid);
}

// CFOP slice/wide notation lifts the entire virtual middle, also on even cubes.
const tokens=['U','R','F','D','L','B','M','E','S','Rw','Lw','Uw','Dw','Fw','Bw','x','y','z'];
for(const n of [4,5,10,25,50]){
  let big=applyAlg(solvedState(n),n,lift3Algorithm("R U F' D2 L B x",n)),small=extractVirtual3(big,n).state;
  for(const base of tokens)for(const suffix of ['',"'",'2']){
    const token=base+suffix,lifted=lift3Algorithm(token,n),nextBig=applyAlg(big,n,lifted),nextSmall=apply3(small,token),status=extractVirtual3(nextBig,n);
    assert.ok(status.valid&&status.paired&&status.centers,`${n} keeps reduction after ${token}`);assert.deepEqual(status.state,nextSmall,`${n} virtual3 projection for ${token}`);
    big=nextBig;small=nextSmall;
  }
}

const n=5,initial=applyAlg(solvedState(n),n,generateScramble(n,{length:50,rng:random}));let state=initial;const stages=[];
for(let i=0;i<4;i++){
  const result=await suggestReduction(state,n);if(result.readyFor3){assert.equal(result.stage,'REDUCED');assert.ok(validate3(result.virtualState).valid);break;}
  const candidate=result.candidates[0];assert.ok(candidate);stages.push(candidate.stage);state=applyAlg(state,n,candidate.moves);assert.deepEqual(state,candidate.state);
}
assert.ok(extractVirtual3(state,n).valid,'iterative hints reach valid 3x3');assert.equal(new Set(stages).size,stages.length);
assert.equal((await reduceNxN(applyAlg(solvedState(50),50,'R U F'),50)).moves.length,0,'already reduced input immediately delegates to CFOP');
const controller=new AbortController();controller.abort();await assert.rejects(reduceNxN(initial,n,{signal:controller.signal}),e=>e.name==='AbortError');
await assert.rejects(reduceNxN(initial,n,{maxMoves:1}),/budget/i);await assert.rejects(reduceNxN(initial,n,{timeoutMs:0}));
assert.throws(()=>lift3Algorithm('R',3));assert.throws(()=>pllParityAlgorithm(5));
console.log(`PASS NxN reduction: ${cases} state-only states covering EVERY size4..50, ${parities} observed parity repairs, unchanged corners during pairing, independent replays, every even parity fixture and lifted CFOP move.`);
console.log(JSON.stringify({environment:'local Node, including internal replay; not Android performance',measurements}));
