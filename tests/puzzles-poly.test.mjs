import assert from 'node:assert/strict';
import {createPolyPuzzle,applyPolyMove,applyPolyAlg,getPolyPermutation,parsePolyMove,parsePolyAlg,normalizePolyMove,
  invertPolyMove,invertPolyAlg,formatPolyMove,formatPolyAlg,isPolySolved,generatePolyScramble,createPolySession,restorePolySession,polyCacheStats} from '../data/puzzles/poly-core.mjs';

let seed=0xa87e516d,comparisons=0;
const rng=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/0x100000000;};
const equal=(a,b,message)=>{assert.deepEqual(a,b,message);comparisons++;};
const dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const magnitude=v=>Math.hypot(...v);

for(const kind of ['pyramid','dodecahedron']){
  for(let order=2;order<=20;order++){
    const puzzle=createPolyPuzzle(kind,order),faceCount=kind==='pyramid'?4:12,m=Math.floor(order/2),q=kind==='pyramid'?3:5;
    const expected=kind==='pyramid'?4*order*order:12*(5*m*(m+1)+1);
    assert.equal(puzzle.faceletCount,expected,`${kind}${order} total geometry count`);
    assert.equal(puzzle.facelets.filter(item=>!item.black).length,kind==='dodecahedron'&&order%2===0?12*5*m*m:expected,`${kind}${order} visible reference count`);
    assert.equal(puzzle.axes.length,faceCount);assert.equal(puzzle.hull.length,faceCount);
    const initial=puzzle.solvedState(),labels=Uint32Array.from({length:puzzle.faceletCount},(_,i)=>i);
    assert.ok(initial instanceof Uint32Array);assert.equal(isPolySolved(initial,puzzle),true);
    const faceAreas=new Array(faceCount).fill(0);
    for(const item of puzzle.facelets){
      assert.ok(item.vertices.length>=3&&item.area>1e-12);
      assert.ok(Math.abs(magnitude(item.normal)-1)<1e-8);
      for(const point of item.vertices){
        assert.ok(point.every(Number.isFinite));assert.ok(Math.abs(dot(point,item.normal)-dot(item.center,item.normal))<1e-7,'facelet is planar');
        for(const face of puzzle.hull)assert.ok(dot(point,face.normal)<=dot(face.center,face.normal)+1e-7,'point stays in regular hull');
      }
      const winding=cross(sub(item.vertices[1],item.vertices[0]),sub(item.vertices[2],item.vertices[1]));
      assert.ok(dot(winding,item.normal)>-1e-9,'consistent outward winding');faceAreas[item.faceIndex]+=item.area;
    }
    const referenceArea=faceAreas[0];for(const area of faceAreas)assert.ok(Math.abs(area-referenceArea)<1e-7,'equal area on all regular faces');
    for(const axis of puzzle.axes){
      assert.equal(axis.layerCount,kind==='pyramid'?order:m);assert.equal(axis.bandCount,kind==='pyramid'?order:2*m+1);
      const layerMembers=new Set();
      for(let layer=0;layer<axis.layerCount;layer++){
        const move={axis:axis.id,layers:[layer],turns:1},info=puzzle.moveInfo(move),permutation=getPolyPermutation(puzzle,move);
        assert.ok(permutation instanceof Uint32Array);assert.equal(new Set(permutation).size,puzzle.faceletCount,'bijective permutation');
        for(const index of info.affectedIndices){assert.equal(puzzle.layerFor(axis.id,index),layer);assert.equal(layerMembers.has(index),false);layerMembers.add(index);}
        equal(applyPolyMove(labels,puzzle,move),permutation,'dest→source permutation');
        equal(applyPolyAlg(labels,puzzle,new Array(q).fill(move)),labels,`${kind}${order}/${axis.id}/${layer} group order ${q}`);
        equal(applyPolyMove(applyPolyMove(labels,puzzle,move),puzzle,invertPolyMove(move,puzzle)),labels,'exact inverse');
        equal(applyPolyMove(labels,puzzle,parsePolyMove(formatPolyMove(move,puzzle),puzzle)),permutation,'notation roundtrip');
        for(let i=0;i<permutation.length;i++)assert.equal(puzzle.facelets[i].black,puzzle.facelets[permutation[i]].black,'black reference cells are closed move orbits');
        const bands=info.bands;assert.equal(bands.length,axis.bandCount);assert.equal(bands.filter(band=>band.moving).length,1);
        for(let i=1;i<bands.length;i++)assert.ok(Math.abs(bands[i].min-bands[i-1].max)<1e-8,'renderer bands cover exact consecutive slabs');
      }
      assert.equal(layerMembers.size,puzzle.facelets.filter(item=>puzzle.layerFor(axis.id,item.index)>=0).length,'all legal axis layers partition the near-face region');
      const whole={axis:axis.id,layers:Array.from({length:axis.bandCount},(_,i)=>i),turns:1,whole:true};
      assert.equal(isPolySolved(applyPolyMove(initial,puzzle,whole),puzzle),true,'whole rotation remains solved');
      assert.equal(isPolySolved(applyPolyMove(initial,puzzle,whole),puzzle,{rotationAgnostic:false}),false,'strict orientation distinguishes whole rotation');
      const allSingles=Array.from({length:axis.layerCount},(_,layer)=>({axis:axis.id,layers:[layer],turns:1}));
      if(kind==='pyramid')equal(applyPolyMove(labels,puzzle,whole),applyPolyAlg(labels,puzzle,allSingles),'whole equals all single slabs');
      equal(applyPolyAlg(labels,puzzle,new Array(q).fill(whole)),labels,'whole rotation group order');
      equal(applyPolyMove(labels,puzzle,parsePolyMove(formatPolyMove(whole,puzzle),puzzle)),applyPolyMove(labels,puzzle,whole),'whole notation roundtrip');
      if(axis.layerCount>=2){
        const wide={axis:axis.id,layers:[0,1],turns:1};
        equal(applyPolyMove(labels,puzzle,wide),applyPolyAlg(labels,puzzle,allSingles.slice(0,2)),'wide equals outer two slabs');
      }
    }
    const scramble=generatePolyScramble(puzzle,{length:19,rng}),mixed=applyPolyAlg(labels,puzzle,scramble);
    equal(applyPolyAlg(mixed,puzzle,invertPolyAlg(scramble,puzzle)),labels,'random scramble inverse');
    equal(labels,Uint32Array.from({length:puzzle.faceletCount},(_,i)=>i),'source state remains unchanged');
    assert.equal(isPolySolved(applyPolyAlg(initial,puzzle,scramble),puzzle),false,'random state is not solved');
    const session=createPolySession(puzzle);session.applyAlg(scramble);const end=session.state;session.undo();session.undo();
    const restored=restorePolySession(session.serialize());equal(restored.state,session.state,'serialized undo cursor');restored.redo();restored.redo();equal(restored.state,end,'restored redo tail');
    const stats=polyCacheStats(puzzle);assert.ok(stats.entries<=stats.maxEntries&&stats.bytes<=stats.maxBytes,'bounded permutations');
  }
  console.log(`PASS ${kind}: all orders2..20, all axes and individual layers, exact ${kind==='pyramid'?120:72}° group powers.`);
}

