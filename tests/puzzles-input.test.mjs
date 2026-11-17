import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {moveForKey,moveForSwipe,normalizeInputMove,createPuzzleInput} from '../data/puzzles/input.mjs';

for(const n of [2,3,7,50]){
  for(const code of ['KeyR','KeyU','KeyF','KeyD','KeyL','KeyB','KeyX','KeyY','KeyZ']){
    const a=moveForKey({code,key:'r'},n),b=moveForKey({code,key:'к'},n);assert.deepEqual(a,b,'Use physical keys in Russian layout');
    const inverse=moveForKey({code,ctrlKey:true},n);assert.equal(inverse.turns,-a.turns);
    assert.equal(moveForKey({code,altKey:true},n).turns,2);assert.ok(a.layers.every(v=>v>=0&&v<n));
  }
  assert.deepEqual(moveForKey({code:'KeyR'},n,{width:n,depth:99}).layers,Array.from({length:n},(_,i)=>i));
  assert.equal(moveForKey({code:'KeyR',metaKey:true},n),null);assert.equal(moveForKey({code:'KeyR',repeat:true},n),null);
}
assert.deepEqual(moveForKey({code:'KeyR'},7,{width:2,depth:2}),{axis:'x',layers:[4,5],turns:-1});
assert.deepEqual(normalizeInputMove({axis:'x',layers:[2,1,1],turns:3},3),{axis:'x',layers:[1,2],turns:-1});
for(const move of [{axis:'q',layers:[0],turns:1},{axis:'x',layers:[3],turns:1},{axis:'x',layers:[0],turns:0}])assert.throws(()=>normalizeInputMove(move,3));
const hit={point:[0,0,1.5],normal:[0,0,1],position:[2,2,4]},project=([x,y])=>[x*100,-y*100];
assert.deepEqual(moveForSwipe(hit,60,0,{size:5,project}),{axis:'y',layers:[2],turns:1});
assert.deepEqual(moveForSwipe(hit,0,60,{size:5,project}),{axis:'x',layers:[2],turns:1});
assert.equal(moveForSwipe(hit,-60,0,{size:5,project}).turns,-1);

const dom=new JSDOM('<div id="host"><canvas tabindex="0"></canvas></div><button id="outside">Outside</button><input id="input">',{pretendToBeVisual:true});
const {document}=dom.window,canvas=document.querySelector('canvas'),moves=[],commands=[],orbits=[],zooms=[];let enabled=true;
canvas.setPointerCapture=()=>{};
const input=createPuzzleInput(canvas,{getSize:()=>5,getHit:()=>hit,project,getCamera:()=>({theta:.7,phi:1,distance:8.8}),onMove:m=>moves.push(m),onCommand:c=>commands.push(c),onOrbit:p=>orbits.push(p),onZoom:z=>zooms.push(z),isEnabled:()=>enabled});
function key(target,code,options={}){const event=new dom.window.KeyboardEvent('keydown',{bubbles:true,cancelable:true,code,...options});target.dispatchEvent(event);return event;}
canvas.focus();assert.equal(key(canvas,'KeyR',{ctrlKey:true,key:'к'}).defaultPrevented,true);assert.equal(moves.at(-1).turns,1);
key(canvas,'KeyZ',{ctrlKey:true});key(canvas,'KeyY',{ctrlKey:true});key(canvas,'Space');assert.deepEqual(commands,['undo','redo','pause']);
document.querySelector('#outside').focus();assert.equal(key(document.querySelector('#outside'),'KeyR').defaultPrevented,false);
document.querySelector('#input').focus();key(document.querySelector('#input'),'KeyR');assert.equal(moves.length,1);
function pointer(type,id,x,y,options={}){const event=new dom.window.MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0,...options});Object.defineProperties(event,{pointerId:{value:id},pointerType:{value:options.pointerType||'touch'}});canvas.dispatchEvent(event);}
pointer('pointerdown',1,0,0);pointer('pointermove',1,50,0);pointer('pointerup',1,50,0);assert.equal(moves.length,2);assert.equal(moves.at(-1).axis,'y');
pointer('pointerdown',1,0,0);pointer('pointerdown',2,100,0);pointer('pointermove',2,180,0);pointer('pointerup',2,180,0);pointer('pointerup',1,0,0);
assert.equal(moves.length,2,'Pinch must not create a layer turn');assert.ok(zooms.length>0&&orbits.length>0);assert.equal(input.activePointers,0);
pointer('pointerdown',1,0,0);pointer('pointermove',1,50,0);pointer('pointercancel',1,50,0);assert.equal(moves.length,2);
pointer('pointerdown',1,0,0);dom.window.dispatchEvent(new dom.window.Event('rg2:pause'));pointer('pointerup',1,70,0);assert.equal(moves.length,2);
enabled=false;canvas.focus();key(canvas,'KeyR');pointer('pointerdown',1,0,0);assert.equal(input.activePointers,0);assert.equal(moves.length,2);
enabled=true;input.dispose();canvas.focus();key(canvas,'KeyR');pointer('pointerdown',1,0,0);assert.equal(moves.length,2);assert.equal(input.activePointers,0);
const queued=[],busyInput=createPuzzleInput(canvas,{isEnabled:()=>false,isKeyboardEnabled:()=>true,onMove:m=>queued.push(m)});
canvas.focus();for(const code of ['KeyR','KeyU','KeyF'])key(canvas,code);key(canvas,'KeyR',{repeat:true});pointer('pointerdown',1,0,0);
assert.deepEqual(queued.map(m=>m.axis),['x','y','z'],'Fast typing must remain available while a previous manual turn animates');assert.equal(busyInput.activePointers,0);busyInput.dispose();
dom.window.close();
console.log('Playable input: Russian/English physical keys, Ctrl inverse, Alt double, bounds, swipe, pinch/cancel/pause arbitration, focus and disposal passed');
