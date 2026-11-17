import {cross,dot} from './poly-geometry.mjs';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const editable=element=>Boolean(element?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]'));
export const DODECA_KEYS=Object.freeze(['KeyU','KeyF','KeyR','KeyB','KeyL','KeyD','KeyJ','KeyK','KeyH','KeyN','KeyM','KeyG']);
export function defaultPolyKeys(puzzle){return puzzle.kind==='pyramid'?{KeyU:'U',KeyL:'L',KeyR:'R',KeyB:'B'}:Object.fromEntries(DODECA_KEYS.map((key,i)=>[key,puzzle.axes[i]?.id]));}
function normalize(puzzle,move){return puzzle.normalizeMove?puzzle.normalizeMove(move):puzzle.moveInfo(move).move;}
export function polyMoveForKey(event,puzzle,options={},keyboardMap=defaultPolyKeys(puzzle)){
  if(event.metaKey||event.repeat)return null;
  const id=keyboardMap[event.code],axis=puzzle.axes.find(a=>a.id===id);if(!axis)return null;
  const tip=puzzle.kind==='pyramid'&&(options.tip||event.shiftKey),turns=(event.altKey||options.double?2:1)*(event.ctrlKey?-1:1);
  if(puzzle.kind==='pyramid'&&!tip&&options.width===undefined&&options.depth===undefined&&puzzle.parseMove){const move=puzzle.parseMove(id);return normalize(puzzle,{...move,turns});}
  const width=tip?1:clamp(Math.round(Number(options.width)||1),1,axis.layerCount),depth=tip?1:clamp(Math.round(Number(options.depth)||1),1,axis.layerCount-width+1);
  return normalize(puzzle,{axis:id,layers:Array.from({length:width},(_,i)=>depth-1+i),turns});
}
export function polyMoveForSwipe(hit,dx,dy,{puzzle,project,width=1,double=false,tip=false}={}){
  if(!hit||!puzzle||typeof project!=='function'||Math.hypot(dx,dy)<1)return null;
  const origin=project(hit.point),length=Math.hypot(dx,dy);let best=null;
  for(const axis of puzzle.axes){
    const layer=puzzle.layerFor?puzzle.layerFor(axis.id,hit.index):axis.thresholds.filter(cut=>dot(axis.normal,hit.center||hit.point)<cut-1e-7).length;
    if(!Number.isInteger(layer)||layer<0||layer>=axis.layerCount||tip&&layer!==0)continue;
    const vector=axis.normal||axis.vector,velocity=cross(vector,hit.point),end=project(hit.point.map((v,i)=>v+velocity[i]*.1)),vx=end[0]-origin[0],vy=end[1]-origin[1],span=Math.hypot(vx,vy);
    if(span<.01)continue;
    const dotScreen=(vx*dx+vy*dy)/(span*length),score=Math.abs(dotScreen);
    if(!best||score>best.score){const count=tip?1:clamp(Math.round(Number(width)||1),1,axis.layerCount),first=clamp(layer,0,axis.layerCount-count);best={score,move:normalize(puzzle,{axis:axis.id,layers:Array.from({length:count},(_,i)=>first+i),turns:(double?2:1)*(dotScreen<0?1:-1)})};}
  }
  return best&&best.score>=.45?best.move:null;
}

