import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {polyMoveForKey,polyMoveForSwipe,createPolyInput,defaultPolyKeys} from '../data/puzzles/poly-input.mjs';

const pyramid={kind:'pyramid',axes:['U','L','R','B'].map(id=>({id,normal:[0,0,1],layerCount:3,thresholds:[.5,-.5]})),normalizeMove:m=>({...m,layers:[...m.layers]}),parseMove:id=>({axis:id,layers:[0,1],turns:1}),layerFor:()=>0};
for(const code of ['KeyU','KeyL','KeyR','KeyB']){
  const normal=polyMoveForKey({code,key:'г'},pyramid);assert.equal(normal.layers.length,2);assert.equal(polyMoveForKey({code,ctrlKey:true},pyramid).turns,-1);assert.equal(polyMoveForKey({code,altKey:true},pyramid).turns,2);assert.deepEqual(polyMoveForKey({code,shiftKey:true},pyramid).layers,[0]);
}
assert.equal(polyMoveForKey({code:'KeyU',repeat:true},pyramid),null);assert.deepEqual(polyMoveForKey({code:'KeyU'},pyramid,{depth:2,width:2}).layers,[1,2]);
const dodeca={...pyramid,kind:'dodecahedron',axes:Array.from({length:12},(_,i)=>({id:String.fromCharCode(65+i),normal:[0,0,1],layerCount:5,thresholds:[.8,.4,-.4,-.8]}))};
const mapping=defaultPolyKeys(dodeca);assert.equal(new Set(Object.values(mapping)).size,12);assert.equal(polyMoveForKey({code:'KeyF'},dodeca,{},mapping).axis,'B');
assert.equal(polyMoveForKey({code:'KeyQ'},dodeca,{}, {KeyQ:'L'}).axis,'L');
const hit={index:0,point:[1,0,0],center:[1,0,0]},project=([x,y])=>[x*100,-y*100];
assert.equal(polyMoveForSwipe(hit,0,-60,{puzzle:pyramid,project}).turns,-1,'Positive RH screen motion must become negative clockwise turns');

const dom=new JSDOM('<canvas tabindex="0"></canvas><input><button>Outside</button>',{pretendToBeVisual:true}),doc=dom.window.document,canvas=doc.querySelector('canvas'),moves=[],commands=[];let pointerEnabled=false,keysEnabled=true;
canvas.setPointerCapture=()=>{};
const input=createPolyInput(canvas,{getPuzzle:()=>pyramid,getHit:()=>hit,project,getCamera:()=>({theta:.7,phi:1,distance:8.8}),onOrbit(){},onZoom(){},onMove:m=>moves.push(m),onCommand:c=>commands.push(c),isEnabled:()=>pointerEnabled,isKeyboardEnabled:()=>keysEnabled});
const key=(target,code,options={})=>{const event=new dom.window.KeyboardEvent('keydown',{code,bubbles:true,cancelable:true,...options});target.dispatchEvent(event);return event;};
canvas.focus();for(const code of ['KeyU','KeyL','KeyR'])key(canvas,code);key(canvas,'KeyU',{repeat:true});assert.equal(moves.length,3,'Rapid keys survive manual animation pointer lock');key(canvas,'KeyZ',{ctrlKey:true});assert.deepEqual(commands,['undo']);
doc.querySelector('input').focus();key(doc.querySelector('input'),'KeyU');assert.equal(moves.length,3);doc.querySelector('button').focus();assert.equal(key(doc.querySelector('button'),'KeyU').defaultPrevented,false);
function pointer(type,id,x,y){const event=new dom.window.MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:x,clientY:y});Object.defineProperties(event,{pointerId:{value:id},pointerType:{value:'touch'}});canvas.dispatchEvent(event);}
pointerEnabled=true;pointer('pointerdown',1,0,0);pointer('pointermove',1,0,-60);pointer('pointerup',1,0,-60);assert.equal(moves.length,4);
pointer('pointerdown',1,0,0);pointer('pointerdown',2,100,0);pointer('pointermove',2,180,0);pointer('pointerup',2,180,0);pointer('pointerup',1,0,0);assert.equal(moves.length,4,'Pinch cannot create a turn');
pointer('pointerdown',1,0,0);pointer('pointermove',1,0,-60);dom.window.dispatchEvent(new dom.window.Event('rg2:pause'));pointer('pointerup',1,0,-60);assert.equal(moves.length,4);
keysEnabled=false;canvas.focus();key(canvas,'KeyU');assert.equal(moves.length,4);input.dispose();keysEnabled=true;key(canvas,'KeyU');pointer('pointerdown',1,0,0);assert.equal(moves.length,4);assert.equal(input.activePointers,0);dom.window.close();
console.log('Poly input: face/tip/Ctrl/Alt keys and mapping, clockwise swipe sign, rapid queued keys, pointer/pinch/pause/focus/disposal passed');
