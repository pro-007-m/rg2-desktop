import * as THREE from '../solver/vendor/three.module.js';

const EPS=1e-7;
export const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const add=(a,b)=>a.map((v,i)=>v+b[i]);
const mul=(a,k)=>a.map(v=>v*k);
export const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const unit=a=>{const length=Math.hypot(...a);if(length<EPS)throw new RangeError('Нулевой вектор геометрии.');return mul(a,1/length);};
const key=p=>p.map(v=>Math.round(v/EPS)).join(',');
export const centroid=vertices=>vertices.reduce((sum,p)=>add(sum,mul(p,1/vertices.length)),[0,0,0]);
function clean(vertices){const out=[];for(const p of vertices)if(!out.length||key(p)!==key(out.at(-1)))out.push([...p]);if(out.length>1&&key(out[0])===key(out.at(-1)))out.pop();return out;}
function polygonNormal(vertices){return unit(vertices.reduce((sum,p,i)=>add(sum,cross(p,vertices[(i+1)%vertices.length])),[0,0,0]));}
function oriented(vertices,normal){const out=clean(vertices);if(out.length>=3&&dot(polygonNormal(out),normal)<0)out.reverse();return out;}

/** A common local cap shape + rigid transform; congruent stickers share one GPU mesh. */
export function polygonDescriptor(facelet){
  const normal=unit(facelet.normal),vertices=oriented(facelet.vertices||facelet.polygon,normal),center=centroid(vertices);
  const tangent=unit(sub(vertices[1],vertices[0])),bitangent=unit(cross(normal,tangent));
  const local=vertices.map(p=>{const delta=sub(p,center);return [dot(delta,tangent),dot(delta,bitangent)];});
  const radius=Math.max(...local.map(p=>Math.hypot(...p)));if(radius<EPS)throw new RangeError('Слишком маленькая наклейка.');
  const points=local.map(p=>p.map(v=>v/radius));
  return {center,normal,tangent,bitangent,radius,points,key:points.map(p=>p.map(v=>Math.round(v*1e5)).join(',')).join(';')};
}

/** Closed polygon caps, physical back/side walls and a small camera-independent bevel. */
export function createPolygonCap(points,{quality='high',inset=.95,dense=false}={}){
  const count=points.length;if(count<3)throw new RangeError('Наклейке нужен многоугольник.');
  // Tiny caps cover their complete mathematical polygon. A minute overlap
  // absorbs independent Float32 instance rounding at shared polygon edges.
  // Their fronts are coplanar even when adjacent polygon radii differ.
  const simple=dense||quality==='low',rings=dense?[{scale:1.002,z:0,tint:1},{scale:1.002,z:-.035,tint:.76}]:simple?[{scale:inset,z:.025,tint:1},{scale:inset,z:-.035,tint:.76}]:[{scale:inset*.95,z:.035,tint:1},{scale:inset,z:.005,tint:.86},{scale:inset,z:-.035,tint:.76}];
  const position=[],tints=[],boundary=[],indices=[];
  rings.forEach(r=>points.forEach(([x,y])=>{position.push(x*r.scale,y*r.scale,r.z);tints.push(r.tint,r.tint,r.tint);boundary.push(0);}));
  const front=position.length/3;position.push(0,0,dense?0:simple?.025:.039);tints.push(1,1,1);boundary.push(1);
  const back=position.length/3;position.push(0,0,-.035);tints.push(.76,.76,.76);boundary.push(1);
  for(let i=0;i<count;i++){
    const j=(i+1)%count;indices.push(front,i,j,back,(rings.length-1)*count+j,(rings.length-1)*count+i);
    for(let ring=0;ring<rings.length-1;ring++){const a=ring*count+i,b=ring*count+j,c=(ring+1)*count+i,d=(ring+1)*count+j;indices.push(a,c,b,b,c,d);}
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(position,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(tints,3));geometry.setAttribute('capBoundary',new THREE.Float32BufferAttribute(boundary,1));geometry.setIndex(indices);geometry.computeVertexNormals();geometry.computeBoundingSphere();geometry.userData={closed:true,quality,dense};return geometry;
}

/** Convex clipping returns CLOSED outward-facing polygon shells, including cut caps. */
export function clipHalfSpace(faces,normal,offset,{above=true}={}){
  const result=[],cut=[],sign=above?1:-1;
  for(const face of faces){
    const input=face.vertices||face.polygon||face,output=[];if(input.length<3)continue;
    for(let i=0;i<input.length;i++){
      const a=input[i],b=input[(i+1)%input.length],da=sign*(dot(normal,a)-offset),db=sign*(dot(normal,b)-offset),insideA=da>=-EPS,insideB=db>=-EPS;
      if(insideA)output.push(a);
      if(insideA!==insideB){const t=da/(da-db),p=a.map((v,j)=>v+(b[j]-v)*t);output.push(p);cut.push(p);}
    }
    const vertices=clean(output);if(vertices.length>=3){try{const n=face.normal||polygonNormal(input);result.push({vertices:oriented(vertices,n),normal:[...n]});}catch{/* A plane can leave a zero-area boundary polygon. */}}
  }
  const unique=[...new Map(cut.map(p=>[key(p),p])).values()];
  if(unique.length>=3){
    const center=centroid(unique),outward=mul(unit(normal),above?-1:1),u=unit(sub(unique[0],center)),v=cross(outward,u);
    unique.sort((a,b)=>Math.atan2(dot(sub(a,center),v),dot(sub(a,center),u))-Math.atan2(dot(sub(b,center),v),dot(sub(b,center),u)));
    result.push({vertices:oriented(unique,outward),normal:outward,cut:true});
  }
  return result;
}
export function clipBand(hull,axis,min,max){
  let faces=hull.map(face=>({vertices:(face.vertices||face.polygon||face).map(p=>[...p]),normal:face.normal?[...face.normal]:polygonNormal(face.vertices||face.polygon||face)}));
  if(Number.isFinite(min))faces=clipHalfSpace(faces,axis,min,{above:true});
  if(Number.isFinite(max))faces=clipHalfSpace(faces,axis,max,{above:false});
  return faces;
}
export function createHullGeometry(faces){
  const positions=[];
  for(const face of faces){const raw=face.vertices||face.polygon||face,vertices=face.normal?oriented(raw,face.normal):raw,center=centroid(vertices);for(let i=0;i<vertices.length;i++)positions.push(...center,...vertices[i],...vertices[(i+1)%vertices.length]);}
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.computeVertexNormals();geometry.computeBoundingSphere();return geometry;
}

export function axisRotation(axis,angle){
  const [x,y,z]=unit(axis),c=Math.cos(angle),s=Math.sin(angle),t=1-c;
  return [t*x*x+c,t*x*y-s*z,t*x*z+s*y,t*x*y+s*z,t*y*y+c,t*y*z-s*x,t*x*z-s*y,t*y*z+s*x,t*z*z+c];
}
export function rotatePolyInstance(source,offset,target,targetOffset,rotation){
  for(let column=0;column<4;column++){const i=offset+column*4,o=targetOffset+column*4,x=source[i],y=source[i+1],z=source[i+2];target[o]=rotation[0]*x+rotation[1]*y+rotation[2]*z;target[o+1]=rotation[3]*x+rotation[4]*y+rotation[5]*z;target[o+2]=rotation[6]*x+rotation[7]*y+rotation[8]*z;target[o+3]=source[i+3];}
}
