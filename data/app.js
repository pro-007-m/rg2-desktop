(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon = (name, cls = '') => `<svg class="${esc(cls)}" aria-hidden="true"><use href="#i-${esc(name)}"/></svg>`;
  const read = (key, fallback) => { try { const value=localStorage.getItem(key); return value === null ? fallback : JSON.parse(value); } catch { return fallback; } };
  const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
  const APP_VERSION='1.5.0';
  const UPDATE_RELEASE_URL='https://github.com/pro-007-m/rg2-desktop/releases/latest';
  const UPDATE_STATUSES=new Set(['idle','checking','available','up-to-date','downloading','verifying','installing','cancelled','error']);
  const UPDATE_BUSY=new Set(['checking','downloading','verifying','installing']);
  let updateState={status:'idle',currentVersion:APP_VERSION,version:null,progress:null,message:'Нажмите «Проверить обновления».'};
  function hasNativeUpdater(){return typeof window.chrome?.webview?.postMessage==='function';}
  function updateVersion(value){return typeof value==='string'&&value.length<=32&&value.trim()===value&&/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(value);}
  function applyUpdateStatus(data){
    if(data?.type!=='update-status'||!UPDATE_STATUSES.has(data.status))return;
    updateState={status:data.status,currentVersion:updateVersion(data.currentVersion)?data.currentVersion:updateState.currentVersion,
      version:updateVersion(data.version)?data.version:null,
      progress:Number.isInteger(data.progress)?Math.min(100,Math.max(0,data.progress)):null,
      message:typeof data.message==='string'?data.message.slice(0,600):'Проверьте обновления ещё раз.'};
    refreshUpdateControls();
  }
  function refreshUpdateControls(){
    const native=hasNativeUpdater(),busy=UPDATE_BUSY.has(updateState.status),check=$('#update-check'),install=$('#update-install'),cancel=$('#update-cancel'),progress=$('#update-progress');
    if(check){check.hidden=!native;check.disabled=busy;}
    if(install){install.hidden=!native||updateState.status!=='available'||!updateState.version;install.disabled=busy;install.textContent=updateState.version?'Скачать и установить '+updateState.version:'Скачать и установить';}
    if(cancel){cancel.hidden=!native||!busy||updateState.status==='installing';cancel.disabled=updateState.status==='installing';}
    if(progress){progress.hidden=!native||updateState.status!=='downloading'||updateState.progress===null;if(updateState.progress!==null)progress.value=updateState.progress;}
    const status=$('#update-status');if(status)status.textContent=native?updateState.message:'Проверка и установка обновлений доступны в приложении Windows. В браузере откройте страницу выпусков.';
    const version=$('#update-current-version');if(version)version.textContent='Установлена версия '+updateState.currentVersion;
    const appVersion=$('#app-version');if(appVersion)appVersion.textContent='RG2 · Desktop '+updateState.currentVersion;
  }
  function requestUpdate(action){
    if(!hasNativeUpdater())return;
    if(action==='update-check'&&!UPDATE_BUSY.has(updateState.status))updateState={...updateState,status:'checking',version:null,progress:null,message:'Проверяю новый выпуск…'};
    else if(action==='update-install'&&updateState.status==='available'&&updateState.version)updateState={...updateState,status:'downloading',progress:0,message:'Загружаю установщик…'};
    else if(action==='update-cancel'&&UPDATE_BUSY.has(updateState.status)&&updateState.status!=='installing')updateState={...updateState,message:'Отменяю обновление…'};
    else return;
    refreshUpdateControls();
    try{window.chrome.webview.postMessage({type:action});}
    catch{updateState={...updateState,status:'error',progress:null,message:'Не удалось запустить обновление. Перезапустите приложение или откройте страницу выпусков.'};refreshUpdateControls();}
  }
  function updateControls(){
    return `<section class="settings-block app-updates" aria-labelledby="updates-heading"><h2 id="updates-heading">Обновления</h2><p id="update-current-version">Установлена версия ${esc(updateState.currentVersion)}</p><div class="app-update-actions"><button type="button" class="action-button" id="update-check">Проверить обновления</button><button type="button" class="action-button update-install" id="update-install" hidden>Скачать и установить</button><button type="button" class="action-button" id="update-cancel" hidden>Отменить</button></div><progress id="update-progress" max="100" value="0" aria-label="Загрузка обновления" hidden></progress><p class="app-update-status" id="update-status" role="status" aria-live="polite"></p><a class="app-release-link" href="${UPDATE_RELEASE_URL}" target="_blank" rel="noopener noreferrer">Открыть страницу выпусков ${icon('arrow')}</a></section>`;
  }
  const MODEL_IMAGE_KEY='rg2.model.image.v1';
  const MODEL_IMAGE_FIELDS={
    contrast:{label:'Контраст',min:70,max:150,step:1,default:100},
    saturation:{label:'Насыщенность',min:0,max:180,step:1,default:100},
    brightness:{label:'Яркость',min:70,max:130,step:1,default:100},
    gamma:{label:'Гамма',min:.7,max:1.3,step:.01,default:1},
    sharpness:{label:'Резкость',min:0,max:100,step:1,default:0},
    glow:{label:'Сила свечения',min:0,max:100,step:1,default:40}
  };
  const MODEL_IMAGE_DEFAULTS=Object.fromEntries(Object.entries(MODEL_IMAGE_FIELDS).map(([key,field])=>[key,field.default]));
  function normalizeModelImageSettings(value,base=MODEL_IMAGE_DEFAULTS) {
    const input=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
    return Object.fromEntries(Object.entries(MODEL_IMAGE_FIELDS).map(([key,field])=>{
      const candidate=Object.prototype.hasOwnProperty.call(input,key)?input[key]:base[key];
      const valid=typeof candidate==='number'&&Number.isFinite(candidate)?Math.min(field.max,Math.max(field.min,candidate)):base[key];
      return [key,key==='gamma'?Math.round(valid*100)/100:Math.round(valid)];
    }));
  }
  let modelImageSettings=normalizeModelImageSettings(read(MODEL_IMAGE_KEY,{}));
  write(MODEL_IMAGE_KEY,modelImageSettings);
  let catalog = null, trainerData = null, route = null, toolDisposer = null, toastTimer = null, searchTimer = null;
  let historyIndex = 0, historyMax = 0, nativeDark, searchIndex = [], bootError = null;
  let favorites = new Set(read('rg2.favorites', []));
  let readerSize = read('rg2.readerSize', 'normal');
  let focusedAlgorithms = read('rg2.focusedAlgorithms', {});
  if (!focusedAlgorithms || typeof focusedAlgorithms !== 'object' || Array.isArray(focusedAlgorithms)) focusedAlgorithms = {};
  let preference; try { preference=localStorage.getItem('rg2.theme') || 'system'; } catch { preference='system'; }
  if (!['system','atelier','graphite'].includes(preference)) preference='system';
  let modelNeon=read('rg2.model.neon',false)===true;
  const systemTheme = matchMedia('(prefers-color-scheme: dark)');
  const phases = new Map(), items = new Map(), parents = new Map(), categories = [], extraItems = [];
  let resolveReady; const ready = new Promise(resolve => {resolveReady=resolve;});
  const fallbackIcon = 'assets/images/main3x3/main_2.png';
  const toolDefinitions = [
    {id:'timer', title:'Таймер', icon:'assets/images/trainers/timer.png', description:'Время сборок и результаты.'},
    {id:'scramble', title:'Генератор скрамблов', icon:'assets/images/trainers/scramble_gen.png', description:'Новая последовательность для перемешивания.'},
    {id:'pll', title:'PLL тренажер', icon:'assets/images/trainers/pll_trainer.png', description:'Распознавание PLL по сторонам кубика.'},
    {id:'alphabet', title:'Тренажер азбуки', icon:'assets/images/trainers/azbuka_trainer.png', description:'Буквы элементов для слепой сборки.'},
    {id:'cfop-solver', title:'Решатель CFOP + COLL', icon:'assets/images/main3x3/main_2.png', description:'Раскрась куб и собери его по этапам с выбором алгоритмов и 3D.'}
  ];
  function normalizeTool(id) { return ({azbuka:'alphabet',plltest:'pll',scrmbl:'scramble',scrambler:'scramble'})[String(id).toLowerCase()] || String(id).toLowerCase(); }
  function orderedTools() {
    const original=phases.get(catalog?.toolsPhase || 'GAMES')?.items.filter(item=>item.kind==='tool') || [];
    const ordered=original.length?original.map(item=>{
      const id=normalizeTool(item.tool || item.id),base=toolDefinitions.find(tool=>tool.id===id);
      return {...base,id,title:item.title,icon:item.icon || base?.icon};
    }):[...toolDefinitions];
    for(const tool of toolDefinitions)if(!ordered.some(item=>item.id===tool.id))ordered.push(tool);
    return ordered;
  }
  function applyModelNeon(resolved=document.documentElement.dataset.theme) {
    const available=resolved==='graphite';
    document.documentElement.dataset.modelNeon=modelNeon&&available?'on':'off';
    const row=$('#model-neon-setting');if(row)row.hidden=!available;
    const toggle=$('#model-neon-toggle');if(toggle){toggle.checked=modelNeon;toggle.disabled=!available;}
    applyModelImageSettings(resolved);
  }
  function modelImageValue(key,value) {return key==='gamma'?value.toFixed(2).replace('.',','):value+'%';}
  function applyModelImageSettings(resolved=document.documentElement.dataset.theme) {
    const encoded=JSON.stringify(modelImageSettings);
    if(document.documentElement.dataset.modelImage!==encoded)document.documentElement.dataset.modelImage=encoded;
    for(const [key,field] of Object.entries(MODEL_IMAGE_FIELDS)) {
      const input=$('#model-image-'+key),output=$('#model-image-'+key+'-value');
      if(input){input.value=String(modelImageSettings[key]);input.setAttribute('aria-valuetext',modelImageValue(key,modelImageSettings[key]));}
      if(output)output.textContent=modelImageValue(key,modelImageSettings[key]);
    }
    const glowAvailable=resolved==='graphite'&&modelNeon,row=$('[data-model-image-row="glow"]'),input=$('#model-image-glow');
    if(row)row.hidden=!glowAvailable;
    if(input)input.disabled=!glowAvailable;
  }
  function setModelImageSettings(partial) {
    modelImageSettings=normalizeModelImageSettings(partial,modelImageSettings);
    write(MODEL_IMAGE_KEY,modelImageSettings);applyModelImageSettings();
    return {...modelImageSettings};
  }
  function resetModelImageSettings() {
    modelImageSettings={...MODEL_IMAGE_DEFAULTS};modelNeon=false;
    write(MODEL_IMAGE_KEY,modelImageSettings);write('rg2.model.neon',false);applyModelNeon();
  }
  function setModelNeon(value) {
    if(typeof value!=='boolean')return;
    modelNeon=value;write('rg2.model.neon',value);applyModelNeon();
  }
  function applyTheme() {
    const dark = nativeDark === undefined ? systemTheme.matches : nativeDark;
    const resolved = preference === 'system' ? (dark ? 'graphite' : 'atelier') : preference;
    document.documentElement.dataset.theme = resolved;
    applyModelNeon(resolved);
    document.documentElement.style.colorScheme = resolved === 'graphite' ? 'dark' : 'light';
    try { window.chrome?.webview?.postMessage({type:'theme', preference, resolved}); } catch {}
    document.querySelectorAll('input[name="theme"]').forEach(input => {input.checked=input.value===preference;});
    const status=$('#theme-status'); if(status) status.innerHTML=`${icon(resolved==='graphite'?'moon':'sun')} Сейчас: ${resolved==='graphite'?'Graphite':'Atelier'}`;
    return resolved;
  }
  function setTheme(value) {
    if(!['system','atelier','graphite'].includes(value)) return;
    preference=value; try {localStorage.setItem('rg2.theme',value);} catch {}
    applyTheme();
  }
  systemTheme.addEventListener('change', () => {nativeDark=undefined;applyTheme();});
  try {window.chrome?.webview?.addEventListener('message', event => {if(event.data?.type==='system-theme' && typeof event.data.dark==='boolean'){nativeDark=event.data.dark;applyTheme();}else if(event.data?.type==='update-status')applyUpdateStatus(event.data);});} catch {}
  applyTheme();

  function plain(html) {
    const textarea=document.createElement('textarea');
    textarea.innerHTML=String(html || '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<[^>]+>/g,' ');
    return textarea.value.replace(/\s+/g,' ').trim();
  }
  const norm=value=>String(value || '').toLocaleLowerCase('ru').replace(/ё/g,'е');
  function asset(path) {
    const clean=String(path || '').replace(/^\.\//,'').replace(/^\//,'');
    return /^assets\/[a-zA-Z0-9_./\- ()]+$/.test(clean) && !clean.split('/').includes('..') ? clean : fallbackIcon;
  }
  function isFavorites(value) { return /FAVOU?RITES|ИЗБРАН/i.test(String(value)); }
  function isAboutItem(item) { return /^ABOUT(?:[-_]|$)/i.test(item?.id || ''); }
  function resolvePhase(value) {
    const id=String(value || '');if(phases.has(id))return id;
    const alias=catalog?.phaseAliases?.[id] || catalog?.phaseAliases?.[id.toUpperCase()];
    if(typeof alias==='string')return alias;
    return [...phases.keys()].find(key=>key.toUpperCase()===id.toUpperCase()) || id;
  }
  function indexCatalog(data) {
    (data.categories || []).forEach((category,index) => categories.push({...category, index}));
    (data.phases || []).forEach(phase => {
      const phaseId=String(phase.id); const normalized={...phase,id:phaseId,items:[]};
      (phase.items || []).forEach((item,index) => {
        const itemId=String(item.id ?? `${phaseId}-${index}`);
        const normalizedItem={...item,id:itemId,index:item.index ?? index,phaseId,kind:item.kind || (item.target_phase?'submenu':'article')};
        normalized.items.push(normalizedItem); items.set(itemId,normalizedItem);
      });
      phases.set(phaseId,normalized);
    });
    // Breadth-first traversal gives a stable original path, including phases reached in more than one place.
    const queue=[]; const seen=new Set();
    categories.forEach(category => {if(category.target_phase && !isFavorites(category.target_phase)){const id=String(category.target_phase);parents.set(id,{category});queue.push(id);}});
    while(queue.length){const id=queue.shift();if(seen.has(id))continue;seen.add(id);const phase=phases.get(id);if(!phase)continue;phase.items.forEach(item=>{if(item.kind==='submenu' && item.target_phase){const target=String(item.target_phase);if(!parents.has(target))parents.set(target,{phaseId:id,itemId:item.id,title:item.title});if(!seen.has(target))queue.push(target);}});}
    (data.extraPages || []).forEach((entry,index) => {
      const item={...entry,id:String(entry.id ?? `extra-${index}`),index:entry.index ?? index,kind:entry.kind || 'article',phaseId:entry.phaseId || '__EXTRAS__',title:entry.title || `Материал ${index+1}`};
      extraItems.push(item);if(!items.has(item.id))items.set(item.id,item);
    });
    searchIndex=[...items.values()].map(item=>({item,title:norm(item.title),text:plain(item.html),path:(isAboutItem(item)?[{title:'Настройки'},{title:'О программе и авторах'}]:phaseTrail(item.phaseId)).map(p=>p.title).join(' / ')}));
    searchIndex.forEach(entry=>{entry.normalizedText=norm(entry.text);});
  }
  function phaseTrail(phaseId) {
    if(phaseId==='__EXTRAS__') return [{title:'Дополнительные материалы',route:{type:'extras'}}];
    const result=[],seen=new Set();let id=String(phaseId);
    while(id && !seen.has(id)){
      seen.add(id);const parent=parents.get(id);const phase=phases.get(id);
      if(parent?.category){result.unshift({title:parent.category.title,route:{type:'phase',id}});break;}
      result.unshift({title:parent?.title || phase?.title || id,route:{type:'phase',id}});
      id=parent?.phaseId;
    }
    return result;
  }
  function categoryForPhase(phaseId) {
    const trail=phaseTrail(phaseId);return trail.length?trail[0].route?.id:null;
  }
  function normalizeRoute(value) {
    const result=typeof value==='string'?{type:'phase',id:value}:{...value};
    if(result.type==='article')result.type='item';
    if(result.type==='tool')result.id=normalizeTool(result.id);
    if(result.type==='phase' && isFavorites(result.id))return {type:'favorites'};
    if(result.type==='phase')result.id=resolvePhase(result.id);
    if(result.id!==undefined)result.id=String(result.id);
    if(!['phase','item','favorites','tools','tool','notation','search','settings','extras'].includes(result.type))return defaultRoute();
    return result;
  }
  function defaultRoute() {
    if(catalog?.defaultPhase && phases.has(catalog.defaultPhase))return {type:'phase',id:catalog.defaultPhase};
    const category=categories.find(c=>/3[XХ×]3/i.test(c.title)) || categories.find(c=>!isFavorites(c.target_phase));
    return {type:'phase',id:String(category?.target_phase || 'MAIN3X3')};
  }
  function hashFor(value) {
    const params=new URLSearchParams({view:value.type});
    for(const key of ['id','q','scramble'])if(value[key]!==undefined)params.set(key,String(value[key]));
    return '#'+params.toString();
  }
  function routeFromHash() {
    const params=new URLSearchParams(location.hash.slice(1));if(!params.has('view'))return null;
    const result={type:params.get('view')};for(const key of ['id','q','scramble'])if(params.has(key))result[key]=params.get(key);return result;
  }
  function navigate(value,{replace=false,restoreScroll=false}={}) {
    if(!catalog)return;const next=normalizeRoute(value);
    if(route && JSON.stringify(route)===JSON.stringify(next)){if(!restoreScroll)$('#workspace').scrollTop=0;return;}
    route=next;
    if(!replace){historyIndex++;historyMax=historyIndex;}
    history[replace?'replaceState':'pushState']({rg2:true,route,index:historyIndex},'',hashFor(route));
    write('rg2.lastRoute',route);render();
    $('#sidebar').classList.remove('expanded');
    if(!restoreScroll)$('#workspace').scrollTop=0;
  }
  function openItem(id) {
    const item=items.get(String(id));if(!item){toast('Материал не найден.');return;}
    if(item.kind==='submenu' && item.target_phase)navigate({type:'phase',id:item.target_phase});
    else if(item.kind==='tool')navigate({type:'tool',id:normalizeTool(item.tool || item.target_phase || item.id)});
    else navigate({type:'item',id:item.id});
  }
  function toast(message) {clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').classList.add('visible');toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),2600);}
  function setBreadcrumbs(crumbs) {
    const nodes=[{title:'Обучалки',route:defaultRoute()},...crumbs];
    // Deep source trees remain reachable while leaving room for the current page title.
    const visible=nodes.length>5?[nodes[0],{title:'…'},...nodes.slice(-3)]:nodes;
    $('#breadcrumbs').innerHTML=visible.map((crumb,index)=>(index?icon('chevron'):'')+(index===visible.length-1?`<span class="crumb-current" title="${esc(crumb.title)}">${esc(crumb.title)}</span>`:crumb.route?`<button data-route="${esc(JSON.stringify(crumb.route))}" title="${esc(crumb.title)}">${esc(crumb.title)}</button>`:`<span class="crumb-ellipsis">${esc(crumb.title)}</span>`)).join('');
  }
  function navIcon(category,index) {
    if(isFavorites(category.target_phase))return 'star';
    if(/Больши/i.test(category.title))return 'layers';
    if(/Скьюб/i.test(category.title))return 'puzzle';
    if(/Модиф|Другие/i.test(category.title))return 'diamond';
    return 'cube';
  }
  function renderNavigation() {
    const additionalItems=extraItems.filter(item=>!isAboutItem(item));
    let selectedPhase=null;
    if(route.type==='phase')selectedPhase=categoryForPhase(route.id);
    if(route.type==='item')selectedPhase=categoryForPhase(items.get(route.id)?.phaseId);
    $('#category-nav').innerHTML=categories.map((category,index)=>{
      const favorite=isFavorites(category.target_phase);
      const active=favorite?route.type==='favorites':selectedPhase===String(category.target_phase);
      const destination=favorite?{type:'favorites'}:{type:'phase',id:category.target_phase};
      return `<button class="nav-button ${active?'active':''}" data-route="${esc(JSON.stringify(destination))}" title="${esc(category.title)}" ${active?'aria-current="page"':''}>${icon(navIcon(category,index))}<span>${esc(category.title)}</span>${favorite && favorites.size?`<span class="nav-count">${favorites.size}</span>`:active?icon('chevron','nav-chevron'):''}</button>`;
    }).join('');
    $('#utility-nav').innerHTML=`${!categories.some(category=>isFavorites(category.target_phase))?`<button class="nav-button ${route.type==='favorites'?'active':''}" data-route="${esc(JSON.stringify({type:'favorites'}))}" title="Избранное">${icon('star')}<span>Избранное</span>${favorites.size?`<span class="nav-count">${favorites.size}</span>`:''}</button>`:''}<button class="nav-button ${['tools','tool'].includes(route.type)?'active':''}" data-route="${esc(JSON.stringify({type:'tools'}))}" title="Тренажеры">${icon('timer')}<span>Тренажеры</span></button>${additionalItems.length?`<button class="nav-button ${route.type==='extras' || (route.type==='item' && items.get(route.id)?.phaseId==='__EXTRAS__' && !isAboutItem(items.get(route.id)))?'active':''}" data-route="${esc(JSON.stringify({type:'extras'}))}" title="Дополнительные материалы">${icon('book')}<span>Дополнительные материалы</span></button>`:''}`;
    $('#settings-button').classList.toggle('active',route.type==='settings' || (route.type==='item' && isAboutItem(items.get(route.id))));
    if(trainerData?.notation?.length)$('#utility-nav').insertAdjacentHTML('beforeend',`<button class="nav-button ${route.type==='notation'?'active':''}" data-route="${esc(JSON.stringify({type:'notation'}))}" title="Азбука вращений">${icon('cube')}<span>Азбука вращений</span></button>`);
    $('#history-back').disabled=historyIndex<=0;$('#history-forward').disabled=historyIndex>=historyMax;
  }
  function hero(title,subtitle,image,eyebrow='Библиотека алгоритмов') {
    return `<section class="hero"><div class="hero-copy"><div class="eyebrow">${esc(eyebrow)}</div><h1>${esc(title)}</h1>${subtitle?`<p>${esc(subtitle)}</p>`:''}</div>${image?`<div class="hero-art"><img src="${esc(asset(image))}" alt=""></div>`:''}</section>`;
  }
  function card(item,index,{intro=false,description}={}) {
    const saved=favorites.has(item.id);
    return `<article class="menu-card ${intro?'intro-card':''}"><button class="menu-open" data-open-item="${esc(item.id)}"><span class="menu-image">${item.icon?`<img src="${esc(asset(item.icon))}" alt="" loading="lazy">`:icon(item.kind==='submenu'?'cube':'book')}</span><span class="menu-copy"><span class="menu-index">${String(index+1).padStart(2,'0')}</span><h3 class="menu-title">${esc(item.title)}</h3>${description?`<p class="menu-description">${esc(description)}</p>`:''}</span>${icon('arrow','menu-arrow')}</button><button class="card-favorite" data-favorite="${esc(item.id)}" aria-label="${saved?'Убрать из избранного':'В избранное'}: ${esc(item.title)}" aria-pressed="${saved}" title="${saved?'Убрать из избранного':'В избранное'}">${icon('star')}</button></article>`;
  }
  function collectionFooter() {return `<div class="collection-footer"><span class="footer-text">${icon('book')} Схемы, алгоритмы и обучалки RG2.</span><span class="footer-mark">learn. solve. repeat.</span></div>`;}
  function phaseName(phase) {return phases.get(phase.id)?.title || phaseTrail(phase.id).slice(-1)[0]?.title || phase.id;}
  function renderPhase() {
    const phase=phases.get(route.id);if(!phase){renderMissing();return;}
    const title=phaseName(phase);setBreadcrumbs(phaseTrail(phase.id));
    const main3=/^MAIN_?3X3$/i.test(phase.id);const rootPhase=parents.get(phase.id)?.category;
    const image=phase.items.find(item=>item.icon && (!main3 || item.index===1))?.icon;
    const sub=main3?'От первой сборки до скоростных методов.':rootPhase?'Выберите головоломку или методику сборки.':'';
    const titleToShow=main3?'Кубик 3×3':/^MAIN_?2X2$/i.test(phase.id)?'Кубик 2×2':title;
    $('#content').innerHTML=hero(titleToShow,sub,image,rootPhase?'Алгоритмы сборки для куба':'Обучалка')+`<div class="section-heading"><h2>${rootPhase?'Выберите раздел':'В этом разделе'}</h2><span>${String(phase.items.length).padStart(2,'0')} / ${phase.items.length===1?'МАТЕРИАЛ':'МАТЕРИАЛЫ'}</span></div><div class="menu-grid">${phase.items.map((item,index)=>card(item,index,{intro:main3 && index===0,description:main3 && index===0?'Устройство, Алгоритмы и Язык вращений кубика.':null})).join('')}</div>`+(phase.items.length?collectionFooter():emptyState('Раздел пока пуст','Выберите другой раздел в меню.'));
  }
  function emptyState(title,message,action='') {return `<div class="empty-state">${icon('book')}<h2>${esc(title)}</h2><p>${esc(message)}</p>${action}</div>`;}
  function renderMissing() {
    setBreadcrumbs([{title:'Материал не найден'}]);
    $('#content').innerHTML=`<div class="page-heading"><h1 class="page-title">Материал не найден</h1></div>`+emptyState('Вернёмся к обучалкам','Этот материал сейчас недоступен. Другие разделы можно открыть в меню.',`<button class="action-button" data-route="${esc(JSON.stringify(defaultRoute()))}">${icon('back')} К обучалкам</button>`);
  }
  function renderFavorites() {
    setBreadcrumbs([{title:'Избранное'}]);const saved=[...favorites].map(id=>items.get(id)).filter(Boolean);
    $('#content').innerHTML=hero('Избранное','Любимые обучалки и алгоритмы — всегда под рукой.','assets/images/main3x3/main_4.png','Личная библиотека')+(saved.length?`<div class="section-heading"><h2>Сохранённые материалы</h2><span>${saved.length}</span></div><div class="menu-grid">${saved.map((item,index)=>card(item,index)).join('')}</div>`:emptyState('Сохраните первый алгоритм','Нажмите на звёздочку у обучалки или статьи. Сохранённые материалы появятся здесь.',`<button class="action-button" data-route="${esc(JSON.stringify(defaultRoute()))}">Открыть обучалки ${icon('arrow')}</button>`));
  }
  function renderExtras() {
    setBreadcrumbs([{title:'Дополнительные материалы'}]);
    $('#content').innerHTML=hero('Дополнительные материалы','Ещё больше схем, пояснений и алгоритмов RG2.',null,'Библиотека')+`<div class="section-heading"><h2>Все материалы</h2><span>${extraItems.length}</span></div><div class="menu-grid">${extraItems.map((item,index)=>card(item,index)).join('')}</div>`;
  }
  function normalizeInternalLink(value) {
    try {
      const url=new URL(value);
      if(url.protocol==='rg2:' && url.hostname.toLowerCase()==='ytplay'){
        const video=url.searchParams.get('link') || '';
        if(!/^[\w-]{11}$/.test(video))return null;
        const time=url.searchParams.get('time') || '0';let seconds=0;
        if(time.includes(':')) seconds=time.split(':').reduce((acc,part)=>acc*60+(Number(part)||0),0);
        else if(/^\d+$/.test(time))seconds=Number(time);
        else {const m=time.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);seconds=(Number(m?.[1])||0)*3600+(Number(m?.[2])||0)*60+(Number(m?.[3])||0);}
        return {external:`https://www.youtube.com/watch?v=${video}${seconds>0?'&t='+Math.floor(seconds)+'s':''}`,video:true};
      }
      if(url.protocol==='rg2:')return {internal:value};
      if(['http:','https:'].includes(url.protocol))return {external:url.href};
    } catch {}
    return null;
  }
  function sanitizeArticle(source) {
    const parsed=new DOMParser().parseFromString(String(source || ''),'text/html');
    const allowed=new Set(['P','B','STRONG','I','EM','A','IMG','BR','SPAN','DIV','TABLE','TBODY','THEAD','TFOOT','TR','TH','TD','UL','OL','LI','BLOCKQUOTE','H1','H2','H3','H4','H5','H6','HR','PRE','CODE','SMALL','SUB','SUP','S','DEL','U','CENTER','FONT']);
    parsed.querySelectorAll('script,style,iframe,object,embed,form,meta,link,base,svg,math,input,button,textarea,select,video,audio').forEach(el=>el.remove());
    [...parsed.body.querySelectorAll('*')].forEach(el=>{
      if(!allowed.has(el.tagName)){el.replaceWith(...el.childNodes);return;}
      const oldSrc=el.getAttribute('src'),oldHref=el.getAttribute('href');
      const oldStyle=el.getAttribute('style') || '';
      const widths={width:el.getAttribute('width'),height:el.getAttribute('height'),colspan:el.getAttribute('colspan'),rowspan:el.getAttribute('rowspan')};
      [...el.attributes].forEach(attribute=>el.removeAttribute(attribute.name));
      if(el.tagName==='IMG'){
        const safe=String(oldSrc || '').replace(/^\.\//,'').replace(/^\//,'');
        if(!safe.startsWith('assets/') || safe.split('/').includes('..') || /["'<>\\]/.test(safe)) {el.replaceWith(parsed.createTextNode(''));return;}
        el.setAttribute('src',safe);el.setAttribute('alt','Схема сборки');el.setAttribute('loading','lazy');el.setAttribute('data-zoom','');el.setAttribute('tabindex','0');
        if(/^\d{1,4}$/.test(widths.width || ''))el.setAttribute('width',widths.width);
      }
      if(['TD','TH'].includes(el.tagName))for(const key of ['colspan','rowspan'])if(/^\d{1,2}$/.test(widths[key] || ''))el.setAttribute(key,widths[key]);
      const alignment=oldStyle.match(/text-align\s*:\s*(left|right|center|justify)/i);if(alignment)el.style.textAlign=alignment[1];
      if(el.tagName==='CENTER')el.style.textAlign='center';
      if(el.tagName==='A' && oldHref){
        if(oldHref.startsWith('#')){el.setAttribute('href',oldHref);return;}
        const link=normalizeInternalLink(oldHref);
        if(link?.external){el.setAttribute('href',link.external);el.setAttribute('target','_blank');el.setAttribute('rel','noopener noreferrer');if(link.video)el.setAttribute('data-video','true');}
        else if(link?.internal){el.setAttribute('href',link.internal);el.setAttribute('data-rg2-link',link.internal);}
        else el.replaceWith(...el.childNodes);
      }
    });
    return document.importNode(parsed.body,true);
  }
  function prepareArticle(container,html) {
    const content=sanitizeArticle(html);while(content.firstChild)container.appendChild(content.firstChild);
    window.RG2Algorithms.prepare(container,{icon});
    container.dataset.algorithmFocusKey=`${route?.type || 'item'}:${route?.id || ''}`;
    applyAlgorithmFocus(container);
  }
  function applyAlgorithmFocus(container) {
    const blocks=[...container.querySelectorAll('.algorithm-block')];
    const saved=focusedAlgorithms[container.dataset.algorithmFocusKey];
    let selected=saved?blocks.find(block=>block.querySelector('[data-focus-algorithm]')?.dataset.focusAlgorithm===saved.id && block.querySelector('[data-copy-algorithm]')?.dataset.copyAlgorithm===saved.formula):null;
    if(!selected && saved)selected=blocks.find(block=>block.querySelector('[data-copy-algorithm]')?.dataset.copyAlgorithm===saved.formula);
    container.classList.toggle('has-focused-algorithm',Boolean(selected));
    blocks.forEach(block=>{
      const active=block===selected,button=block.querySelector('[data-focus-algorithm]');
      block.classList.toggle('is-focused',active);
      if(!button)return;
      button.setAttribute('aria-pressed',String(active));
      button.setAttribute('aria-label',active?'Снять выделение алгоритма':'Выделить алгоритм');
      button.title=active?'Снять выделение алгоритма':'Выделить алгоритм';
      button.innerHTML=icon(active?'check':'focus')+`<span>${active?'Выделен':'Выделить'}</span>`;
    });
  }
  function toggleAlgorithmFocus(button) {
    const container=button.closest('.article-body'),block=button.closest('.algorithm-block');
    if(!container || !block)return;
    const key=container.dataset.algorithmFocusKey;
    if(block.classList.contains('is-focused'))delete focusedAlgorithms[key];
    else focusedAlgorithms[key]={id:button.dataset.focusAlgorithm,formula:block.querySelector('[data-copy-algorithm]')?.dataset.copyAlgorithm || ''};
    write('rg2.focusedAlgorithms',focusedAlgorithms);
    applyAlgorithmFocus(container);
    if(block.classList.contains('is-focused'))block.scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  }
  function videoLink(item) {
    const id=item.videoId || item.source_videoId || item.source_video_id;
    return typeof id==='string' && /^[\w-]{11}$/.test(id)?`https://www.youtube.com/watch?v=${id}`:null;
  }
  function renderArticle() {
    const item=items.get(route.id);if(!item){renderMissing();return;}
    const trail=isAboutItem(item)?[{title:'Настройки',route:{type:'settings'}}]:phaseTrail(item.phaseId);setBreadcrumbs([...trail,{title:item.title}]);
    const backRoute=isAboutItem(item)?{type:'settings'}:item.phaseId==='__EXTRAS__'?{type:'extras'}:{type:'phase',id:item.phaseId};
    const saved=favorites.has(item.id),video=videoLink(item);
    $('#content').innerHTML=`<div class="article-layout"><button class="back-link" data-route="${esc(JSON.stringify(backRoute))}">${icon('back')} ${esc(trail.slice(-1)[0]?.title || 'К разделу')}</button><header class="page-heading article-heading"><div><div class="eyebrow">${esc(trail.slice(-1)[0]?.title || 'Обучалка')}</div><h1 class="page-title">${esc(item.title)}</h1></div><div class="article-actions"><div class="page-size-controls" aria-label="Размер текста"><button class="icon-button" data-reader="small" title="Мелкий текст" aria-label="Мелкий текст">A−</button><button class="icon-button" data-reader="normal" title="Обычный текст" aria-label="Обычный текст">A</button><button class="icon-button" data-reader="large" title="Крупный текст" aria-label="Крупный текст">A+</button></div><button class="action-button ${saved?'saved':''}" data-favorite="${esc(item.id)}" aria-pressed="${saved}">${icon(saved?'check':'star')}<span>${saved?'В избранном':'В избранное'}</span></button></div></header>${video?`<div class="article-video"><a class="action-button" href="${esc(video)}" target="_blank" rel="noopener noreferrer">${icon('play')} Открыть видеоурок ${icon('arrow')}</a></div>`:''}<article class="article-body reader-${esc(readerSize)}" id="article-body"></article><div id="article-pagination"></div><div class="article-source">${icon('book')} Материалы RG2 · RubicsGuide</div></div>`;
    if(item.html)prepareArticle($('#article-body'),item.html);
    else $('#article-body').innerHTML=`<p>${video?'К этому разделу доступен видеоурок. Откройте его по ссылке выше.':'В этом разделе нет текстового описания.'}</p>`;
    const siblings=phases.get(item.phaseId)?.items || extraItems;
    const index=siblings.findIndex(other=>other.id===item.id),previous=index>0?siblings[index-1]:null,next=index>=0?siblings[index+1]:null;
    if(previous || next)$('#article-pagination').innerHTML=`<nav class="article-pagination" aria-label="Соседние материалы">${previous?`<button data-open-item="${esc(previous.id)}">${icon('back')}<span><small>ПРЕДЫДУЩИЙ МАТЕРИАЛ</small><strong>${esc(previous.title)}</strong></span></button>`:'<span></span>'}${next?`<button data-open-item="${esc(next.id)}"><span><small>СЛЕДУЮЩИЙ МАТЕРИАЛ</small><strong>${esc(next.title)}</strong></span>${icon('arrow')}</button>`:''}</nav>`;
  }
  function toggleFavorite(id) {
    if(!items.has(id))return;const adding=!favorites.has(id);if(adding)favorites.add(id);else favorites.delete(id);
    write('rg2.favorites',[...favorites]);toast(adding?'Добавлено в избранное':'Удалено из избранного');
    if(route.type==='favorites'){render();return;}
    renderNavigation();document.querySelectorAll('[data-favorite]').forEach(button=>{
      if(button.dataset.favorite!==id)return;button.setAttribute('aria-pressed',String(adding));
      if(button.classList.contains('card-favorite')){button.title=adding?'Убрать из избранного':'В избранное';button.setAttribute('aria-label',`${button.title}: ${items.get(id).title}`);}
      else {button.classList.toggle('saved',adding);button.innerHTML=icon(adding?'check':'star')+`<span>${adding?'В избранном':'В избранное'}</span>`;}
    });
  }
  function highlighter(text,terms) {
    let result=esc(text);const sorted=[...new Set(terms)].filter(Boolean).sort((a,b)=>b.length-a.length);
    if(!sorted.length)return result;
    const pattern=sorted.map(term=>term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|');
    try {return result.replace(new RegExp(pattern,'giu'),match=>`<mark>${match}</mark>`);}catch{return result;}
  }
  function renderSearch() {
    const q=String(route.q || '').trim();setBreadcrumbs([{title:'Поиск'}]);const tokens=norm(q).split(/\s+/).filter(Boolean);
    const results=tokens.length?searchIndex.map(entry=>{
      const titleMatch=tokens.every(token=>entry.title.includes(token));const allMatch=tokens.every(token=>entry.title.includes(token)||entry.normalizedText.includes(token));
      return {...entry,score:allMatch?(titleMatch?100:20)+(entry.title===norm(q)?100:0):0};
    }).filter(entry=>entry.score>0).sort((a,b)=>b.score-a.score || a.item.title.localeCompare(b.item.title,'ru')):[];
    $('#content').innerHTML=`<div class="page-heading"><div class="eyebrow">По всей библиотеке</div><h1 class="page-title">Поиск</h1><p>Названия разделов, алгоритмы и текст обучалок.</p></div>`+(q?`<div class="search-meta"><span>«${esc(q)}» · найдено ${results.length}</span>${results.length>120?'<span>Показаны первые 120</span>':''}</div>`:'')+(results.length?`<div class="search-results">${results.slice(0,120).map(entry=>{
      let start=tokens.map(token=>entry.normalizedText.indexOf(token)).filter(index=>index>=0).sort((a,b)=>a-b)[0] || 0;start=Math.max(0,start-65);
      const snippet=(start?'…':'')+entry.text.slice(start,start+240)+(entry.text.length>start+240?'…':'');
      return `<article class="search-result"><button class="result-open" data-open-item="${esc(entry.item.id)}"><span class="result-icon">${entry.item.icon?`<img src="${esc(asset(entry.item.icon))}" alt="" loading="lazy">`:icon('book')}</span><span class="result-copy"><span class="result-path">${esc(entry.path || 'Дополнительные материалы')}</span><strong class="result-title">${highlighter(entry.item.title,tokens)}</strong>${snippet?`<p class="result-snippet">${highlighter(snippet,tokens)}</p>`:''}</span></button><button class="card-favorite" data-favorite="${esc(entry.item.id)}" aria-pressed="${favorites.has(entry.item.id)}" title="В избранное" aria-label="В избранное: ${esc(entry.item.title)}">${icon('star')}</button></article>`;
    }).join('')}</div>`:emptyState(q?'Ничего не найдено':'Что будем искать?',q?'Попробуйте другое название, формулу или короткую фразу.':'Введите название головоломки, алгоритм или фразу в строке поиска.'));
  }
  function modelImageControls() {
    return `<section class="model-image-settings" aria-labelledby="model-image-heading"><div class="model-image-heading"><h3 id="model-image-heading">Изображение 3D-куба</h3><button type="button" class="action-button" id="model-image-reset">Как в развёртке</button></div><div class="model-image-layout"><div><div class="model-image-preview" id="model-image-preview"></div><p class="model-image-preview-note">Предпросмотр · перетащи куб для поворота</p></div><div class="model-image-grid">${Object.entries(MODEL_IMAGE_FIELDS).map(([key,field])=>`<div class="model-image-control" data-model-image-row="${key}" ${key==='glow'?'hidden':''}><div class="model-image-label"><label for="model-image-${key}">${field.label}</label><output id="model-image-${key}-value" for="model-image-${key}">${modelImageValue(key,modelImageSettings[key])}</output></div><input type="range" id="model-image-${key}" data-model-image-key="${key}" data-model-image="${key}" min="${field.min}" max="${field.max}" step="${field.step}" value="${modelImageSettings[key]}" aria-valuetext="${modelImageValue(key,modelImageSettings[key])}"></div>`).join('')}</div></div></section>`;
  }
  function mountModelImagePreview() {
    const host=$('#model-image-preview');let cancelled=false,renderer=null;
    toolDisposer=()=>{cancelled=true;renderer?.dispose();};
    Promise.all([import('./solver/renderer.mjs'),import('./solver/core.mjs')]).then(([model,core])=>{
      if(cancelled||!host.isConnected)return;
      renderer=model.createRenderer(host);renderer.setEditable(false);
      renderer.setState(core.applyAlg(core.SOLVED,"R U R' F2 D L2 B' U2"));
    }).catch(()=>{if(!cancelled&&host.isConnected)host.textContent='Предпросмотр 3D недоступен.';});
  }
  function renderSettings() {
    setBreadcrumbs([{title:'Настройки'}]);
    $('#content').innerHTML=`<div class="settings-layout"><div class="page-heading"><div class="eyebrow">Рабочее пространство</div><h1 class="page-title">Настройки</h1></div><section class="settings-block"><h2>Оформление</h2><p>Выберите свой стиль или доверьте выбор системе.</p><div class="theme-options">${[
      ['system','Как в системе','По умолчанию'],['atelier','Atelier','Светлая · тёплая и спокойная'],['graphite','Graphite','Тёмная · графит и синий']
    ].map(([value,title,subtitle])=>`<label class="theme-choice"><span class="theme-swatch ${value}" aria-hidden="true"></span><input type="radio" name="theme" value="${value}" ${preference===value?'checked':''}><strong>${title}</strong><small>${subtitle}</small></label>`).join('')}</div><div class="settings-note" id="theme-status"></div><label class="settings-row model-neon-setting" id="model-neon-setting" for="model-neon-toggle" hidden><span><strong id="model-neon-label">Неоновое свечение деталей</strong><small id="model-neon-help">Цветные элементы 3D-куба светятся в тёмной теме.</small></span><input type="checkbox" id="model-neon-toggle" aria-labelledby="model-neon-label" aria-describedby="model-neon-help"></label>${modelImageControls()}</section><section class="settings-block"><h2>Горячие клавиши</h2><div class="keyboard-grid"><div class="keyboard-item"><span>Поиск по библиотеке</span><kbd>/</kbd></div><div class="keyboard-item"><span>Назад</span><kbd>Alt + ←</kbd></div><div class="keyboard-item"><span>Вперёд</span><kbd>Alt + →</kbd></div><div class="keyboard-item"><span>Закрыть изображение / вернуться</span><kbd>Esc</kbd></div></div></section><section class="settings-block"><h2>О приложении</h2><p id="app-version">RG2 · Desktop ${esc(updateState.currentVersion)}</p><div class="settings-row"><span><strong>Библиотека доступна без интернета</strong><small>Видео и внешние ссылки открываются в браузере.</small></span>${icon('book')}</div><div class="settings-row"><span><strong>Избранное и настройки сохраняются на этом компьютере</strong><small>Можно продолжить с того раздела, на котором вы остановились.</small></span>${icon('star')}</div></section>${updateControls()}</div>`;
    applyTheme();refreshUpdateControls();mountModelImagePreview();
  }
  function renderTools() {
    setBreadcrumbs([{title:'Тренажеры'}]);
    $('#content').innerHTML=hero('Тренажеры','Практика, распознавание алгоритмов и время сборок.','assets/images/trainers/pll_trainer.png','Практика')+`<div class="menu-grid">${orderedTools().map((tool,index)=>`<article class="menu-card"><button class="menu-open" data-tool="${esc(tool.id)}"><span class="menu-image"><img src="${esc(asset(tool.icon))}" alt=""></span><span class="menu-copy"><span class="menu-index">${String(index+1).padStart(2,'0')}</span><h3 class="menu-title">${esc(tool.title)}</h3><p class="menu-description">${esc(tool.description || '')}</p></span>${icon('arrow','menu-arrow')}</button></article>`).join('')}</div>`+collectionFooter();
  }
  function notationName(group) {
    if(group.title)return group.title;
    const size=group.id.match(/^BASIC_(\dX\d)$/i);
    if(size)return 'Кубик '+size[1].replace(/X/i,'×');
    const phaseId=String(group.id).replace(/^BASIC_/,'');
    if(phaseId==='PYRAMINX')return 'Пирамидка Мефферта (Pyraminx)';
    return phases.get(phaseId)?.title || phaseId;
  }
  function renderNotation() {
    const groups=trainerData?.notation || [];
    if(!groups.length){setBreadcrumbs([{title:'Азбука вращений'}]);$('#content').innerHTML=emptyState('Азбука вращений','Справочник вращений сейчас недоступен.');return;}
    const group=groups.find(entry=>entry.id===route.id) || groups[0];
    setBreadcrumbs([{title:'Азбука вращений',route:{type:'notation'}},{title:notationName(group)}]);
    $('#content').innerHTML=`<div class="notation-layout"><div class="page-heading"><div class="eyebrow">Язык вращений</div><h1 class="page-title">Азбука вращений</h1><p>Обозначения ходов и оригинальные схемы для вашей головоломки.</p></div><div class="notation-toolbar"><label for="notation-group"><span>Головоломка</span><select id="notation-group">${groups.map(entry=>`<option value="${esc(entry.id)}" ${entry.id===group.id?'selected':''}>${esc(notationName(entry))}</option>`).join('')}</select></label><span class="notation-count">${group.items.length} / ВРАЩЕНИЯ</span></div><div class="notation-grid">${group.items.map((entry,index)=>{
      const move=String(entry.move || '').startsWith('@string/')?'':entry.move || '';
      return `<figure class="notation-card"><div class="notation-diagram"><img src="${esc(asset(entry.icon))}" alt="${esc([move,entry.description].filter(Boolean).join(' · '))}" data-zoom tabindex="0"></div><figcaption><div class="notation-move"><span class="notation-number">${String(index+1).padStart(2,'0')}</span><code>${esc(move)}</code>${move?`<button class="icon-button" data-copy-algorithm="${esc(move)}" data-copy-label="Обозначение скопировано" title="Копировать обозначение" aria-label="Копировать обозначение ${esc(move)}">${icon('copy')}</button>`:''}</div><p>${esc(entry.description || '')}</p></figcaption></figure>`;
    }).join('')}</div><div class="notation-note">Нажмите на схему, чтобы рассмотреть её крупнее.</div></div>`;
  }
  function renderTool() {
    const tool=toolDefinitions.find(t=>t.id===route.id);if(!tool){renderMissing();return;}
    setBreadcrumbs([{title:'Тренажеры',route:{type:'tools'}},{title:tool.title}]);
    if(tool.id==='cfop-solver'){
      const host=document.createElement('div');host.id='tool-host';$('#content').replaceChildren(host);host.textContent='Загружаю решатель…';
      let cancelled=false,dispose=null;
      toolDisposer=()=>{cancelled=true;dispose?.();};
      import('./solver/tool.mjs').then(module=>{if(!cancelled&&host.isConnected)dispose=module.mount(host);}).catch(error=>{if(!cancelled)host.textContent='Не удалось открыть решатель: '+error.message;});
      return;
    }
    $('#content').innerHTML=`<button class="back-link" data-route="${esc(JSON.stringify({type:'tools'}))}">${icon('back')} Тренажеры</button><div class="page-heading"><div class="eyebrow">Практика</div><h1 class="page-title">${tool.title}</h1></div><div id="tool-host" class="tool-host"></div><div id="tool-help"></div>`;
    if(window.RG2Tools?.mount){
      toolDisposer=window.RG2Tools.mount($('#tool-host'),tool.id,{catalog,trainerData,assetRoot:'',hideSourceHelp:true,initialScramble:route.scramble,navigatePhase:id=>navigate({type:'phase',id}),openItem,toast});
      const sourceItem=[...items.values()].find(item=>item.kind==='tool' && normalizeTool(item.tool || '')===tool.id);
      const help=sourceItem?.html || trainerData?.help?.[tool.id] || trainerData?.help?.[tool.id==='alphabet'?'azbuka':tool.id];
      const helpHtml=typeof help==='string'?help:help?.html;
      if(helpHtml){$('#tool-help').innerHTML='<details class="tool-help"><summary>Обучалка и помощь</summary><div class="article-body"></div></details>';prepareArticle($('#tool-help .article-body'),helpHtml);}
    } else $('#tool-host').innerHTML=emptyState('Не удалось открыть тренажер','Откройте другой раздел и попробуйте ещё раз.');
  }
  function render() {
    if(typeof toolDisposer==='function'){toolDisposer();toolDisposer=null;}
    renderNavigation();$('#global-search').value=route.type==='search'?route.q || '':'';
    document.title='RG2 · Desktop';
    ({phase:renderPhase,item:renderArticle,favorites:renderFavorites,search:renderSearch,settings:renderSettings,tools:renderTools,tool:renderTool,notation:renderNotation,extras:renderExtras}[route.type] || renderMissing)();
    document.querySelectorAll('#content img').forEach(image=>image.addEventListener('error',()=>{image.dataset.loadError='true';image.alt='Не удалось открыть схему';},{once:true}));
  }
  async function copyText(value,label='Алгоритм скопирован') {
    try {await navigator.clipboard.writeText(value);toast(label);}
    catch {
      const input=document.createElement('textarea');input.value=value;input.style.position='fixed';input.style.opacity='0';document.body.appendChild(input);input.select();const success=document.execCommand('copy');input.remove();toast(success?label:'Не удалось скопировать. Выделите текст и нажмите Ctrl+C.');
    }
  }
  function handleRG2Link(value) {
    let url;try{url=new URL(value);}catch{return;}
    const action=url.hostname.toLowerCase();
    if(action==='pager'){
      const phaseId=resolvePhase(url.searchParams.get('phase') || ''),index=Number(url.searchParams.get('item') || 0),phase=phases.get(phaseId);
      const item=phase?.items.find(entry=>Number(entry.index)===index) || phase?.items[index];
      if(item)openItem(item.id);else toast('Не удалось открыть связанный материал.');
    }else if(action==='scrmbl')navigate({type:'tool',id:'scramble',scramble:(url.searchParams.get('scram') || '').replace(/_/g,' ')});
    else if(action==='plltest')navigate({type:'tool',id:'pll'});
    else if(action==='ytplay'){
      const link=normalizeInternalLink(value);if(link?.external){const a=document.createElement('a');a.href=link.external;a.target='_blank';a.rel='noopener noreferrer';a.click();}
    }else toast('Этот переход сейчас недоступен.');
  }
  document.addEventListener('click',event=>{
    const button=event.target.closest('button,a,label');if(!button)return;
    if(['update-check','update-install','update-cancel'].includes(button.id)){requestUpdate(button.id);return;}
    if(button.id==='model-image-reset'){resetModelImageSettings();return;}
    if(button.matches('[data-home]')){event.preventDefault();navigate(defaultRoute());return;}
    if(button.dataset.route){event.preventDefault();try{navigate(JSON.parse(button.dataset.route));}catch{}return;}
    if(button.dataset.openItem){event.preventDefault();openItem(button.dataset.openItem);return;}
    if(button.dataset.favorite){event.preventDefault();toggleFavorite(button.dataset.favorite);return;}
    if(button.matches('[data-focus-algorithm]')){event.preventDefault();toggleAlgorithmFocus(button);return;}
    if(button.dataset.copyAlgorithm){event.preventDefault();copyText(button.dataset.copyAlgorithm,button.dataset.copyLabel);return;}
    if(button.dataset.tool){navigate({type:'tool',id:button.dataset.tool});return;}
    if(button.dataset.reader){readerSize=button.dataset.reader;write('rg2.readerSize',readerSize);const article=$('#article-body');if(article){article.classList.remove('reader-small','reader-normal','reader-large');article.classList.add(`reader-${readerSize}`);}return;}
    if(button.dataset.rg2Link){event.preventDefault();handleRG2Link(button.dataset.rg2Link);return;}
  });
  document.addEventListener('click',event=>{
    const image=event.target.closest('img[data-zoom]');if(!image)return;
    $('#zoom-image').src=image.src;$('#zoom-image').alt=image.alt;$('#image-dialog').showModal();
  });
  document.addEventListener('keydown',event=>{if(event.key==='Enter' && event.target.matches('img[data-zoom]'))event.target.click();});
  document.addEventListener('change',event=>{if(event.target.matches('input[name="theme"]'))setTheme(event.target.value);if(event.target.id==='notation-group')navigate({type:'notation',id:event.target.value});if(event.target.id==='model-neon-toggle')setModelNeon(event.target.checked);});
  document.addEventListener('input',event=>{const key=event.target.dataset.modelImageKey;if(Object.prototype.hasOwnProperty.call(MODEL_IMAGE_FIELDS,key))setModelImageSettings({[key]:Number(event.target.value)});});
  $('#settings-button').addEventListener('click',()=>navigate({type:'settings'}));
  $('#history-back').addEventListener('click',()=>{if(historyIndex>0)history.back();});
  $('#history-forward').addEventListener('click',()=>{if(historyIndex<historyMax)history.forward();});
  $('#sidebar-toggle').addEventListener('click',()=>$('#sidebar').classList.toggle('expanded'));
  $('#zoom-close').addEventListener('click',()=>$('#image-dialog').close());
  $('#image-dialog').addEventListener('click',event=>{if(event.target===$('#image-dialog'))$('#image-dialog').close();});
  $('#global-search').addEventListener('input',event=>{
    const value=event.target.value;clearTimeout(searchTimer);searchTimer=setTimeout(()=>{navigate({type:'search',q:value},{replace:route?.type==='search'});$('#global-search').focus();},160);
  });
  document.addEventListener('keydown',event=>{
    const editable=/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '') || document.activeElement?.isContentEditable;
    if(event.key==='/' && !editable && !event.ctrlKey && !event.altKey){event.preventDefault();$('#global-search').focus();$('#global-search').select();return;}
    if(event.altKey && event.key==='ArrowLeft'){event.preventDefault();if(historyIndex>0)history.back();return;}
    if(event.altKey && event.key==='ArrowRight'){event.preventDefault();if(historyIndex<historyMax)history.forward();return;}
    if(event.key==='Escape'){
      if($('#image-dialog').open)return;
      if($('#sidebar').classList.contains('expanded')){$('#sidebar').classList.remove('expanded');return;}
      if(editable){document.activeElement.blur();return;}
      if(route?.type==='item'){const item=items.get(route.id);navigate(isAboutItem(item)?{type:'settings'}:item?.phaseId==='__EXTRAS__'?{type:'extras'}:{type:'phase',id:item?.phaseId || defaultRoute().id});}
      else if(route?.type==='tool')navigate({type:'tools'});
      else if(historyIndex>0)history.back();
    }
  });
  window.addEventListener('popstate',event=>{
    if(!catalog)return;route=normalizeRoute(event.state?.route || routeFromHash() || defaultRoute());historyIndex=event.state?.index ?? 0;write('rg2.lastRoute',route);render();$('#workspace').scrollTop=0;
  });
  window.RG2App={ready,navigate,openItem,setTheme,setModelNeon,setModelImageSettings,toast,get catalog(){return catalog;},get trainerData(){return trainerData;},get state(){return {route,themePreference:preference,effectiveTheme:document.documentElement.dataset.theme,modelNeonPreference:modelNeon,modelNeonActive:document.documentElement.dataset.modelNeon==='on',modelImageSettings:{...modelImageSettings},updateStatus:{...updateState},favorites:[...favorites],historyIndex,historyMax,bootError};},get items(){return items;},get phases(){return phases;},sanitizeArticle,handleRG2Link};
  async function initialize() {
    try {
      const [catalogResult,trainerResult]=await Promise.allSettled([fetch('catalog.json').then(response=>{if(!response.ok)throw new Error('catalog '+response.status);return response.json();}),fetch('trainer-data.json').then(response=>response.ok?response.json():null)]);
      if(catalogResult.status!=='fulfilled')throw catalogResult.reason;
      catalog=catalogResult.value;trainerData=trainerResult.status==='fulfilled'?trainerResult.value:null;indexCatalog(catalog);
      route=normalizeRoute(routeFromHash() || read('rg2.lastRoute',null) || defaultRoute());
      if(route.type==='phase' && !phases.has(route.id))route=defaultRoute();
      if(route.type==='item' && !items.has(route.id))route=defaultRoute();
      history.replaceState({rg2:true,route,index:0},'',hashFor(route));render();resolveReady(true);
    }catch(error){
      bootError=String(error);console.error('RG2 library could not load',error);
      $('#content').innerHTML=`<div class="error-state"><div class="page-heading"><div class="eyebrow">RG2 · Desktop</div><h1 class="page-title">Не удалось открыть библиотеку</h1><p>Закройте приложение и откройте его снова. Если это не поможет, восстановите папку приложения из исходного архива.</p></div><button class="action-button" id="retry-load">Попробовать снова ${icon('arrow')}</button></div>`;
      $('#retry-load').addEventListener('click',()=>location.reload());resolveReady(false);
    }
  }
  initialize();
})();
