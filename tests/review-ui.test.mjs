import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountReview} from '../data/review/ui.mjs';
import {createReviewStore} from '../data/review/model.mjs';
import {createDeveloperGate,createTapCounter,DEVELOPER_KEY,DEVELOPER_PHRASE,validDeveloperPhrase} from '../data/review/unlock.mjs';

const tick=()=>new Promise(resolve=>setTimeout(resolve,15));
function fixture({saveBackend,storeStorage}={}){
 const dom=new JSDOM('<!doctype html><html><head></head><body><section id="about"><button id="app-version">TwistForge Desktop 1.7.0</button></section><article id="article-body"><p>Сначала R U R\' U\'. Теперь следующий урок.</p><img src="assets/test.png"></article></body></html>',{url:'https://twistforge.local/index.html'});
 const {document}=dom.window;dom.window.HTMLElement.prototype.scrollIntoView=function(){};
 let saved=null,exported=null;
 const store=createReviewStore({backend:{load:async()=>null,save:async value=>{await saveBackend?.(value);saved=structuredClone(value);}},storage:storeStorage||dom.window.localStorage});
 const source=document.querySelector('#article-body').innerHTML;
 let article={id:'ONE',title:'Первый урок',path:'3×3 / F2L',html:source,element:document.querySelector('#article-body')};
 const api=mountReview({document,store,appVersion:'1.7.0',getArticle:()=>article,getLessons:()=>[{id:'ONE',title:'Первый урок'},{id:'TWO',title:'Второй урок'}],
  applyArticlePreview:({fragment,original})=>{article.element.replaceChildren(...(original?new JSDOM('<body>'+source+'</body>').window.document.body.childNodes:[fragment]));},
  exportFile:async(text,name)=>{exported={text,name};}});
 const click=action=>document.querySelector(`[data-tf-action="${action}"]`).click();
 const input=(node,value)=>{node.value=value;node.dispatchEvent(new dom.window.Event('input',{bubbles:true}));};
 const select=(start,end)=>{const root=article.element,walker=document.createTreeWalker(root,dom.window.NodeFilter.SHOW_TEXT);let node,position=0,a=null,b=null;while((node=walker.nextNode())){if(a===null&&start<=position+node.length)a={node,offset:start-position};if(end<=position+node.length){b={node,offset:end-position};break;}position+=node.length;}const range=document.createRange();range.setStart(a.node,a.offset);range.setEnd(b.node,b.offset);const sel=dom.window.getSelection();sel.removeAllRanges();sel.addRange(range);document.dispatchEvent(new dom.window.Event('selectionchange'));};
 return {dom,document,store,api,click,input,select,get saved(){return saved;},get exported(){return exported;},get article(){return article;},set article(value){article=value;},async unlock(){api.bindBuildNumber(document.querySelector('#app-version'),document.querySelector('#about'));for(let i=0;i<5;i++)document.querySelector('#app-version').click();input(document.querySelector('[data-tf-developer-code]'),DEVELOPER_PHRASE);document.querySelector('.tf-dev-challenge form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await tick();}};
}

test('developer gate counts five keyboard activations, rejects wrong phrase and persists a local unlock',async()=>{
 const dom=new JSDOM('<body><section><span id="build">TwistForge 1.7.0</span></section><button id="launch">Правки</button></body>',{url:'https://twistforge.local'}),{document}=dom.window;
 const gate=createDeveloperGate({document,launcher:document.querySelector('#launch')});
 const number=document.querySelector('#build');gate.bindBuildNumber(number,number.parentElement);
 for(let i=0;i<4;i++)number.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
 assert.equal(document.querySelector('.tf-dev-challenge'),null);
 number.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:' ',bubbles:true,cancelable:true}));
 assert.equal(document.querySelector('.tf-dev-challenge h3').textContent,'Что ты здесь делаешь?!?');
 const input=document.querySelector('[data-tf-developer-code]');input.value='нет';document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
 assert.equal(gate.enabled,false);assert.equal(input.getAttribute('aria-invalid'),'true');
 input.value=DEVELOPER_PHRASE;document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await tick();
 assert.equal(gate.enabled,true);assert.equal(dom.window.localStorage.getItem(DEVELOPER_KEY),'true');assert.equal(gate.debug().overlays,0);
 document.querySelector('[data-tf-lock]').click();assert.equal(gate.enabled,false);assert.equal(dom.window.localStorage.getItem(DEVELOPER_KEY),'false');gate.dispose();dom.window.close();
});

