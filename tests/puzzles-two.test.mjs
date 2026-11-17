import assert from 'node:assert/strict';
import {applyAlg,applyMove,solvedState,invertAlg,isSolved,faceletGeometry} from '../data/puzzles/core.mjs';
import {suggest2,next2Stage,validate2,isFirstSide2,isOriented2,buildFirstSideTable2,ORTEGA_OLL,ORTEGA_PBL} from '../data/puzzles/solver-two.mjs';
const started=performance.now();let checks=0;
const ok=(value,message)=>{assert.ok(value,message);checks++;};
const same=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;};
let seed=0x2c2fc013;
function random(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/0x100000000;}
const choices=['U','R','F','D','L','B'].flatMap(f=>[f,f+"'",f+'2']);
function scramble(){const out=[];while(out.length<25){const m=choices[Math.floor(random()*choices.length)];if(out.at(-1)?.[0]!==m[0])out.push(m);}return out;}
const solved=solvedState(2),initialCopy=solved.slice();
same(suggest2(solved).stage,'DONE');
const table=buildFirstSideTable2();
same(table.states,5670,'complete same-colour-corner abstraction');
ok(table.maxDepth<=8,'fixed D face can be reached within eight HTM');

// Verify shortest-distance transitions exhaustively, not against an inverse scramble.
const maskState=mask=>Uint32Array.from({length:24},(_,i)=>(mask&(1<<i))?0:1);
for(const [mask,distance] of table.distances){
  if(!distance)continue;
  const state=maskState(mask);let lower=false;
  for(const move of choices){const next=applyMove(state,2,move);let key=0;for(let i=0;i<24;i++)if(next[i]===0)key|=1<<i;
    const other=table.distances.get(key);ok(other!==undefined&&Math.abs(other-distance)<=1,'PDB move stays legal and changes distance at most one');
    if(other===distance-1)lower=true;
  }
  ok(lower,'every non-goal PDB state has a descending real move');
}

// Construct independent corner facelets from cubie permutations/orientations.
const cornerPositions=[[1,1,1],[0,1,1],[0,1,0],[1,1,0],[1,0,1],[0,0,1],[0,0,0],[1,0,0]];
const cornerFaces=[[0,1,2],[0,2,4],[0,4,5],[0,5,1],[3,2,1],[3,4,2],[3,5,4],[3,1,5]];
const geometry=Array.from({length:24},(_,i)=>faceletGeometry(2,i));
const corners=cornerPositions.map((position,p)=>cornerFaces[p].map(face=>geometry.find(g=>g.faceIndex===face&&g.position.every((v,i)=>v===position[i])).index));
const colors=corners.map(indices=>indices.map(i=>Math.floor(i/4)));
function cubies(cp=[0,1,2,3,4,5,6,7],co=Array(8).fill(0)){
  const state=new Uint32Array(24);
  for(let p=0;p<8;p++)for(let j=0;j<3;j++)state[corners[p][(j+co[p])%3]]=colors[cp[p]][j];
  return state;
}
function permutations(values){if(!values.length)return [[]];return values.flatMap((v,i)=>permutations(values.filter((_,j)=>i!==j)).map(t=>[v,...t]));}
const fourPerms=permutations([0,1,2,3]);

// All 27 U-corner orientation patterns (including the skip) with an arbitrary
// bottom-layer permutation must preserve D and orient U after one OLL stage.
for(let a=0;a<3;a++)for(let b=0;b<3;b++)for(let c=0;c<3;c++){
  const d=(6-a-b-c)%3,state=cubies([2,0,3,1,6,4,7,5],[a,b,c,d,0,0,0,0]);
  ok(validate2(state).valid,'independent legal orientation fixture');
  const result=suggest2(state,{crossColor:3});
  same(result.stage,a+b+c+d?'OLL':'PBL','real orientation stage/skip');
  ok(result.candidates.length>0,'all 27 orientations covered');
  for(const candidate of result.candidates){same(candidate.state,applyAlg(state,2,candidate.moves),'replay is exact');ok(isOriented2(candidate.state,3),'both faces oriented');}
}

