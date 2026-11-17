/* Safe local before/after rendering. Imported instructions are data, never code. */
import {canonicalText,normalizeAssetPath,textFingerprint,validateAnchor,validateSolverSetup,REVIEW_ACTIONS} from './model.mjs';
const ALLOWED=new Set(['P','B','STRONG','I','EM','A','IMG','BR','SPAN','DIV','TABLE','TBODY','THEAD','TFOOT','TR','TH','TD','UL','OL','LI','BLOCKQUOTE','H1','H2','H3','H4','H5','H6','HR','PRE','CODE','SMALL','SUB','SUP','S','DEL','U','CENTER','FONT']);
const REMOVE='script,style,iframe,object,embed,form,meta,link,base,svg,math,input,button,textarea,select,video,audio';
const IGNORE='button,input,select,textarea,script,style,.algorithm-actions,[data-review-chrome],[data-tf-review-chrome],[aria-hidden="true"]';
function knownId(options,id){const known=options.knownLessonIds;if(!known)return true;return typeof known==='function'?known(id):known instanceof Set?known.has(id):Array.isArray(known)?known.includes(id):Object.hasOwn(known,id);}
function hrefForLesson(id,options){const candidate=options.resolveLessonLink?.(id)??`#view=item&id=${encodeURIComponent(id)}`;if(typeof candidate!=='string'||!candidate.startsWith('#')||/[\u0000-\u001f<>"']/g.test(candidate))throw new Error('Некорректная внутренняя ссылка.');return candidate;}
function safeHref(value,options){
  if(typeof value!=='string'||/[\u0000-\u001f]/.test(value))return null;
  if(value.startsWith('#')){
    const query=new URLSearchParams(value.slice(1)),lessonId=query.get('view')==='item'?query.get('id'):null;
    if(lessonId&&!knownId(options,lessonId))return null;
    return {href:value,lessonId};
  }
  try{const url=new URL(value);if(['http:','https:'].includes(url.protocol))return {href:url.href,external:true};if(url.protocol==='rg2:')return {href:value,legacy:true};}catch{}
  return null;
}
export function sanitizeReviewHTML(document,html,options={}){
  const host=document.createElement('div');host.innerHTML=String(html??'');host.querySelectorAll(REMOVE).forEach(node=>node.remove());
  for(const element of [...host.querySelectorAll('*')]){
    if(!ALLOWED.has(element.tagName)){element.replaceWith(...element.childNodes);continue;}
    const attrs=Object.fromEntries([...element.attributes].map(a=>[a.name,a.value]));for(const a of [...element.attributes])element.removeAttribute(a.name);
    if(element.tagName==='IMG'){
      try{element.setAttribute('src',normalizeAssetPath(attrs.src));}catch{element.remove();continue;}
      element.setAttribute('alt',String(attrs.alt||'Схема сборки').slice(0,2048));element.setAttribute('loading','lazy');element.setAttribute('data-zoom','');element.tabIndex=0;
      for(const key of ['width','height'])if(/^\d{1,4}$/.test(attrs[key]||''))element.setAttribute(key,attrs[key]);
    }
    if(element.tagName==='A'){
      const link=safeHref(attrs.href,options);if(!link){element.replaceWith(...element.childNodes);continue;}
      element.setAttribute('href',link.href);
      if(link.external){element.target='_blank';element.rel='noopener noreferrer';}
      if(link.legacy)element.setAttribute('data-rg2-link',link.href);
      if(link.lessonId){element.setAttribute('data-tf-lesson-id',link.lessonId);element.setAttribute('data-review-link','true');}
    }
    if(['TD','TH'].includes(element.tagName))for(const key of ['colspan','rowspan'])if(/^\d{1,3}$/.test(attrs[key]||''))element.setAttribute(key,attrs[key]);
    const align=String(attrs.style||'').match(/(?:^|;)\s*text-align\s*:\s*(left|right|center|justify)\s*(?:;|$)/i);if(align)element.style.textAlign=align[1].toLowerCase();
    if(element.tagName==='CENTER')element.style.textAlign='center';
  }
  const fragment=document.createDocumentFragment();fragment.append(...host.childNodes);return fragment;
}
function sanitized(document,html,options){
  let input=html;
  if(options.sanitize){const result=options.sanitize(String(html??''));if(typeof result==='string')input=result;else if(result?.nodeType){const host=document.createElement('div');for(const child of result.childNodes||[])host.append(document.importNode(child,true));input=host.innerHTML;}else throw new Error('Не удалось безопасно прочитать урок.');}
  return sanitizeReviewHTML(document,input,options);
}
export function resolveTextAnchor(value,input){
  const whole=typeof value==='string'?value:canonicalText(value),anchor=validateAnchor(input);
  if(anchor.type!=='text')return {ok:false,code:'not-text',message:'Не выбрано место в тексте.'};
  const matches=index=>whole.slice(index,index+anchor.exact.length)===anchor.exact&&
    (!anchor.prefix||whole.slice(Math.max(0,index-anchor.prefix.length),index)===anchor.prefix)&&
    (!anchor.suffix||whole.slice(index+anchor.exact.length,index+anchor.exact.length+anchor.suffix.length)===anchor.suffix);
  if(anchor.textFingerprint===textFingerprint(whole)&&anchor.end<=whole.length&&matches(anchor.start))return {ok:true,start:anchor.start,end:anchor.end,method:'snapshot'};
  const candidates=[];
  if(anchor.exact.length){let from=0;for(;;){const at=whole.indexOf(anchor.exact,from);if(at<0)break;if(matches(at))candidates.push(at);if(candidates.length>1)break;from=at+1;}}
  else{for(let at=0;at<=whole.length;at++)if(matches(at)){candidates.push(at);if(candidates.length>1)break;}}
  if(candidates.length===1)return {ok:true,start:candidates[0],end:candidates[0]+anchor.exact.length,method:'context'};
  return {ok:false,code:candidates.length?'ambiguous':'not-found',message:candidates.length?'В уроке несколько одинаковых мест. Выдели нужное место заново.':'Фрагмент изменился или удалён. Выдели новое место правки.'};
}
function textNodes(root){const nodes=[];function visit(node){if(node.nodeType===3){nodes.push(node);return;}if(node.nodeType===1&&node.matches(IGNORE))return;for(const child of node.childNodes||[])visit(child);}visit(root);return nodes;}
export function rangeForOffsets(root,start,end){
  const document=root.ownerDocument,nodes=textNodes(root),wholeLength=nodes.reduce((n,node)=>n+node.data.length,0);if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<start||end>wholeLength)throw new Error('Границы правки больше длины урока.');
  const range=document.createRange();if(!nodes.length){range.selectNodeContents(root);range.collapse(true);return range;}
  function point(offset){let remaining=offset;for(const node of nodes){if(remaining<=node.data.length)return [node,remaining];remaining-=node.data.length;}const node=nodes.at(-1);return [node,node.data.length];}
  range.setStart(...point(start));range.setEnd(...point(end));return range;
}
function unwrapLinks(fragment){for(const anchor of [...fragment.querySelectorAll('a')])anchor.replaceWith(...anchor.childNodes);return fragment;}
function moveMarkerOutsideLink(marker){
  while(marker.parentElement?.closest('a')){
    const parent=marker.parentNode,before=parent.cloneNode(false),after=parent.cloneNode(false);let past=false;
    for(const node of [...parent.childNodes]){if(node===marker){past=true;continue;}(past?after:before).append(node);}
    const replacement=[];if(before.childNodes.length)replacement.push(before);replacement.push(marker);if(after.childNodes.length)replacement.push(after);parent.replaceWith(...replacement);
  }
}
function wrapRange(range,element,{link=false}={}){
  const contents=range.extractContents();if(link)unwrapLinks(contents);element.append(contents);
  if(link){const marker=range.startContainer.ownerDocument.createComment('review-link');range.insertNode(marker);moveMarkerOutsideLink(marker);marker.replaceWith(element);}else range.insertNode(element);
  return element;
}
function noteElement(document,note,tag='span'){const element=document.createElement(tag);element.setAttribute('data-review-note-id',String(note.id));return element;}
function conflictingMarker(root,start,end,kind){
  const other=kind==='algorithm'?'text':'algorithm';let at=0;
  for(const node of textNodes(root)){const next=at+node.data.length;if(start<next&&at<end&&node.parentElement?.closest(`[data-review-kind="${other}"]`))return true;at=next;}return false;
}
function appendPlain(document,element,text){element.textContent=String(text??'');element.style.whiteSpace='pre-wrap';return element;}
function resolveImage(root,anchor){
  const images=[...root.querySelectorAll('img')],matches=images.filter(image=>{try{return normalizeAssetPath(image.getAttribute('src'))===anchor.src;}catch{return false;}});
  if(images[anchor.index]&&matches.includes(images[anchor.index]))return images[anchor.index];
  if(matches.length===1)return matches[0];throw new Error(matches.length?'В уроке несколько одинаковых картинок. Укажи нужную заново.':'Картинка правки больше не найдена.');
}
function decorateImage(document,image,note){
  let wrapper=image.parentElement;if(!wrapper?.hasAttribute('data-review-image-wrap')){
    wrapper=document.createElement('span');wrapper.setAttribute('data-review-image-wrap','');
    // A marker is normalized to the image border box, not to its line box or
    // article margins. Keep the image as the wrapper's only in-flow block;
    // border-box sizing also prevents padding overflowing a narrow viewport.
    wrapper.style.cssText='position:relative;display:inline-block;max-width:100%;line-height:0;vertical-align:middle;padding:0;border:0';
    Object.assign(image.style,{display:'block',margin:'0',maxWidth:'100%',boxSizing:'border-box'});
    image.replaceWith(wrapper);wrapper.append(image);
  }
  const marker=noteElement(document,note),r=note.anchor.rect;marker.setAttribute('data-review-image-region','');marker.setAttribute('aria-hidden','true');marker.style.cssText=`position:absolute;pointer-events:none;box-sizing:border-box;border:2px solid var(--accent,#34745a);background:rgba(90,155,120,.12);left:${r.x*100}%;top:${r.y*100}%;width:${r.width*100}%;height:${r.height*100}%`;wrapper.append(marker);
}
function applyFormat(document,root,range,note){
  const tag=note.payload?.format?.tag??note.payload?.format??'strong';if(!['p','strong','em','u','h2','h3','blockquote','ul','ol','li','code'].includes(tag))throw new Error('Неподдерживаемое оформление.');
  if(['p','h2','h3','blockquote','ul','ol','li'].includes(tag)){
    const ancestor=(range.commonAncestorContainer.nodeType===1?range.commonAncestorContainer:range.commonAncestorContainer.parentElement)?.closest('p,h1,h2,h3,h4,h5,h6,blockquote,li,pre');
    if(ancestor&&root.contains(ancestor)&&canonicalText(ancestor).trim()===note.anchor.exact.trim()){
      const element=noteElement(document,note,tag);if(['ul','ol'].includes(tag)){const item=document.createElement('li');item.append(...ancestor.childNodes);element.append(item);}else element.append(...ancestor.childNodes);ancestor.replaceWith(element);return;
    }
    throw new Error('Для оформления абзаца выдели его текст целиком.');
  }
  wrapRange(range,noteElement(document,note,tag));
}
export function renderPreview(document,sourceHTML,notes=[],options={}){
  const root=document.createElement('div');root.append(sanitized(document,sourceHTML,options));const conflicts=[],applied=[],preferred=[];let solverSetup=null;
  const conflict=(note,code,message)=>conflicts.push({noteId:note?.id??'',lessonId:note?.lessonId??'',code,message});
  for(const note of notes){
    if(['dismissed','applied'].includes(note.status))continue;
    if(options.lessonId!==undefined&&note.lessonId!==String(options.lessonId)){conflict(note,'wrong-lesson','Правка относится к другому уроку.');continue;}
    if(options.sourceHash&&note.sourceHash!==options.sourceHash&&!options.allowSourceDrift){conflict(note,'source-version','Исходная версия урока отличается. Проверь и привяжи пометку заново.');continue;}
    if(!REVIEW_ACTIONS.includes(note.action)){conflict(note,'unknown-action','Неизвестное действие правки.');continue;}
    try{
      const anchor=validateAnchor(note.anchor),payload=note.payload||{};
      if(note.action==='solver-setup'){
        solverSetup=validateSolverSetup(payload.solverSetup);
        if(solverSetup.preferredAlgorithmId){const algorithm=solverSetup.algorithms?.find(a=>a.id===solverSetup.preferredAlgorithmId);if(algorithm)preferred.push({algorithm,noteId:note.id,at:note.updatedAt??note.createdAt??0});}
        applied.push(note.id);continue;
      }
      if(note.action==='lesson-rewrite'){root.replaceChildren(sanitized(document,payload.replacementHTML??'',options));applied.push(note.id);continue;}
      if(anchor.type==='image'){
        if(!['image-region','request-algorithm'].includes(note.action))throw new Error('Неподдерживаемая правка изображения.');decorateImage(document,resolveImage(root,anchor),note);applied.push(note.id);continue;
      }
      if(anchor.type==='document'){
        if(note.action==='insert'){const paragraph=appendPlain(document,noteElement(document,note,'p'),payload.replacementText??'');if(payload.position==='before')root.prepend(paragraph);else root.append(paragraph);applied.push(note.id);continue;}
        if(note.action==='request-algorithm'){applied.push(note.id);continue;}
        throw new Error('Для этой правки нужно выделить текст.');
      }
      const resolved=resolveTextAnchor(root,anchor);if(!resolved.ok){conflict(note,resolved.code,resolved.message);continue;}
      if(['mark-algorithm','mark-text'].includes(note.action)&&conflictingMarker(root,resolved.start,resolved.end,note.action==='mark-algorithm'?'algorithm':'text')){conflict(note,'contradictory-marker','Этот фрагмент уже помечен противоположным образом. Измени или удали предыдущую пометку.');continue;}
      const range=rangeForOffsets(root,resolved.start,resolved.end);
      if(note.action==='replace'){range.deleteContents();range.insertNode(appendPlain(document,noteElement(document,note),payload.replacementText??''));}
      else if(note.action==='remove')range.deleteContents();
      else if(note.action==='insert'){range.collapse(payload.position==='before');range.insertNode(appendPlain(document,noteElement(document,note),payload.replacementText??''));}
      else if(note.action==='mark-text'){const element=noteElement(document,note);element.setAttribute('data-review-kind','text');wrapRange(range,element);}
      else if(note.action==='mark-algorithm'){
        const element=noteElement(document,note);element.setAttribute('data-review-kind','algorithm');
        if(payload.algorithm?.id)element.setAttribute('data-review-algorithm-id',payload.algorithm.id);
        if(payload.algorithm?.preferred)element.setAttribute('data-review-preferred','true');
        const moves=payload.algorithm?.moves??payload.replacementText;
        if(moves!==undefined&&moves!==anchor.exact){range.deleteContents();element.textContent=moves;range.insertNode(element);}else wrapRange(range,element);
        if(payload.algorithm?.preferred)preferred.push({algorithm:{...payload.algorithm,moves:payload.algorithm.moves||anchor.exact},noteId:note.id,at:note.updatedAt??note.createdAt??0});
      }
      else if(note.action==='format')applyFormat(document,root,range,note);
      else if(note.action==='link'){
        const target=payload.targetLessonId;if(typeof target!=='string'||!target||!knownId(options,target))throw new Error('Урок для ссылки не найден.');
        const anchor=noteElement(document,note,'a');anchor.setAttribute('href',hrefForLesson(target,options));anchor.setAttribute('data-tf-lesson-id',target);anchor.setAttribute('data-review-link','true');wrapRange(range,anchor,{link:true});
      }
      else if(note.action==='request-algorithm'){const element=noteElement(document,note);element.setAttribute('data-review-request','algorithm');wrapRange(range,element);}
      else throw new Error('Неподдерживаемая правка текста.');
      applied.push(note.id);
    }catch(error){conflict(note,'invalid-operation',error.message||'Правка не применена.');}
  }
  preferred.sort((a,b)=>a.at-b.at);const preferredAlgorithm=preferred.length?preferred.at(-1).algorithm:null;
  const html=root.innerHTML,fragment=document.createDocumentFragment();fragment.append(...root.childNodes);
  return {fragment,html,conflicts,applied,solverSetup,preferredAlgorithm};
}
export const applyReviewOperations=renderPreview;
