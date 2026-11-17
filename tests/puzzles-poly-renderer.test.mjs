import assert from 'node:assert/strict';
import * as THREE from '../data/solver/vendor/three.module.js';
import {polygonDescriptor,createPolygonCap,createHullGeometry,clipBand,axisRotation,rotatePolyInstance,unit,centroid,dot,cross} from '../data/puzzles/poly-geometry.mjs';
import {pointInPolygon,validatePolyLayout} from '../data/puzzles/poly-renderer.mjs';
import {createPolyPuzzle,getPolyPermutation} from '../data/puzzles/poly-core.mjs';

function inspect(geometry,{closed=true}={}){
  const p=geometry.attributes.position,indices=geometry.index,vertices=new Map(),ids=[],edges=new Map();let volume=0;
  for(let i=0;i<p.count;i++){const key=[p.getX(i),p.getY(i),p.getZ(i)].map(v=>Math.round(v*1e5)).join(',');if(!vertices.has(key))vertices.set(key,vertices.size);ids.push(vertices.get(key));}
  for(let i=0;i<(indices?indices.count:p.count);i+=3){const original=[0,1,2].map(j=>indices?indices.getX(i+j):i+j),triangle=original.map(j=>ids[j]);assert.equal(new Set(triangle).size,3,'No degenerate cap/fill triangles');const [a,b,c]=original.map(j=>new THREE.Vector3().fromBufferAttribute(p,j));assert.ok(new THREE.Vector3().crossVectors(b.clone().sub(a),c.clone().sub(a)).length()>1e-10);volume+=a.dot(new THREE.Vector3().crossVectors(b,c))/6;for(let j=0;j<3;j++){const a=triangle[j],b=triangle[(j+1)%3],key=Math.min(a,b)+','+Math.max(a,b),e=edges.get(key)||{count:0,winding:0};e.count++;e.winding+=a<b?1:-1;edges.set(key,e);}}
  if(closed)assert.ok([...edges.values()].every(e=>e.count===2&&e.winding===0),'Cap/fill must be a closed consistently wound solid');return volume;
}
for(const count of [3,4,5,6])for(const quality of ['low','medium','high']){
  const points=Array.from({length:count},(_,i)=>[Math.cos(i/count*Math.PI*2),Math.sin(i/count*Math.PI*2)]),g=createPolygonCap(points,{quality});assert.ok(inspect(g)>0);assert.equal(g.index.count/3,count*(quality==='low'?4:6));g.dispose();
  const dense=createPolygonCap(points,{quality,dense:true}),p=dense.attributes.position;
  assert.ok(inspect(dense)>0,'Dense caps retain closed opaque side/back walls');assert.equal(dense.index.count/3,count*4);assert.equal(dense.userData.dense,true);
  for(let i=0;i<count;i++){assert.ok(Math.abs(p.getX(i)-points[i][0]*1.002)<1e-6);assert.ok(Math.abs(p.getY(i)-points[i][1]*1.002)<1e-6);assert.equal(p.getZ(i),0,'Different sized dense polygons share the exact hull plane');assert.equal(dense.attributes.color.getX(i),1);assert.equal(dense.attributes.capBoundary.getX(i),0);}
  assert.equal(dense.attributes.capBoundary.getX(count*2),1);dense.dispose();
}
const face={vertices:[[0,1,0],[-.866,-.5,0],[.866,-.5,0]],normal:[0,0,1]};
const transform=new THREE.Matrix4().compose(new THREE.Vector3(.4,.3,-.7),new THREE.Quaternion().setFromEuler(new THREE.Euler(.5,.2,.7)),new THREE.Vector3(2,2,2));
const transformed={vertices:face.vertices.map(p=>new THREE.Vector3(...p).applyMatrix4(transform).toArray()),normal:new THREE.Vector3(...face.normal).transformDirection(transform).toArray()};
assert.equal(polygonDescriptor(face).key,polygonDescriptor(transformed).key,'Congruent cells across faces share an instance geometry');
assert.equal(pointInPolygon([0,0,0],face.vertices,face.normal),true);assert.equal(pointInPolygon([2,2,0],face.vertices,face.normal),false);assert.throws(()=>validatePolyLayout({}));