test('tap timeout resets progress, phrase is exact and reduced motion creates no flying overlay',async()=>{
 let now=0;const counter=createTapCounter({now:()=>now,windowMs:100});for(let i=0;i<4;i++)assert.equal(counter.tap().ready,false);now=101;assert.deepEqual(counter.tap(),{ready:false,remaining:4});
 assert.equal(validDeveloperPhrase(DEVELOPER_PHRASE),true);assert.equal(validDeveloperPhrase(DEVELOPER_PHRASE.toLowerCase()),false);
 const dom=new JSDOM('<body><section><button id="build">1.7</button></section><button id="launch">Режим правок</button>',{url:'https://twistforge.local'});dom.window.matchMedia=()=>({matches:true});
 const {document}=dom.window,gate=createDeveloperGate({document,launcher:document.querySelector('#launch')});gate.bindBuildNumber(document.querySelector('#build'),document.querySelector('section'));
 for(let i=0;i<5;i++)document.querySelector('#build').click();document.querySelector('input').value=DEVELOPER_PHRASE;document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await tick();assert.equal(gate.enabled,true);assert.equal(document.querySelector('.tf-unlock-flight'),null);gate.dispose();dom.window.close();
});

test('review replacement saves one note, previews without overwriting the original and exports one complete package',async()=>{
 const f=fixture();await f.api.ready;assert.equal(f.api.debug().unlocked,false);assert.equal(await f.api.importReview('{}'),false);
 await f.unlock();assert.equal(f.api.debug().unlocked,true);f.click('toggle-panel');await tick();assert.equal(f.document.documentElement.dataset.reviewMode,'on');
 const original=f.article.html;f.select(0,7);assert.equal(f.document.querySelector('.tf-review-selection').hidden,false);f.click('replace');await tick();
 f.input(f.document.querySelector('.tf-replacement'),'Начни');f.click('save-composer');await tick();
 assert.equal(f.store.listNotes().length,1);assert.equal(f.store.listNotes()[0].payload.replacementText,'Начни');assert.equal(f.api.debug().composer.noteId,f.store.listNotes()[0].id);
 f.input(f.document.querySelector('.tf-replacement'),'Сначала собери');f.click('save-composer');await tick();assert.equal(f.store.listNotes().length,1,'editing an existing draft does not duplicate it');
 f.click('composer-preview');await tick();assert.match(f.article.element.textContent,/Сначала собери/);assert.equal(f.article.html,original);
 f.click('preview-original');await tick();assert.match(f.article.element.textContent,/Сначала R U/);
 const text=await f.api.exportReview();const pkg=JSON.parse(text);assert.equal(pkg.schema,'twistforge-review');assert.equal(pkg.lessons[0].sourceHTML,original);assert.equal(pkg.notes.length,1);assert.match(f.exported.name,/^TwistForge-Review-\d{4}-\d{2}-\d{2}\.json$/);
 assert.equal(f.api.handleBack(),true);await tick();assert.equal(f.api.debug().composer,null);assert.equal(f.api.handleBack(),true);assert.equal(f.api.debug().panelOpen,false);f.api.dispose();f.dom.window.close();
});

test('whole-lesson rich editing and a linked word produce safe, clickable internal preview links',async()=>{
 const f=fixture();await f.api.ready;await f.unlock();f.click('toggle-panel');await tick();f.click('rewrite');await tick();
 const editor=f.document.querySelector('.tf-review-rich-editor');editor.innerHTML='<h2>Мой урок</h2><p>Смотри <a href="#view=item&amp;id=TWO">другой урок</a></p><img src="assets/test.png"><script>bad()</script>';
 editor.dispatchEvent(new f.dom.window.Event('input',{bubbles:true}));f.click('composer-preview');await tick();
 assert.equal(f.store.listNotes()[0].action,'lesson-rewrite');assert.equal(f.article.element.querySelector('script'),null);assert.equal(f.article.element.querySelector('a').dataset.tfLessonId,'TWO');assert.equal(f.article.html.includes('Мой урок'),false);
 f.api.dispose();f.dom.window.close();
});

