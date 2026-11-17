import * as THREE from '../solver/vendor/three.module.js';
import {EffectComposer} from '../solver/vendor/addons/postprocessing/EffectComposer.js';
import {RenderPass} from '../solver/vendor/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from '../solver/vendor/addons/postprocessing/UnrealBloomPass.js';
import {OutputPass} from '../solver/vendor/addons/postprocessing/OutputPass.js';
import {ShaderPass} from '../solver/vendor/addons/postprocessing/ShaderPass.js';
import {IMAGE_DEFAULTS,normalizeImageSettings,readImageSettings,imageColor} from '../solver/image-settings.mjs';
import {createPuzzleInput,normalizeInputMove} from './input.mjs';
import {qualityProfile,createAdaptiveQuality} from './performance.mjs';

export const PALETTE=Object.freeze(['#F8F8F8','#F52A32','#00C853','#FFE600','#FF7A00','#1565E8']);
const DEFAULT_CAMERA=Object.freeze({theta:.72,phi:.94,distance:8.8});
const AXES=['x','y','z'],EXTENT=3;
export function validSize(value){const n=Number(value);if(!Number.isInteger(n)||n<2||n>50)throw new RangeError('Размер куба: от 2 до 50.');return n;}

/** Color/index order agrees with the solver and NxN core, without importing either. */
export function cubeFacelet(size,index){
  const n=validSize(size),face=Math.floor(index/(n*n)),row=Math.floor(index%(n*n)/n),column=index%n;
  if(!Number.isInteger(index)||index<0||face>5)throw new RangeError('Наклейка вне куба.');
  const positions=[[column,n-1,row],[n-1,n-1-row,n-1-column],[column,n-1-row,n-1],[column,0,n-1-row],[0,n-1-row,column],[n-1-column,n-1-row,0]];
  return {index,face,row,column,position:positions[face],normal:[[0,1,0],[1,0,0],[0,0,1],[0,-1,0],[-1,0,0],[0,0,-1]][face]};
}
export function cubeLayout(size){
  const n=validSize(size),facelets=Array.from({length:6*n*n},(_,i)=>cubeFacelet(n,i)),bodies=[];
  for(let x=0;x<n;x++)for(let y=0;y<n;y++)bodies.push([x,y,0],[x,y,n-1]);
  for(let x=0;x<n;x++)for(let z=1;z<n-1;z++)bodies.push([x,0,z],[x,n-1,z]);
  for(let y=1;y<n-1;y++)for(let z=1;z<n-1;z++)bodies.push([0,y,z],[n-1,y,z]);
  return {size:n,pitch:EXTENT/n,facelets,bodies};
}

/** Closed colored caps. Dense LOD joins tiles and draws an antialiased tinted grid. */
export function createTileGeometry(segments=3){
  // Subpixel black geometric gaps turn into a stipple pattern on large puzzles.
  // A complete colored tile keeps the backing behind an unbroken front plane.
  if(!segments){const geometry=new THREE.BoxGeometry(1,1,.10);geometry.translate(0,0,.50);geometry.userData={closed:true,qualitySegments:0};return geometry;}
  segments=Math.max(1,Math.min(4,Math.round(segments)));
  const outline=[],radius=.16,half=.4925;
  const stops=[...new Set([...Array.from({length:segments+1},(_,i)=>i/segments),.5])].sort((a,b)=>a-b);
  for(const [cx,cy,start] of [[half-radius,half-radius,0],[-half+radius,half-radius,Math.PI/2],[-half+radius,-half+radius,Math.PI],[half-radius,-half+radius,Math.PI*1.5]]){
    for(const stop of stops){const a=start+stop*Math.PI/2;outline.push([cx+Math.cos(a)*radius,cy+Math.sin(a)*radius]);}
  }
  const count=outline.length,positions=[],tints=[],indices=[];
  const rings=[{scale:.94,z:.525,tint:1},{scale:1,z:.515,tint:.94},{scale:1,z:.505,tint:.91,square:true},{scale:1,z:.445,tint:.80,square:true}];
  rings.forEach(r=>outline.forEach(([x,y])=>{const shapeScale=r.square?half/Math.max(Math.abs(x),Math.abs(y)):r.scale;positions.push(x*shapeScale,y*shapeScale,r.z);tints.push(r.tint,r.tint,r.tint);}));
  const front=positions.length/3;positions.push(0,0,.53);tints.push(1,1,1);
  const back=positions.length/3;positions.push(0,0,.445);tints.push(.76,.76,.76);
  for(let i=0;i<count;i++){
    const j=(i+1)%count;indices.push(front,i,j,back,(rings.length-1)*count+j,(rings.length-1)*count+i);
    for(let ring=0;ring<rings.length-1;ring++){const a=ring*count+i,b=ring*count+j,c=(ring+1)*count+i,d=(ring+1)*count+j;indices.push(a,c,b,b,c,d);}
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(tints,3));geometry.setIndex(indices);geometry.computeVertexNormals();geometry.computeBoundingSphere();
  geometry.userData={closed:true,qualitySegments:segments};return geometry;
}

