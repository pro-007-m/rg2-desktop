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
  for(let i=0;i<positions.count;i++){
    assert.ok([positions.getX(i),positions.getY(i),positions.getZ(i),normals.getX(i),normals.getY(i),normals.getZ(i)].every(Number.isFinite));
    const length=Math.hypot(normals.getX(i),normals.getY(i),normals.getZ(i));assert.ok(length>.99&&length<1.01,'Smooth, nondegenerate cap normals');
  }
  vertices+=positions.count;triangles+=geometry.index.count/3;
}
assert.deepEqual(counts,{center:6,edge:24,corner:24});assert.equal(geometries.size,9);
for(const geometry of geometries.values())geometry.dispose();
console.log(JSON.stringify({faceCaps:54,sharedGeometryVariants:geometries.size,counts,vertices,triangles,finiteSmoothGeometry:true}));