test('link picker, primary algorithm, reviewed state, and solver foundation are exported as data',async()=>{
 const f=fixture();await f.api.ready;await f.unlock();f.click('toggle-panel');await tick();f.select(8,17);f.click('mark-algorithm');await tick();
 const primary=f.document.querySelector('.tf-review-composer .tf-review-inline-check input');primary.checked=true;primary.dispatchEvent(new f.dom.window.Event('change',{bubbles:true}));f.click('save-composer');await tick();f.click('close-composer');await tick();
 assert.equal(f.store.listNotes()[0].payload.algorithm.preferred,true);
 f.select(0,7);f.click('link');await tick();const target=f.document.querySelector('.tf-review-picker select');target.value='TWO';target.dispatchEvent(new f.dom.window.Event('change',{bubbles:true}));f.click('save-composer');await tick();f.click('close-composer');await tick();
 const checked=f.document.querySelector('[data-tf-control=reviewed]');checked.checked=true;checked.dispatchEvent(new f.dom.window.Event('change',{bubbles:true}));await tick();assert.equal(f.store.getLesson('ONE').reviewed,true);
 f.click('solver');await tick();f.click('save-composer');await tick();const solver=f.store.listNotes().find(n=>n.action==='solver-setup');assert.equal(solver.payload.solverSetup.status,'awaiting-case');assert.equal(solver.payload.solverSetup.kind,'cube');
 const pkg=JSON.parse(await f.api.exportReview());assert.equal(pkg.notes.length,3);assert.equal(pkg.notes.find(n=>n.action==='link').payload.targetLessonId,'TWO');assert.equal(await f.api.importReview(JSON.stringify(pkg)),true);assert.equal(f.store.listNotes().length,3);
 f.api.dispose();f.dom.window.close();
});

test('a source revision mismatch stays visible as a conflict and cannot overwrite the current lesson',async()=>{
 const f=fixture();await f.api.ready;await f.unlock();f.click('toggle-panel');await tick();f.select(0,7);f.click('replace');await tick();f.input(f.document.querySelector('.tf-replacement'),'Замена');f.click('save-composer');await tick();await f.api.handleBack();await tick();
 f.article.html='<p>Совсем другой текст урока</p>';f.article.element.innerHTML=f.article.html;await f.api.refresh();f.click('preview-result');await tick();
 assert.equal(f.api.debug().conflicts.length,1);assert.match(f.article.element.textContent,/Совсем другой/);assert.ok(f.document.querySelector('.tf-review-conflicts'));f.api.dispose();f.dom.window.close();
});

test('navigation removes all flying unlock nodes and cancels their animations',async()=>{
 const dom=new JSDOM('<body><section id="about"><button id="build">1.7</button></section><button id="launch">Режим правок</button>',{url:'https://twistforge.local'}),{document}=dom.window;
 dom.window.HTMLElement.prototype.getBoundingClientRect=function(){return {left:10,top:20,width:200,height:150};};
 let cancellations=0;dom.window.Element.prototype.animate=function(){let reject;const finished=new Promise((resolve,no)=>{reject=no;});return {finished,cancel(){cancellations++;reject(new Error('cancelled'));}};};
 const gate=createDeveloperGate({document,launcher:document.querySelector('#launch')});gate.bindBuildNumber(document.querySelector('#build'),document.querySelector('section'));
 for(let i=0;i<5;i++)document.querySelector('#build').click();document.querySelector('input').value=DEVELOPER_PHRASE;document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
 assert.equal(gate.debug().overlays,1);document.querySelector('#about').remove();gate.bindBuildNumber(null,null);await tick();
 assert.equal(gate.debug().overlays,0);assert.equal(gate.debug().animations,0);assert.equal(gate.debug().busy,false);assert.ok(cancellations>0);assert.equal(document.querySelector('.tf-unlock-flight'),null);gate.dispose();dom.window.close();
});

test('an incomplete link survives Back and blocks an incomplete export until its target is chosen',async()=>{
 const f=fixture();await f.api.ready;await f.unlock();f.click('toggle-panel');await tick();f.select(0,7);f.click('link');await tick();
 f.input(f.document.querySelector('.tf-review-composer textarea'),'Перенести сюда объяснение');f.api.handleBack();await tick();
 assert.equal(f.api.debug().composer.action,'link');assert.match(f.api.debug().composer.error,/Выбери урок/);assert.equal(f.store.listNotes().length,0);
 await assert.rejects(f.api.exportReview(),/Заверши открытую правку/);assert.equal(f.exported,null);
 const target=f.document.querySelector('.tf-review-picker select');target.value='TWO';target.dispatchEvent(new f.dom.window.Event('change',{bubbles:true}));f.click('save-composer');await tick();
 assert.equal(f.store.listNotes().length,1);assert.match(await f.api.exportReview(),/Перенести сюда объяснение/);f.api.dispose();f.dom.window.close();
});

