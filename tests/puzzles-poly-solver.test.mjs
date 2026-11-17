import assert from 'node:assert/strict';
import {createPolyPuzzle,applyPolyAlg,generatePolyScramble,isPolySolved,getPolyPermutation} from '../data/puzzles/poly-core.mjs';
import {suggestPoly,POLY_METHOD} from '../data/puzzles/solver-poly.mjs';
const started=performance.now();let checks=0,pipelines=0,segments=0,maxQueryMs=0;
const ok=(value,message)=>{assert.ok(value,message);checks++;};
const same=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;};
let seed=0xc012faca;
function random(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/0x100000000;}
async function solve(state,puzzle){
  let previousPhase=0,protectedColors=new Map(),count=0;
  while(!isPolySolved(state,puzzle)){
    const snapshot=state.slice(),result=await suggestPoly(state,puzzle),candidate=result.candidates[0];
    same(state,snapshot,'query never mutates input');
    ok(result.coverage.complete&&result.coverage.provedAllStages,'current state has a complete constructive proof');
    ok(candidate?.moves.length>0,'real group algorithm returned');
    same(candidate.state,applyPolyAlg(state,puzzle,candidate.moves),'every stage replays in independent poly core');
    ok(candidate.phaseIndex>previousPhase,'group order advances strictly');previousPhase=candidate.phaseIndex;
    const indices=new Set(candidate.fixedIndices);
    for(const [index,color] of protectedColors){ok(indices.has(index),'earlier group remains in invariant');same(candidate.state[index],color,'earlier coloured group survives later algorithm');}
    for(const index of candidate.fixedIndices){ok(!puzzle.facelets[index].black,'black filler is not claimed as a solved coloured piece');protectedColors.set(index,candidate.state[index]);}
    for(const index of candidate.newlyFixedIndices)ok(indices.has(index),'newly fixed sticker is in stage invariant');
    state=candidate.state;segments++;count++;maxQueryMs=Math.max(maxQueryMs,result.coverage.elapsedMs);
    ok(count<=puzzle.axes.length+50,'bounded number of constructive phases');
  }
  same((await suggestPoly(state,puzzle)).stage,'DONE','zero-move skip is explicit');pipelines++;return state;
}

// Pyramid2: all 3^4 independent tip combinations in several actual global
// orientations. This is not the same mechanism as 90-degree Pyramorphix.
const p2=createPolyPuzzle('pyramid',2),tipNames=p2.axes.map(a=>a.id.toLowerCase());
for(let code=0;code<81;code++){
  let value=code;const moves=[];
  for(const name of tipNames){const power=value%3;value=Math.floor(value/3);if(power)moves.push(name+(power===2?"'":''));}
  for(const pose of ['', 'Uv', "Lv Rv'"]){const state=applyPolyAlg(p2.solvedState(),p2,[...moves,pose].filter(Boolean));await solve(state,p2);}
}

// Long independent scrambles; only current sticker colours enter suggestPoly.
for(const [kind,order,samples] of [['pyramid',3,32],['dodecahedron',3,16],['dodecahedron',2,16]]){
  const puzzle=createPolyPuzzle(kind,order),solved=puzzle.solvedState();
  for(let sample=0;sample<samples;sample++){
    const moves=generatePolyScramble(puzzle,{length:35,rng:random});
    if(sample%3===0)moves.push(puzzle.parseMove(puzzle.axes[sample%puzzle.axes.length].id+'v'));
    const state=applyPolyAlg(solved,puzzle,moves);await solve(state,puzzle);
  }
  // Every root move and inverse, including the independent Pyraminx tips.
  for(const axis of puzzle.axes)for(const suffix of ['',"'"]){
    const names=[axis.id+suffix];if(kind==='pyramid')names.push(axis.id.toLowerCase()+suffix);
    for(const name of names)await solve(applyPolyAlg(solved,puzzle,name),puzzle);
  }
  const one=applyPolyAlg(solved,puzzle,puzzle.axes[0].id),again=await suggestPoly([...one],puzzle);
  ok(again.method===POLY_METHOD,'honest group-based method, never relabelled layer-by-layer');
  const aborter=new AbortController();aborter.abort();await assert.rejects(suggestPoly(one,puzzle,{signal:aborter.signal}),e=>e.name==='AbortError');
  const malformed=one.slice();malformed[0]=99;await assert.rejects(suggestPoly(malformed,puzzle),/цвет/);
}

// Kilo's coloured subset is a projection of exactly the same 132-slot group.
const k2=createPolyPuzzle('dodecahedron',2),m3=createPolyPuzzle('dodecahedron',3);
same(k2.faceletCount,m3.faceletCount);
for(const axis of k2.axes)same(getPolyPermutation(k2,axis.id),getPolyPermutation(m3,axis.id),'Kilo and Mega share the same geometric action');
same(k2.facelets.filter(f=>!f.black).length,60,'only real Kilominx corners are coloured');

// Larger geometry has its own constructive state-only reduction.
for(const kind of ['pyramid']){
  const puzzle=createPolyPuzzle(kind,4),state=applyPolyAlg(puzzle.solvedState(),puzzle,puzzle.axes[0].id),result=await suggestPoly(state,puzzle);
  same(result.coverage.complete,true);same(result.candidates.length,1);same(result.coverage.historyRequired,false);
}
console.log(JSON.stringify({pass:true,checks,pipelines,segments,pyramid2Combinations:81,pyramid3Random:32,megaminxRandom:16,kilominxRandom:16,maxQueryMs:Math.round(maxQueryMs*10)/10,elapsedMs:Math.round(performance.now()-started)}));
