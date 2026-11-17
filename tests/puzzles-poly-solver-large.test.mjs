import assert from 'node:assert/strict';
import {createPolyPuzzle,applyPolyAlg,isPolySolved,normalizePolyMove} from '../data/puzzles/poly-core.mjs';
import {suggestPoly} from '../data/puzzles/solver-poly.mjs';
let seed=0xac4128f0,checks=0,pipelines=0,segments=0,maxMs=0;
const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const ok=(v,m)=>{assert.ok(v,m);checks++;};
const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
const started=performance.now(),cases=[];
for(let n=4;n<=20;n++){
  const puzzle=createPolyPuzzle('dodecahedron',n),samples=n<=5?3:1;
  for(let sample=0;sample<samples;sample++){
    const scramble=[];
    for(let i=0;i<36+n;i++){const axis=puzzle.axes[Math.floor(random()*12)],layer=Math.floor(random()*axis.layerCount),turns=Math.floor(random()*4)+1;scramble.push(normalizePolyMove({axis:axis.id,layers:[layer],turns},puzzle));}
    if(sample===0)scramble.push(puzzle.parseMove('Av'),puzzle.parseMove('Cv2'));
    let state=applyPolyAlg(puzzle.solvedState(),puzzle,scramble),phase=-1,totalMoves=0,guard=0;const fixed=new Map(),caseStart=performance.now();
    while(!isPolySolved(state,puzzle)){
      const copy=state.slice(),result=await suggestPoly(state,puzzle),c=result.candidates[0];
      eq(state,copy,'solver never mutates the current state');
      ok(result.coverage.complete&&result.coverage.supported&&result.coverage.historyRequired===false,'state-only complete constructive coverage');
      ok(c?.moves.length>0,'next group has real legal moves');
      eq(c.state,applyPolyAlg(state,puzzle,c.moves),'every output segment replays through the independent core');
      ok(c.phaseIndex>phase,'constructive phase advances');phase=c.phaseIndex;
      for(const [index,color] of fixed)eq(c.state[index],color,'previous phase colours remain fixed');
      for(const index of c.fixedIndices){ok(!puzzle.facelets[index].black,'black regions do not become coloured targets');fixed.set(index,c.state[index]);}
      state=c.state;totalMoves+=c.moves.length;segments++;maxMs=Math.max(maxMs,result.coverage.elapsedMs);
      ok(++guard<=50+puzzle.order*puzzle.order,'finite number of group stages');
    }
    pipelines++;cases.push({order:n,sample,segments:guard,moves:totalMoves,ms:Math.round(performance.now()-caseStart)});
  }
  console.log(JSON.stringify({order:n,passed:true,samples,moves:cases.at(-1).moves,ms:cases.at(-1).ms}));
}
// A globally oriented base with miscoloured extra cells needs explicit frame
// recovery before individual orbit stages; it is not a solved whole puzzle.
const p=createPolyPuzzle('dodecahedron',5),state=applyPolyAlg(p.solvedState(),p,"2A Av");
const first=await suggestPoly(state,p);ok(first.candidates.length>0,'global frame plus inner turn has a real hint');
const controller=new AbortController();controller.abort();await assert.rejects(()=>suggestPoly(state,p,{signal:controller.signal}),e=>e.name==='AbortError');
console.log(JSON.stringify({pass:true,checks,pipelines,segments,maxQueryMs:Math.round(maxMs),elapsedMs:Math.round(performance.now()-started),cases}));
