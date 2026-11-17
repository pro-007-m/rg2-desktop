import assert from 'node:assert/strict';
import {createPolyPuzzle,applyPolyAlg,isPolySolved,normalizePolyMove} from '../data/puzzles/poly-core.mjs';
import {suggestPoly} from '../data/puzzles/solver-poly.mjs';
let seed=0xb127ce92,checks=0,pipelines=0,segments=0,maxMs=0;
const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const ok=(value,message)=>{assert.ok(value,message);checks++;};
const eq=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;};
const started=performance.now(),cases=[];
for(let n=4;n<=20;n++){
  const puzzle=createPolyPuzzle('pyramid',n),goal=puzzle.solvedState(),samples=n<=6?4:2;
  for(let sample=0;sample<samples;sample++){
    const scramble=[];
    for(let i=0;i<48+2*n;i++){const axis=puzzle.axes[Math.floor(random()*4)],layer=Math.floor(random()*n),turns=random()<.5?1:2;scramble.push(normalizePolyMove({axis:axis.id,layers:[layer],turns},puzzle));}
    if(sample===0)scramble.push(puzzle.parseMove('Uv'),puzzle.parseMove('Rv'));
    let state=applyPolyAlg(puzzle.solvedState(),puzzle,scramble),phase=-1,totalMoves=0,guard=0;const fixed=new Map(),caseStart=performance.now();
    while(!isPolySolved(state,puzzle)){
      const copy=state.slice(),result=await suggestPoly(state,puzzle),c=result.candidates[0];
      eq(state,copy,'current colour state remains unchanged');
      ok(result.coverage.complete&&result.coverage.supported&&result.coverage.historyRequired===false,'complete state-only coverage');
      ok(c?.moves.length>0,'every stage supplies legal moves');
      eq(c.state,applyPolyAlg(state,puzzle,c.moves),'stage replays through independent facelet engine');
      ok(c.phaseIndex>phase,'phase advances monotonically');phase=c.phaseIndex;
      for(const [index,color] of fixed)eq(c.state[index],color,'all previous phase targets survive');
      for(const index of c.fixedIndices){ok(!puzzle.facelets[index].black,'only coloured targets are fixed');eq(c.state[index],goal[index],'claimed target is solved');fixed.set(index,c.state[index]);}
      state=c.state;totalMoves+=c.moves.length;segments++;maxMs=Math.max(maxMs,result.coverage.elapsedMs);
      ok(++guard<2+n*n,'finite constructive chain');ok(totalMoves<=200000,'whole solution fits game history');
    }
    pipelines++;cases.push({order:n,sample,segments:guard,moves:totalMoves,ms:Math.round(performance.now()-caseStart)});
  }
  console.log(JSON.stringify({order:n,passed:true,samples,moves:cases.at(-1).moves,ms:cases.at(-1).ms}));
}
// An actual colour state is the only input: no session/history/scramble is passed.
const p=createPolyPuzzle('pyramid',8),state=applyPolyAlg(p.solvedState(),p,"3U 4L' B u");
const controller=new AbortController();controller.abort();await assert.rejects(()=>suggestPoly(state,p,{signal:controller.signal}),e=>e.name==='AbortError');
console.log(JSON.stringify({pass:true,checks,pipelines,segments,maxQueryMs:Math.round(maxMs),maxMoves:Math.max(...cases.map(c=>c.moves)),elapsedMs:Math.round(performance.now()-started),cases}));