/** Left-multiply a column-major affine matrix by an exact-axis visual rotation. */
export function rotateInstance(source,offset,target,targetOffset,axis,angle){
  const c=Math.cos(angle),s=Math.sin(angle),a=typeof axis==='number'?axis:AXES.indexOf(axis);
  for(let column=0;column<4;column++){
    const i=offset+column*4,o=targetOffset+column*4,x=source[i],y=source[i+1],z=source[i+2];
    target[o]=a===0?x:a===1?c*x+s*z:c*x-s*y;
    target[o+1]=a===0?c*y-s*z:a===1?y:s*x+c*y;
    target[o+2]=a===0?s*y+c*z:a===1?-s*x+c*z:z;target[o+3]=source[i+3];
  }
}
export function slabRuns(size,layers){
  const selected=new Set(layers),runs=[];
  for(let first=0;first<size;){const moving=selected.has(first);let end=first+1;while(end<size&&selected.has(end)===moving)end++;runs.push({first,count:end-first,moving});first=end;}
  return runs;
}

export function createPuzzleRenderer(container,options={}){
  const doc=container.ownerDocument,win=doc.defaultView;
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(35,1,.5,40),root=new THREE.Group();scene.add(root);
  let size=validSize(options.size??3),quality=options.quality||'auto',layout=null,state=null,disposed=false,interactive=true,contextLost=false;
  let cameraState={...DEFAULT_CAMERA},animation=null,animationRaf=0,drawRaf=0,visualDirty=false,appearance=options.appearance||null,imageOverride=null;
  let imageSettings={...IMAGE_DEFAULTS},theme='atelier',neon=false,bloomEnabled=false,profile=null,adaptive=null;
  let capMesh=null,bodyMesh=null,fillMesh=null,capBase=null,bodyBase=null,fillBase=null,capGeometry=null;
  let composer=null,bloom=null,sharpness=null,renderPass=null,output=null;
  const mobile=options.mobile??(win.navigator.userAgentData?.mobile||/Android|iPhone|iPad/i.test(win.navigator.userAgent));
  const hints={mobile,deviceMemory:win.navigator.deviceMemory||4,hardwareConcurrency:win.navigator.hardwareConcurrency||4};
  function makeProfile(){return qualityProfile({size,quality,...hints,devicePixelRatio:win.devicePixelRatio||1,width:container.clientWidth||640,height:container.clientHeight||640});}
  profile=makeProfile();adaptive=createAdaptiveQuality(profile);
  const webgl=new THREE.WebGLRenderer({alpha:false,antialias:profile.antialias,powerPreference:mobile?'low-power':'high-performance'});
  webgl.outputColorSpace=THREE.SRGBColorSpace;webgl.toneMapping=THREE.NoToneMapping;webgl.setPixelRatio(profile.dpr);
  const canvas=webgl.domElement;canvas.tabIndex=0;canvas.style.touchAction='none';canvas.style.display='block';canvas.style.width='100%';canvas.style.height='100%';
  canvas.setAttribute('role','application');canvas.setAttribute('aria-label','Игровой куб. Потяни наклейку для хода, фон для камеры. Два пальца — камера и масштаб. R U F D L B — ходы; Ctrl — обратный; Alt — двойной.');container.append(canvas);
  const capMaterial=new THREE.MeshBasicMaterial({color:0xffffff,vertexColors:true}),bodyMaterial=new THREE.MeshBasicMaterial({color:0x141922});
  capMaterial.onBeforeCompile=shader=>{
    shader.vertexShader='#ifdef PUZZLE_TILE_GRID\nvarying vec2 vPuzzleTileUv;\n#endif\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n#ifdef PUZZLE_TILE_GRID\nvPuzzleTileUv=uv;\n#endif');
    shader.fragmentShader='#ifdef PUZZLE_TILE_GRID\nvarying vec2 vPuzzleTileUv;\n#endif\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\n#ifdef PUZZLE_TILE_GRID\nvec2 edgeDistance=min(vPuzzleTileUv,vec2(1.0)-vPuzzleTileUv);\nvec2 footprint=max(fwidth(vPuzzleTileUv),vec2(0.00001));\nvec2 line=vec2(1.0)-smoothstep(vec2(0.0),footprint*.7,edgeDistance);\nfloat grid=max(line.x,line.y);\ndiffuseColor.rgb*=1.0-.12*grid;\n#endif');
  };
  const bodyGeometry=new THREE.BoxGeometry(.97,.97,.97),fillGeometry=new THREE.BoxGeometry(1,1,1);
  const matrix=new THREE.Matrix4(),quaternion=new THREE.Quaternion(),scale=new THREE.Vector3(),position=new THREE.Vector3(),zNormal=new THREE.Vector3(0,0,1),color=new THREE.Color();
  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2(),projected=new THREE.Vector3();
  let colorsCache=[];
  function placeCamera(){const {theta,phi,distance}=cameraState;camera.position.set(distance*Math.sin(phi)*Math.sin(theta),distance*Math.cos(phi),distance*Math.sin(phi)*Math.cos(theta));camera.lookAt(0,0,0);camera.updateMatrixWorld();}
  function invalidate(){if(disposed||contextLost||drawRaf||animation)return;drawRaf=win.requestAnimationFrame(()=>{drawRaf=0;renderNow();});}
  function createComposer(){
    if(composer)return;
    const target=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,samples:0});
    composer=new EffectComposer(webgl,target);renderPass=new RenderPass(scene,camera);bloom=new UnrealBloomPass(new THREE.Vector2(1,1),.04,.12,.32);output=new OutputPass();
    sharpness=new ShaderPass({uniforms:{tDiffuse:{value:null},texel:{value:new THREE.Vector2(1,1)},amount:{value:0}},vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:'uniform sampler2D tDiffuse;uniform vec2 texel;uniform float amount;varying vec2 vUv;void main(){vec4 c=texture2D(tDiffuse,vUv);vec3 b=(texture2D(tDiffuse,vUv+vec2(texel.x,0.0)).rgb+texture2D(tDiffuse,vUv-vec2(texel.x,0.0)).rgb+texture2D(tDiffuse,vUv+vec2(0.0,texel.y)).rgb+texture2D(tDiffuse,vUv-vec2(0.0,texel.y)).rgb)*.25;gl_FragColor=vec4(clamp(c.rgb+(c.rgb-b)*amount,0.0,1.0),c.a);}'});
    composer.addPass(renderPass);composer.addPass(bloom);composer.addPass(output);composer.addPass(sharpness);resizeTargets();
  }
  function resizeTargets(){const w=Math.max(1,container.clientWidth),h=Math.max(1,container.clientHeight);webgl.setSize(w,h,false);composer?.setPixelRatio(profile.dpr);composer?.setSize(w,h);sharpness?.uniforms.texel.value.set(1/(w*profile.dpr),1/(h*profile.dpr));camera.aspect=w/h;camera.updateProjectionMatrix();}
  function renderNow(activeGap=0){
    if(disposed||contextLost)return;
    const started=win.performance.now();
    if(bloomEnabled||imageSettings.sharpness>0){createComposer();bloom.enabled=bloomEnabled;bloom.strength=imageSettings.glow/100*.10;sharpness.enabled=imageSettings.sharpness>0;sharpness.uniforms.amount.value=imageSettings.sharpness/100;composer.render();}
    else webgl.render(scene,camera);
    const changed=adaptive.sample(Math.max(win.performance.now()-started,activeGap));
    if(changed&&Math.abs(changed.dpr-profile.dpr)>.001){profile=changed;webgl.setPixelRatio(profile.dpr);resizeTargets();options.onQuality?.({...profile});invalidate();}
  }
  function updateColors(){
    if(!capMesh||!state)return;
    colorsCache=[...PALETTE,'#747e8a'].map(hex=>{const c=new THREE.Color().setRGB(...imageColor(hex,imageSettings),THREE.SRGBColorSpace);if(neon)c.multiplyScalar(1+imageSettings.glow/100*.65);return c;});
    for(let i=0;i<state.length;i++)capMesh.setColorAt(i,colorsCache[state[i]>=0&&state[i]<6?state[i]:6]);
    capMesh.instanceColor.needsUpdate=true;bodyMaterial.color.setRGB(...imageColor('#141922',imageSettings),THREE.SRGBColorSpace);
  }
  function updateAppearance(){
    if(disposed)return;
    imageSettings=imageOverride||normalizeImageSettings(appearance?.imageSettings||readImageSettings(doc.documentElement.dataset.modelImage));
    theme=appearance?.theme||doc.documentElement.dataset.theme||'atelier';neon=theme==='graphite'&&(appearance?.neon??(doc.documentElement.dataset.modelNeon==='on'));bloomEnabled=neon&&profile.bloom&&imageSettings.glow>0;
    const background=win.getComputedStyle(container).getPropertyValue('--surface').trim();
    scene.background=new THREE.Color(appearance?.theme?(theme==='graphite'?'#20242e':'#fffefa'):(background||(theme==='graphite'?'#20242e':'#fffefa')));
    updateColors();invalidate();
  }
  function setFill(move=null){
    const axis=move?AXES.indexOf(move.axis):0,runs=move?slabRuns(size,move.layers):[{first:0,count:size,moving:false}];
    fillMesh.count=runs.length;
    runs.forEach((run,i)=>{
      position.set(0,0,0);position.setComponent(axis,((run.first+run.count/2)/size-.5)*EXTENT);
      scale.setScalar(EXTENT-layout.pitch*.06);scale.setComponent(axis,run.count*layout.pitch-layout.pitch*.06);
      matrix.compose(position,new THREE.Quaternion(),scale);fillMesh.setMatrixAt(i,matrix);
    });
    fillMesh.instanceMatrix.needsUpdate=true;fillBase=fillMesh.instanceMatrix.array.slice();return runs;
  }
  function restoreVisual(){
    if(!capMesh)return;capMesh.instanceMatrix.array.set(capBase);bodyMesh.instanceMatrix.array.set(bodyBase);capMesh.instanceMatrix.needsUpdate=bodyMesh.instanceMatrix.needsUpdate=true;setFill();visualDirty=false;
  }
  function stopAnimation(){if(animation)animation.abort();}
  function rebuild(){
    stopAnimation();input?.clear();
    for(const mesh of [capMesh,bodyMesh,fillMesh])if(mesh){root.remove(mesh);mesh.dispose();}
    capGeometry?.dispose();layout=cubeLayout(size);capGeometry=createTileGeometry(profile.capSegments);capMaterial.vertexColors=Boolean(capGeometry.getAttribute('color'));capMaterial.defines=profile.capSegments===0?{PUZZLE_TILE_GRID:1}:{};capMaterial.needsUpdate=true;
    capMesh=new THREE.InstancedMesh(capGeometry,capMaterial,layout.facelets.length);bodyMesh=new THREE.InstancedMesh(bodyGeometry,bodyMaterial,layout.bodies.length);fillMesh=new THREE.InstancedMesh(fillGeometry,bodyMaterial,size);
    for(const mesh of [capMesh,bodyMesh,fillMesh]){mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=false;root.add(mesh);}
    scale.setScalar(layout.pitch);
    layout.facelets.forEach((f,i)=>{position.fromArray(f.position).addScalar(.5-size/2).multiplyScalar(layout.pitch);quaternion.setFromUnitVectors(zNormal,new THREE.Vector3(...f.normal));matrix.compose(position,quaternion,scale);capMesh.setMatrixAt(i,matrix);});
    layout.bodies.forEach((p,i)=>{position.fromArray(p).addScalar(.5-size/2).multiplyScalar(layout.pitch);matrix.compose(position,new THREE.Quaternion(),scale);bodyMesh.setMatrixAt(i,matrix);});
    capBase=capMesh.instanceMatrix.array.slice();bodyBase=bodyMesh.instanceMatrix.array.slice();setFill();capMesh.instanceMatrix.needsUpdate=bodyMesh.instanceMatrix.needsUpdate=true;visualDirty=false;updateColors();invalidate();
  }
  function setState(next){
    const values=next?.colors??next?.state??next;
    if(!values||values.length!==6*size*size)throw new RangeError('Состояние не соответствует размеру куба.');
    if(Array.from(values).some(v=>!Number.isInteger(v)||v<0||v>255))throw new TypeError('Неверные цвета куба.');
    stopAnimation();state=Uint8Array.from(values);
    if(capGeometry.userData.qualitySegments!==profile.capSegments)rebuild();else if(visualDirty)restoreVisual();
    updateColors();invalidate();
  }
  function setPuzzle(spec){
    const requested=typeof spec==='number'?{size:spec}:spec||{};
    if(requested.kind&&requested.kind!=='cube'&&requested.kind!=='nxn')throw new RangeError('Этому renderer нужна кубическая геометрия.');
    size=validSize(requested.size??size);state=Uint8Array.from({length:6*size*size},(_,i)=>Math.floor(i/(size*size)));profile=makeProfile();adaptive.reset(profile);webgl.setPixelRatio(profile.dpr);rebuild();resizeTargets();updateAppearance();
  }
  function hit(event){
    if(animation||visualDirty)return null;
    const rect=canvas.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);raycaster.setFromCamera(pointer,camera);
    const box=new THREE.Box3(new THREE.Vector3(-1.5,-1.5,-1.5),new THREE.Vector3(1.5,1.5,1.5));
    const point=raycaster.ray.intersectBox(box,new THREE.Vector3());if(!point)return null;
    const xyz=point.toArray(),largest=xyz.map(Math.abs).indexOf(Math.max(...xyz.map(Math.abs))),normal=[0,0,0];normal[largest]=Math.sign(xyz[largest]);
    const p=xyz.map(v=>Math.max(0,Math.min(size-1,Math.floor((v/EXTENT+.5)*size))));
    const [x,y,z]=p;const face=normal[1]>0?0:normal[0]>0?1:normal[2]>0?2:normal[1]<0?3:normal[0]<0?4:5;
    const row=[z,size-1-y,size-1-y,size-1-z,size-1-y,size-1-y][face],column=[x,size-1-z,x,x,z,size-1-x][face];
    return {index:face*size*size+row*size+column,face,row,column,position:p,normal,point:xyz};
  }
  function project(point){const rect=canvas.getBoundingClientRect();projected.fromArray(point).project(camera);return [rect.left+(projected.x+1)*rect.width/2,rect.top+(1-projected.y)*rect.height/2];}
  const input=createPuzzleInput(canvas,{getSize:()=>size,getHit:hit,project,getCamera:()=>cameraState,onOrbit:next=>{Object.assign(cameraState,next);placeCamera();invalidate();},onZoom:distance=>{cameraState.distance=distance;placeCamera();invalidate();},onMove:move=>options.onMove?.(move),onCommand:command=>options.onCommand?.(command),getMoveOptions:()=>options.getMoveOptions?.()||{},isEnabled:()=>interactive&&!animation&&!contextLost&&!disposed,isKeyboardEnabled:()=>interactive&&!contextLost&&!disposed,onGesture:options.onGesture});
  function playMove(descriptor,{duration=220,signal}={}){
    if(disposed)return Promise.reject(new DOMException('Disposed','AbortError'));
    if(animation)return Promise.reject(new Error('Поворот уже выполняется.'));
    if(contextLost)return Promise.reject(new Error('Контекст WebGL недоступен.'));
    const move=normalizeInputMove(descriptor,size),axis=AXES.indexOf(move.axis),layers=new Set(move.layers);
    if(visualDirty)restoreVisual();input.clear();
    const caps=layout.facelets.flatMap((f,i)=>layers.has(f.position[axis])?[i]:[]),bodies=layout.bodies.flatMap((p,i)=>layers.has(p[axis])?[i]:[]),runs=setFill(move),fills=runs.flatMap((r,i)=>r.moving?[i]:[]);
    visualDirty=true;if(drawRaf){win.cancelAnimationFrame(drawRaf);drawRaf=0;}
    return new Promise((resolve,reject)=>{
      let start=null,last=null;
      const abort=()=>{win.cancelAnimationFrame(animationRaf);animationRaf=0;animation=null;signal?.removeEventListener('abort',abort);restoreVisual();invalidate();reject(new DOMException('Cancelled','AbortError'));};
      animation={abort};if(signal?.aborted){abort();return;}signal?.addEventListener('abort',abort,{once:true});
      function frame(now){
        if(disposed||contextLost){abort();return;}
        start??=now;const t=duration<=0?1:Math.min(1,(now-start)/duration),ease=t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2,angle=move.turns*Math.PI/2*ease;
        for(const [mesh,base,indices] of [[capMesh,capBase,caps],[bodyMesh,bodyBase,bodies],[fillMesh,fillBase,fills]]){for(const i of indices)rotateInstance(base,i*16,mesh.instanceMatrix.array,i*16,axis,angle);mesh.instanceMatrix.needsUpdate=true;}
        renderNow(last===null?0:Math.min(100,now-last));last=now;
        if(t<1)animationRaf=win.requestAnimationFrame(frame);else{animationRaf=0;animation=null;signal?.removeEventListener('abort',abort);resolve();}
      }
      animationRaf=win.requestAnimationFrame(frame);
    });
  }
  function resize(){if(disposed)return;const next=makeProfile(),changed=next.capSegments!==capGeometry?.userData.qualitySegments;profile={...next,dpr:Math.min(profile.dpr,next.dpr)};adaptive.reset(profile);webgl.setPixelRatio(profile.dpr);if(changed&&!animation)rebuild();resizeTargets();bloomEnabled=neon&&profile.bloom&&imageSettings.glow>0;invalidate();}
  function contextLostEvent(event){if(disposed)return;event.preventDefault();contextLost=true;input.clear();stopAnimation();options.onStatus?.('3D приостановлено: графический контекст восстанавливается.');}
  function contextRestored(){if(disposed)return;contextLost=false;restoreVisual();invalidate();options.onStatus?.('3D восстановлено.');}
  canvas.addEventListener('webglcontextlost',contextLostEvent);canvas.addEventListener('webglcontextrestored',contextRestored);
  const resizeObserver=new win.ResizeObserver(resize);resizeObserver.observe(container);
  const observer=new win.MutationObserver(updateAppearance);observer.observe(doc.documentElement,{attributes:true,attributeFilter:['data-theme','data-model-neon','data-model-image']});
  placeCamera();setPuzzle({size});
  return {
    canvas,setPuzzle,setState,playMove,animateMove:playMove,resize,
    setInteractive(value){interactive=Boolean(value);if(!interactive)input.clear();},setEditable(value){this.setInteractive(value);},
    resetCamera(){input.clear();cameraState={...DEFAULT_CAMERA};placeCamera();invalidate();},
    setImageSettings(next){imageOverride=normalizeImageSettings(next,imageOverride||imageSettings);updateAppearance();},
    setAppearance(next){appearance=next;updateAppearance();},
    setQuality(next){quality=next||'auto';profile=makeProfile();adaptive.reset(profile);webgl.setPixelRatio(profile.dpr);rebuild();resizeTargets();updateAppearance();options.onQuality?.({...profile});},
    getVisualState(){return {size,state:state?[...state]:null,theme,neon,bloomEnabled,settings:{...imageSettings},quality:{...profile},...cameraState,animating:Boolean(animation),interactive,contextLost,lights:0,opaqueCaps:!capMaterial.transparent&&capMaterial.opacity===1,caps:layout.facelets.length,solidBodies:layout.bodies.length,fillSlabs:fillMesh.count,capTriangles:capGeometry.index.count/3,drawCalls:webgl.info.render.calls,triangles:webgl.info.render.triangles,activePointers:input.activePointers};},
    dispose(){if(disposed)return;stopAnimation();disposed=true;input.dispose();win.cancelAnimationFrame(drawRaf);win.cancelAnimationFrame(animationRaf);resizeObserver.disconnect();observer.disconnect();canvas.removeEventListener('webglcontextlost',contextLostEvent);canvas.removeEventListener('webglcontextrestored',contextRestored);for(const mesh of [capMesh,bodyMesh,fillMesh])mesh?.dispose();capGeometry?.dispose();bodyGeometry.dispose();fillGeometry.dispose();capMaterial.dispose();bodyMaterial.dispose();bloom?.dispose();sharpness?.dispose();output?.dispose();renderPass?.dispose();composer?.dispose();webgl.dispose();webgl.forceContextLoss();scene.clear();canvas.remove();},
  };
}

export const createRenderer=createPuzzleRenderer;
