/* Shared offline review UI for WebView2 and Android. No original lesson is overwritten. */
import {createReviewStore,createLessonContext,createTextAnchor,createImageAnchor,createDocumentAnchor} from './model.mjs';
import {renderPreview,sanitizeReviewHTML} from './preview.mjs';
import {createDeveloperGate} from './unlock.mjs';

const LABELS={
  'mark-algorithm':'Выделить как алгоритм','mark-text':'Оставить обычным текстом',replace:'Заменить текст',
  insert:'Вставить текст',remove:'Убрать фрагмент',format:'Изменить оформление',link:'Ссылка на урок',
  'request-algorithm':'Подобрать другой алгоритм','lesson-rewrite':'Переписать урок',
  'solver-setup':'Подготовить 3D и решатель','image-region':'Пометка на схеме'
};
const clone=value=>JSON.parse(JSON.stringify(value));
const short=(value,length=130)=>String(value||'').length>length?String(value).slice(0,length)+'…':String(value||'');

export function mountReview(options={}){
  const document=options.document||globalThis.document,win=document.defaultView;
  if(!document?.body)throw new Error('Режим правок ожидает готовую страницу.');
  const getArticle=options.getArticle||(()=>null),getLessons=options.getLessons||(()=>[]);
  const store=options.store||createReviewStore({storage:win.localStorage,indexedDB:win.indexedDB});
  const iconUrl=options.iconUrl||new URL('../app-icon.png',import.meta.url).href;
  const listeners=[];
  let disposed=false,unlocked=false,panelOpen=false,editing=false,preview=false,tab='lesson';
  let current=null,context=null,generation=0,selection=null,composer=null,pendingEditId=null,saveTimer=0,toastTimer=0;
  let saveSerial=Promise.resolve(),previewScheduled=false,imageMode=false,imageDrag=null,imageLayer=null,imageClickUntil=0;
  let conflicts=[],lastPreviewKey='',lastAppliedPreview=false,readyDone=false;
  function el(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;}
  function button(text,action,className=''){const node=el('button',className,text);node.type='button';if(action)node.dataset.tfAction=action;return node;}
  function listen(target,type,fn,opts){target.addEventListener(type,fn,opts);listeners.push(()=>target.removeEventListener(type,fn,opts));}
  function report(message,error=false){status.textContent=String(message||'');status.classList.toggle('is-error',error);}
  function toast(message){if(disposed)return;toastBox.textContent=String(message);toastBox.hidden=false;win.clearTimeout(toastTimer);toastTimer=win.setTimeout(()=>{toastBox.hidden=true;},4200);}
  function failed(error){report(error?.message||'Не удалось сохранить правку. Экспортируй пакет перед закрытием.',true);}
  function safe(action){Promise.resolve().then(action).catch(failed);}
  function requireUnlocked(){if(unlocked)return true;toast('Сначала открой режим разработчика в настройках.');return false;}
  function field(label,node,host=composer?.node){const wrap=el('label','',label);wrap.append(node);host?.append(wrap);return node;}
  function textInput(value='',placeholder=''){const node=el('input');node.type='text';node.value=value;node.placeholder=placeholder;return node;}
  function area(value='',className=''){const node=el('textarea',className);node.value=value;return node;}
  function selectChoices(choices,value){const select=el('select');for(const [id,title]of choices){const option=el('option','',title);option.value=id;select.append(option);}select.value=value;return select;}
  function cleanEditorHTML(html){const box=el('div');box.append(sanitizeReviewHTML(document,html,{knownLessonIds:new Set(getLessons().map(item=>item.id))}));return box.innerHTML;}

  if(!document.querySelector('#tf-review-styles')){const link=el('link');link.id='tf-review-styles';link.rel='stylesheet';link.href=new URL('./view.css',import.meta.url).href;document.head.append(link);}
  const launcher=button('','toggle-panel','tf-review-launcher');launcher.hidden=true;launcher.setAttribute('aria-expanded','false');launcher.setAttribute('aria-controls','tf-review-panel');
  const launchIcon=el('img');launchIcon.src=iconUrl;launchIcon.alt='';const launchText=el('span','','Режим правок'),launchCount=el('small','','0');launcher.append(launchIcon,launchText,launchCount);
  const panel=el('aside','tf-review-panel');panel.id='tf-review-panel';panel.hidden=true;panel.setAttribute('aria-label','Режим правок уроков');panel.dataset.tfReviewChrome='true';
  const header=el('header','tf-review-header'),heading=el('div');heading.append(el('h2','','Мастерская уроков'),el('p','','Правки сохраняются на этом устройстве'));const close=button('×','close-panel','tf-close');close.setAttribute('aria-label','Свернуть режим правок');header.append(heading,close);
  const mode=el('div','tf-review-mode'),modeLabel=el('label'),modeInput=el('input');modeInput.type='checkbox';modeInput.dataset.tfControl='editing';modeLabel.append(modeInput,document.createTextNode('Выделять и отмечать в уроке'));mode.append(modeLabel);
  const tabs=el('div','tf-review-tabs');tabs.setAttribute('role','group');tabs.setAttribute('aria-label','Область пометок');const lessonTab=button('Этот урок','tab-lesson'),allTab=button('Все пометки','tab-all');tabs.append(lessonTab,allTab);
  const scroller=el('div','tf-review-scroll'),summary=el('div'),composerHost=el('div'),noteList=el('div');scroller.append(summary,composerHost,noteList);
  const exportRow=el('div','tf-review-export');exportRow.append(button('Экспорт всех пометок','export','tf-primary'),button('Импорт','import'));
  const status=el('p','tf-review-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.textContent='Выдели текст или выбери действие для всего урока.';
  panel.append(header,mode,tabs,scroller,exportRow,status);
  const selectionBar=el('div','tf-review-selection');selectionBar.hidden=true;selectionBar.dataset.tfReviewChrome='true';selectionBar.setAttribute('role','toolbar');selectionBar.setAttribute('aria-label','Действия с выделенным фрагментом');
  const selectionCaption=el('div','tf-selection-caption');selectionBar.append(selectionCaption);
  for(const [action,text]of [['mark-algorithm','Это алгоритм'],['mark-text','Это текст'],['replace','Заменить'],['link','Ссылка'],['request-algorithm','Другой алгоритм'],['more-selection','Ещё…'],['clear-selection','×']])selectionBar.append(button(text,action));
  const toastBox=el('div','tf-review-toast');toastBox.hidden=true;toastBox.setAttribute('role','status');
  const importInput=el('input');importInput.type='file';importInput.accept='.json,application/json';importInput.hidden=true;
  document.body.append(launcher,panel,selectionBar,toastBox,importInput);
  const gate=createDeveloperGate({document,storage:win.localStorage,launcher,iconUrl,
    onStatus:toast,onUnlocked:()=>{toast('Режим правок открыт. Кнопка мастерской — внизу справа.');},
    onChanged:value=>{unlocked=value;launcher.hidden=!value;if(!value){editing=false;setPanel(false);clearSelection();cancelImage();preview=false;updateSurface();queuePreview();}updateLauncher();}});
  unlocked=gate.enabled;launcher.hidden=!unlocked;

  function updateLauncher(){const count=store.listNotes().length;launchCount.textContent=String(count);launcher.setAttribute('aria-label',`Режим правок. Пометок: ${count}`);launcher.classList.toggle('is-active',editing&&unlocked);launcher.setAttribute('aria-expanded',String(panelOpen));}
  function updateSurface(){
    const active=unlocked&&editing;
    if(active)document.documentElement.dataset.reviewMode='on';else delete document.documentElement.dataset.reviewMode;
    modeInput.checked=active;modeInput.disabled=!unlocked;
    document.body.classList.toggle('tf-review-panel-open',panelOpen);
    for(const node of document.querySelectorAll('.tf-review-surface'))if(node!==current?.element)node.classList.remove('tf-review-surface','tf-review-image-mode');
    current?.element?.classList.toggle('tf-review-surface',active&&!preview);
    current?.element?.classList.toggle('tf-review-image-mode',active&&!preview&&imageMode);
    updateLauncher();
  }
  function setPanel(value){panelOpen=Boolean(value)&&unlocked;panel.hidden=!panelOpen;if(panelOpen){editing=true;renderSummary();renderNotes();}updateSurface();}
  function clearSelection(){selection=null;selectionBar.hidden=true;}
  function showSelection(value){selection=value;selectionCaption.textContent='«'+short(value.anchor.exact,170)+'»';selectionBar.hidden=false;}
  function captureSelection(){
    if(!unlocked||!editing||preview||!context||!current?.element?.isConnected||imageMode)return;
    if(composer?.node.contains(document.activeElement))return;
    const selected=win.getSelection();if(!selected?.rangeCount||selected.isCollapsed)return;
    const range=selected.getRangeAt(0);
    if(!current.element.contains(range.startContainer)||!current.element.contains(range.endContainer))return;
    if(range.startContainer.parentElement?.closest('button,.algorithm-actions,[data-tf-review-chrome]'))return;
    try{const anchor=createTextAnchor(current.element,range);if(anchor.exact?.trim())showSelection({anchor,lesson:clone(context),range:range.cloneRange()});}catch{}
  }
  function picker(host,selected,onChange){
    const wrapper=el('div','tf-review-picker'),search=textInput('','Найти урок по названию или разделу');search.setAttribute('aria-label','Поиск урока для ссылки');
    const list=el('select');list.size=5;list.setAttribute('aria-label','Урок назначения');wrapper.append(search,list);host.append(wrapper);
    const lessons=getLessons();
    const render=()=>{const old=list.value||selected,query=search.value.trim().toLocaleLowerCase('ru');list.replaceChildren();const blank=el('option','','Выбери урок');blank.value='';list.append(blank);let count=0;for(const item of lessons){const label=(item.path||item.title);if(query&&!(`${label} ${item.id}`).toLocaleLowerCase('ru').includes(query))continue;if(count++>=250)break;const option=el('option','',label);option.value=item.id;list.append(option);}if([...list.options].some(option=>option.value===old))list.value=old;else list.value='';};
    search.addEventListener('input',render);list.addEventListener('change',()=>onChange(list.value));render();return {search,list};
  }

  function renderSummary(){
    summary.replaceChildren();lessonTab.setAttribute('aria-pressed',String(tab==='lesson'));allTab.setAttribute('aria-pressed',String(tab==='all'));
    if(tab==='all'){
      summary.append(el('h3','tf-review-lesson-title','Все пометки'),el('p','tf-review-help',`${store.listNotes().length} пометок · ${store.listLessons().filter(item=>item.reviewed).length} уроков просмотрено. Один экспорт объединяет всё.`));
    }else if(!current||!context){summary.append(el('div','tf-review-empty','Открой обычный урок в библиотеке. Здесь появятся его пометки и инструменты.'));}
    else{
      summary.append(el('h3','tf-review-lesson-title',current.title),el('p','tf-review-path',current.path||''));
      summary.append(el('p','tf-review-help',preview?'Открыт результат правок. Переключись на оригинал, чтобы отмечать новые фрагменты.':'Выдели текст мышью или долгим касанием. Для алгоритма можно нажать на его блок. Затем выбери, что поменять.'));
      const grid=el('div','tf-review-grid');grid.append(button('Переписать весь урок','rewrite'),button('Добавить текст','insert-end'),button(imageMode?'Отменить выбор картинки':'Область картинки','image-mode'),button('3D и решатель урока','solver'));
      summary.append(grid);
      const switcher=el('div','tf-review-preview-switch');const before=button('Оригинал','preview-original'),after=button('Предпросмотр','preview-result');before.setAttribute('aria-pressed',String(!preview));after.setAttribute('aria-pressed',String(preview));switcher.append(before,after);summary.append(switcher);
      if(preview)summary.append(button('Смотреть урок целиком','view-lesson','tf-primary tf-review-mobile-view'));
      const reviewed=el('label','tf-review-inline-check'),check=el('input');check.type='checkbox';check.checked=Boolean(store.getLesson(current.id)?.reviewed);check.dataset.tfControl='reviewed';reviewed.append(check,document.createTextNode('Урок просмотрен'));summary.append(reviewed);
      if(conflicts.length){const box=el('div','tf-review-conflicts');box.append(el('strong','',`Нужно уточнить правки: ${conflicts.length}`));const list=el('ul');for(const conflict of conflicts)list.append(el('li','',conflict.message||'Не удалось однозначно найти фрагмент.'));box.append(list);summary.append(box);}
    }
    const undoRow=el('div','tf-review-preview-switch'),undo=button('Отменить правку','undo'),redo=button('Повторить','redo');undo.disabled=!store.canUndo;redo.disabled=!store.canRedo;undoRow.append(undo,redo);summary.append(undoRow);
    const stub=el('div','tf-review-stub');const copy=el('div');copy.append(el('strong','','Предложить исправление или добавление'),el('span','','Отправка автору появится позже. Пока используй экспорт.'));const disabled=button('В разработке');disabled.disabled=true;stub.append(copy,disabled);summary.append(stub);
  }
  function renderNotes(){
    noteList.replaceChildren();const notes=store.listNotes(tab==='lesson'?current?.id||'':null);
    if(!notes.length){noteList.append(el('p','tf-review-empty','Пометок пока нет. Изменения исходной библиотеки здесь не теряются: каждое действие сохраняется отдельной правкой.'));return;}
    const groups=new Map();for(const note of notes){if(!groups.has(note.lessonId))groups.set(note.lessonId,[]);groups.get(note.lessonId).push(note);}
    for(const [lessonId,items]of groups){
      const context=store.getLesson(lessonId),group=el('section','tf-review-group');
      const title=button('','open-lesson','tf-review-group-title');title.dataset.lessonId=lessonId;title.append(el('span','',context?.title||lessonId),el('small','',String(items.length)));group.append(title);
      for(const note of items){
        const conflict=conflicts.find(item=>(item.noteId||item.id)===note.id),card=el('article','tf-review-note'+(conflict?' is-conflict':''));card.dataset.noteId=note.id;
        const head=el('div','tf-review-note-head');head.append(el('strong','',LABELS[note.action]||note.action),el('small','',note.status==='ready'?'Готово':'Черновик'));card.append(head);
        if(note.anchor.type==='text')card.append(el('blockquote','',short(note.anchor.exact,300)));
        if(note.anchor.type==='image')card.append(el('p','',`Область схемы · ${note.anchor.src||note.anchor.assetPath||''}`));
        if(note.payload.replacementText!==undefined)card.append(el('p','','→ '+short(note.payload.replacementText,280)));
        if(note.payload.targetLessonId)card.append(el('p','','→ '+(getLessons().find(item=>item.id===note.payload.targetLessonId)?.title||note.payload.targetLessonId)));
        if(note.payload.algorithm?.preferred)card.append(el('p','','★ Основной алгоритм: '+note.payload.algorithm.moves));
        if(note.comment)card.append(el('p','',short(note.comment,300)));
        if(conflict)card.append(el('p','',conflict.message));
        const actions=el('div','tf-review-note-actions');for(const [action,text]of [['edit-note','Изменить'],['jump-note','К месту'],['delete-note','Удалить']]){const b=button(text,action);b.dataset.noteId=note.id;actions.append(b);}card.append(actions);group.append(card);
      }
      noteList.append(group);
    }
  }

  function markDirty(){if(!composer)return;composer.dirty=true;composer.editRevision++;composer.error=null;composer.state.textContent='Изменения ожидают сохранения…';win.clearTimeout(saveTimer);saveTimer=win.setTimeout(()=>safe(()=>drainComposer()),750);}
  function readComposer(c){
    const payload={...c.originalPayload},controls=c.controls;
    if(controls.replacement)payload.replacementText=controls.replacement.value;
    if(controls.position)payload.position=controls.position.value;
    if(controls.format)payload.format={tag:controls.format.value};
    if(controls.targetLesson)payload.targetLessonId=controls.targetLesson.value;
    if(controls.editor)payload.replacementHTML=cleanEditorHTML(controls.editor.innerHTML);
    if(controls.moves){payload.algorithm={id:c.algorithmId,moves:controls.moves.value,title:controls.algorithmTitle.value,preferred:controls.preferred.checked};}
    if(c.action==='solver-setup'){
      const raw=controls.initialCase.value.trim();let initialCase=null;if(raw){if(raw.startsWith('[')){try{initialCase=JSON.parse(raw);}catch{throw new Error('Состояние куба должно быть JSON-массивом цветов или обычным описанием.');}}else initialCase=raw;}
      const solverSetup={kind:controls.kind.value,size:Number(controls.size.value),stage:controls.stage.value,initialCase,
        recognitionOrientation:{description:controls.orientation.value},notes:controls.solverNotes.value,status:initialCase?'unverified':'awaiting-case'};
      for(const side of ['U','F','R','D','L','B'])if(controls['side'+side].value.trim())solverSetup.recognitionOrientation[side]=controls['side'+side].value.trim();
      if(controls.theta.value||controls.phi.value||controls.distance.value){solverSetup.cameraPose={};for(const key of ['theta','phi','distance'])if(controls[key].value!=='')solverSetup.cameraPose[key]=Number(controls[key].value);}
      const otherAlgorithms=(c.originalPayload.solverSetup?.algorithms||[]).filter(item=>item.id!==c.algorithmId);
      if(controls.solverMoves.value.trim()){const algorithm={id:c.algorithmId,moves:controls.solverMoves.value,title:controls.solverTitle.value,preferred:true};solverSetup.algorithms=[algorithm,...otherAlgorithms.map(item=>({...item,preferred:false}))];solverSetup.preferredAlgorithmId=algorithm.id;}
      else if(otherAlgorithms.length)solverSetup.algorithms=otherAlgorithms;
      payload.solverSetup=solverSetup;
    }
    return {action:c.action,anchor:c.anchor,payload,comment:controls.comment.value,status:controls.ready.checked?'ready':'draft'};
  }
  function saveComposer({force=false,target=composer}={}){
    const c=target;if(!c||(!c.dirty&&!force))return saveSerial;
    win.clearTimeout(saveTimer);let patch;const revision=c.editRevision;
    try{patch=readComposer(c);if(c.action==='link'&&!patch.payload.targetLessonId)throw new Error('Выбери урок, на который должна вести ссылка.');}catch(error){c.lastAttemptRevision=revision;c.error=error;c.state.textContent=error.message;return Promise.resolve(null);}
    c.dirty=false;c.state.textContent='Сохраняю…';
    const pending=saveSerial.then(async()=>{
      try{const note=c.noteId?await store.updateNote(c.noteId,patch):await store.addNote({lesson:c.lesson,...patch});c.noteId=note.id;
        if(store.error)throw store.error;
        c.lastAttemptRevision=revision;c.error=null;if(!c.dirty){c.state.textContent='Сохранено на устройстве';report('Пометки сохранены на устройстве. Экспорт собирает все уроки в один файл.');}return note;
      }catch(error){c.lastAttemptRevision=revision;if(error.pendingNote?.id)c.noteId=error.pendingNote.id;c.dirty=true;c.error=error;c.state.textContent=error.message;failed(error);return null;}
    });
    saveSerial=pending.then(()=>{});return pending;
  }
  async function drainComposer(target=composer,{force=false}={}){
    if(!target){await saveSerial;return true;}
    do{
      await saveComposer({target,force});force=false;await saveSerial;
      if(target.error&&target.editRevision<=target.lastAttemptRevision)return false;
    }while(target.dirty);
    return true;
  }
  async function closeComposer(){const c=composer;if(!c)return true;await drainComposer(c);if(c.dirty){toast('Правка осталась в редакторе. Исправь данные или экспортируй сохранённые пометки.');return false;}if(composer!==c)return false;composer=null;composerHost.replaceChildren();return true;}
  function appendAlgorithmFields(c,payload){
    c.controls.moves=field('Алгоритм · международная нотация',area(payload.algorithm?.moves||c.anchor.exact||'','tf-replacement'),c.node);
    c.controls.moves.spellcheck=false;c.controls.algorithmTitle=field('Название варианта',textInput(payload.algorithm?.title||''),c.node);
    const label=el('label','tf-review-inline-check'),input=el('input');input.type='checkbox';input.checked=Boolean(payload.algorithm?.preferred);label.append(input,document.createTextNode('Сделать основным алгоритмом урока'));c.controls.preferred=input;c.node.append(label);
    c.node.append(el('p','tf-review-help','Выбранный основной вариант будет первым при будущем подключении 3D. Варианты и исходное состояние останутся отдельными данными.'));
  }
  function appendRewrite(c,payload){
    c.node.append(el('p','tf-review-help','Редактируй текст как в документе. Выдели слово и нажми «Ссылка на урок», чтобы связать объяснения. Вставка из буфера очищается от разметки.'));
    const toolbar=el('div','tf-review-rich-toolbar'),editor=el('div','tf-review-rich-editor');editor.contentEditable='true';editor.setAttribute('role','textbox');editor.setAttribute('aria-label','Новая редакция урока');editor.setAttribute('aria-multiline','true');editor.append(sanitizeReviewHTML(document,payload.replacementHTML??c.lesson.sourceHTML,{knownLessonIds:new Set(getLessons().map(item=>item.id))}));
    c.controls.editor=editor;
    for(const [command,label]of [['bold','Жирный'],['italic','Курсив'],['insertUnorderedList','Список']]){
      const b=button(label);b.addEventListener('pointerdown',event=>event.preventDefault());b.addEventListener('click',()=>{editor.focus();document.execCommand?.(command,false,null);markDirty();});toolbar.append(b);
    }
    const link=button('Ссылка на урок');toolbar.append(link);c.node.append(toolbar,editor);
    const linkHost=el('div');linkHost.hidden=true;c.node.append(linkHost);let savedRange=null;
    link.addEventListener('pointerdown',event=>{event.preventDefault();const selection=win.getSelection();if(selection?.rangeCount&&editor.contains(selection.getRangeAt(0).commonAncestorContainer))savedRange=selection.getRangeAt(0).cloneRange();});
    link.addEventListener('click',()=>{if(!savedRange||savedRange.collapsed){toast('Сначала выдели слово или фразу в редакторе.');return;}linkHost.hidden=false;linkHost.replaceChildren();picker(linkHost,'',id=>{if(!id||!savedRange)return;const anchor=el('a');anchor.href='#view=item&id='+encodeURIComponent(id);anchor.dataset.tfLessonId=id;anchor.append(savedRange.extractContents());savedRange.insertNode(anchor);savedRange=null;linkHost.hidden=true;markDirty();});});
    editor.addEventListener('paste',event=>{event.preventDefault();const text=event.clipboardData?.getData('text/plain')||'';insertPlain(editor,text);markDirty();});
    editor.addEventListener('drop',event=>event.preventDefault());
    editor.addEventListener('click',event=>{if(event.target.closest('a'))event.preventDefault();});
  }
  function insertPlain(editor,text){const selection=win.getSelection();if(!selection?.rangeCount)return;const range=selection.getRangeAt(0);if(!editor.contains(range.commonAncestorContainer))return;range.deleteContents();const node=document.createTextNode(text);range.insertNode(node);range.setStartAfter(node);range.collapse(true);selection.removeAllRanges();selection.addRange(range);}
  function appendSolver(c,payload){
    const setup=payload.solverSetup||{},grid=el('div','tf-review-solver-fields');c.node.append(el('p','tf-review-help','Это подготовка урока к 3D, а не запуск решателя. Сохрани положение для распознавания, исходный случай и свой основной алгоритм. Без исходного случая постановка останется «Ожидает состояния». Проверка корректности будет отдельным шагом.'),grid);
    const add=(label,input,key,wide=false)=>{const wrapper=el('label',wide?'tf-wide':'',label);wrapper.append(input);grid.append(wrapper);c.controls[key]=input;return input;};
    add('Головоломка',selectChoices([['cube','Куб'],['pyramid','Пирамидка'],['dodecahedron','Мегаминкс'],['skewb','Скьюб'],['square1','Square-1'],['other','Другая']],setup.kind||'cube'),'kind');
    const size=el('input');size.type='number';size.min='2';size.max='50';size.value=String(setup.size||3);add('Размер',size,'size');
    add('Этап / случай',textInput(setup.stage||''),'stage',true);
    add('Как распознавать случай',area(setup.recognitionOrientation?.description||''),'orientation',true);
    const names={U:'Сверху · U',F:'Спереди · F',R:'Справа · R',D:'Снизу · D',L:'Слева · L',B:'Сзади · B'};
    for(const side of Object.keys(names))add(names[side],textInput(setup.recognitionOrientation?.[side]||'','Цвет / ориентир'),'side'+side);
    add('Исходный случай · описание или массив цветов',area(Array.isArray(setup.initialCase)?JSON.stringify(setup.initialCase):setup.initialCase||''),'initialCase',true);
    for(const [key,label]of [['theta','Камера · theta'],['phi','Камера · phi'],['distance','Камера · расстояние']]){const input=el('input');input.type='number';input.step='any';input.value=setup.cameraPose?.[key]??'';add(label,input,key);}
    const algorithm=setup.algorithms?.find(item=>item.id===setup.preferredAlgorithmId)||setup.algorithms?.[0];c.algorithmId=algorithm?.id||c.algorithmId;
    add('Основной алгоритм',area(algorithm?.moves||''),'solverMoves',true);c.controls.solverMoves.spellcheck=false;
    add('Название основного варианта',textInput(algorithm?.title||''),'solverTitle',true);
    add('Пояснение к будущему 3D',area(setup.notes||''),'solverNotes',true);
  }
  async function openComposer(action,{note=null,selected=selection,preferred=false}={}){
    if(!requireUnlocked())return;if(!await closeComposer())return;
    const lesson=note?store.getLesson(note.lessonId,note.sourceHash):selected?.lesson||context;
    if(!lesson){toast('Сначала открой урок.');return;}
    const anchor=note?clone(note.anchor):selected?.anchor?clone(selected.anchor):createDocumentAnchor();
    if(['mark-algorithm','mark-text','replace','remove','format','link'].includes(action)&&anchor.type!=='text'){toast('Сначала выдели нужный фрагмент в оригинале урока.');return;}
    if(!note&&['mark-algorithm','mark-text'].includes(action))note=store.listNotes(lesson.id).find(item=>['mark-algorithm','mark-text'].includes(item.action)&&item.sourceHash===lesson.sourceHash&&item.anchor.type==='text'&&item.anchor.start===anchor.start&&item.anchor.end===anchor.end&&item.anchor.exact===anchor.exact)||null;
    const payload=note?clone(note.payload):{};if(action==='mark-text')delete payload.algorithm;
    if(preferred)payload.algorithm={...(payload.algorithm||{}),moves:anchor.exact||'',preferred:true};
    setPanel(true);const node=el('section','tf-review-composer');node.dataset.tfReviewChrome='true';node.append(el('h3','',LABELS[action]||action),el('p','tf-review-path','Урок: '+lesson.title));
    const c={action,lesson,anchor,noteId:note?.id||null,originalPayload:payload,controls:{},node,dirty:note?note.action!==action||preferred:!['lesson-rewrite','solver-setup','link'].includes(action),error:null,editRevision:0,lastAttemptRevision:-1,
      algorithmId:payload.algorithm?.id||'lesson-'+(globalThis.crypto?.randomUUID?.()||Date.now().toString(36))};composer=c;composerHost.replaceChildren(node);
    if(anchor.type==='text')node.append(el('blockquote','',short(anchor.exact,550)));
    if(anchor.type==='image')node.append(el('p','tf-review-help','Область привязана к исходной схеме и сохраняется в относительных координатах.'));
    if(['replace','insert'].includes(action))c.controls.replacement=field('Новый текст',area(payload.replacementText??(action==='replace'?anchor.exact:''),'tf-replacement'),node);
    if(action==='insert'&&anchor.type==='text')c.controls.position=field('Место вставки',selectChoices([['before','Перед выделенным'],['after','После выделенного']],payload.position||'after'),node);
    if(action==='format')c.controls.format=field('Оформление',selectChoices([['strong','Жирный'],['em','Курсив'],['u','Подчёркнутый'],['h2','Заголовок'],['h3','Подзаголовок'],['p','Абзац'],['blockquote','Цитата'],['code','Моноширинный']],payload.format?.tag||'strong'),node);
    if(action==='link'){node.append(el('p','tf-review-help','В предпросмотре нажатие на выделенное слово откроет выбранный урок.'));const target=picker(node,payload.targetLessonId||'',markDirty);c.controls.targetLesson=target.list;}
    if(action==='mark-algorithm')appendAlgorithmFields(c,payload);
    if(action==='lesson-rewrite')appendRewrite(c,payload);
    if(action==='solver-setup')appendSolver(c,payload);
    c.controls.comment=field(action==='request-algorithm'?'Что должно быть удобнее / какой вариант нужен':'Комментарий (необязательно)',area(note?.comment||''),node);
    const readyLabel=el('label','tf-review-inline-check'),ready=el('input');ready.type='checkbox';ready.checked=note?.status==='ready';readyLabel.append(ready,document.createTextNode('Правка готова к переносу в библиотеку'));c.controls.ready=ready;node.append(readyLabel);
    const actions=el('div','tf-review-composer-actions');actions.append(button('Сохранить','save-composer','tf-primary'),button('Предпросмотр','composer-preview'),button('Закрыть','close-composer'));node.append(actions);
    c.state=el('p','tf-note-state',note?'Сохранено на устройстве':'Изменения сохраняются автоматически');c.state.setAttribute('role','status');node.append(c.state);
    node.addEventListener('input',markDirty);node.addEventListener('change',markDirty);
    clearSelection();win.getSelection()?.removeAllRanges();renderSummary();if(c.dirty)markDirty();node.scrollIntoView?.({block:'nearest'});
  }

  function queuePreview(){if(previewScheduled||disposed)return;previewScheduled=true;win.queueMicrotask(()=>{previewScheduled=false;if(disposed)return;try{applyPreview();}catch(error){failed(error);}});}
  function applyPreview({force=false}={}){
    if(!current||!context||!current.element?.isConnected)return;
    const notes=store.listNotes(current.id),key=context.sourceHash+'|'+String(preview)+'|'+notes.map(note=>`${note.id}:${note.revision}`).join(',');
    const result=renderPreview(document,context.sourceHTML,notes,{sanitize:options.sanitize,lessonId:current.id,sourceHash:context.sourceHash,knownLessonIds:new Set(getLessons().map(item=>item.id))});
    conflicts=result.conflicts;
    if(force||lastPreviewKey!==key){lastPreviewKey=key;
      if(preview||lastAppliedPreview||force){clearSelection();
        if(options.applyArticlePreview)options.applyArticlePreview({article:current,fragment:result.fragment,html:result.html,original:!preview});
        else if(preview)current.element.replaceChildren(document.importNode(result.fragment,true));
        else{const fragment=sanitizeReviewHTML(document,current.html||'',{knownLessonIds:new Set(getLessons().map(item=>item.id))});current.element.replaceChildren(fragment);}
      }
      lastAppliedPreview=preview;updateSurface();
    }
    if(panelOpen){renderSummary();renderNotes();}
  }
  async function setPreview(value){await drainComposer();if(composer?.dirty&&composer.error&&composer.error!==store.error)throw composer.error;preview=Boolean(value);cancelImage();clearSelection();applyPreview({force:true});}

  function cancelImage(){imageMode=false;if(imageDrag?.image?.hasPointerCapture?.(imageDrag.pointerId))try{imageDrag.image.releasePointerCapture(imageDrag.pointerId);}catch{}imageDrag=null;imageLayer?.remove();imageLayer=null;updateSurface();}
  function imagePosition(event,image){const box=image.getBoundingClientRect();return {x:Math.max(0,Math.min(1,(event.clientX-box.left)/Math.max(1,box.width))),y:Math.max(0,Math.min(1,(event.clientY-box.top)/Math.max(1,box.height)))};}
  function imageRect(){if(!imageDrag)return null;const {start,end}=imageDrag;return {x:Math.min(start.x,end.x),y:Math.min(start.y,end.y),width:Math.abs(start.x-end.x),height:Math.abs(start.y-end.y)};}
  function updateImageLayer(){if(!imageDrag||!imageLayer)return;const box=imageDrag.image.getBoundingClientRect(),rect=imageRect();Object.assign(imageLayer.style,{left:(box.left+rect.x*box.width)+'px',top:(box.top+rect.y*box.height)+'px',width:(rect.width*box.width)+'px',height:(rect.height*box.height)+'px'});}
  function pointerDown(event){
    if(!imageMode||!unlocked||!editing||preview||!context)return;
    if(imageDrag&&event.pointerId!==imageDrag.pointerId){cancelImage();return;}
    const image=event.target.closest?.('img');if(!image||!current?.element?.contains(image)||event.button>0)return;
    event.preventDefault();event.stopPropagation();const start=imagePosition(event,image);imageDrag={image,pointerId:event.pointerId,start,end:start,lesson:clone(context)};
    imageLayer=el('div','tf-review-image-layer');imageLayer.setAttribute('aria-hidden','true');document.body.append(imageLayer);try{image.setPointerCapture(event.pointerId);}catch{}updateImageLayer();
  }
  function pointerMove(event){if(!imageDrag||imageDrag.pointerId!==event.pointerId)return;event.preventDefault();imageDrag.end=imagePosition(event,imageDrag.image);updateImageLayer();}
  function pointerUp(event){
    if(!imageDrag||imageDrag.pointerId!==event.pointerId){captureSelection();return;}
    event.preventDefault();event.stopPropagation();const drag=imageDrag;drag.end=imagePosition(event,drag.image);const rect=imageRect();imageClickUntil=Date.now()+700;
    let anchor=null;try{if(rect.width>.005&&rect.height>.005)anchor=createImageAnchor(drag.image,rect,{root:current.element,normalized:true});}catch(error){failed(error);}cancelImage();renderSummary();
    if(anchor)safe(()=>openComposer('image-region',{selected:{anchor,lesson:drag.lesson}}));else toast('Проведи по схеме, чтобы выделить прямоугольную область.');
  }
  async function jumpToNote(note){
    if(current?.id!==note.lessonId){if(!await closeComposer())return;options.openLesson?.(note.lessonId);toast('Открыт урок с этой пометкой.');return;}
    if(preview)await setPreview(false);
    if(note.anchor.type==='text'){
      const {resolveTextAnchor,rangeForOffsets}=await import('./preview.mjs');const resolved=resolveTextAnchor(current.element,note.anchor);
      if(!resolved.ok){toast('Фрагмент изменился. Проверь привязку в пометке.');return;}
      const range=rangeForOffsets(current.element,resolved.start,resolved.end),selection=win.getSelection();selection.removeAllRanges();selection.addRange(range);range.startContainer.parentElement?.scrollIntoView?.({block:'center'});captureSelection();
    }else if(note.anchor.type==='image'){
      const index=note.anchor.index??note.anchor.imageIndex??0;current.element.querySelectorAll('img')[index]?.scrollIntoView?.({block:'center'});
    }else current.element.scrollIntoView?.({block:'start'});
  }
  async function exportReview(){
    if(!requireUnlocked())return null;await drainComposer();await saveSerial;
    if(composer?.dirty&&composer.error&&composer.error!==store.error){composer.controls.targetLesson?.focus();throw new Error('Заверши открытую правку перед экспортом: '+composer.error.message);}
    const text=store.exportReview({appVersion:options.appVersion}),name='TwistForge-Review-'+new Date().toISOString().slice(0,10)+'.json';
    if(options.exportFile)await options.exportFile(text,name);
    else{const url=win.URL.createObjectURL(new win.Blob([text],{type:'application/json'})),a=el('a');a.href=url;a.download=name;a.click();win.setTimeout(()=>win.URL.revokeObjectURL(url),1000);}
    report('Открыто сохранение единого файла пометок. Исходные уроки включены для точного переноса.');return text;
  }
  async function importReview(text){
    if(!requireUnlocked())return false;if(!await closeComposer())return false;
    try{const count=await store.importReview(text,{merge:true});toast(`Пакет прочитан. Пометок в файле: ${count}.`);queuePreview();return true;}catch(error){failed(error);return false;}
  }
  function importFile(){
    if(!requireUnlocked())return;
    if(win.RG2Platform?.post?.('import-review'))return;
    if(win.chrome?.webview?.postMessage){win.chrome.webview.postMessage({type:'import-review'});return;}
    importInput.value='';importInput.click();
  }
  function onClick(event){
    if(imageClickUntil>Date.now()&&event.target.closest?.('img')&&current?.element?.contains(event.target)){event.preventDefault();event.stopPropagation();return;}
    const target=event.target.closest?.('[data-tf-action]');if(target&&(panel.contains(target)||selectionBar.contains(target)||target===launcher)){
      event.preventDefault();event.stopPropagation();const action=target.dataset.tfAction;
      safe(async()=>{
        switch(action){
          case'toggle-panel':setPanel(!panelOpen);break;
          case'close-panel':if(await closeComposer())setPanel(false);break;
          case'tab-lesson':tab='lesson';renderSummary();renderNotes();break;
          case'tab-all':tab='all';renderSummary();renderNotes();break;
          case'clear-selection':clearSelection();break;
          case'more-selection':{
            if(!selection)return;const selected=selection;setPanel(true);
            const menu=el('div','tf-review-grid');menu.append(el('p','tf-review-help','Действие с выделенным фрагментом'));
            for(const [action,label]of [['insert','Вставить рядом'],['remove','Убрать фрагмент'],['format','Оформление'],['preferred-algorithm','Сделать основным']]){const item=button(label);item.addEventListener('click',()=>safe(()=>openComposer(action==='preferred-algorithm'?'mark-algorithm':action,{selected,preferred:action==='preferred-algorithm'})));menu.append(item);}
            composerHost.prepend(menu);clearSelection();break;
          }
          case'rewrite':await openComposer('lesson-rewrite',{selected:null});break;
          case'insert-end':await openComposer('insert',{selected:null});break;
          case'solver':await openComposer('solver-setup',{selected:null});break;
          case'image-mode':if(!current)return;if(preview)await setPreview(false);imageMode=!imageMode;clearSelection();updateSurface();renderSummary();if(imageMode)toast('Обведи область картинки мышью или пальцем.');break;
          case'preview-original':await setPreview(false);break;
          case'preview-result':await setPreview(true);break;
          case'view-lesson':await drainComposer();if(!composer?.dirty)setPanel(false);else if(composer.error)failed(composer.error);break;
          case'save-composer':await drainComposer(composer,{force:true});break;
          case'composer-preview':await setPreview(true);break;
          case'close-composer':await closeComposer();break;
          case'export':await exportReview();break;
          case'import':importFile();break;
          case'undo':if(await closeComposer())await store.undo();break;
          case'redo':if(await closeComposer())await store.redo();break;
          case'open-lesson':if(await closeComposer())options.openLesson?.(target.dataset.lessonId);break;
          case'edit-note':{const note=store.listNotes().find(note=>note.id===target.dataset.noteId);if(!note)break;if(current?.id!==note.lessonId){if(!await closeComposer())break;if(!options.openLesson){toast('Открой урок с этой пометкой, затем нажми «Изменить».');break;}pendingEditId=note.id;options.openLesson(note.lessonId);await refresh();}else await openComposer(note.action,{note});break;}
          case'jump-note':{const note=store.listNotes().find(note=>note.id===target.dataset.noteId);if(note)await jumpToNote(note);break;}
          case'delete-note':{if(composer?.noteId===target.dataset.noteId){composer=null;composerHost.replaceChildren();win.clearTimeout(saveTimer);}await saveSerial;await store.deleteNote(target.dataset.noteId);break;}
          default:if(Object.hasOwn(LABELS,action))await openComposer(action);break;
        }
      });return;
    }
    if(!editing||!unlocked||preview||!current?.element?.contains(event.target)||event.target.closest('button,.algorithm-actions,a'))return;
    const block=event.target.closest('.algorithm-code');if(block){const range=document.createRange();range.selectNodeContents(block);try{const anchor=createTextAnchor(current.element,range);showSelection({anchor,lesson:clone(context),range});}catch{}}
  }
  function onControl(event){
    if(event.target===modeInput){editing=modeInput.checked;if(!editing){clearSelection();cancelImage();}updateSurface();return;}
    if(event.target.dataset.tfControl==='reviewed'&&context)safe(()=>store.setLessonReviewed(context,event.target.checked));
  }
  async function refresh(){
    if(disposed)return;await store.ready;const token=++generation,article=getArticle();
    if(current?.id!==article?.id||current?.element!==article?.element){if(composer){const c=composer;await drainComposer(c);if(token!==generation||disposed)return;if(!c.dirty&&composer===c){composer=null;composerHost.replaceChildren();}}if(!composer)composerHost.replaceChildren();clearSelection();cancelImage();preview=false;conflicts=[];lastPreviewKey='';lastAppliedPreview=false;}
    current=article;context=null;
    if(article){try{const resolved=await createLessonContext({id:article.id,title:article.title,path:article.path||'',sourceHTML:article.html||'',version:options.appVersion});if(token!==generation||disposed)return;context=resolved;}catch(error){failed(error);}}
    if(token!==generation||disposed)return;updateSurface();if(panelOpen){renderSummary();renderNotes();}queuePreview();
    const number=document.querySelector('#app-version');gate.bindBuildNumber(number,number?.closest('section'));
    if(pendingEditId){const note=store.listNotes().find(item=>item.id===pendingEditId);pendingEditId=null;if(note&&note.lessonId===current?.id)await openComposer(note.action,{note});}
  }
  function handleBack(){
    if(imageMode||imageDrag){cancelImage();renderSummary();return true;}
    if(!selectionBar.hidden){clearSelection();return true;}
    if(composer){safe(()=>closeComposer());return true;}
    if(panelOpen){setPanel(false);return true;}
    if(editing){editing=false;updateSurface();return true;}return false;
  }
  function pause(){safe(()=>drainComposer());clearSelection();cancelImage();}
  function dispose(){if(disposed)return;safe(()=>drainComposer());disposed=true;win.clearTimeout(saveTimer);win.clearTimeout(toastTimer);cancelImage();gate.dispose();unsubscribe();for(const remove of listeners)remove();launcher.remove();panel.remove();selectionBar.remove();toastBox.remove();importInput.remove();document.body.classList.remove('tf-review-panel-open');delete document.documentElement.dataset.reviewMode;current?.element?.classList.remove('tf-review-surface','tf-review-image-mode');}
  const unsubscribe=store.subscribe(()=>{updateLauncher();if(panelOpen){renderSummary();renderNotes();}if(readyDone)queuePreview();if(store.error)failed(store.error);});
  listen(document,'click',onClick,true);listen(panel,'change',onControl);
  listen(selectionBar,'pointerdown',event=>{if(event.target.closest('button'))event.preventDefault();});
  listen(document,'selectionchange',captureSelection);listen(document,'keyup',captureSelection);
  listen(document,'pointerdown',pointerDown,true);listen(document,'pointermove',pointerMove,{capture:true,passive:false});listen(document,'pointerup',pointerUp,true);listen(document,'pointercancel',()=>{if(imageDrag){cancelImage();renderSummary();}},true);
  listen(document,'keydown',event=>{if(event.key==='Escape'&&handleBack()){event.preventDefault();event.stopImmediatePropagation();}},true);
  listen(document,'visibilitychange',()=>{if(document.visibilityState==='hidden')pause();});
  listen(win,'pagehide',pause);listen(win,'resize',()=>{if(imageDrag)updateImageLayer();});
  listen(importInput,'change',()=>safe(async()=>{const file=importInput.files?.[0];if(!file)return;if(file.size>8*1024*1024)throw new Error('Файл правок больше 8 МБ.');await importReview(await file.text());}));
  const ready=store.ready.then(async()=>{readyDone=true;updateLauncher();if(store.error)failed(store.error);await refresh();return true;});
  return {ready,refresh,handleBack,pause,dispose,exportReview,importReview,bindBuildNumber:(element,host)=>gate.bindBuildNumber(element,host),
    debug(){return {unlocked,editing,panelOpen,preview,currentLessonId:current?.id||null,contextReady:Boolean(context),notes:store.listNotes().length,conflicts:clone(conflicts),composer:composer?{action:composer.action,noteId:composer.noteId,dirty:composer.dirty,error:composer.error?.message||null}:null,selection:selection?.anchor||null,imageMode,dirty:store.dirty,gate:gate.debug()};}};
}