const tetraVertices=[[1,1,1],[1,-1,-1],[-1,1,-1],[-1,-1,1]].map(unit),tetra=tetraVertices.map((v,i)=>({vertices:tetraVertices.filter((_,j)=>j!==i),normal:v.map(x=>-x)}));
const dodecaGeometry=new THREE.DodecahedronGeometry(1),p=dodecaGeometry.attributes.position,planes=new Map();
for(let i=0;i<p.count;i+=3){const triangle=[0,1,2].map(j=>new THREE.Vector3().fromBufferAttribute(p,i+j)),normal=triangle[1].clone().sub(triangle[0]).cross(triangle[2].clone().sub(triangle[0])).normalize(),key=normal.toArray().map(v=>Math.round(v*1e5)).join(',');if(!planes.has(key))planes.set(key,{normal:normal.toArray(),points:new Map()});for(const point of triangle)planes.get(key).points.set(point.toArray().map(v=>Math.round(v*1e5)).join(','),point.toArray());}
const dodeca=[...planes.values()].map(({normal,points})=>{const vertices=[...points.values()],center=centroid(vertices),u=unit(vertices[0].map((v,i)=>v-center[i])),v=cross(normal,u);vertices.sort((a,b)=>Math.atan2(dot(a.map((x,i)=>x-center[i]),v),dot(a.map((x,i)=>x-center[i]),u))-Math.atan2(dot(b.map((x,i)=>x-center[i]),v),dot(b.map((x,i)=>x-center[i]),u)));return {vertices,normal};});dodecaGeometry.dispose();assert.equal(dodeca.length,12);
for(const hull of [tetra,dodeca]){
  const whole=createHullGeometry(hull),total=inspect(whole);assert.ok(total>0);whole.dispose();
  for(const axis of [[1,0,0],unit([.3,.7,-.2])]){
    let partition=0;
    for(const [min,max] of [[-Infinity,-.25],[-.25,.25],[.25,Infinity]]){const geometry=createHullGeometry(clipBand(hull,axis,min,max));partition+=inspect(geometry);geometry.dispose();}
    assert.ok(Math.abs(partition-total)<1e-6,'Closed opaque bands partition the actual full hull without gaps/overlap');
  }
}
for(const axis of [[1,0,0],unit([.2,.6,.7])])for(const angle of [2*Math.PI/3,2*Math.PI/5,-4*Math.PI/5]){
  const base=new THREE.Matrix4().compose(new THREE.Vector3(.3,.8,-.2),new THREE.Quaternion().setFromEuler(new THREE.Euler(.2,.1,.3)),new THREE.Vector3(.4,.4,.4));
  const expected=new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(...axis),angle).multiply(base).elements,out=new Float32Array(16);rotatePolyInstance(base.elements,0,out,0,axisRotation(axis,angle));out.forEach((v,i)=>assert.ok(Math.abs(v-expected[i])<1e-6));
}
const actualCounts=[];
for(const kind of ['pyramid','dodecahedron'])for(const order of [2,3,4,8,20]){
  const puzzle=validatePolyLayout(createPolyPuzzle(kind,order)),shapes=new Map();
  for(const f of puzzle.facelets)if(!f.hidden&&!f.black){const d=polygonDescriptor(f);if(!shapes.has(d.key))shapes.set(d.key,d);}
  for(const d of shapes.values())for(const dense of [false,true]){const geometry=createPolygonCap(d.points,{quality:'low',dense});assert.ok(inspect(geometry)>0);geometry.dispose();}
  const axis=puzzle.axes[0],info=puzzle.moveInfo({axis:axis.id,layers:[Math.min(1,axis.layerCount-1)],turns:1}),permutation=getPolyPermutation(puzzle,info.move),destination=new Uint32Array(permutation.length);
  permutation.forEach((source,target)=>destination[source]=target);
  const rotation=new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(...info.axis),info.angleRad);
  for(const index of info.affectedIndices){const f=puzzle.facelets[index],target=puzzle.facelets[destination[index]],center=new THREE.Vector3(...f.center).applyMatrix4(rotation),normal=new THREE.Vector3(...f.normal).transformDirection(rotation);assert.ok(center.distanceTo(new THREE.Vector3(...target.center))<1e-6);assert.ok(normal.distanceTo(new THREE.Vector3(...target.normal))<1e-6);}
  const hull=createHullGeometry(puzzle.hull),wholeVolume=inspect(hull);hull.dispose();let sum=0;
  for(const band of info.bands){const fill=createHullGeometry(clipBand(puzzle.hull,info.axis,band.min,band.max));sum+=inspect(fill);fill.dispose();}
  assert.ok(Math.abs(sum-wholeVolume)<1e-6,'Actual core cut planes must produce closed volume-preserving render fills');
  actualCounts.push({kind,order,facelets:puzzle.faceletCount,colored:puzzle.facelets.filter(f=>!f.hidden&&!f.black).length,groups:shapes.size});
}
assert.equal(actualCounts.find(p=>p.kind==='dodecahedron'&&p.order===2).colored,60);
console.log(JSON.stringify(actualCounts));
console.log('Poly renderer: closed beveled polygon caps, congruent instancing, closed tetra/dodeca clipped bands and volume, exact arbitrary-axis 120/72-degree transforms passed');
