import * as THREE from '../solver/vendor/three.module.js';
import {EffectComposer} from '../solver/vendor/addons/postprocessing/EffectComposer.js';
import {RenderPass} from '../solver/vendor/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from '../solver/vendor/addons/postprocessing/UnrealBloomPass.js';
import {OutputPass} from '../solver/vendor/addons/postprocessing/OutputPass.js';
import {ShaderPass} from '../solver/vendor/addons/postprocessing/ShaderPass.js';
import {normalizeImageSettings,readImageSettings,imageColor} from '../solver/image-settings.mjs';
import {qualityProfile,createAdaptiveQuality} from './performance.mjs';
import {createPolyInput} from './poly-input.mjs';
import {polygonDescriptor,createPolygonCap,createHullGeometry,clipBand,axisRotation,rotatePolyInstance,dot,cross} from './poly-geometry.mjs';

export const POLY_PALETTE=Object.freeze(['#F8F8F8','#F52A32','#00C853','#FFE600','#FF7A00','#1565E8','#9C4DCC','#F48FB1','#B9D300','#FFF3C4','#00BFA5','#798A9E']);
const DEFAULT_CAMERA=Object.freeze({theta:.72,phi:.94,distance:8.8});
const WORLD_RADIUS=1.8;
const minus=(a,b)=>a.map((v,i)=>v-b[i]);
export function pointInPolygon(point,vertices,normal,tolerance=1e-7){
  let positive=false,negative=false;
  for(let i=0;i<vertices.length;i++){const sign=dot(cross(minus(vertices[(i+1)%vertices.length],vertices[i]),minus(point,vertices[i])),normal);if(sign>tolerance)positive=true;if(sign<-tolerance)negative=true;if(positive&&negative)return false;}
  return true;
}
export function validatePolyLayout(puzzle){
  if(!puzzle||!Array.isArray(puzzle.facelets)||!puzzle.facelets.length||!Array.isArray(puzzle.hull)||!puzzle.hull.length||!Array.isArray(puzzle.axes)||!puzzle.axes.length||typeof puzzle.moveInfo!=='function')throw new TypeError('Нужна геометрия и moveInfo многогранной головоломки.');
  for(const f of puzzle.facelets)if(!(f.vertices||f.polygon)?.length||!f.normal?.length||!f.center?.length)throw new TypeError('Неполная геометрия наклейки.');
  return puzzle;
}

