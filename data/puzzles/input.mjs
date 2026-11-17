/* Shared Pointer Events + physical-key input. The model remains owned by the caller. */
const AXES=['x','y','z'];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const editable=element=>Boolean(element?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]'));
export function normalizeInputMove(move,size) {
  if(!move||!AXES.includes(move.axis)||!Array.isArray(move.layers)||!move.layers.length)throw new TypeError('Неверный ход.');
  const layers=[...new Set(move.layers)].sort((a,b)=>a-b);
  if(layers.some(v=>!Number.isInteger(v)||v<0||v>=size))throw new RangeError('Слой вне куба.');
  const turns=((Number(move.turns)%4)+4)%4;
  if(!Number.isInteger(Number(move.turns))||!turns)throw new RangeError('Нужен поворот на 90 или 180 градусов.');
  return {axis:move.axis,layers,turns:turns===3?-1:turns};
}
export function moveForKey(event,size,options={}) {
  const face={KeyR:['x',1,-1],KeyL:['x',0,1],KeyU:['y',1,-1],KeyD:['y',0,1],KeyF:['z',1,-1],KeyB:['z',0,1]};
  if(event.metaKey||event.repeat)return null;
  const whole={KeyX:'x',KeyY:'y',KeyZ:'z'}[event.code],spec=face[event.code];
  if(!spec&&!whole)return null;
  const width=clamp(Math.round(Number(options.width)||1),1,size),depth=clamp(Math.round(Number(options.depth)||1),1,size-width+1);
  const layers=whole?Array.from({length:size},(_,i)=>i):Array.from({length:width},(_,i)=>spec[1]?size-depth-i:depth-1+i).sort((a,b)=>a-b);
  return {axis:whole||spec[0],layers,turns:event.altKey||options.double?2:(whole?-1:spec[2])*(event.ctrlKey?-1:1)};
}

/** getHit: {point:[world xyz], normal:[xyz], position:[integer xyz]}; project -> screen px. */
export function moveForSwipe(hit,dx,dy,{size,project,width=1,double=false}={}) {
  if(!hit||!hit.point||!hit.normal||!hit.position||typeof project!=='function')return null;
  const origin=project(hit.point),length=Math.hypot(dx,dy);if(length<1)return null;
  let best=null;
  for(let axis=0;axis<3;axis++){
    if(Math.abs(hit.normal[axis])>.5)continue;
    const [x,y,z]=hit.point,velocity=axis===0?[0,-z,y]:axis===1?[z,0,-x]:[-y,x,0];
    const endpoint=project(hit.point.map((v,i)=>v+velocity[i]*.1)),vx=endpoint[0]-origin[0],vy=endpoint[1]-origin[1],span=Math.hypot(vx,vy);
    if(span<.01)continue;
    const dot=(vx*dx+vy*dy)/(span*length),score=Math.abs(dot);
    if(!best||score>best.score)best={axis,turns:dot<0?-1:1,score};
  }
  if(!best||best.score<.45)return null;
  width=clamp(Math.round(Number(width)||1),1,size);
  const lane=hit.position[best.axis],first=clamp(lane>=size/2?lane-width+1:lane,0,size-width);
  return {axis:AXES[best.axis],layers:Array.from({length:width},(_,i)=>first+i),turns:double?2:best.turns};
}