const pyramid=createPolyPuzzle('pyramid',3),dodeca=createPolyPuzzle('dodecahedron',3);
equal(parsePolyMove('u',pyramid).layers,[0],'pyramid lowercase tip');equal(parsePolyMove('U',pyramid).layers,[0,1],'pyramid uppercase body+tip');
equal(parsePolyMove('2U',pyramid).layers,[1],'explicit inner layer');equal(parsePolyMove('Uv',pyramid).layers,[0,1,2],'whole pyramid rotation');
assert.equal(formatPolyMove(parsePolyMove('U2',pyramid),pyramid),"U'",'pyramid double is inverse120');
assert.equal(formatPolyMove(invertPolyMove('A2',dodeca),dodeca),"A2'",'72-degree double is not self-inverse');
equal(applyPolyAlg(dodeca.solvedState(),dodeca,'[A,B]'),applyPolyAlg(dodeca.solvedState(),dodeca,"A B A' B'"),'commutator');
equal(applyPolyAlg(pyramid.solvedState(),pyramid,"(U R)3'"),applyPolyAlg(pyramid.solvedState(),pyramid,"R' U' R' U' R' U'"),'group repeat/inverse');
equal(parsePolyAlg("U3 R0 //comment\n B²",pyramid).map(move=>move.token),["B'"],'zero powers and unicode');
assert.equal(formatPolyAlg('A A2 A2\'',dodeca),"A A2 A2'");
const cacheCopy=getPolyPermutation(dodeca,'A');cacheCopy.fill(0);assert.equal(new Set(getPolyPermutation(dodeca,'A')).size,132,'external writes cannot poison cached permutation');
assert.equal(createPolyPuzzle('dodecahedron',2).facelets.filter(item=>item.black).length,72);
assert.equal(dodeca.axes[0].layerCount,1,'reference dodeca has no additional central legal layer');
assert.equal(dodeca.axes[0].bandCount,3,'renderer still covers the central fixed body');
assert.throws(()=>parsePolyMove('2A',dodeca));
for(const value of [0,1,21,2.5,'3',NaN])assert.throws(()=>createPolyPuzzle('pyramid',value));
assert.throws(()=>createPolyPuzzle('icosahedron',3));
for(const token of ['0U','4U','0Uw','Rww','R\'\'','[U,R','(U','2Uv','Q','2-1Uw'])assert.throws(()=>parsePolyAlg(token,pyramid),token);
assert.throws(()=>normalizePolyMove({axis:'U',layers:[0,2],turns:1},pyramid));assert.throws(()=>normalizePolyMove({axis:'U',layers:[0,0],turns:1},pyramid));
assert.throws(()=>applyPolyMove(new Uint32Array(10),pyramid,'U'));assert.throws(()=>parsePolyAlg('(U)100001',pyramid));
assert.throws(()=>generatePolyScramble(pyramid,{rng:()=>1}));
const session=createPolySession('pyramid',4);session.applyAlg('U R 2L u');session.undo();const data=session.toJSON();
for(const patch of [{kind:'cube'},{order:51},{version:2},{cursor:-1},{cursor:1000},{moves:['99U']},{extra:true}])assert.throws(()=>restorePolySession({...data,...patch}));
const before=session.serialize();assert.throws(()=>session.applyAlg('U BAD'));assert.equal(session.serialize(),before,'bad history batch is atomic');
session.apply('B');assert.equal(session.canRedo,false);while(session.undo()){}assert.equal(session.solved,true);assert.equal(session.undo(),false);
session.redo();const leaked=session.state;leaked.fill(99);assert.notEqual(session.state[0],99);session.reset();assert.equal(session.historyLength,0);
console.log(`PASS poly core: ${comparisons} equality properties; geometry, reference colors, all layer permutations, notation, immutable states and sessions.`);