test('opposite classifications of the same quote update one saved note instead of contradicting one another',async()=>{
 const f=fixture();await f.api.ready;await f.unlock();f.click('toggle-panel');await tick();f.select(8,17);f.click('mark-algorithm');await tick();f.click('save-composer');await tick();f.click('close-composer');await tick();
 const firstId=f.store.listNotes()[0].id;f.select(8,17);f.click('mark-text');await tick();f.click('save-composer');await tick();
 assert.equal(f.store.listNotes().length,1);assert.equal(f.store.listNotes()[0].id,firstId);assert.equal(f.store.listNotes()[0].action,'mark-text');f.click('composer-preview');await tick();assert.equal(f.api.debug().conflicts.length,0);assert.ok(f.article.element.querySelector('[data-review-kind=text]'));f.api.dispose();f.dom.window.close();
});

test('a touch rectangle on a lesson image exports normalized image coordinates and previews its region',async()=>{
 const f=fixture();await f.api.ready;await f.unlock();f.click('toggle-panel');await tick();f.click('image-mode');await tick();
 const image=f.article.element.querySelector('img');image.getBoundingClientRect=()=>({left:20,top:30,width:200,height:100});
 const pointer=(name,x,y)=>{const event=new f.dom.window.MouseEvent(name,{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0});Object.defineProperty(event,'pointerId',{value:1});image.dispatchEvent(event);};
 pointer('pointerdown',40,40);pointer('pointermove',140,90);pointer('pointerup',140,90);await tick();
 assert.equal(f.api.debug().composer.action,'image-region');f.input(f.document.querySelector('.tf-review-composer textarea'),'Поменять эту схему');f.click('composer-preview');await tick();
 const note=f.store.listNotes()[0];assert.equal(note.action,'image-region');assert.deepEqual(note.anchor.rect,{x:.1,y:.1,width:.5,height:.5});assert.equal(note.anchor.src,'assets/test.png');assert.ok(f.article.element.querySelector('[data-review-image-region]'));f.api.dispose();f.dom.window.close();
});

for(const transition of ['close','export','navigation'])test(`a slow store drains edits typed during ${transition} before completing that transition`,async()=>{
 let release,started,block=true;const pending=new Promise(resolve=>{release=resolve;}),writing=new Promise(resolve=>{started=resolve;});
 const f=fixture({saveBackend:async()=>{if(block){started();await pending;block=false;}}});await f.api.ready;await f.unlock();f.click('toggle-panel');await tick();f.select(0,7);f.click('replace');await tick();
 f.input(f.document.querySelector('.tf-replacement'),'Запись A');f.click('save-composer');await writing;
 let completed;
 if(transition==='close')f.click('close-composer');
 else if(transition==='export')completed=f.api.exportReview();
 else{f.article={...f.article,id:'TWO',title:'Второй урок',html:'<p>Другой урок.</p>'};completed=f.api.refresh();}
 f.input(f.document.querySelector('.tf-replacement'),'Последние изменения B');release();await completed;
 for(let i=0;i<20&&(transition!=='export'?f.api.debug().composer!==null:f.api.debug().composer?.dirty);i++)await tick();
 assert.equal(f.store.listNotes().length,1);assert.equal(f.store.listNotes()[0].payload.replacementText,'Последние изменения B');assert.equal(f.store.listNotes()[0].lessonId,'ONE');
 if(transition==='export')assert.equal(JSON.parse(f.exported.text).notes[0].payload.replacementText,'Последние изменения B');else assert.equal(f.api.debug().composer,null);
 f.api.dispose();f.dom.window.close();
});

test('quota recovery export includes the latest text typed during a failed write without duplicating the note',async()=>{
 let release,started,block=true;const pending=new Promise(resolve=>{release=resolve;}),writing=new Promise(resolve=>{started=resolve;});
 const f=fixture({storeStorage:{getItem:()=>null,setItem(){throw new Error('quota');}},saveBackend:async()=>{if(block){started();await pending;block=false;}throw new Error('quota');}});
 await f.api.ready;await f.unlock();f.click('toggle-panel');await tick();f.select(0,7);f.click('replace');await tick();f.input(f.document.querySelector('.tf-replacement'),'Запись A');f.click('save-composer');await writing;
 const exported=f.api.exportReview();f.input(f.document.querySelector('.tf-replacement'),'Последние изменения B');release();const pkg=JSON.parse(await exported);
 assert.equal(pkg.notes.length,1);assert.equal(pkg.notes[0].payload.replacementText,'Последние изменения B');assert.equal(f.api.debug().dirty,true);assert.equal(f.api.debug().composer.noteId,pkg.notes[0].id);f.api.dispose();f.dom.window.close();
});