export function createPolyRenderer(container,options={}){
  const doc=container.ownerDocument,win=doc.defaultView,scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(35,1,.1,80),root=new THREE.Group();scene.add(root);
  let puzzle=validatePolyLayout(options.puzzle),quality=options.quality||'auto',appearance=options.appearance||null,imageOverride=null,worldScale=1;
  let state=null,groups=[],locations=[],faceGroups=new Map(),hullMesh=null,cutMeshes=[],disposed=false,interactive=true,contextLost=false,dirty=false,animation=null,animationRaf=0,drawRaf=0;
  let cameraState={...DEFAULT_CAMERA},theme='atelier',neon=false,bloomEnabled=false,imageSettings=readImageSettings(null),profile=null,adaptive=null;
  let composer=null,bloom=null,sharpness=null,output=null,renderPass=null;
  const palette=options.palette||POLY_PALETTE;
  const mobile=options.mobile??(win.navigator.userAgentData?.mobile||/Android|iPhone|iPad/i.test(win.navigator.userAgent));
  const hints={mobile,deviceMemory:win.navigator.deviceMemory||4,hardwareConcurrency:win.navigator.hardwareConcurrency||4};
  function makeProfile(){return qualityProfile({size:Math.max(2,Math.sqrt(puzzle.facelets.length/6)),quality,...hints,devicePixelRatio:win.devicePixelRatio||1,width:container.clientWidth||640,height:container.clientHeight||640});}
  profile=makeProfile();adaptive=createAdaptiveQuality(profile);
  const webgl=new THREE.WebGLRenderer({alpha:false,antialias:profile.antialias,powerPreference:mobile?'low-power':'high-performance'});webgl.outputColorSpace=THREE.SRGBColorSpace;webgl.toneMapping=THREE.NoToneMapping;webgl.setPixelRatio(profile.dpr);
  const canvas=webgl.domElement;canvas.tabIndex=0;canvas.style.cssText='touch-action:none;display:block;width:100%;height:100%';canvas.setAttribute('role','application');canvas.setAttribute('aria-label','Игровая головоломка. Потяни цветную деталь для хода, фон для камеры. Два пальца — камера и масштаб. Ctrl — обратный ход, Alt — двойной.');container.append(canvas);
  const capMaterial=new THREE.MeshBasicMaterial({color:0xffffff,vertexColors:true}),bodyMaterial=new THREE.MeshBasicMaterial({color:0x141922});
  capMaterial.onBeforeCompile=shader=>{
    shader.vertexShader='#ifdef POLY_TILE_GRID\nattribute float capBoundary;\nvarying float vPolyBoundary;\n#endif\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n#ifdef POLY_TILE_GRID\nvPolyBoundary=capBoundary;\n#endif');
    shader.fragmentShader='#ifdef POLY_TILE_GRID\nvarying float vPolyBoundary;\n#endif\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\n#ifdef POLY_TILE_GRID\nfloat footprint=max(fwidth(vPolyBoundary),.00001);\nfloat seam=1.0-smoothstep(0.0,footprint*.55,vPolyBoundary);\ndiffuseColor.rgb*=1.0-.10*seam;\n#endif');
  };
  const denseCaps=()=>profile.pixelsPerTile<14||puzzle.order>=10;
  const matrix=new THREE.Matrix4(),basis=new THREE.Matrix4(),position=new THREE.Vector3(),scale=new THREE.Vector3(),quaternion=new THREE.Quaternion(),raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2(),projection=new THREE.Vector3();
  function placeCamera(){const {theta,phi,distance}=cameraState;camera.position.set(distance*Math.sin(phi)*Math.sin(theta),distance*Math.cos(phi),distance*Math.sin(phi)*Math.cos(theta));camera.lookAt(0,0,0);camera.updateMatrixWorld();}
  function invalidate(){if(disposed||contextLost||drawRaf||animation)return;drawRaf=win.requestAnimationFrame(()=>{drawRaf=0;renderNow();});}
  function resizeTargets(){const w=Math.max(1,container.clientWidth),h=Math.max(1,container.clientHeight);webgl.setSize(w,h,false);composer?.setPixelRatio(profile.dpr);composer?.setSize(w,h);sharpness?.uniforms.texel.value.set(1/(w*profile.dpr),1/(h*profile.dpr));camera.aspect=w/h;camera.updateProjectionMatrix();}
  function ensureComposer(){
    if(composer)return;
    composer=new EffectComposer(webgl,new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,samples:0}));renderPass=new RenderPass(scene,camera);bloom=new UnrealBloomPass(new THREE.Vector2(1,1),.04,.12,.32);output=new OutputPass();
    sharpness=new ShaderPass({uniforms:{tDiffuse:{value:null},texel:{value:new THREE.Vector2(1,1)},amount:{value:0}},vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:'uniform sampler2D tDiffuse;uniform vec2 texel;uniform float amount;varying vec2 vUv;void main(){vec4 c=texture2D(tDiffuse,vUv);vec3 b=(texture2D(tDiffuse,vUv+vec2(texel.x,0.0)).rgb+texture2D(tDiffuse,vUv-vec2(texel.x,0.0)).rgb+texture2D(tDiffuse,vUv+vec2(0.0,texel.y)).rgb+texture2D(tDiffuse,vUv-vec2(0.0,texel.y)).rgb)*.25;gl_FragColor=vec4(clamp(c.rgb+(c.rgb-b)*amount,0.0,1.0),c.a);}'});
    composer.addPass(renderPass);composer.addPass(bloom);composer.addPass(output);composer.addPass(sharpness);resizeTargets();
  }
  function renderNow(gap=0){
    if(disposed||contextLost)return;const started=win.performance.now();
    if(bloomEnabled||imageSettings.sharpness>0){ensureComposer();bloom.enabled=bloomEnabled;bloom.strength=imageSettings.glow/100*.10;sharpness.enabled=imageSettings.sharpness>0;sharpness.uniforms.amount.value=imageSettings.sharpness/100;composer.render();}else webgl.render(scene,camera);
    const next=adaptive.sample(Math.max(win.performance.now()-started,gap));if(next&&Math.abs(next.dpr-profile.dpr)>.001){profile=next;webgl.setPixelRatio(profile.dpr);resizeTargets();options.onQuality?.({...profile});invalidate();}
  }
  function updateColors(){
    if(!state)return;
    const colors=[...palette,'#141922','#747e8a'].map((hex,index)=>{const color=new THREE.Color().setRGB(...imageColor(hex,imageSettings),THREE.SRGBColorSpace);if(neon&&index<palette.length)color.multiplyScalar(1+imageSettings.glow/100*.65);return color;});
    for(const group of groups){group.indices.forEach((index,i)=>group.mesh.setColorAt(i,colors[state[index]===(puzzle.blackColor??12)?palette.length:state[index]>=0&&state[index]<palette.length?state[index]:palette.length+1]));if(group.mesh.instanceColor)group.mesh.instanceColor.needsUpdate=true;}
    bodyMaterial.color.setRGB(...imageColor('#141922',imageSettings),THREE.SRGBColorSpace);
  }
  function updateAppearance(){
    if(disposed)return;imageSettings=imageOverride||normalizeImageSettings(appearance?.imageSettings||readImageSettings(doc.documentElement.dataset.modelImage));theme=appearance?.theme||doc.documentElement.dataset.theme||'atelier';neon=theme==='graphite'&&(appearance?.neon??(doc.documentElement.dataset.modelNeon==='on'));bloomEnabled=neon&&profile.bloom&&imageSettings.glow>0;
    const bg=win.getComputedStyle(container).getPropertyValue('--surface').trim();scene.background=new THREE.Color(appearance?.theme?(theme==='graphite'?'#20242e':'#fffefa'):(bg||(theme==='graphite'?'#20242e':'#fffefa')));updateColors();invalidate();
  }
  function clearCuts(){for(const mesh of cutMeshes){root.remove(mesh);mesh.geometry.dispose();}cutMeshes=[];if(hullMesh)hullMesh.visible=true;}
  function restoreVisual(){for(const group of groups){group.mesh.instanceMatrix.array.set(group.base);group.mesh.instanceMatrix.needsUpdate=true;}clearCuts();dirty=false;}
  function stop(){animation?.abort();}
  function build(){
    stop();input?.clear();clearCuts();for(const group of groups){root.remove(group.mesh);group.mesh.dispose();group.geometry.dispose();}groups=[];locations=[];faceGroups=new Map();if(hullMesh){root.remove(hullMesh);hullMesh.geometry.dispose();}
    worldScale=WORLD_RADIUS/Math.max(...puzzle.hull.flatMap(f=>(f.vertices||f.polygon).map(p=>Math.hypot(...p))));
    const dense=denseCaps();capMaterial.defines=dense?{POLY_TILE_GRID:1}:{};capMaterial.needsUpdate=true;
    const shapes=new Map();
    puzzle.facelets.forEach((facelet,index)=>{
      if(!faceGroups.has(facelet.face))faceGroups.set(facelet.face,[]);faceGroups.get(facelet.face).push(index);
      if(facelet.hidden||facelet.black)return;
      const descriptor=polygonDescriptor(facelet);if(!shapes.has(descriptor.key))shapes.set(descriptor.key,{descriptors:[],indices:[],points:descriptor.points});const shape=shapes.get(descriptor.key);shape.descriptors.push(descriptor);shape.indices.push(index);
    });
    for(const shape of shapes.values()){
      const geometry=createPolygonCap(shape.points,{quality:profile.quality,dense}),mesh=new THREE.InstancedMesh(geometry,capMaterial,shape.indices.length);mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=false;
      const group={geometry,mesh,indices:shape.indices,base:null};
      shape.descriptors.forEach((d,i)=>{basis.makeBasis(new THREE.Vector3(...d.tangent),new THREE.Vector3(...d.bitangent),new THREE.Vector3(...d.normal));quaternion.setFromRotationMatrix(basis);position.fromArray(d.center).multiplyScalar(worldScale);scale.setScalar(d.radius*worldScale);matrix.compose(position,quaternion,scale);mesh.setMatrixAt(i,matrix);locations[shape.indices[i]]={group,instance:i};});
      group.base=mesh.instanceMatrix.array.slice();mesh.instanceMatrix.needsUpdate=true;root.add(mesh);groups.push(group);
    }
    hullMesh=new THREE.Mesh(createHullGeometry(puzzle.hull),bodyMaterial);hullMesh.scale.setScalar(worldScale*.997);root.add(hullMesh);dirty=false;updateColors();invalidate();
  }
  function setState(next){
    const values=next?.colors??next?.state??next;if(!values||values.length!==puzzle.facelets.length||Array.from(values).some(v=>!Number.isInteger(v)||v<0||v>255))throw new RangeError('Состояние не соответствует головоломке.');
    stop();state=Uint8Array.from(values);if(groups[0]?.geometry.userData.quality!==profile.quality||groups[0]?.geometry.userData.dense!==denseCaps())build();else if(dirty)restoreVisual();updateColors();invalidate();
  }
  function setPuzzle(next){
    stop();puzzle=validatePolyLayout(next?.puzzle||next);state=Uint8Array.from(puzzle.facelets,f=>f.color);profile=makeProfile();adaptive.reset(profile);webgl.setPixelRatio(profile.dpr);build();resizeTargets();updateAppearance();
  }
  function hit(event){
    if(animation||dirty)return null;const rect=canvas.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);raycaster.setFromCamera(pointer,camera);
    const origin=raycaster.ray.origin.toArray().map(v=>v/worldScale),direction=raycaster.ray.direction.toArray();let best=null;
    for(const face of puzzle.hull){const normal=face.normal,denominator=dot(normal,direction);if(denominator>=-1e-8)continue;const vertices=face.vertices||face.polygon,offset=dot(normal,vertices[0]),distance=(offset-dot(normal,origin))/denominator;if(distance<0||best&&distance>=best.distance)continue;const point=origin.map((v,i)=>v+direction[i]*distance);if(pointInPolygon(point,vertices,normal))best={face,distance,point};}
    if(!best)return null;
    const indices=faceGroups.get(best.face.face)||puzzle.facelets.map((_,i)=>i);
    for(const index of indices){const f=puzzle.facelets[index];if(pointInPolygon(best.point,f.vertices||f.polygon,f.normal))return {index,face:f.face,normal:f.normal,center:f.center,point:best.point.map(v=>v*worldScale)};}
    return null;
  }
  function project(point){const rect=canvas.getBoundingClientRect();projection.fromArray(point).project(camera);return [rect.left+(projection.x+1)*rect.width/2,rect.top+(1-projection.y)*rect.height/2];}
  const input=createPolyInput(canvas,{getPuzzle:()=>puzzle,getHit:hit,project,getCamera:()=>cameraState,onOrbit:next=>{Object.assign(cameraState,next);placeCamera();invalidate();},onZoom:distance=>{cameraState.distance=distance;placeCamera();invalidate();},onMove:move=>options.onMove?.(move),onCommand:command=>options.onCommand?.(command),getMoveOptions:()=>options.getMoveOptions?.()||{},keyboardMap:options.keyboardMap,isEnabled:()=>interactive&&!animation&&!contextLost&&!disposed,isKeyboardEnabled:()=>interactive&&!contextLost&&!disposed,onGesture:options.onGesture});
  function playMove(move,{duration=240,signal}={}){
    if(disposed)return Promise.reject(new DOMException('Disposed','AbortError'));if(animation)return Promise.reject(new Error('Поворот уже выполняется.'));if(contextLost)return Promise.reject(new Error('Контекст WebGL недоступен.'));
    let info;try{info=puzzle.moveInfo(move);}catch(error){return Promise.reject(error);}
    if(dirty)restoreVisual();input.clear();const affected=new Map();for(const index of info.affectedIndices||info.affected){const location=locations[index];if(!location)continue;if(!affected.has(location.group))affected.set(location.group,[]);affected.get(location.group).push(location.instance);}
    const axis=info.axis,angle=info.angleRad??info.angle;
    hullMesh.visible=false;
    for(const band of info.bands){const faces=clipBand(puzzle.hull,axis,band.min,band.max);if(!faces.length)continue;const mesh=new THREE.Mesh(createHullGeometry(faces),bodyMaterial);mesh.scale.setScalar(worldScale*.997);mesh.userData.moving=band.moving;root.add(mesh);cutMeshes.push(mesh);}
    dirty=true;if(drawRaf){win.cancelAnimationFrame(drawRaf);drawRaf=0;}
    return new Promise((resolve,reject)=>{
      let start=null,last=null;
      const abort=()=>{win.cancelAnimationFrame(animationRaf);animationRaf=0;animation=null;signal?.removeEventListener('abort',abort);restoreVisual();invalidate();reject(new DOMException('Cancelled','AbortError'));};animation={abort};if(signal?.aborted){abort();return;}signal?.addEventListener('abort',abort,{once:true});
      function frame(now){
        if(disposed||contextLost){abort();return;}start??=now;const t=duration<=0?1:Math.min(1,(now-start)/duration),ease=t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2,actualAngle=angle*ease,rotation=axisRotation(axis,actualAngle);
        for(const [group,indices] of affected){for(const i of indices)rotatePolyInstance(group.base,i*16,group.mesh.instanceMatrix.array,i*16,rotation);group.mesh.instanceMatrix.needsUpdate=true;}
        for(const mesh of cutMeshes)if(mesh.userData.moving)mesh.quaternion.setFromAxisAngle(new THREE.Vector3(...axis),actualAngle);
        renderNow(last===null?0:Math.min(100,now-last));last=now;
        if(t<1)animationRaf=win.requestAnimationFrame(frame);else{animationRaf=0;animation=null;signal?.removeEventListener('abort',abort);resolve();}
      }
      animationRaf=win.requestAnimationFrame(frame);
    });
  }
  function resize(){if(disposed)return;const next=makeProfile();profile={...next,dpr:Math.min(profile.dpr,next.dpr)};adaptive.reset(profile);webgl.setPixelRatio(profile.dpr);if((groups[0]?.geometry.userData.quality!==profile.quality||groups[0]?.geometry.userData.dense!==denseCaps())&&!animation)build();resizeTargets();bloomEnabled=neon&&profile.bloom&&imageSettings.glow>0;invalidate();}
  function lost(event){if(disposed)return;event.preventDefault();contextLost=true;input.clear();stop();options.onStatus?.('3D приостановлено: графический контекст восстанавливается.');}
  function restored(){if(disposed)return;contextLost=false;restoreVisual();invalidate();options.onStatus?.('3D восстановлено.');}
  canvas.addEventListener('webglcontextlost',lost);canvas.addEventListener('webglcontextrestored',restored);
  const resizeObserver=new win.ResizeObserver(resize);resizeObserver.observe(container);const observer=new win.MutationObserver(updateAppearance);observer.observe(doc.documentElement,{attributes:true,attributeFilter:['data-theme','data-model-neon','data-model-image']});
  placeCamera();setPuzzle(puzzle);
  return {
    canvas,setPuzzle,setState,playMove,animateMove:playMove,resize,
    setInteractive(value){interactive=Boolean(value);if(!interactive)input.clear();},setEditable(value){this.setInteractive(value);},resetCamera(){input.clear();cameraState={...DEFAULT_CAMERA};placeCamera();invalidate();},
    setImageSettings(next){imageOverride=normalizeImageSettings(next,imageOverride||imageSettings);updateAppearance();},setAppearance(next){appearance=next;updateAppearance();},
    setQuality(next){quality=next||'auto';profile=makeProfile();adaptive.reset(profile);webgl.setPixelRatio(profile.dpr);build();resizeTargets();updateAppearance();options.onQuality?.({...profile});},
    getVisualState(){return {kind:puzzle.kind,order:puzzle.order,state:state?[...state]:null,theme,neon,bloomEnabled,settings:{...imageSettings},quality:{...profile},...cameraState,animating:Boolean(animation),interactive,contextLost,lights:0,opaqueCaps:!capMaterial.transparent&&capMaterial.opacity===1,denseCaps:groups[0]?.geometry.userData.dense??false,caps:groups.reduce((sum,g)=>sum+g.indices.length,0),facelets:puzzle.facelets.length,hiddenCaps:puzzle.facelets.filter(f=>f.hidden||f.black).length,geometryGroups:groups.length,fillSlabs:cutMeshes.length||1,capTriangles:groups.reduce((sum,g)=>sum+g.geometry.index.count/3*g.indices.length,0),drawCalls:webgl.info.render.calls,triangles:webgl.info.render.triangles,activePointers:input.activePointers};},
    dispose(){if(disposed)return;stop();disposed=true;input.dispose();win.cancelAnimationFrame(drawRaf);win.cancelAnimationFrame(animationRaf);resizeObserver.disconnect();observer.disconnect();canvas.removeEventListener('webglcontextlost',lost);canvas.removeEventListener('webglcontextrestored',restored);clearCuts();for(const group of groups){group.mesh.dispose();group.geometry.dispose();}hullMesh?.geometry.dispose();capMaterial.dispose();bodyMaterial.dispose();bloom?.dispose();sharpness?.dispose();output?.dispose();renderPass?.dispose();composer?.dispose();webgl.dispose();webgl.forceContextLoss();scene.clear();canvas.remove();},
  };
}

export const createRenderer=createPolyRenderer;
