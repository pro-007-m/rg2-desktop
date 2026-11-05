import * as THREE from './vendor/three.module.js';
import {RoundedBoxGeometry} from './vendor/addons/geometries/RoundedBoxGeometry.js';
import {EffectComposer} from './vendor/addons/postprocessing/EffectComposer.js';
import {RenderPass} from './vendor/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from './vendor/addons/postprocessing/UnrealBloomPass.js';
import {OutputPass} from './vendor/addons/postprocessing/OutputPass.js';
import {RoomEnvironment} from './vendor/addons/environments/RoomEnvironment.js';
import {FACELETS,moveInfo} from './core.mjs';
import {CELL_PITCH,capRadii,createCapGeometry} from './model-geometry.mjs';

// Screen approximation of GAN Full-bright Stickerless, shared with the editor.
export const PALETTE=['#F8F8F8','#F52A32','#00C853','#FFE600','#FF7A00','#1565E8'];
const DEFAULT_CAMERA={theta:.72,phi:.94,distance:8.8};

export function createRenderer(container,{onPaint=()=>{},appearance=null}={}){
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(35,1,.1,80);
  const webgl=new THREE.WebGLRenderer({alpha:true,antialias:true});
  const ratio=Math.min(devicePixelRatio||1,1.75);webgl.setPixelRatio(ratio);
  webgl.outputColorSpace=THREE.SRGBColorSpace;webgl.toneMapping=THREE.NoToneMapping;
  const canvas=webgl.domElement;container.append(canvas);
  canvas.setAttribute('role','img');canvas.setAttribute('aria-label','Трёхмерный куб. Перетаскивание поворачивает камеру, нажатие выбирает цветную деталь.');
  const root=new THREE.Group();scene.add(root);
  const environment=new RoomEnvironment(),pmrem=new THREE.PMREMGenerator(webgl),environmentMap=pmrem.fromScene(environment,.04);
  scene.environment=environmentMap.texture;scene.environmentIntensity=.30;environment.dispose();pmrem.dispose();
  scene.add(new THREE.AmbientLight(0xffffff,.45));
  for(const [position,intensity] of [[[3,5,4],1.15],[[-4,2,-3],.55],[[0,-4,2],.60]]){
    const light=new THREE.DirectionalLight(0xffffff,intensity);light.position.set(...position);scene.add(light);
  }
  const colors=[...PALETTE,'#747e8a'].map(color=>new THREE.MeshPhysicalMaterial({color,roughness:.32,metalness:0,clearcoat:.45,clearcoatRoughness:.22,envMapIntensity:.45,emissive:color,emissiveIntensity:0}));
  const bodyMaterial=new THREE.MeshBasicMaterial({color:0x141922});
  const steelMaterial=new THREE.MeshStandardMaterial({color:0xbfc9d5,roughness:.26,metalness:.85});
  const insertMaterial=new THREE.MeshStandardMaterial({color:0x93d728,roughness:.36,metalness:.12});
  const bodyGeometry=new RoundedBoxGeometry(.84,.84,.84,3,.10);
  const screwGeometry=new THREE.CylinderGeometry(.075,.075,.018,16);
  const slitGeometry=new THREE.BoxGeometry(.069,.009,.012);
  const coreGeometry=new THREE.SphereGeometry(.49,16,12),core=new THREE.Mesh(coreGeometry,bodyMaterial);root.add(core);
  const capGeometries=new Map(),caps=[],cubies=[];
  const zNormal=new THREE.Vector3(0,0,1),yNormal=new THREE.Vector3(0,1,0);
  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
  const composer=new EffectComposer(webgl),renderPass=new RenderPass(scene,camera);
  const bloom=new UnrealBloomPass(new THREE.Vector2(1,1),.035,.12,.32),output=new OutputPass();
  composer.addPass(renderPass);composer.addPass(bloom);composer.addPass(output);
  let state=null,editable=true,disposed=false,raf=0,animation=null,drag=null,neon=false,theme='atelier';
  let {theta,phi,distance}=DEFAULT_CAMERA;

  function placeCamera(){camera.position.set(distance*Math.sin(phi)*Math.sin(theta),distance*Math.cos(phi),distance*Math.sin(phi)*Math.cos(theta));camera.lookAt(0,0,0);}
  function draw(){if(!disposed)composer.render();}
  function updateAppearance(){
    theme=appearance?.theme||document.documentElement.dataset.theme||'atelier';
    neon=theme==='graphite'&&(appearance?.neon??(document.documentElement.dataset.modelNeon==='on'));
    const background=getComputedStyle(container).getPropertyValue('--surface').trim();
    scene.background=new THREE.Color(appearance?.theme?(theme==='graphite'?'#20242e':'#fffefa'):(background|| (theme==='graphite'?'#20242e':'#fffefa')));
    bloom.enabled=neon;
    colors.forEach((material,index)=>{
      material.color.set([...PALETTE,'#747e8a'][index]);
      const c=material.color,luma=.2126*c.r+.7152*c.g+.0722*c.b;
      material.emissiveIntensity=!neon ? 0 : index===0 ? .55 : index===6 ? .02 : Math.min(2.5,.35/Math.max(.14,luma));
      if(neon)material.color.multiplyScalar(.35);
      material.clearcoat=neon ? .20 : .45;
    });
    draw();
  }
  function decorate(group,position){
    if(position.filter(Boolean).length<2)return;
    position.forEach((value,axis)=>{
      if(!value)return;
      const n=new THREE.Vector3();n.setComponent(axis,-Math.sign(value));
      const head=new THREE.Mesh(screwGeometry,(axis+position.filter(v=>v<0).length)%3===0?insertMaterial:steelMaterial);
      head.position.copy(n).multiplyScalar(.429);head.quaternion.setFromUnitVectors(yNormal,n);group.add(head);
      const slit=new THREE.Mesh(slitGeometry,bodyMaterial);slit.position.copy(n).multiplyScalar(.44);slit.quaternion.setFromUnitVectors(yNormal,n);group.add(slit);
    });
  }
  function setState(next){
    state=Array.from(next);root.clear();root.add(core);cubies.length=0;caps.length=0;
    const positions=new Map();
    for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++){
      if(!x&&!y&&!z)continue;
      const group=new THREE.Group(),position=[x,y,z];group.position.set(x*CELL_PITCH,y*CELL_PITCH,z*CELL_PITCH);group.userData.position=position;
      group.add(new THREE.Mesh(bodyGeometry,bodyMaterial));decorate(group,position);root.add(group);cubies.push(group);positions.set(position.join(','),group);
    }
    FACELETS.forEach((facelet,index)=>{
      const radii=capRadii(facelet),key=radii.join(',');
      if(!capGeometries.has(key))capGeometries.set(key,createCapGeometry(radii));
      const color=state[index]>=0&&state[index]<6?state[index]:6;
      const mesh=new THREE.Mesh(capGeometries.get(key),colors[color]);
      mesh.quaternion.setFromUnitVectors(zNormal,new THREE.Vector3(...facelet.normal));mesh.userData.index=index;
      positions.get(facelet.position.join(',')).add(mesh);caps.push(mesh);
    });
    draw();
  }
  function resize(){
    const width=Math.max(1,container.clientWidth),height=Math.max(1,container.clientHeight);
    webgl.setSize(width,height,false);composer.setSize(width,height);camera.aspect=width/height;camera.updateProjectionMatrix();draw();
  }
  function hit(event){const r=canvas.getBoundingClientRect();pointer.set((event.clientX-r.left)/r.width*2-1,-(event.clientY-r.top)/r.height*2+1);raycaster.setFromCamera(pointer,camera);return raycaster.intersectObjects(caps,false)[0]?.object.userData.index;}
  function down(event){if(event.button!==0)return;event.preventDefault();drag={x:event.clientX,y:event.clientY,theta,phi,moved:false};canvas.setPointerCapture(event.pointerId);}
  function move(event){
    if(!drag)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>6)drag.moved=true;if(!drag.moved)return;
    // Mouse sensitivity is unchanged; only the solver's playback is slower.
    theta=drag.theta-dx*.008;phi=Math.min(2.82,Math.max(.28,drag.phi-dy*.008));placeCamera();draw();
  }
  function up(event){if(!drag)return;const moved=drag.moved;drag=null;if(!moved&&editable&&!animation){const index=hit(event);if(index!==undefined)onPaint(index);}}
  function pointerCancel(){drag=null;}
  function wheel(event){event.preventDefault();distance=Math.max(5.9,Math.min(12,distance+event.deltaY*.008));placeCamera();draw();}
  canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',pointerCancel);canvas.addEventListener('wheel',wheel,{passive:false});
  function animateMove(token,{duration=220,signal}={}){
    if(disposed)return Promise.reject(new DOMException('Disposed','AbortError'));
    if(animation)return Promise.reject(new Error('Один ход уже выполняется'));
    const info=moveInfo(token),group=new THREE.Group(),axis=typeof info.axis==='number'?['x','y','z'][info.axis]:info.axis,axisIndex=['x','y','z'].indexOf(axis);root.add(group);
    cubies.filter(c=>info.layers.includes(c.userData.position[axisIndex])).forEach(c=>group.attach(c));
    return new Promise((resolve,reject)=>{
      let start;
      function abort(){cancelAnimationFrame(raf);animation=null;signal?.removeEventListener('abort',abort);if(state)setState(state);reject(new DOMException('Cancelled','AbortError'));}
      if(signal?.aborted){abort();return;}signal?.addEventListener('abort',abort,{once:true});animation={abort};
      function frame(now){if(disposed){abort();return;}start??=now;const t=duration<=0?1:Math.min(1,(now-start)/duration),ease=t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;group.rotation[axis]=info.quarterTurns*Math.PI/2*ease;draw();if(t<1)raf=requestAnimationFrame(frame);else{animation=null;signal?.removeEventListener('abort',abort);resolve();}}
      raf=requestAnimationFrame(frame);
    });
  }
  placeCamera();updateAppearance();
  const resizeObserver=new ResizeObserver(resize);resizeObserver.observe(container);resize();
  const themeObserver=new MutationObserver(updateAppearance);themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','data-model-neon']});
  return {
    setState,animateMove,resize,
    setEditable(value){editable=Boolean(value);canvas.classList.toggle('is-editable',editable);},
    resetCamera(){({theta,phi,distance}=DEFAULT_CAMERA);placeCamera();draw();},
    getVisualState(){return{theme,neon,bloomEnabled:bloom.enabled,emission:colors.slice(0,6).map(material=>material.emissiveIntensity),caps:caps.length,geometryVariants:capGeometries.size,theta,phi,distance,state:state?[...state]:null};},
    dispose(){
      if(disposed)return;animation?.abort();disposed=true;cancelAnimationFrame(raf);resizeObserver.disconnect();themeObserver.disconnect();
      canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerup',up);canvas.removeEventListener('pointercancel',pointerCancel);canvas.removeEventListener('wheel',wheel);
      for(const geometry of capGeometries.values())geometry.dispose();bodyGeometry.dispose();coreGeometry.dispose();screwGeometry.dispose();slitGeometry.dispose();
      colors.forEach(m=>m.dispose());bodyMaterial.dispose();steelMaterial.dispose();insertMaterial.dispose();environmentMap.dispose();
      bloom.dispose();output.dispose();composer.dispose();webgl.dispose();webgl.forceContextLoss();canvas.remove();
    }
  };
}
