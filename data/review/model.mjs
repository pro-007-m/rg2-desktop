/* Local, explicit lesson review records. No network and no developer credentials. */
export const REVIEW_SCHEMA='twistforge-review',REVIEW_VERSION=1,MAX_REVIEW_BYTES=8*1024*1024;
export const REVIEW_ACTIONS=Object.freeze(['mark-algorithm','mark-text','replace','insert','remove','format','link','request-algorithm','lesson-rewrite','solver-setup','image-region']);
export const REVIEW_STATUSES=Object.freeze(['draft','ready','applied','dismissed']);
const MAX_SOURCE=512*1024,MAX_NOTES=10000,MAX_LESSONS=2000,MAX_TEXT=65536,MAX_COMMENT=16384;
const DB_NAME='twistforge-review',STORE='workspace',KEY='current',FALLBACK_KEY='twistforge.review.backup.v1';
const forbidden=new Set(['__proto__','constructor','prototype']);
const encoder=new TextEncoder();
const copy=value=>JSON.parse(JSON.stringify(value));
const fail=message=>{throw new TypeError(message);};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
function text(value,label,max=MAX_TEXT,{empty=true}={}){if(typeof value!=='string'||value.length>max||!empty&&!value.length||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))fail('Некорректное поле: '+label+'.');return value;}
const id=(value,label='идентификатор')=>text(value,label,512,{empty:false});
function keys(value,allowed,label){if(!object(value))fail('Некорректный объект: '+label+'.');for(const key of Object.keys(value))if(!allowed.includes(key))fail('Неизвестное поле '+label+': '+key+'.');}
function safeTree(value,depth=0,budget={nodes:0}){if(depth>48||++budget.nodes>300000)fail('Слишком сложный файл правок.');if(value&&typeof value==='object')for(const key of Object.keys(value)){if(forbidden.has(key))fail('Недопустимое поле в файле правок.');safeTree(value[key],depth+1,budget);}return value;}
function stamp(value,fallback=Date.now()){return Number.isSafeInteger(value)&&value>=0&&value<7258118400000?value:fallback;}
function identity(){return globalThis.crypto?.randomUUID?.()||`review-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;}
export function reviewByteLength(value){return encoder.encode(typeof value==='string'?value:JSON.stringify(value)).byteLength;}
export function assertReviewSize(value){if(reviewByteLength(value)>MAX_REVIEW_BYTES)throw new RangeError('Файл правок больше 8 МБ. Раздели правки на несколько пакетов.');return value;}
export async function hashText(value){text(value,'исходный текст',MAX_SOURCE);if(!globalThis.crypto?.subtle)throw new Error('Недоступна проверка целостности текста. Открой приложение через штатную оболочку.');const bytes=await globalThis.crypto.subtle.digest('SHA-256',encoder.encode(value));return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function createLessonContext(value){
  if(!object(value))fail('Не указан урок.');
  const sourceHTML=text(value.sourceHTML??value.html??'','исходный урок',MAX_SOURCE),lessonId=id(value.id??value.lessonId,'урок');
  return {id:lessonId,title:text(value.title??lessonId,'название урока',2048),path:text(value.path??'','путь урока',4096),sourceHTML,sourceHash:await hashText(sourceHTML),sourceVersion:text(String(value.sourceVersion??value.version??''),'версия урока',128)};
}
async function validateLesson(value){keys(value,['id','title','path','sourceHTML','sourceHash','sourceVersion','reviewed','updatedAt'],'урок');const lesson=await createLessonContext(value);if(value.sourceHash!==lesson.sourceHash)fail('Исходный урок не совпадает с его контрольной суммой.');return {...lesson,reviewed:value.reviewed===true,updatedAt:stamp(value.updatedAt)};}

const IGNORE='button,input,select,textarea,script,style,.algorithm-actions,[data-review-chrome],[data-tf-review-chrome],[aria-hidden="true"]';
export function canonicalText(root){
  if(!root)return '';
  if(root.nodeType===3)return root.data;
  if(root.nodeType===1&&root.matches?.(IGNORE))return '';
  let result='';for(const node of root.childNodes||[])result+=canonicalText(node);return result;
}
// Position checksum disambiguates repeated quotes only when the complete visible
// text is unchanged. Source integrity itself uses SHA-256 above, never this hash.
export function textFingerprint(value){let a=0x811c9dc5,b=0x9e3779b9;for(let i=0;i<value.length;i++){const c=value.charCodeAt(i);a=Math.imul(a^c,0x01000193);b=Math.imul(b^(c+i),0x85ebca6b);}return (a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');}
export function createDocumentAnchor(){return {type:'document'};}
export function createTextAnchor(root,range,{contextLength=96}={}){
  if(!root||!range||!root.contains(range.startContainer)||!root.contains(range.endContainer))fail('Выделение должно находиться внутри урока.');
  if(range.startContainer.parentElement?.closest(IGNORE)||range.endContainer.parentElement?.closest(IGNORE))fail('Выдели текст урока, а не кнопку.');
  contextLength=Number.isFinite(contextLength)?Math.max(0,Math.min(256,Math.floor(contextLength))):96;
  const doc=root.ownerDocument,prefix=doc.createRange();prefix.selectNodeContents(root);prefix.setEnd(range.startContainer,range.startOffset);
  const start=canonicalText(prefix.cloneContents()).length;prefix.setEnd(range.endContainer,range.endOffset);const end=canonicalText(prefix.cloneContents()).length,whole=canonicalText(root);
  return {type:'text',exact:whole.slice(start,end),prefix:whole.slice(Math.max(0,start-contextLength),start),suffix:whole.slice(end,end+contextLength),start,end,textFingerprint:textFingerprint(whole)};
}
export function normalizeAssetPath(value){
  let src=String(value||'');
  if(/^https?:/i.test(src)){let url;try{url=new URL(src);}catch{fail('Некорректный путь картинки.');}if(!['rg2.local','appassets.androidplatform.net','localhost','127.0.0.1'].includes(url.hostname))fail('Картинка должна принадлежать библиотеке.');const at=url.pathname.lastIndexOf('/assets/');if(at<0)fail('Картинка должна принадлежать библиотеке.');src=url.pathname.slice(at+1);}
  src=src.replace(/^\.\//,'').replace(/^\//,'');
  let decoded=src;for(let pass=0;pass<5;pass++){let next;try{next=decodeURIComponent(decoded);}catch{fail('Некорректный путь картинки.');}if(next===decoded)break;decoded=next;if(pass===4)fail('Некорректный путь картинки.');}
  if(!decoded.startsWith('assets/')||decoded.split('/').some(p=>p==='..'||p==='.')||/["'<>\\?#\u0000-\u0020]/.test(decoded))fail('Некорректный путь картинки.');return text(src,'картинка',4096,{empty:false});
}
export function createImageAnchor(image,rect,{root=image?.closest?.('.article-body')||image?.parentElement,normalized=true}={}){
  if(!image||!rect)fail('Не выбрана область картинки.');let {x,y,width,height}=rect;
  if(!normalized){const bounds=image.getBoundingClientRect();x/=bounds.width;y/=bounds.height;width/=bounds.width;height/=bounds.height;}
  const index=[...(root?.querySelectorAll?.('img')||[])].indexOf(image);if(index<0)fail('Изображение должно находиться внутри урока.');
  return validateAnchor({type:'image',src:normalizeAssetPath(image.getAttribute('src')||image.src),index,naturalWidth:image.naturalWidth||Number(image.getAttribute('width'))||0,naturalHeight:image.naturalHeight||Number(image.getAttribute('height'))||0,rect:{x,y,width,height}});
}
export function validateAnchor(value){
  if(!object(value))fail('Не указано место правки.');
  if(value.type==='document'){keys(value,['type'],'позиция');return {type:'document'};}
  if(value.type==='text'){
    keys(value,['type','exact','prefix','suffix','start','end','textFingerprint'],'выделение');const exact=text(value.exact,'выделенный текст'),prefix=text(value.prefix??'','контекст до',256),suffix=text(value.suffix??'','контекст после',256);
    if(!Number.isInteger(value.start)||!Number.isInteger(value.end)||value.start<0||value.end<value.start||value.end>MAX_SOURCE||value.end-value.start!==exact.length)fail('Повреждены границы выделения.');
    const result={type:'text',exact,prefix,suffix,start:value.start,end:value.end};if(value.textFingerprint!==undefined){if(!/^[a-f0-9]{16}$/.test(value.textFingerprint))fail('Повреждена позиционная сумма выделения.');result.textFingerprint=value.textFingerprint;}return result;
  }
  if(value.type==='image'){
    keys(value,['type','src','index','naturalWidth','naturalHeight','rect'],'область изображения');keys(value.rect,['x','y','width','height'],'прямоугольник');const r=value.rect;
    if(![r.x,r.y,r.width,r.height].every(Number.isFinite)||r.x<0||r.y<0||r.width<=0||r.height<=0||r.x+r.width>1.000001||r.y+r.height>1.000001)fail('Область картинки должна находиться внутри изображения.');
    if(!Number.isInteger(value.index)||value.index<0||value.index>10000)fail('Некорректный номер картинки.');
    for(const k of ['naturalWidth','naturalHeight'])if(!Number.isInteger(value[k])||value[k]<0||value[k]>50000)fail('Некорректный размер картинки.');
    return {type:'image',src:normalizeAssetPath(value.src),index:value.index,naturalWidth:value.naturalWidth,naturalHeight:value.naturalHeight,rect:{x:r.x,y:r.y,width:r.width,height:r.height}};
  }
  fail('Неизвестный тип выделения.');
}
function algorithm(value){
  keys(value,['id','moves','title','preferred'],'алгоритм');return {id:id(value.id??identity(),'алгоритм'),moves:text(value.moves??'','ходы'),title:text(value.title??'','название алгоритма',2048),preferred:value.preferred===true};
}
export function validateSolverSetup(value){
  keys(value,['puzzle','kind','size','stage','initialCase','recognitionOrientation','cameraPose','algorithms','preferredAlgorithmId','selectedAlgorithmId','notes','status'],'данные решателя');
  const kind=value.kind??value.puzzle??'cube',size=value.size??3;if(!['cube','pyramid','dodecahedron','skewb','square1','other'].includes(kind)||!Number.isInteger(size)||size<2||size>(kind==='cube'?50:20))fail('Некорректная головоломка для урока.');
  if(value.status!==undefined&&!['awaiting-case','unverified','ready'].includes(value.status))fail('Некорректное состояние данных решателя.');
  const result={kind,size,stage:text(value.stage??'','этап',128),notes:text(value.notes??'','пояснение решателя',MAX_COMMENT),status:value.initialCase===undefined||value.initialCase===null?'awaiting-case':value.status??'unverified'};
  if(value.initialCase!==undefined&&value.initialCase!==null){if(Array.isArray(value.initialCase)){if(value.initialCase.length>20000||value.initialCase.some(v=>!Number.isInteger(v)||v<0||v>255))fail('Повреждено исходное состояние.');result.initialCase=[...value.initialCase];}else result.initialCase=text(value.initialCase,'описание исходного случая',MAX_TEXT);}
  if(value.recognitionOrientation!==undefined){keys(value.recognitionOrientation,['U','F','R','D','L','B','description'],'ракурс распознавания');const frame={};for(const [key,v]of Object.entries(value.recognitionOrientation))frame[key]=text(String(v),'сторона распознавания',512);result.recognitionOrientation=frame;}
  if(value.cameraPose!==undefined){keys(value.cameraPose,['theta','phi','distance'],'камера');const pose={};for(const [key,v]of Object.entries(value.cameraPose)){if(!Number.isFinite(v)||Math.abs(v)>100)fail('Некорректный ракурс камеры.');pose[key]=v;}result.cameraPose=pose;}
  if(value.algorithms!==undefined){if(!Array.isArray(value.algorithms)||value.algorithms.length>500)fail('Слишком много вариантов алгоритма.');result.algorithms=value.algorithms.map(algorithm);if(new Set(result.algorithms.map(a=>a.id)).size!==result.algorithms.length)fail('Идентификаторы алгоритмов повторяются.');}
  const preferred=value.preferredAlgorithmId??value.selectedAlgorithmId;
  if(preferred!==undefined&&preferred!==null){result.preferredAlgorithmId=id(preferred,'основной алгоритм');if(result.algorithms&&!result.algorithms.some(a=>a.id===preferred))fail('Основной алгоритм отсутствует в списке вариантов.');}
  return result;
}
function validatePayload(value={}){
  keys(value,['replacementText','replacementHTML','targetLessonId','format','algorithm','solverSetup','position','suggestion','preferredAlgorithmId'],'содержимое правки');const result={};
  for(const k of ['replacementText','suggestion'])if(value[k]!==undefined)result[k]=text(value[k],k);
  if(value.replacementHTML!==undefined)result.replacementHTML=text(value.replacementHTML,'новая версия урока',MAX_SOURCE);
  for(const k of ['targetLessonId','preferredAlgorithmId'])if(value[k]!==undefined)result[k]=id(value[k],k);
  if(value.position!==undefined){if(!['before','after','replace'].includes(value.position))fail('Некорректное место вставки.');result.position=value.position;}
  if(value.format!==undefined){const tag=typeof value.format==='string'?value.format:value.format?.tag;if(!['p','strong','em','u','h2','h3','blockquote','ul','ol','li','code'].includes(tag))fail('Недопустимое оформление.');result.format={tag};}
  if(value.algorithm!==undefined)result.algorithm=algorithm(value.algorithm);
  if(value.solverSetup!==undefined)result.solverSetup=validateSolverSetup(value.solverSetup);
  return result;
}
function validateNote(value){
  keys(value,['id','lessonId','sourceHash','action','anchor','payload','comment','status','createdAt','updatedAt','revision'],'правка');
  if(!REVIEW_ACTIONS.includes(value.action))fail('Неизвестное действие правки.');if(!REVIEW_STATUSES.includes(value.status??'draft'))fail('Неизвестное состояние правки.');
  const hash=text(value.sourceHash,'версия исходника',64);if(!/^[a-f0-9]{64}$/.test(hash))fail('Некорректная контрольная сумма урока.');
  const result={id:id(value.id,'правка'),lessonId:id(value.lessonId,'урок'),sourceHash:hash,action:value.action,anchor:validateAnchor(value.anchor),payload:validatePayload(value.payload),comment:text(value.comment??'','комментарий',MAX_COMMENT),status:value.status??'draft',createdAt:stamp(value.createdAt),updatedAt:stamp(value.updatedAt),revision:Number.isInteger(value.revision)&&value.revision>0?value.revision:1};
  if(['lesson-rewrite','solver-setup'].includes(result.action)&&result.anchor.type!=='document')fail('Эта правка относится ко всему уроку.');
  if(['mark-algorithm','mark-text','replace','remove','format','link'].includes(result.action)&&result.anchor.type!=='text')fail('Для этой правки нужно выделить текст.');
  if(result.action==='insert'&&!['text','document'].includes(result.anchor.type))fail('Для вставки нужно указать место в тексте.');
  if(result.action==='image-region'&&result.anchor.type!=='image')fail('Для пометки картинки нужна область изображения.');
  if(['mark-algorithm','mark-text','replace','remove','format','link'].includes(result.action)&&!result.anchor.exact.length)fail('Выделенный фрагмент пуст.');
  if(result.action==='link'&&!result.payload.targetLessonId)fail('Не выбран урок для ссылки.');
  if(result.action==='lesson-rewrite'&&result.payload.replacementHTML===undefined)fail('Не указан новый текст урока.');
  if(result.action==='solver-setup'&&!result.payload.solverSetup)fail('Не указаны данные будущего решателя.');
  return result;
}
export async function validatePackage(input){
  if(typeof input==='string'){assertReviewSize(input);try{input=JSON.parse(input);}catch{fail('Не удалось прочитать JSON-файл правок.');}}
  else assertReviewSize(input);
  safeTree(input);keys(input,['schema','version','createdAt','updatedAt','app','lessons','notes'],'пакет');
  if(input.schema!==REVIEW_SCHEMA||input.version!==REVIEW_VERSION)fail('Неизвестный формат или версия файла правок.');
  if(!Array.isArray(input.lessons)||input.lessons.length>MAX_LESSONS||!Array.isArray(input.notes)||input.notes.length>MAX_NOTES)fail('Слишком много уроков или пометок.');
  const lessons=await Promise.all(input.lessons.map(validateLesson)),notes=input.notes.map(validateNote),contexts=new Set();
  for(const lesson of lessons){const key=lesson.id+':'+lesson.sourceHash;if(contexts.has(key))fail('Исходный урок повторяется.');contexts.add(key);}
  if(new Set(notes.map(n=>n.id)).size!==notes.length)fail('Идентификаторы правок повторяются.');
  for(const note of notes)if(!contexts.has(note.lessonId+':'+note.sourceHash))fail('У правки отсутствует соответствующий исходный урок.');
  const app={name:'TwistForge'};if(input.app!==undefined){keys(input.app,['name','version'],'приложение');if(input.app.version!==undefined)app.version=text(input.app.version,'версия приложения',128);}
  return {schema:REVIEW_SCHEMA,version:REVIEW_VERSION,createdAt:stamp(input.createdAt),updatedAt:stamp(input.updatedAt),app,lessons,notes};
}
export const validateReview=validatePackage;
export function emptyReview(){const now=Date.now();return {schema:REVIEW_SCHEMA,version:REVIEW_VERSION,createdAt:now,updatedAt:now,app:{name:'TwistForge'},lessons:[],notes:[]};}

function idbBackend(indexedDB){return {async load(){const db=await open();try{return await transaction(db,'readonly',store=>store.get(KEY));}finally{db.close();}},async save(value){const db=await open();try{await transaction(db,'readwrite',store=>store.put(value,KEY));}finally{db.close();}}};
  function open(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,1);req.onupgradeneeded=()=>req.result.createObjectStore(STORE);req.onerror=()=>reject(req.error);req.onsuccess=()=>resolve(req.result);});}
  function transaction(db,mode,action){return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,mode),req=action(tx.objectStore(STORE));let result;req.onsuccess=()=>{result=req.result;};tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Сохранение прервано.'));});}
}
export function createReviewStore(options={}){
  const storage=options.storage??globalThis.localStorage,indexedDB=options.indexedDB??globalThis.indexedDB,backend=options.backend??(indexedDB?idbBackend(indexedDB):null),fallbackKey=options.key??FALLBACK_KEY;
  let state=emptyReview(),history=[],historySizes=[],historyBytes=0,future=[],serial=Promise.resolve(),loading=true,lastError=null,dirty=false;
  const listeners=new Set();
  const notify=()=>{for(const listener of listeners)try{listener();}catch{}};
  const api={ready:null,get error(){return lastError;},get dirty(){return dirty;},get loading(){return loading;},subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
    listNotes(lessonId=null){return copy(state.notes.filter(n=>lessonId===null||n.lessonId===lessonId));},
    listLessons(){return copy(state.lessons);},
    getLesson(lessonId,sourceHash=null){const list=state.lessons.filter(l=>l.id===lessonId&&(!sourceHash||l.sourceHash===sourceHash));return list.length?copy(list.at(-1)):null;},
    snapshot(){return copy(state);},
    async addNote(value){await api.ready;safeTree(value);const lesson=value.lesson?await createLessonContext(value.lesson):api.getLesson(value.lessonId,value.sourceHash);if(!lesson)fail('Сначала открой соответствующий урок.');const now=Date.now(),note=validateNote({id:value.id??identity(),lessonId:lesson.id,sourceHash:lesson.sourceHash,action:value.action,anchor:value.anchor??createDocumentAnchor(),payload:value.payload??{},comment:value.comment??'',status:value.status??'draft',createdAt:now,updatedAt:now,revision:1});return change(next=>{if(next.notes.some(n=>n.id===note.id))fail('Правка с таким идентификатором уже существует.');if(!next.lessons.some(l=>l.id===lesson.id&&l.sourceHash===lesson.sourceHash))next.lessons.push({...lesson,reviewed:false,updatedAt:now});next.notes.push(note);return note;});},
    async updateNote(noteId,patch){await api.ready;safeTree(patch);keys(patch,['action','anchor','payload','comment','status'],'изменение правки');return change(next=>{const at=next.notes.findIndex(n=>n.id===noteId);if(at<0)fail('Правка не найдена.');const old=next.notes[at],note=validateNote({...old,...patch,revision:old.revision+1,updatedAt:Math.max(Date.now(),old.updatedAt+1)});next.notes[at]=note;return note;});},
    async deleteNote(noteId){await api.ready;return change(next=>{const at=next.notes.findIndex(n=>n.id===noteId);if(at<0)return false;next.notes.splice(at,1);return true;});},
    async setLessonReviewed(lessonOrId,reviewed=true){await api.ready;const lesson=object(lessonOrId)?await createLessonContext(lessonOrId):null,lessonId=lesson?.id??id(lessonOrId,'урок');return change(next=>{let list=next.lessons.filter(l=>l.id===lessonId);if(!list.length&&lesson){const item={...lesson,reviewed:Boolean(reviewed),updatedAt:Date.now()};next.lessons.push(item);list=[item];}if(!list.length)fail('Сначала открой соответствующий урок.');for(const item of list){item.reviewed=Boolean(reviewed);item.updatedAt=Date.now();}return Boolean(reviewed);});},
    exportReview({appVersion}={}){const result=copy(state);if(appVersion!==undefined)result.app.version=text(String(appVersion),'версия приложения',128);return assertReviewSize(JSON.stringify(result,null,2));},
    async importReview(input,{merge=true}={}){await api.ready;const imported=await validatePackage(input);return change(next=>{if(!merge){Object.assign(next,imported);return imported.notes.length;}const lessonKeys=new Set(next.lessons.map(l=>l.id+':'+l.sourceHash));for(const l of imported.lessons)if(!lessonKeys.has(l.id+':'+l.sourceHash)){next.lessons.push(l);lessonKeys.add(l.id+':'+l.sourceHash);}for(const n of imported.notes){const at=next.notes.findIndex(old=>old.id===n.id);if(at<0)next.notes.push(n);else{const old=next.notes[at];if(old.lessonId!==n.lessonId||old.sourceHash!==n.sourceHash)fail('Конфликт импорта: идентификатор правки уже относится к другой версии урока.');if(JSON.stringify(old)!==JSON.stringify(n)&&n.updatedAt>old.updatedAt)next.notes[at]=n;}}return imported.notes.length;});},
    async undo(){await api.ready;return serialize(async()=>{if(!history.length)return false;const previous=copy(history.at(-1)),current=copy(state);previous.updatedAt=Math.max(Date.now(),current.updatedAt+1);history.pop();historyBytes-=historySizes.pop();future.push(current);state=previous;dirty=true;try{await persist(previous);}finally{notify();}return true;});},
    async redo(){await api.ready;return serialize(async()=>{if(!future.length)return false;const next=copy(future.at(-1)),current=copy(state);next.updatedAt=Math.max(Date.now(),current.updatedAt+1);future.pop();pushHistory(current);state=next;dirty=true;try{await persist(next);}finally{notify();}return true;});},
    get canUndo(){return history.length>0;},get canRedo(){return future.length>0;},async flush(){await api.ready;await serial;if(dirty){await persist(state);notify();}},
    async clear(){await api.ready;return change(next=>Object.assign(next,emptyReview()));}
  };
  function pushHistory(value){const size=reviewByteLength(value);history.push(value);historySizes.push(size);historyBytes+=size;while(history.length>1&&(history.length>80||historyBytes>16*1024*1024)){history.shift();historyBytes-=historySizes.shift();}}
  function serialize(fn){const pending=serial.then(fn,fn);serial=pending.catch(()=>{});return pending;}
  async function persist(value){assertReviewSize(value);let error;
    if(backend)try{await backend.save(copy(value));try{storage?.removeItem(fallbackKey);}catch{}lastError=null;dirty=false;return;}catch(e){error=e;}
    try{if(!storage)throw error||new Error('Хранилище недоступно.');storage.setItem(fallbackKey,JSON.stringify(value));lastError=null;dirty=false;}catch(e){dirty=true;lastError=new Error('Не удалось сохранить правки. Экспортируй открытый пакет перед закрытием приложения.');lastError.cause=e;throw lastError;}
  }
  async function change(mutator){return serialize(async()=>{const previous=copy(state),next=copy(state),result=mutator(next);next.updatedAt=Math.max(Date.now(),previous.updatedAt+1);if(next.notes.length>MAX_NOTES||next.lessons.length>MAX_LESSONS)fail('Слишком много правок.');assertReviewSize(next);state=next;dirty=true;pushHistory(previous);future=[];try{await persist(next);}catch(error){if(object(result)&&result.id)error.pendingNote=copy(result);notify();throw error;}notify();return result===undefined?undefined:copy(result);});}
  api.ready=(async()=>{let saved=null;
    if(backend)try{saved=await backend.load();}catch(error){lastError=error;}
    try{const raw=storage?.getItem(fallbackKey);if(raw){const fallback=await validatePackage(raw);if(!saved||fallback.updatedAt>saved.updatedAt)saved=fallback;}}catch(error){lastError=error;}
    if(saved)try{state=await validatePackage(saved);}catch(error){lastError=new Error('Сохранённый пакет правок повреждён; его данные не перезаписаны.');lastError.cause=error;}
    loading=false;notify();return api;
  })();
  return api;
}
