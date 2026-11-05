import * as THREE from './vendor/three.module.js';
import {RoundedBoxGeometry} from './vendor/addons/geometries/RoundedBoxGeometry.js';
import {EffectComposer} from './vendor/addons/postprocessing/EffectComposer.js';
import {RenderPass} from './vendor/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from './vendor/addons/postprocessing/UnrealBloomPass.js';
import {OutputPass} from './vendor/addons/postprocessing/OutputPass.js';
import {ShaderPass} from './vendor/addons/postprocessing/ShaderPass.js';
import {FACELETS,moveInfo} from './core.mjs';
import {CELL_PITCH,capRadii,createCapGeometry} from './model-geometry.mjs';
import {IMAGE_DEFAULTS,normalizeImageSettings,readImageSettings,imageColor} from './image-settings.mjs';

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
  // Unlit materials keep the editor's colors identical on every cube face.
  const colors=[...PALETTE,'#747e8a'].map(color=>new THREE.MeshBasicMaterial({color,vertexColors:true}));
  const fillColors=[...PALETTE,'#747e8a'].map(color=>new THREE.MeshBasicMaterial({color}));
  const bodyMaterial=new THREE.MeshBasicMaterial({color:0x141922});
  const bodyGeometry=new RoundedBoxGeometry(.90,.90,.90,3,.075);
  const coreGeometry=new THREE.SphereGeometry(.77,20,16),core=new THREE.Mesh(coreGeometry,bodyMaterial);root.add(core);
  const capGeometries=new Map(),caps=[],cubies=[];
  const zNormal=new THREE.Vector3(0,0,1);
  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
  const composer=new EffectComposer(webgl,new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,samples:Math.min(4,webgl.capabilities.maxSamples)})),renderPass=new RenderPass(scene,camera);
  const bloom=new UnrealBloomPass(new THREE.Vector2(1,1),.035,.12,.32),output=new OutputPass();
  const sharpness=new ShaderPass({uniforms:{tDiffuse:{value:null},texel:{value:new THREE.Vector2(1,1)},amount:{value:0}},
    vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:'uniform sampler2D tDiffuse;uniform vec2 texel;uniform float amount;varying vec2 vUv;void main(){vec4 c=texture2D(tDiffuse,vUv);vec3 blur=(texture2D(tDiffuse,vUv+vec2(texel.x,0.0)).rgb+texture2D(tDiffuse,vUv-vec2(texel.x,0.0)).rgb+texture2D(tDiffuse,vUv+vec2(0.0,texel.y)).rgb+texture2D(tDiffuse,vUv-vec2(0.0,texel.y)).rgb)*0.25;gl_FragColor=vec4(clamp(c.rgb+(c.rgb-blur)*amount,0.0,1.0),c.a);}' });
  composer.addPass(renderPass);composer.addPass(bloom);composer.addPass(output);composer.addPass(sharpness);
  let imageOverride=appearance?.imageSettings?normalizeImageSettings(appearance.imageSettings):null,imageSettings={...IMAGE_DEFAULTS};
  let state=null,editable=true,disposed=false,raf=0,animation=null,drag=null,neon=false,theme='atelier';
  let {theta,phi,distance}=DEFAULT_CAMERA;

  function placeCamera(){camera.position.set(distance*Math.sin(phi)*Math.sin(theta),distance*Math.cos(phi),distance*Math.sin(phi)*Math.cos(theta));camera.lookAt(0,0,0);}
  function draw(){if(!disposed)composer.render();}
  function updateAppearance(){
    imageSettings=imageOverride||readImageSettings(document.documentElement.dataset.modelImage);
    theme=appearance?.theme||document.documentElement.dataset.theme||'atelier';
    neon=theme==='graphite'&&(appearance?.neon??(document.documentElement.dataset.modelNeon==='on'));
    const background=getComputedStyle(container).getPropertyValue('--surface').trim();
    scene.background=new THREE.Color(appearance?.theme?(theme==='graphite'?'#20242e':'#fffefa'):(background|| (theme==='graphite'?'#20242e':'#fffefa')));
    bloom.enabled=neon;
    bloom.strength=imageSettings.glow/100*.10;
    sharpness.uniforms.amount.value=imageSettings.sharpness/100;
    sharpness.enabled=imageSettings.sharpness>0;
    colors.forEach((material,index)=>{
      const rgb=imageColor([...PALETTE,'#747e8a'][index],imageSettings);
      material.color.setRGB(...rgb,THREE.SRGBColorSpace);
      if(neon)material.color.multiplyScalar(1+imageSettings.glow/100*.65);
      fillColors[index].color.copy(material.color).multiplyScalar(.70);
    });
    bodyMaterial.color.setRGB(...imageColor('#141922',imageSettings),THREE.SRGBColorSpace);
    draw();
  }
  function setState(next){
    state=Array.from(next);root.clear();root.add(core);cubies.length=0;caps.length=0;
    const positions=new Map();
    for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++){
      if(!x&&!y&&!z)continue;
      const group=new THREE.Group(),position=[x,y,z];group.position.set(x*CELL_PITCH,y*CELL_PITCH,z*CELL_PITCH);group.userData.position=position;
      const stickers=FACELETS.filter(f=>f.position.every((v,i)=>v===position[i]));
      const bodyColors=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].map(n=>{
        const f=stickers.find(f=>f.normal.every((v,i)=>v===n[i]))||stickers[0];
        return fillColors[state[f.index]>=0&&state[f.index]<6?state[f.index]:6];
      });
      group.add(new THREE.Mesh(bodyGeometry,bodyColors));root.add(group);cubies.push(group);positions.set(position.join(','),group);
    }
    FACELETS.forEach((facelet,index)=>{
      const radii=capRadii(facelet),key=radii.join(',');
      if(!capGeometries.has(key)){
        const geometry=createCapGeometry(radii),positions=geometry.getAttribute('position'),tints=[];
        // A small, camera-independent bevel tint defines the closed side walls.
        // Front surfaces retain the exact reference color, without scene lights.
        for(let i=0;i<positions.count;i++){
          const tint=.76+.24*Math.max(0,Math.min(1,(positions.getZ(i)-.46)/.045));tints.push(tint,tint,tint);
        }
        geometry.setAttribute('color',new THREE.Float32BufferAttribute(tints,3));capGeometries.set(key,geometry);
      }
      const color=state[index]>=0&&state[index]<6?state[index]:6;
      const mesh=new THREE.Mesh(capGeometries.get(key),colors[color]);
      mesh.quaternion.setFromUnitVectors(zNormal,new THREE.Vector3(...facelet.normal));mesh.userData.index=index;
      positions.get(facelet.position.join(',')).add(mesh);caps.push(mesh);
    });
    draw();
  }
  function resize(){
    const width=Math.max(1,container.clientWidth),height=Math.max(1,container.clientHeight);
    webgl.setSize(width,height,false);composer.setSize(width,height);sharpness.uniforms.texel.value.set(1/(width*ratio),1/(height*ratio));camera.aspect=width/height;camera.updateProjectionMatrix();draw();
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
  const themeObserver=new MutationObserver(updateAppearance);themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','data-model-neon','data-model-image']});
  return {
    setState,animateMove,resize,
    setImageSettings(next){imageOverride=normalizeImageSettings(next,imageOverride||imageSettings);updateAppearance();},
    setEditable(value){editable=Boolean(value);canvas.classList.toggle('is-editable',editable);},
    resetCamera(){({theta,phi,distance}=DEFAULT_CAMERA);placeCamera();draw();},
    getVisualState(){return{theme,neon,bloomEnabled:bloom.enabled,settings:{...imageSettings},lights:0,solidBodies:cubies.length,opaqueCaps:colors.every(m=>!m.transparent&&m.opacity===1),caps:caps.length,geometryVariants:capGeometries.size,theta,phi,distance,state:state?[...state]:null};},
    dispose(){
      if(disposed)return;animation?.abort();disposed=true;cancelAnimationFrame(raf);resizeObserver.disconnect();themeObserver.disconnect();
      canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerup',up);canvas.removeEventListener('pointercancel',pointerCancel);canvas.removeEventListener('wheel',wheel);
      for(const geometry of capGeometries.values())geometry.dispose();bodyGeometry.dispose();coreGeometry.dispose();
      colors.forEach(m=>m.dispose());fillColors.forEach(m=>m.dispose());bodyMaterial.dispose();sharpness.dispose();
      bloom.dispose();output.dispose();composer.dispose();webgl.dispose();webgl.forceContextLoss();canvas.remove();
    }
  };
}