// Every permutation of four corners in each oriented layer: odd corner
// permutation parity is legal on 2x2 and must not be rejected as on 3x3.
for(const top of fourPerms)for(const bottom of fourPerms){
  const state=cubies([...top,...bottom.map(v=>v+4)]);ok(validate2(state).valid,'2x2 permits independent layer parity');
  const result=suggest2(state,{crossColor:3,maxCandidates:1});
  if(isSolved(state,2)){same(result.stage,'DONE');continue;}
  same(result.stage,'PBL');ok(result.candidates.length>0,`all 576 PBL permutations covered: ${top}/${bottom} ${JSON.stringify(result.coverage)}`);
  same(result.candidates[0].state,applyAlg(state,2,result.candidates[0].moves),'PBL byte replay');
  ok(isSolved(result.candidates[0].state,2),'PBL finishes actual coloured cube');
}

// Arbitrary long scrambles, whole-cube orientations and every chosen D colour.
let phaseCount=0,maxElapsed=0;
for(let sample=0;sample<120;sample++){
  let state=applyAlg(solved,2,[...scramble(),['x','y2',"z'",''][sample%4]].filter(Boolean));
  const crossColor=sample%6;ok(validate2(state).valid,'scramble + rotation validate');
  const seen=[];
  for(let phase=0;phase<4;phase++){
    const snapshot=state.slice(),result=suggest2(state,{crossColor,maxCandidates:2});maxElapsed=Math.max(maxElapsed,result.coverage.elapsedMs);
    same(state,snapshot,'caller state is not mutated');
    if(result.stage==='DONE')break;
    ok(!seen.includes(result.stage),'stage advances monotonically');seen.push(result.stage);phaseCount++;
    ok(result.candidates.length>0,'arbitrary current state has a next stage');
    const chosen=result.candidates[sample%result.candidates.length];same(chosen.state,applyAlg(state,2,chosen.moves),'random stage replay');
    if(result.stage==='D_FACE'){ok(isFirstSide2(chosen.state,crossColor),'chosen colour ends on D');same(chosen.moves.length,result.coverage.optimalHtm,'first side is PDB-shortest');}
    if(result.stage==='OLL')ok(isOriented2(chosen.state,crossColor),'OLL preserves first face');
    if(result.stage==='PBL')ok(isSolved(chosen.state,2),'PBL solved');
    state=chosen.state;
  }
  ok(isSolved(state,2),'full Ortega pipeline solves independently scrambled cube');
}

// Manual histories are not inputs. Equivalent states give the same candidates.
const fixture=applyAlg(solved,2,"R F U2 L' B2");
same(suggest2(fixture).candidates.map(c=>c.moves),suggest2([...fixture]).candidates.map(c=>c.moves));
same(solved,initialCopy,'global solved state never mutated');
const twisted=cubies(undefined,[1,0,0,0,0,0,0,0]);ok(!validate2(twisted).valid,'single twisted corner rejected');
const duplicate=cubies([0,0,2,3,4,5,6,7]);ok(!validate2(duplicate).valid,'duplicate corner rejected');
const mirror=solved.slice();[mirror[4],mirror[9]]=[mirror[9],mirror[4]];ok(!validate2(mirror).valid,'mirrored corner rejected');
assert.throws(()=>suggest2(new Uint32Array(23)),/24/);
assert.throws(()=>suggest2(solved,{crossColor:7}),/цвет/);
assert.throws(()=>suggest2(solved,{signal:{aborted:true}}),e=>e.name==='AbortError');

// All source formulas parse and their inverses replay exactly in the own core.
for(const record of [...ORTEGA_OLL,...ORTEGA_PBL])same(applyAlg(applyAlg(solved,2,record.alg),2,invertAlg(record.alg,2)),solved,record.caseId);
console.log(JSON.stringify({pass:true,checks,pdbStates:table.states,pdbMaxDepth:table.maxDepth,ollPatterns:27,pblPermutations:576,randomPipelines:120,phaseCount,maxQueryMs:Math.round(maxElapsed*10)/10,elapsedMs:Math.round(performance.now()-started)}));
