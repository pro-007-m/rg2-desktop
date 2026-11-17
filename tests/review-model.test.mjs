import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createReviewStore,createLessonContext,createTextAnchor,createImageAnchor,createDocumentAnchor,canonicalText,validatePackage,normalizeAssetPath,reviewByteLength,MAX_REVIEW_BYTES} from '../data/review/model.mjs';

const source='<p>Сначала R U R\' U\'. Затем выбери алгоритм.</p><img src="assets/test.png">';
const context=()=>createLessonContext({id:'LESSON-1',title:'Проверка',path:'3×3 / F2L',sourceHTML:source,version:'1.7.0'});
function storage(){const data=new Map();return {data,getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};}
function memory(){let data=null;return {load:async()=>data,save:async v=>{data=structuredClone(v);},get value(){return data;}};}
async function fixture(options={}){const backend=memory(),store=createReviewStore({backend,storage:storage(),...options});await store.ready;return {store,backend,lesson:await context()};}
const anchor={type:'text',exact:"R U R' U'",prefix:'Сначала ',suffix:'. Затем выбери алгоритм.',start:8,end:17};

test('one export deduplicates original context and keeps preferred algorithm and solver foundation',async()=>{
 const {store,lesson}=await fixture();
 const first=await store.addNote({lesson,action:'mark-algorithm',anchor,payload:{algorithm:{id:'my-alg',moves:anchor.exact,title:'Мой вариант',preferred:true}},comment:'Показывать первым'});
 await store.addNote({lesson,action:'solver-setup',anchor:createDocumentAnchor(),payload:{solverSetup:{kind:'cube',size:3,stage:'F2L',recognitionOrientation:{U:'жёлтый',F:'зелёный'},cameraPose:{theta:.7,phi:.9,distance:8.8},algorithms:[{id:'my-alg',moves:anchor.exact,title:'Мой вариант'},{id:'other',moves:'F R U',title:'Другой'}],preferredAlgorithmId:'my-alg'}}});
 const exported=store.exportReview({appVersion:'1.7.0'}),value=await validatePackage(exported);
 assert.equal(value.schema,'twistforge-review');assert.equal(value.version,1);assert.equal(value.lessons.length,1);assert.equal(value.notes.length,2);
 assert.equal(value.notes[0].id,first.id);assert.equal(value.notes[0].payload.algorithm.preferred,true);assert.equal(value.notes[1].payload.solverSetup.preferredAlgorithmId,'my-alg');
 assert.equal(value.notes[1].payload.solverSetup.status,'awaiting-case');assert.equal(value.notes[1].payload.solverSetup.initialCase,undefined);
 assert.equal(value.lessons[0].sourceHTML,source);assert.equal(value.app.version,'1.7.0');assert.ok(!exported.includes('developerEnabled'));
});
test('reopen, update, remove, undo/redo and branch keep exact notes and source',async()=>{
 const {store,backend,lesson}=await fixture();const note=await store.addNote({lesson,action:'request-algorithm',anchor,comment:'Удобнее'});
 await store.updateNote(note.id,{comment:'Без перехватов'});assert.equal(store.listNotes()[0].revision,2);assert.equal(store.listNotes()[0].comment,'Без перехватов');
 await store.undo();assert.equal(store.listNotes()[0].comment,'Удобнее');await store.redo();assert.equal(store.listNotes()[0].comment,'Без перехватов');
 const reopened=createReviewStore({backend,storage:storage()});await reopened.ready;assert.deepEqual(reopened.listNotes(),store.listNotes());
 await store.deleteNote(note.id);assert.equal(store.listNotes().length,0);await store.undo();assert.equal(store.listNotes().length,1);
 await store.updateNote(note.id,{status:'ready'});assert.equal(store.canRedo,false);await store.setLessonReviewed(lesson.id,true);assert.equal(store.listLessons()[0].reviewed,true);
 assert.equal(store.getLesson(lesson.id).sourceHTML,source);
});
test('strict import rejects malformed versions, prototype keys, missing sources, broken hashes and invalid payloads before mutation',async()=>{
 const {store,lesson}=await fixture();await store.addNote({lesson,action:'request-algorithm',anchor});const good=JSON.parse(store.exportReview()),before=store.exportReview();
 const malformed=[{...good,version:2},{...good,developerEnabled:true},{...good,lessons:[]},{...good,lessons:[{...good.lessons[0],sourceHTML:'changed'}]},{...good,notes:[{...good.notes[0],action:'execute-js'}]},{...good,notes:[{...good.notes[0],payload:{targetLessonId:'x',execute:'alert(1)'}}]},{...good,notes:[{...good.notes[0],anchor:{...anchor,end:999}}]},{...good,notes:[good.notes[0],good.notes[0]]}];
 for(const value of malformed){await assert.rejects(()=>store.importReview(JSON.stringify(value)));assert.equal(store.exportReview(),before);}
 await assert.rejects(()=>store.importReview('{"schema":"twistforge-review","version":1,"__proto__":{}}'));
 assert.equal(store.exportReview(),before);
});
test('export/import roundtrip and merge are deterministic without duplicating a note',async()=>{
 const {store,lesson}=await fixture();await store.addNote({lesson,action:'replace',anchor,payload:{replacementText:'Новый текст'}});
 const other=await fixture();await other.store.importReview(store.exportReview(),{merge:false});const original=other.store.listNotes();
 await other.store.importReview(store.exportReview());assert.deepEqual(other.store.listNotes(),original);assert.equal(other.store.listLessons().length,1);
 const newer=JSON.parse(store.exportReview());newer.notes[0].comment='Новая правка';newer.notes[0].updatedAt+=1000;
 await other.store.importReview(newer);assert.equal(other.store.listNotes()[0].comment,'Новая правка');
});
test('merge never transfers an existing annotation id to another lesson or source revision',async()=>{
 const {store,lesson}=await fixture();await store.addNote({lesson,action:'request-algorithm',anchor});const before=store.exportReview(),value=JSON.parse(before),other=await createLessonContext({id:'ANOTHER',title:'Другой урок',sourceHTML:'<p>Другой текст</p>'});
 value.lessons.push({...other,reviewed:false,updatedAt:1});value.notes[0]={...value.notes[0],lessonId:other.id,sourceHash:other.sourceHash,updatedAt:value.notes[0].updatedAt+1000};
 await assert.rejects(()=>store.importReview(value),/Конфликт импорта/);assert.equal(store.exportReview(),before);
});
test('UTF-8 limit is enforced, including Cyrillic, before an import is written',async()=>{
 assert.equal(reviewByteLength('я'),2);const {store}=await fixture(),before=store.exportReview();await assert.rejects(()=>store.importReview('я'.repeat(MAX_REVIEW_BYTES/2+1)),/8 МБ/);assert.equal(store.exportReview(),before);
});
test('quota errors retain pending work for export and retry instead of silently losing the note',async()=>{
 let failSave=true;const disk=memory(),fallback=storage();fallback.setItem=()=>{throw new Error('quota');};const backend={load:disk.load,save:async v=>{if(failSave)throw new Error('quota');await disk.save(v);}};
 const {store,lesson}=await fixture({backend,storage:fallback});let error;try{await store.addNote({lesson,action:'request-algorithm',anchor,comment:'Не потерять'});}catch(e){error=e;}
 assert.ok(error?.pendingNote?.id);assert.equal(store.dirty,true);assert.equal(store.listNotes()[0].comment,'Не потерять');assert.equal((await validatePackage(store.exportReview())).notes.length,1);
 failSave=false;await store.flush();assert.equal(store.dirty,false);assert.equal(store.error,null);assert.equal(disk.value.notes.length,1);
 failSave=true;await assert.rejects(()=>store.undo());assert.equal(store.listNotes().length,0);assert.equal(store.dirty,true);assert.equal((await validatePackage(store.exportReview())).notes.length,0);
 failSave=false;await store.flush();assert.equal(disk.value.notes.length,0);await store.redo();assert.equal(store.listNotes().length,1);
});
test('serialized writes preserve simultaneous edits and fallback survives reload',async()=>{
 const fallback=storage(),{store,lesson}=await fixture({backend:{load:async()=>null,save:async()=>{throw Error('unavailable');}},storage:fallback});
 await Promise.all([store.addNote({lesson,action:'request-algorithm',anchor,comment:'Первый'}),store.addNote({lesson,action:'request-algorithm',anchor,comment:'Второй'})]);
 assert.equal(store.listNotes().length,2);const reopened=createReviewStore({backend:{load:async()=>null,save:async()=>{}},storage:fallback});await reopened.ready;assert.equal(reopened.listNotes().length,2);
});
test('a newer fallback wins after two saves in the same millisecond',async t=>{
 t.mock.method(Date,'now',()=>10000);const disk=memory(),fallback=storage();let unavailable=false;const backend={load:disk.load,save:async value=>{if(unavailable)throw Error('offline');await disk.save(value);}},store=createReviewStore({backend,storage:fallback});await store.ready;const lesson=await context();
 await store.addNote({lesson,action:'request-algorithm',anchor,comment:'Уже на диске'});unavailable=true;await store.addNote({lesson,action:'request-algorithm',anchor,comment:'В резервном хранилище'});
 const reopened=createReviewStore({backend,storage:fallback});await reopened.ready;assert.equal(reopened.listNotes().length,2);assert.equal(reopened.listNotes()[1].comment,'В резервном хранилище');
});
test('canonical selectors ignore algorithm action buttons and image rectangles are resolution independent',()=>{
 const dom=new JSDOM('<article><p>Начало <span class="algorithm-block"><code>R U</code><span class="algorithm-actions"><button>Копировать</button></span></span> конец</p><img src="assets/test.png" width="800" height="600"></article>'),doc=dom.window.document,root=doc.querySelector('article'),node=doc.querySelector('code').firstChild,range=doc.createRange();range.setStart(node,0);range.setEnd(node,3);
 const result=createTextAnchor(root,range);assert.equal(canonicalText(root),'Начало R U конец');assert.equal(result.exact,'R U');assert.equal(result.start,7);assert.equal(result.prefix,'Начало ');assert.equal(result.suffix,' конец');
 const image=createImageAnchor(doc.querySelector('img'),{x:.1,y:.2,width:.3,height:.4},{root});assert.equal(image.src,'assets/test.png');assert.equal(image.naturalWidth,800);assert.deepEqual(image.rect,{x:.1,y:.2,width:.3,height:.4});
 assert.throws(()=>createImageAnchor(doc.querySelector('img'),{x:.9,y:0,width:.3,height:.4},{root}));
 for(const path of ['https://evil.test/assets/x.png','assets/../key','assets/%2e%2e/key','assets/%252e%252e/key','assets/x%5c..%5ckey','assets/x%3fkey','assets/%00key'])assert.throws(()=>normalizeAssetPath(path));
 assert.throws(()=>createImageAnchor(doc.querySelector('img'),{x:0,y:0,width:1,height:1},{root:doc.createElement('article')}));dom.window.close();
});
