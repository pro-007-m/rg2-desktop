import assert from 'node:assert/strict';
import * as THREE from '../data/solver/vendor/three.module.js';
import {cubeFacelet,cubeLayout,createTileGeometry,rotateInstance,slabRuns,validSize} from '../data/puzzles/renderer.mjs';
import {faceletGeometry,solvedState,applyMove} from '../data/puzzles/core.mjs';
import {FACELETS} from '../data/solver/core.mjs';
import {qualityProfile,createAdaptiveQuality} from '../data/puzzles/performance.mjs';

for(const n of [2,3,4,7,10,25,50]){
  const layout=cubeLayout(n);
  assert.equal(layout.facelets.length,6*n*n);assert.equal(layout.bodies.length,n**3-(n-2)**3);
  assert.equal(new Set(layout.bodies.map(p=>p.join(','))).size,layout.bodies.length);
  const keys=new Set();
  for(const f of layout.facelets){
    assert.deepEqual(f.position,faceletGeometry(n,f.index).position);assert.deepEqual(f.normal,faceletGeometry(n,f.index).normal);
    assert.ok(f.position.every(v=>Number.isInteger(v)&&v>=0&&v<n));
    const key=f.position.join(',')+'/'+f.normal.join(',');assert.ok(!keys.has(key));keys.add(key);
    if(n===3){assert.deepEqual(f.position.map(v=>v-1),FACELETS[f.index].position);assert.deepEqual(f.normal,FACELETS[f.index].normal);}
  }
  const source=solvedState(n),move={axis:'y',layers:[n-1],turns:1},after=applyMove(source,n,move);
  // A visual quarter-turn sends every selected source facelet to its actual core destination.
  for(const f of layout.facelets){
    if(f.position[1]!==n-1)continue;
    const [x,y,z]=f.position.map(v=>v-(n-1)/2),[nx,ny,nz]=f.normal;
    const target=layout.facelets.find(g=>g.position.every((v,i)=>v===[z+(n-1)/2,y+(n-1)/2,-x+(n-1)/2][i])&&g.normal.every((v,i)=>v===[nz,ny,-nx][i]));
    assert.ok(target);assert.equal(after[target.index],source[f.index]);
  }
}
for(const value of [0,1,51,NaN,3.5])assert.throws(()=>validSize(value));
assert.throws(()=>cubeFacelet(3,54));

for(const segments of [0,1,2,3]){
  const geometry=createTileGeometry(segments),positions=geometry.getAttribute('position'),ids=[],vertices=new Map(),edges=new Map();
  for(let i=0;i<positions.count;i++){
    const xyz=[positions.getX(i),positions.getY(i),positions.getZ(i)],key=xyz.map(v=>Math.round(v*1e6)).join(',');
    if(!vertices.has(key))vertices.set(key,vertices.size);ids.push(vertices.get(key));
  }
  let volume=0;
  for(let i=0;i<geometry.index.count;i+=3){
    const original=[0,1,2].map(j=>geometry.index.getX(i+j)),triangle=original.map(j=>ids[j]);assert.equal(new Set(triangle).size,3);
    const [a,b,c]=original.map(j=>new THREE.Vector3().fromBufferAttribute(positions,j));volume+=a.dot(new THREE.Vector3().crossVectors(b,c))/6;
    for(let j=0;j<3;j++){const a=triangle[j],b=triangle[(j+1)%3],key=Math.min(a,b)+','+Math.max(a,b),edge=edges.get(key)||{count:0,winding:0};edge.count++;edge.winding+=a<b?1:-1;edges.set(key,edge);}
  }
  assert.ok([...edges.values()].every(e=>e.count===2&&e.winding===0),'Every cap must be a consistently oriented closed solid');
  assert.ok(volume>.02&&volume<.12);assert.equal(vertices.size-edges.size+geometry.index.count/3,2);
  const stops=new Set([...Array.from({length:segments+1},(_,i)=>i/segments),.5]);
  assert.equal(geometry.index.count/3,segments?4*stops.size*8:12);geometry.dispose();
}
for(const axis of ['x','y','z'])for(const angle of [Math.PI/2,-Math.PI/2,Math.PI,.41]){
  const base=new THREE.Matrix4().compose(new THREE.Vector3(.32,-1.22,.9),new THREE.Quaternion().setFromEuler(new THREE.Euler(.2,.4,.1)),new THREE.Vector3(.7,.8,.9));
  const out=new Float32Array(16),rotation=new THREE.Matrix4()[`makeRotation${axis.toUpperCase()}`](angle),expected=rotation.multiply(base).elements;
  rotateInstance(base.elements,0,out,0,axis,angle);out.forEach((v,i)=>assert.ok(Math.abs(v-expected[i])<1e-6));
}
for(const n of [2,3,50])for(const layers of [[0],[n-1],Array.from({length:n},(_,i)=>i),[0,n-1]]){
  const runs=slabRuns(n,layers),coverage=runs.flatMap(r=>Array.from({length:r.count},(_,i)=>({i:r.first+i,moving:r.moving})));
  assert.deepEqual(coverage.map(c=>c.i),Array.from({length:n},(_,i)=>i));coverage.forEach(c=>assert.equal(c.moving,layers.includes(c.i)));
}
const large=qualityProfile({size:50,width:500,height:500,devicePixelRatio:3});assert.equal(large.quality,'low');assert.equal(large.capSegments,0);assert.ok(large.maxTriangles<400000);
const mobile=qualityProfile({size:7,mobile:true,deviceMemory:2,hardwareConcurrency:4,devicePixelRatio:3});assert.ok(mobile.dpr<=1.15);assert.equal(mobile.bloom,false);
const manualMobile=qualityProfile({size:3,quality:'high',mobile:true,deviceMemory:2,hardwareConcurrency:4,devicePixelRatio:3});assert.equal(manualMobile.bloom,true);assert.equal(manualMobile.antialias,true);assert.ok(manualMobile.dpr>mobile.dpr,'explicit detailed quality permits full effects');
const adaptive=createAdaptiveQuality(qualityProfile({size:3,devicePixelRatio:2}),{sampleCount:4});
for(let i=0;i<7;i++)assert.equal(adaptive.sample(30),null);
const reduced=adaptive.sample(30);assert.ok(reduced.dpr<1.75);
const manual=createAdaptiveQuality(qualityProfile({quality:'high'}),{sampleCount:1});for(let i=0;i<20;i++)assert.equal(manual.sample(60),null);
console.log('Playable renderer: NxN 2..50/core geometry oracle, exact visual transforms, closed low-cost caps, opaque slab coverage, quality adaptation passed');
