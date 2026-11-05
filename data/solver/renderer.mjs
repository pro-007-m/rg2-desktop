import * as THREE from './vendor/three.module.js';
import { FACELETS, moveInfo } from './core.mjs';

export const PALETTE = ['#f6f5ec','#e64d4b','#30a274','#f2ce42','#ec9141','#4d8bd4'];
export function createRenderer(container,{onPaint=()=>{}}={}) {
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(35,1,.1,80);
  const webgl=new THREE.WebGLRenderer({alpha:true,antialias:true});
  webgl.setPixelRatio(Math.min(devicePixelRatio||1,2));webgl.setClearColor(0,0);
  webgl.outputColorSpace=THREE.SRGBColorSpace;
  container.appendChild(webgl.domElement);webgl.domElement.setAttribute('aria-label','Трёхмерная модель куба. Перетаскивание — поворот камеры, нажатие — выбор наклейки.');
  webgl.domElement.setAttribute('role','img');
  scene.add(new THREE.HemisphereLight(0xffffff,0x53616b,2.5));
  const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(4,7,5);scene.add(light);
  const root=new THREE.Group();scene.add(root);
  const bodyGeometry=new THREE.BoxGeometry(.97,.97,.97);
  const stickerGeometry=new THREE.PlaneGeometry(.80,.80);
  const bodyMaterial=new THREE.MeshStandardMaterial({color:0x161c24,roughness:.48,metalness:.12});
  const colors=[...PALETTE,'#747e8a'].map(color=>new THREE.MeshStandardMaterial({color,roughness:.53,metalness:.02}));
  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
  const normalZ=new THREE.Vector3(0,0,1);
  let state=null,editable=true,disposed=false,raf=0,animation=null,drag=null;
  let theta=.72,phi=.94,distance=8.4;
  const cubies=[],stickers=[];
  function cameraPosition(){camera.position.set(distance*Math.sin(phi)*Math.sin(theta),distance*Math.cos(phi),distance*Math.sin(phi)*Math.cos(theta));camera.lookAt(0,0,0);}
  cameraPosition();
  function setState(next){
    state=Array.from(next);root.clear();cubies.length=0;stickers.length=0;
    const byPosition=new Map();
    for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++){
      if(!x&&!y&&!z)continue;
      const group=new THREE.Group();group.position.set(x*1.015,y*1.015,z*1.015);group.userData.position=[x,y,z];
      group.add(new THREE.Mesh(bodyGeometry,bodyMaterial));root.add(group);cubies.push(group);byPosition.set([x,y,z].join(','),group);
    }
    FACELETS.forEach((facelet,index)=>{
      const p=facelet.position||facelet.p,n=facelet.normal||facelet.n;
      const group=byPosition.get(p.join(','));
      const mesh=new THREE.Mesh(stickerGeometry,colors[state[index]>=0&&state[index]<6?state[index]:6]);
      mesh.position.set(n[0]*.493,n[1]*.493,n[2]*.493);
      mesh.quaternion.setFromUnitVectors(normalZ,new THREE.Vector3(...n));mesh.userData.index=index;
      group.add(mesh);stickers.push(mesh);
    });
    draw();
  }
  function draw(){if(!disposed)webgl.render(scene,camera);}
  function resize(){const width=Math.max(1,container.clientWidth),height=Math.max(1,container.clientHeight);webgl.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();draw();}
  const observer=new ResizeObserver(resize);observer.observe(container);resize();
  function hit(event){const rect=webgl.domElement.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);raycaster.setFromCamera(pointer,camera);return raycaster.intersectObjects(stickers,false)[0]?.object.userData.index;}
  function down(event){if(event.button!==0)return;drag={x:event.clientX,y:event.clientY,theta,phi,moved:false};webgl.domElement.setPointerCapture(event.pointerId);}
  function move(event){if(!drag)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>6)drag.moved=true;if(!drag.moved)return;theta=drag.theta-dx*.008;phi=Math.min(2.82,Math.max(.28,drag.phi-dy*.008));cameraPosition();draw();}
  function up(event){if(!drag)return;const moved=drag.moved;drag=null;if(!moved&&editable&&!animation){const index=hit(event);if(index!==undefined)onPaint(index);} }
  function wheel(event){event.preventDefault();distance=Math.max(5.9,Math.min(12,distance+event.deltaY*.008));cameraPosition();draw();}
  webgl.domElement.addEventListener('pointerdown',down);webgl.domElement.addEventListener('pointermove',move);webgl.domElement.addEventListener('pointerup',up);webgl.domElement.addEventListener('pointercancel',()=>{drag=null;});webgl.domElement.addEventListener('wheel',wheel,{passive:false});
  function animateMove(token,{duration=220,signal}={}){
    if(disposed)return Promise.reject(new DOMException('Disposed','AbortError'));
    if(animation)return Promise.reject(new Error('Один ход уже выполняется'));
    const info=moveInfo(token),group=new THREE.Group();root.add(group);
    const axis=typeof info.axis==='number'?['x','y','z'][info.axis]:info.axis;
    const axisIndex=['x','y','z'].indexOf(axis);
    cubies.filter(c=>info.layers.includes(c.userData.position[axisIndex])).forEach(c=>group.attach(c));
    const angle=info.quarterTurns*Math.PI/2;
    return new Promise((resolve,reject)=>{
      let start;
      function abort(){cancelAnimationFrame(raf);animation=null;signal?.removeEventListener('abort',abort);if(state)setState(state);reject(new DOMException('Cancelled','AbortError'));}
      if(signal?.aborted){abort();return;}
      signal?.addEventListener('abort',abort,{once:true});animation={abort};
      function frame(now){if(disposed){abort();return;}start??=now;const t=duration<=0?1:Math.min(1,(now-start)/duration);const ease=t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;group.rotation[axis]=angle*ease;draw();if(t<1)raf=requestAnimationFrame(frame);else{animation=null;signal?.removeEventListener('abort',abort);resolve();}}
      raf=requestAnimationFrame(frame);
    });
  }
  return {setState,animateMove,resize,setEditable(value){editable=Boolean(value);webgl.domElement.classList.toggle('is-editable',editable);},resetCamera(){theta=.72;phi=.94;distance=8.4;cameraPosition();draw();},dispose(){if(disposed)return;animation?.abort();disposed=true;cancelAnimationFrame(raf);observer.disconnect();bodyGeometry.dispose();stickerGeometry.dispose();bodyMaterial.dispose();colors.forEach(m=>m.dispose());webgl.dispose();webgl.domElement.remove();}};
}