export function createPolyInput(canvas,{getPuzzle,getHit,project,getCamera,onOrbit,onZoom,onMove,onCommand=()=>{},getMoveOptions=()=>({}),keyboardMap,isEnabled=()=>true,isKeyboardEnabled=isEnabled,onGesture=()=>{}}){
  const doc=canvas.ownerDocument,win=doc.defaultView,pointers=new Map();let gesture=null,blocked=false,disposed=false;
  function seed(){
    const camera={...getCamera()};
    if(!pointers.size){gesture=null;return;}
    if(pointers.size>=2){const [a,b]=[...pointers.values()];gesture={kind:'pinch',camera,span:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),center:[(a.x+b.x)/2,(a.y+b.y)/2]};blocked=true;return;}
    const p=[...pointers.values()][0];gesture={...p,camera,kind:blocked?'orbit':p.kind,moved:false};
  }
  function clear(){pointers.clear();gesture=null;blocked=false;onGesture({phase:'end'});}
  function down(e){
    if(disposed||!isEnabled()||e.pointerType!=='touch'&&![0,1,2].includes(e.button))return;
    e.preventDefault();canvas.focus({preventScroll:true});if(!pointers.size)blocked=false;
    const hit=e.button===0||e.pointerType==='touch'?getHit(e):null;
    pointers.set(e.pointerId,{id:e.pointerId,x:e.clientX,y:e.clientY,hit,kind:hit&&!e.altKey&&e.button!==1&&e.button!==2?'layer':'orbit'});seed();try{canvas.setPointerCapture(e.pointerId);}catch{}
  }
  function move(e){
    if(!pointers.has(e.pointerId)||!gesture)return;e.preventDefault();if(!isEnabled()){clear();return;}
    const p=pointers.get(e.pointerId);p.x=e.clientX;p.y=e.clientY;
    if(pointers.size>=2){const [a,b]=[...pointers.values()],span=Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),center=[(a.x+b.x)/2,(a.y+b.y)/2];if(gesture.kind!=='pinch')seed();onZoom(clamp(gesture.camera.distance*gesture.span/span,4.8,20));onOrbit({theta:gesture.camera.theta-(center[0]-gesture.center[0])*.008,phi:clamp(gesture.camera.phi-(center[1]-gesture.center[1])*.008,.15,Math.PI-.15)});return;}
    const dx=e.clientX-gesture.x,dy=e.clientY-gesture.y;if(Math.hypot(dx,dy)>7)gesture.moved=true;if(!gesture.moved)return;
    if(gesture.kind==='orbit')onOrbit({theta:gesture.camera.theta-dx*.008,phi:clamp(gesture.camera.phi-dy*.008,.15,Math.PI-.15)});
    else onGesture({phase:'move',move:polyMoveForSwipe(gesture.hit,dx,dy,{puzzle:getPuzzle(),project,...getMoveOptions()}),distance:Math.hypot(dx,dy)});
  }
  function up(e,cancelled=false){
    if(!pointers.has(e.pointerId))return;const current=gesture,single=pointers.size===1;pointers.delete(e.pointerId);
    if(!cancelled&&single&&!blocked&&current?.kind==='layer'&&current.moved&&isEnabled()){const move=polyMoveForSwipe(current.hit,e.clientX-current.x,e.clientY-current.y,{puzzle:getPuzzle(),project,...getMoveOptions()});if(move)onMove(move);}
    onGesture({phase:'end'});if(cancelled)blocked=true;seed();if(!pointers.size)blocked=false;
  }
  const cancel=e=>up(e,true),context=e=>e.preventDefault(),hidden=()=>{if(doc.hidden)clear();};
  function wheel(e){if(!isEnabled())return;e.preventDefault();onZoom(clamp(getCamera().distance+e.deltaY*.008,4.8,20));}
  function key(e){
    const focus=doc.activeElement;if(!isKeyboardEnabled()||editable(e.target)||editable(focus)||focus!==canvas||e.metaKey)return;
    const command=e.ctrlKey&&e.code==='KeyZ'?(e.shiftKey?'redo':'undo'):e.ctrlKey&&e.code==='KeyY'?'redo':e.code==='Space'&&!e.ctrlKey&&!e.altKey?'pause':null;
    if(command){e.preventDefault();if(!e.repeat)onCommand(command);return;}
    const move=polyMoveForKey(e,getPuzzle(),getMoveOptions(),typeof keyboardMap==='function'?keyboardMap():keyboardMap);if(move){e.preventDefault();onMove(move);}
  }
  canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',cancel);canvas.addEventListener('lostpointercapture',cancel);canvas.addEventListener('contextmenu',context);canvas.addEventListener('wheel',wheel,{passive:false});doc.addEventListener('keydown',key);doc.addEventListener('visibilitychange',hidden);win.addEventListener('blur',clear);win.addEventListener('rg2:pause',clear);
  return {clear,get activePointers(){return pointers.size;},dispose(){if(disposed)return;disposed=true;clear();canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerup',up);canvas.removeEventListener('pointercancel',cancel);canvas.removeEventListener('lostpointercapture',cancel);canvas.removeEventListener('contextmenu',context);canvas.removeEventListener('wheel',wheel);doc.removeEventListener('keydown',key);doc.removeEventListener('visibilitychange',hidden);win.removeEventListener('blur',clear);win.removeEventListener('rg2:pause',clear);}};
}
