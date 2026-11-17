import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {JSDOM} from 'jsdom';
import {createTextAnchor,createDocumentAnchor,canonicalText,textFingerprint} from '../data/review/model.mjs';
import {renderPreview,resolveTextAnchor,sanitizeReviewHTML,rangeForOffsets} from '../data/review/preview.mjs';
const dom=new JSDOM('<!doctype html>'),doc=dom.window.document;
const algorithms=createRequire(import.meta.url)('../data/algorithms.js');
const context={lessonId:'L1',sourceHash:'a'.repeat(64),knownLessonIds:new Set(['L1','L2'])};
function anchor(html,quote,index=0){const root=doc.createElement('div');root.innerHTML=html;const whole=canonicalText(root),start=whole.indexOf(quote,index);assert.ok(start>=0);return createTextAnchor(root,rangeForOffsets(root,start,start+quote.length));}
const note=(action,a,payload={},id='note-1')=>({id,lessonId:'L1',sourceHash:'a'.repeat(64),action,anchor:a,payload,status:'draft',createdAt:1,updatedAt:1});
function host(result){const root=doc.createElement('div');root.append(result.fragment);return root;}

test('duplicate quotations use unchanged snapshot positions and fail closed after ambiguous drift',()=>{
 const html='<p>R U · R U</p>',a=anchor(html,'R U',4),resolved=resolveTextAnchor('R U · R U',a);assert.equal(resolved.ok,true);assert.equal(resolved.start,6);
 const legacy={type:'text',exact:'R U',prefix:'',suffix:'',start:0,end:3};assert.equal(resolveTextAnchor('R U R U',legacy).code,'ambiguous');
 const drift={...legacy,textFingerprint:textFingerprint('R U')};assert.equal(resolveTextAnchor('R U R U',drift).code,'ambiguous');
 const result=renderPreview(doc,'<p>R U R U</p>',[note('replace',drift,{replacementText:'F'})],context);assert.equal(result.applied.length,0);assert.equal(result.conflicts[0].code,'ambiguous');assert.equal(canonicalText(host(result)),'R U R U');
});
test('overlapping edits are reported without applying a stale edit to another occurrence',()=>{
 const html='<p>Первый алгоритм R U R\' U\'. Второй R U R\' U\'.</p>',a=anchor(html,"R U R' U'"),n1=note('replace',a,{replacementText:'F2'},'a'),n2=note('remove',a,{},'b');
 const result=renderPreview(doc,html,[n1,n2],context);assert.equal(result.applied.length,1);assert.equal(result.conflicts.length,1);assert.equal(canonicalText(host(result)),"Первый алгоритм F2. Второй R U R' U'.");
});
test('positive/negative algorithm markers preserve formula and source links for the renderer',()=>{
 const html='<p>Сделай <b>R U</b>, затем F.</p>',a=anchor(html,'R U'),first=renderPreview(doc,html,[note('mark-algorithm',a,{algorithm:{id:'preferred',moves:'R U',title:'Мой',preferred:true}})],context),root=host(first);
 assert.equal(root.querySelector('[data-review-kind=algorithm]').textContent,'R U');assert.equal(root.querySelector('[data-review-kind=algorithm]').dataset.reviewNoteId,'note-1');assert.equal(first.preferredAlgorithm.id,'preferred');
 const second=host(renderPreview(doc,html,[note('mark-text',a)],context));assert.equal(second.querySelector('[data-review-kind=text]').textContent,'R U');assert.equal(canonicalText(second),'Сделай R U, затем F.');
});
test('real algorithm decoration keeps exact source text and selection anchors usable in raw preview',()=>{
 const html='<p>Первый R <b>U\'  R2</b> и <a href="https://example.com">второй F U2 F\' пример</a>.</p>',root=doc.createElement('div');root.innerHTML=html;const original=canonicalText(root);
 algorithms.prepare(root,{});assert.equal(canonicalText(root),original);assert.ok(root.querySelectorAll('.algorithm-actions').length>=2);
 const formula=root.querySelector('.algorithm-code'),range=doc.createRange();range.selectNodeContents(formula);const captured=createTextAnchor(root,range),result=renderPreview(doc,html,[note('mark-text',captured)],context);
 assert.equal(result.conflicts.length,0);assert.equal(canonicalText(host(result)),original);assert.equal(result.applied.length,1);
});
test('contradictory explicit classifications cannot silently disappear during algorithm decoration',()=>{
 const html='<p>Алгоритм R U R\'</p>',a=anchor(html,"R U R'"),result=renderPreview(doc,html,[note('mark-algorithm',a,{},'positive'),note('mark-text',a,{},'negative')],context);
 assert.deepEqual(result.applied,['positive']);assert.equal(result.conflicts[0].code,'contradictory-marker');const root=host(result);algorithms.prepare(root,{});assert.equal(root.querySelectorAll('.algorithm-block').length,1);assert.equal(root.querySelector('[data-review-kind=text]'),null);
});
test('plain replacements never interpret HTML and imported full rewrite is always sanitized',()=>{
 const html='<p>Старый текст</p>',result=host(renderPreview(doc,html,[note('replace',anchor(html,'Старый'),{replacementText:'<img src=x onerror=alert(1)>'})],context));
 assert.equal(result.querySelector('img'),null);assert.ok(result.textContent.includes('<img'));
 const malicious='<script>alert(1)</script><svg onload="alert(2)"></svg><p onclick="x()">Новый <a href="javascript:alert(1)">текст</a></p><img src="https://evil.test/x" onerror="x()"><a href="#view=item&id=L2">Урок</a>';
 const updated=host(renderPreview(doc,html,[note('lesson-rewrite',createDocumentAnchor(),{replacementHTML:malicious})],context));assert.equal(updated.querySelector('script,svg,img,[onclick],[onerror]'),null);assert.equal(updated.querySelectorAll('a').length,1);assert.equal(updated.querySelector('a').dataset.tfLessonId,'L2');assert.equal(updated.querySelector('a').href,'about:blank#view=item&id=L2');
});
test('internal lesson references reject unknown targets and preserve partial existing links without nesting anchors',()=>{
 const html='<p><a href="https://example.com">Первая формула и вторая</a></p>',n=note('link',anchor(html,'формула'),{targetLessonId:'L2'}),result=renderPreview(doc,html,[n],context),root=host(result);
 assert.equal(result.conflicts.length,0);assert.equal(root.querySelector('a a'),null);assert.equal(root.querySelector('[data-tf-lesson-id=L2]').textContent,'формула');assert.equal(root.querySelectorAll('a').length,3);assert.equal(root.textContent,'Первая формула и вторая');
 const bad=renderPreview(doc,html,[{...n,payload:{targetLessonId:'missing'}}],context);assert.equal(bad.applied.length,0);assert.equal(bad.conflicts.length,1);
});
test('wrong lesson and wrong source revision cannot apply silently',()=>{
 const html='<p>Алгоритм R U</p>',n=note('remove',anchor(html,'R U'));
 const wrongLesson=renderPreview(doc,html,[{...n,lessonId:'L2'}],context);assert.equal(wrongLesson.conflicts[0].code,'wrong-lesson');
 const wrongSource=renderPreview(doc,html,[{...n,sourceHash:'b'.repeat(64)}],context);assert.equal(wrongSource.conflicts[0].code,'source-version');assert.equal(canonicalText(host(wrongSource)),'Алгоритм R U');
});
test('image notes retain normalized coordinates and never modify the image',()=>{
 const html='<p>Схема</p><img src="assets/test.png" width="800" height="600">',image={type:'image',src:'assets/test.png',index:0,naturalWidth:800,naturalHeight:600,rect:{x:.1,y:.2,width:.3,height:.4}};
 const result=renderPreview(doc,html,[note('image-region',image)],context),root=host(result),marker=root.querySelector('[data-review-image-region]');
 assert.equal(result.conflicts.length,0);assert.equal(root.querySelector('img').getAttribute('src'),'assets/test.png');assert.equal(marker.style.left,'10%');assert.equal(marker.style.width,'30%');assert.equal(canonicalText(root),'Схема');
 const wrapper=root.querySelector('[data-review-image-wrap]'),picture=wrapper.querySelector('img');assert.equal(wrapper.style.lineHeight,'0');assert.equal(wrapper.style.padding,'0px');assert.equal(wrapper.style.border,'0px');assert.equal(picture.style.display,'block');assert.equal(picture.style.margin,'0px');assert.equal(picture.style.maxWidth,'100%');assert.equal(picture.style.boxSizing,'border-box');
});
test('solver foundation keeps explicit chosen algorithm and awaits a real case',()=>{
 const setup={kind:'cube',size:3,stage:'OLL',recognitionOrientation:{U:'жёлтый',F:'зелёный'},algorithms:[{id:'mine',moves:'R U',title:'Мой'},{id:'fast',moves:'F',title:'Другой'}],preferredAlgorithmId:'mine'};
 const result=renderPreview(doc,'<p>Текст нужен</p>',[note('solver-setup',createDocumentAnchor(),{solverSetup:setup})],context);
 assert.equal(result.solverSetup.status,'awaiting-case');assert.equal(result.solverSetup.initialCase,undefined);assert.equal(result.preferredAlgorithm.id,'mine');assert.equal(canonicalText(host(result)),'Текст нужен');
});
test('insert, paragraph formatting, request and dismissed operations have explicit effects',()=>{
 const html='<p>Один абзац</p>',a=anchor(html,'Один абзац'),result=renderPreview(doc,html,[note('format',a,{format:{tag:'h2'}},'format'),note('insert',createDocumentAnchor(),{replacementText:'Новый абзац'},'insert'),note('request-algorithm',createDocumentAnchor(),{},'request'),{...note('remove',a),status:'dismissed'}],context),root=host(result);
 assert.equal(root.querySelector('h2').textContent,'Один абзац');assert.equal(root.querySelector('p').textContent,'Новый абзац');assert.equal(result.applied.length,3);assert.equal(result.conflicts.length,0);
});
