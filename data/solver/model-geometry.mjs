import * as THREE from './vendor/three.module.js';
import {mergeVertices} from './vendor/addons/utils/BufferGeometryUtils.js';

export const CELL_PITCH = 1.02;
export const CAP_FRONT = .505;
export const CAP_CROWN = .018;
const HALF = .945 / 2;

// Preserve the nine GAN-style corner profiles and the public renderer API.
export function capRadii(facelet) {
  const normal = new THREE.Vector3(...facelet.normal);
  const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),normal);
  const local = new THREE.Vector3(...facelet.position).applyQuaternion(rotation.clone().invert());
  const center = Math.abs(local.x)<.1 && Math.abs(local.y)<.1;
  return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y]) =>
    Math.abs(local.x+x*.5)<1.49 && Math.abs(local.y+y*.5)<1.49 ? (center ? .40 : .32) : .045);
}

function outline(radii) {
  const [bl,br,tr,tl]=radii,s=new THREE.Shape(),h=HALF;
  s.moveTo(-h+bl,-h);s.lineTo(h-br,-h);s.quadraticCurveTo(h,-h,h,-h+br);
  s.lineTo(h,h-tr);s.quadraticCurveTo(h,h,h-tr,h);s.lineTo(-h+tl,h);
  s.quadraticCurveTo(-h,h,-h,h-tl);s.lineTo(-h,-h+bl);s.quadraticCurveTo(-h,-h,-h+bl,-h);
  return s;
}

function exactFrontContour(frontTriangles) {
  const points=[],pointIds=new Map(),edges=new Map();
  const idFor=point=>{
    const key=point.map(value=>Math.round(value*1e6)).join(',');
    if(!pointIds.has(key)){pointIds.set(key,points.length);points.push(point);}
    return pointIds.get(key);
  };
  for(const triangle of frontTriangles) {
    const ids=triangle.map(idFor);
    for(let i=0;i<3;i++) {
      const a=ids[i],b=ids[(i+1)%3],key=a<b?a+','+b:b+','+a;
      const edge=edges.get(key)||{a,b,count:0};edge.count++;edges.set(key,edge);
    }
  }
  const neighbors=new Map(),boundary=[...edges.values()].filter(edge=>edge.count===1);
  for(const {a,b} of boundary) {
    if(!neighbors.has(a))neighbors.set(a,[]);
    if(!neighbors.has(b))neighbors.set(b,[]);
    neighbors.get(a).push(b);neighbors.get(b).push(a);
  }
  if(!boundary.length||[...neighbors.values()].some(list=>list.length!==2))throw new Error('Cap front contour must be a single closed loop.');
  const start=boundary[0].a,ordered=[];
  let previous=-1,current=start;
  do {
    ordered.push(points[current]);
    const options=neighbors.get(current),next=options[0]===previous?options[1]:options[0];
    previous=current;current=next;
    if(ordered.length>boundary.length)throw new Error('Cap front contour could not be ordered.');
  } while(current!==start);
  if(ordered.length!==boundary.length)throw new Error('Cap front contour contains multiple loops.');
  const signedArea=ordered.reduce((sum,point,i)=>{
    const next=ordered[(i+1)%ordered.length];return sum+point[0]*next[1]-next[0]*point[1];
  },0);
  if(signedArea<0)ordered.reverse();
  return ordered;
}

export function createCapGeometry(radii) {
  const original=new THREE.ExtrudeGeometry(outline(radii),{depth:.10,bevelEnabled:true,bevelThickness:.035,bevelSize:.03,bevelSegments:5,steps:1,curveSegments:12});
  original.computeBoundingBox();
  const front=original.boundingBox.max.z,position=original.getAttribute('position'),index=original.index;
  const frontTriangles=[],out=[];
  const triangleCount=(index?index.count:position.count)/3;
  for(let triangle=0;triangle<triangleCount;triangle++) {
    const points=[0,1,2].map(offset=>{
      const i=index?index.getX(triangle*3+offset):triangle*3+offset;
      return [position.getX(i),position.getY(i),position.getZ(i)];
    });
    if(points.every(point=>Math.abs(point[2]-front)<1e-6))frontTriangles.push(points);
    else for(const point of points)out.push(...point);
  }

  // Reuse the extrusion's ACTUAL front/bevel perimeter, including its exact
  // curve tessellation. Never subdivide only one side of a shared boundary.
  // Every inner ring has the same number of vertices as that perimeter.
  const contour=exactFrontContour(frontTriangles),count=contour.length;
  const scales=[1,.8,.6,.4,.2];
  const rings=scales.map(scale=>contour.map(([x,y,z])=>scale===1?[x,y,z]:[
    x*scale,y*scale,front+CAP_CROWN*(1-scale*scale),
  ]));
  const pushTriangle=(a,b,c)=>out.push(...a,...b,...c);
  for(let ring=0;ring<rings.length-1;ring++) {
    const outer=rings[ring],inner=rings[ring+1];
    for(let i=0;i<count;i++) {
      const next=(i+1)%count;
      pushTriangle(outer[i],outer[next],inner[i]);
      pushTriangle(outer[next],inner[next],inner[i]);
    }
  }
  const inner=rings[rings.length-1],center=[0,0,front+CAP_CROWN];
  for(let i=0;i<count;i++)pushTriangle(inner[i],inner[(i+1)%count],center);

  // The original extrusion's side walls, five bevel bands and closed back face
  // remain intact. The unchanged outer front ring welds directly to those walls.
  const raw=new THREE.BufferGeometry();
  raw.setAttribute('position',new THREE.Float32BufferAttribute(out,3));
  const geometry=mergeVertices(raw,1e-6);
  geometry.computeVertexNormals();geometry.translate(0,0,CAP_FRONT-front);
  geometry.computeBoundingBox();geometry.computeBoundingSphere();
  geometry.userData={topology:'closed-front-rings',frontRingVertices:count,frontRings:scales.length};
  raw.dispose();original.dispose();return geometry;
}
