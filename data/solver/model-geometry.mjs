import * as THREE from './vendor/three.module.js';
import {mergeVertices} from './vendor/addons/utils/BufferGeometryUtils.js';

export const CELL_PITCH = 1.02;
export const CAP_FRONT = .505;
export const CAP_CROWN = .018;
const HALF = .945 / 2;

// A GAN-style cap rounds the corners facing the four inner grid intersections
// much more than the outer cube corners. Each cap still represents ONE facelet.
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

function segmentDistance(x,y,a,b) {
  const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
  const t=length?Math.max(0,Math.min(1,((x-a.x)*dx+(y-a.y)*dy)/length)):0;
  return Math.hypot(x-a.x-dx*t,y-a.y-dy*t);
}

export function createCapGeometry(radii) {
  const shape=outline(radii);
  const original=new THREE.ExtrudeGeometry(shape,{depth:.10,bevelEnabled:true,bevelThickness:.035,bevelSize:.03,bevelSegments:5,steps:1,curveSegments:12});
  original.computeBoundingBox();const front=original.boundingBox.max.z;
  const boundary=shape.getPoints(24),distances=new Map();
  function distance(x,y){const key=x.toFixed(5)+','+y.toFixed(5);if(!distances.has(key))distances.set(key,Math.min(...boundary.slice(1).map((b,i)=>segmentDistance(x,y,boundary[i],b))));return distances.get(key);}
  const positions=original.attributes.position.array,out=[];
  const push=point=>{const d=distance(point[0],point[1]);out.push(point[0],point[1],point[2]+CAP_CROWN*(1-Math.exp(-Math.pow(d/.16,2))));};
  function subdivide(a,b,c,depth){
    if(!depth){push(a);push(b);push(c);return;}
    const mid=(u,v)=>u.map((value,i)=>(value+v[i])/2),ab=mid(a,b),bc=mid(b,c),ca=mid(c,a);
    subdivide(a,ab,ca,depth-1);subdivide(ab,b,bc,depth-1);subdivide(ca,bc,c,depth-1);subdivide(ab,bc,ca,depth-1);
  }
  for(let i=0;i<positions.length;i+=9){
    const a=Array.from(positions.slice(i,i+3)),b=Array.from(positions.slice(i+3,i+6)),c=Array.from(positions.slice(i+6,i+9));
    if([a,b,c].every(p=>Math.abs(p[2]-front)<1e-5))subdivide(a,b,c,2);else out.push(...a,...b,...c);
  }
  const raw=new THREE.BufferGeometry();raw.setAttribute('position',new THREE.Float32BufferAttribute(out,3));
  const geometry=mergeVertices(raw,1e-5);geometry.computeVertexNormals();
  // A flat tangent at the cap boundary avoids diagonal highlights from the
  // triangulation while the interior vertices form a shallow convex crown.
  const p=geometry.attributes.position,n=geometry.attributes.normal;
  for(let i=0;i<p.count;i++)if(Math.abs(p.getZ(i)-front)<1e-5&&distance(p.getX(i),p.getY(i))<.001)n.setXYZ(i,0,0,1);
  geometry.translate(0,0,CAP_FRONT-front);geometry.computeBoundingBox();geometry.computeBoundingSphere();
  raw.dispose();original.dispose();return geometry;
}
