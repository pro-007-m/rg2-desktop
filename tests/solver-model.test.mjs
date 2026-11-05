import assert from 'node:assert/strict';
import {FACELETS} from '../data/solver/core.mjs';
import {CELL_PITCH,CAP_FRONT,CAP_CROWN,capRadii,createCapGeometry} from '../data/solver/model-geometry.mjs';

const geometries=new Map(),counts={center:0,edge:0,corner:0};let vertices=0,triangles=0;
for(const facelet of FACELETS){
  const radii=capRadii(facelet),large=radii.filter(r=>r>.1).length;
  const zeroes=facelet.position.filter(v=>v===0).length;
  assert.equal(large,zeroes===2?4:zeroes===1?2:1,'Inner corners must round toward the four face intersections');
  counts[zeroes===2?'center':zeroes===1?'edge':'corner']++;
  const key=radii.join(',');if(geometries.has(key))continue;
  const geometry=createCapGeometry(radii);geometries.set(key,geometry);
  const positions=geometry.attributes.position,normals=geometry.attributes.normal,bounds=geometry.boundingBox;
  assert.ok(geometry.index && positions.count>20);
  assert.ok(bounds.max.x<=CELL_PITCH/2 && bounds.min.x>=-CELL_PITCH/2);
  assert.ok(bounds.max.y<=CELL_PITCH/2 && bounds.min.y>=-CELL_PITCH/2);
  assert.ok(bounds.max.z>CAP_FRONT && bounds.max.z<=CAP_FRONT+CAP_CROWN+.0001,'The colored cap has a shallow convex crown');
  assert.ok(bounds.max.z-bounds.min.z>.15,'Caps have actual colored thickness, not flat stickers');
  // Weld by position: smooth normals must not hide cracks between front and bevel.
  const welded=new Map(),ids=[],edges=new Map();let volume=0;
  for(let i=0;i<positions.count;i++){
    const key=[positions.getX(i),positions.getY(i),positions.getZ(i)].map(v=>Math.round(v*1e6)).join(',');
    if(!welded.has(key))welded.set(key,welded.size);ids.push(welded.get(key));
  }
  for(let i=0;i<geometry.index.count;i+=3){
    const indices=[0,1,2].map(k=>geometry.index.getX(i+k)),triangle=indices.map(j=>ids[j]);
    assert.equal(new Set(triangle).size,3,'No degenerate triangles');
    for(let k=0;k<3;k++){
      const a=triangle[k],b=triangle[(k+1)%3],key=a<b?a+','+b:b+','+a,edge=edges.get(key)||{count:0,winding:0};
      edge.count++;edge.winding+=a<b?1:-1;edges.set(key,edge);
    }
    const [a,b,c]=indices.map(j=>[positions.getX(j),positions.getY(j),positions.getZ(j)]);
    volume+=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;
  }
  assert.ok([...edges.values()].every(edge=>edge.count===2&&edge.winding===0),'Every edge belongs to two oppositely oriented triangles: cap is fully closed');
  assert.ok(volume>.15,'Caps enclose actual solid volume');
  for(let i=0;i<positions.count;i++){
    assert.ok([positions.getX(i),positions.getY(i),positions.getZ(i),normals.getX(i),normals.getY(i),normals.getZ(i)].every(Number.isFinite));
    const length=Math.hypot(normals.getX(i),normals.getY(i),normals.getZ(i));assert.ok(length>.99&&length<1.01,'Smooth, nondegenerate cap normals');
  }
  vertices+=positions.count;triangles+=geometry.index.count/3;
}
assert.deepEqual(counts,{center:6,edge:24,corner:24});assert.equal(geometries.size,9);
for(const geometry of geometries.values())geometry.dispose();
console.log(JSON.stringify({faceCaps:54,sharedGeometryVariants:geometries.size,counts,vertices,triangles,finiteSmoothGeometry:true}));