export function createPuzzleInput(canvas,{getSize=()=>3,getHit=()=>null,project=p=>p,getCamera=()=>({theta:.72,phi:.94,distance:8.8}),onOrbit=()=>{},onZoom=()=>{},onMove=()=>{},onCommand=()=>{},getMoveOptions=()=>({}),isEnabled=()=>true,isKeyboardEnabled=isEnabled,scope=canvas,onGesture=()=>{}}={}) {
  const pointers=new Map(),doc=canvas.ownerDocument,win=doc.defaultView;
  let gesture=null,blocked=false,disposed=false;
  const camera=()=>({...getCamera()});
  function seed(){
    if(!pointers.size){gesture=null;return;}
    if(pointers.size>=2){const [a,b]=[...pointers.values()];gesture={kind:'pinch',span:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),center:[(a.x+b.x)/2,(a.y+b.y)/2],camera:camera()};blocked=true;return;}
    const p=[...pointers.values()][0];gesture={kind:blocked?'orbit':p.kind,id:p.id,x:p.x,y:p.y,hit:p.hit,camera:camera(),moved:false};
  }
  function down(e){
    if(disposed||!isEnabled()||e.pointerType!=='touch'&&![0,1,2].includes(e.button))return;
    e.preventDefault();canvas.focus({preventScroll:true});
    if(!pointers.size)blocked=false;
    const hit=e.button===0||e.pointerType==='touch'?getHit(e):null;
    const kind=hit&&!e.altKey&&e.button!==1&&e.button!==2?'layer':'orbit';
    pointers.set(e.pointerId,{id:e.pointerId,x:e.clientX,y:e.clientY,hit,kind});seed();
    try{canvas.setPointerCapture(e.pointerId);}catch{}
  }
  function move(e){
    if(!pointers.has(e.pointerId)||!gesture)return;
    e.preventDefault();const p=pointers.get(e.pointerId);p.x=e.clientX;p.y=e.clientY;
    if(!isEnabled()){clear();return;}
    if(pointers.size>=2){
      const [a,b]=[...pointers.values()],span=Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),center=[(a.x+b.x)/2,(a.y+b.y)/2];
      if(gesture.kind!=='pinch')seed();
      onZoom(clamp(gesture.camera.distance*gesture.span/span,4.8,20));
      onOrbit({theta:gesture.camera.theta-(center[0]-gesture.center[0])*.008,phi:clamp(gesture.camera.phi-(center[1]-gesture.center[1])*.008,.15,Math.PI-.15)});return;
    }
    const dx=e.clientX-gesture.x,dy=e.clientY-gesture.y;
    if(Math.hypot(dx,dy)>7)gesture.moved=true;
    if(!gesture.moved)return;
    if(gesture.kind==='orbit')onOrbit({theta:gesture.camera.theta-dx*.008,phi:clamp(gesture.camera.phi-dy*.008,.15,Math.PI-.15)});
    else onGesture({phase:'move',move:moveForSwipe(gesture.hit,dx,dy,{size:getSize(),project,...getMoveOptions()}),distance:Math.hypot(dx,dy)});
  }
  function up(e,cancelled=false){
    if(!pointers.has(e.pointerId))return;
    const current=gesture,single=pointers.size===1;
    pointers.delete(e.pointerId);
    if(!cancelled&&single&&!blocked&&current?.kind==='layer'&&current.moved&&isEnabled()){
      const move=moveForSwipe(current.hit,e.clientX-current.x,e.clientY-current.y,{size:getSize(),project,...getMoveOptions()});if(move)onMove(move);
    }
    onGesture({phase:'end'});if(cancelled)blocked=true;seed();
    if(!pointers.size)blocked=false;
  }
  function cancel(e){up(e,true);}
  function clear(){pointers.clear();gesture=null;blocked=false;onGesture({phase:'end'});}
  function wheel(e){if(!isEnabled())return;e.preventDefault();onZoom(clamp(getCamera().distance+e.deltaY*.008,4.8,20));}
  function keydown(e){
    const focused=doc.activeElement;
    if(!isKeyboardEnabled()||editable(e.target)||editable(focused)||!(scope===focused||scope.contains(focused))||e.metaKey)return;
    let command=null;
    if(e.ctrlKey&&e.code==='KeyZ')command=e.shiftKey?'redo':'undo';
    else if(e.ctrlKey&&e.code==='KeyY')command='redo';
    else if(e.code==='Space'&&!e.ctrlKey&&!e.altKey)command='pause';
    if(command){e.preventDefault();if(!e.repeat)onCommand(command);return;}
    const next=moveForKey(e,getSize(),getMoveOptions());if(next){e.preventDefault();onMove(next);}
  }
  const context=e=>e.preventDefault();
  const hidden=()=>{if(doc.hidden)clear();};
  canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',cancel);canvas.addEventListener('lostpointercapture',cancel);canvas.addEventListener('wheel',wheel,{passive:false});canvas.addEventListener('contextmenu',context);
  doc.addEventListener('keydown',keydown);doc.addEventListener('visibilitychange',hidden);win.addEventListener('blur',clear);win.addEventListener('rg2:pause',clear);
  return {clear,dispose(){if(disposed)return;disposed=true;clear();canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerup',up);canvas.removeEventListener('pointercancel',cancel);canvas.removeEventListener('lostpointercapture',cancel);canvas.removeEventListener('wheel',wheel);canvas.removeEventListener('contextmenu',context);doc.removeEventListener('keydown',keydown);doc.removeEventListener('visibilitychange',hidden);win.removeEventListener('blur',clear);win.removeEventListener('rg2:pause',clear);},get activePointers(){return pointers.size;}};
}
