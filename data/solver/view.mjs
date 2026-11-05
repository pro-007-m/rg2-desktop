import { createRenderer,PALETTE } from './renderer.mjs';
import { SOLVED,FACE_NAMES,applyAlg } from './core.mjs';
import { orientForCross,determineCrossColor } from './orientation.mjs';
const NAMES=['Белый','Красный','Зелёный','Жёлтый','Оранжевый','Синий'];
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const movesText=c=>Array.isArray(c.moves)?c.moves.join(' '):String(c.moves||c.alg||'');
const stageName=value=>({CROSS:'Крест · CROSS',F2L:'Первые два слоя · F2L',LAST_LAYER:'Последний слой · OLL / COLL',COLL:'Углы последнего слоя · COLL',EPLL:'Рёбра последнего слоя · EPLL',PLL:'Перестановка · PLL',AUF:'Конечный доворот',DONE:'Куб собран'}[value]||value||'Подготовка');
export function createSolverView(container,callbacks={},settings={}){
  const link=document.querySelector('link[data-cfop-style]')||Object.assign(document.createElement('link'),{rel:'stylesheet',href:new URL('./solver.css',import.meta.url).href});link.dataset.cfopStyle='';if(!link.parentNode)document.head.append(link);
  container.innerHTML=`<section class="cfop-tool"><header class="cfop-heading"><div><div class="eyebrow">Решатель по цветам</div><h1>CFOP <span>+ COLL</span></h1><p>От твоей раскраски — к понятному решению по этапам.</p></div><span class="cfop-local">На этом компьютере</span></header>
  <div class="cfop-settings"><label>Крест<select data-setting="crossColor">${NAMES.map((n,i)=>`<option value="${i}">${n}</option>`).join('')}<option value="auto">Сравнить все цвета</option></select></label><label>Рекомендация<select data-setting="rankMode"><option value="execution">Удобство исполнения</option><option value="htm">Меньше ходов · HTM</option></select></label><label class="cfop-check"><input type="checkbox" data-setting="pauseForChoice"><span>Пауза перед выбором алгоритма<small>Выключено — продолжать по рекомендации</small></span></label><label class="cfop-check"><input type="checkbox" data-setting="prepareColl"><span>Подготовка к COLL<small>Допускать EOLL → COLL</small></span></label></div>
  <div class="cfop-status" role="status" aria-live="polite">Перенеси цвета куба или создай новый скрамбл.</div><div class="cfop-errors" role="alert" hidden></div>
  <div class="cfop-scramble" aria-label="Перемешивание из собранного куба"><div class="cfop-scramble-head"><strong>Скрамбл из собранного куба</strong><button type="button" data-action="copy-scramble" disabled>Копировать скрамбл</button></div><code data-scramble-notation>Создай новый скрамбл кнопкой в блоке раскраски</code><p data-scramble-frame>Начни с собранного куба. Ориентация будет указана здесь.</p></div><div class="cfop-timeline" aria-label="Ходы выбранного решения"><div class="cfop-timeline-head"><span data-stage>Подготовка</span><button type="button" data-action="copy" disabled>Копировать ходы</button></div><div class="cfop-moves"><span class="cfop-moves-empty">Здесь появятся ходы решения</span></div></div>
  <div class="cfop-workbench"><section class="cfop-cube-panel"><div class="cfop-cube"></div><div class="cfop-cube-caption">Перетащи куб, чтобы рассмотреть другую сторону</div><div class="cfop-playback"><button type="button" data-action="back" title="Предыдущий ход">← Ход</button><button type="button" data-action="pause">Пауза</button><button type="button" data-action="resume">Продолжить</button><button type="button" data-action="next">Ход →</button><button type="button" data-action="restart" title="Вернуться к введённому кубу">Сначала</button><button type="button" data-action="camera" title="Вернуть камеру к направлению ходов: U сверху, F спереди, R справа">К виду ходов</button></div><label class="cfop-speed">Скорость анимации <input type="range" min=".25" max="4" step=".25" value="1" data-setting="speed"><span data-speed>1×</span></label></section>
  <section class="cfop-choice-panel"><div class="cfop-choice-title"><h2>Варианты решения</h2><span data-count></span></div><div class="cfop-choices-scroll" tabindex="0" aria-label="Варианты алгоритмов"><div class="cfop-recommendation"><div class="cfop-choice-empty">Решатель сравнит варианты CROSS, F2L, OLL/COLL и PLL. В каждом этапе можно выбрать свой путь.</div></div><div class="cfop-coverage"></div><div class="cfop-alternatives"></div></div><button type="button" class="cfop-show-more" data-action="show-more" hidden>Показать ещё варианты</button><button type="button" class="cfop-search-more" data-action="search-more" hidden>Продолжить поиск</button></section></div>
  <details class="cfop-editor" open><summary>Раскраска куба <span>54 наклейки · U R F D L B</span></summary><div class="cfop-editor-content"><div><div class="cfop-palette">${NAMES.map((n,i)=>`<button type="button" data-color="${i}" aria-label="${n}" style="--paint:${PALETTE[i]}"><i></i><span>${n}</span><b data-color-count="${i}">0/9</b></button>`).join('')}</div><p class="cfop-input-help">Выбери цвет и нажимай на наклейки развёртки или 3D-модели. Каждая грань показана снаружи. Центры задают цветовую схему.</p><div class="cfop-input-actions"><button type="button" data-action="clear">Очистить</button><button type="button" data-action="solved">Собранный куб</button><button type="button" data-action="demo">Новый скрамбл</button></div><button type="button" class="cfop-solve" data-action="solve">Проверить и найти решение</button></div><div class="cfop-net">${FACE_NAMES.map((face,f)=>`<div class="cfop-face cfop-face-${face}"><div class="cfop-face-label">${face}</div><div class="cfop-face-grid">${Array.from({length:9},(_,i)=>`<button type="button" data-sticker="${f*9+i}" class="${i===4?'is-center':''}" aria-label="${face}${i+1}">${i===4?face:''}</button>`).join('')}</div></div>`).join('')}</div></div></details>
  <p class="cfop-footnote">Рейтинг оценивает удобство, а не измеренное время. Для поиска CROSS/F2L показывается достигнутая глубина; остальные варианты остаются доступны.</p></section>`;
  const root=container.querySelector('.cfop-tool'),$=s=>root.querySelector(s);
  let input=Array.from(SOLVED),selectedColor=0,candidates=[],recommendedId=null,visibleCount=12,disposed=false,allMoves=[],scrambleMoves=[],busy=false,frameColor=0,frame=null,liveMoves=[],liveDisplayToInput=[];
  const indexLabels=Uint8Array.from({length:54},(_,index)=>index);
  const config={crossColor:0,autoCrossColor:0,rankMode:'execution',pauseForChoice:false,prepareColl:false,speed:1,...settings};
  frameColor=determineCrossColor(input,config.crossColor,config.autoCrossColor);
  $('.cfop-timeline-head').insertAdjacentHTML('afterend','<div class="cfop-frame" aria-label="Ориентация решения"><div><strong>Перед решением</strong><code data-setup-moves></code></div><p data-solution-frame></p><button type="button" data-action="copy-setup">Копировать поворот</button></div>');
  let renderer;
  try{renderer=createRenderer($('.cfop-cube'),{onPaint:index=>paint(index,true)});}catch(error){$('.cfop-cube').innerHTML=`<p class="cfop-render-error">Не удалось включить 3D. Проверь поддержку WebGL2.<br>${esc(error.message)}</p>`;renderer={setState(){},animateMove(){return Promise.reject(new Error('3D недоступно: '+error.message));},setEditable(){},resetCamera(){},dispose(){}};}
  for(const node of root.querySelectorAll('[data-setting]')){const value=config[node.dataset.setting];if(node.type==='checkbox')node.checked=Boolean(value);else node.value=String(value);}
  $('[data-speed]').textContent=config.speed+'×';
  function getSettings(){return {...config};}
  function updateInput({render=true}={}){
    frame=orientForCross(input,frameColor,{fallback:frame?.moves});
    updateLiveMapping();
    const counts=new Array(6).fill(0);input.forEach(v=>{if(v>=0&&v<6)counts[v]++;});
    root.querySelectorAll('[data-sticker]').forEach(node=>{const index=Number(node.dataset.sticker),v=frame.state[index];node.dataset.inputIndex=frame.displayToInput[index];node.style.background=v>=0&&v<6?PALETTE[v]:'var(--cfop-unpainted)';node.classList.toggle('is-unknown',v<0||v>5);node.classList.remove('is-error');});
    root.querySelectorAll('[data-color-count]').forEach(node=>{const n=counts[Number(node.dataset.colorCount)];node.textContent=n+'/9';node.classList.toggle('is-over',n>9);});
    root.querySelectorAll('[data-color]').forEach(node=>node.setAttribute('aria-pressed',String(Number(node.dataset.color)===selectedColor)));
    $('[data-setup-moves]').textContent=frame.moves.length?frame.moves.join(' '):'Поворот не нужен';
    $('[data-action="copy-setup"]').disabled=!frame.moves.length;
    const names=frame.centers.map(color=>NAMES[color]?.toLowerCase()||'не задан');
    $('[data-solution-frame]').textContent=frame.validCenters?`${names[3]} снизу · ${names[0]} сверху · ${names[2]} спереди · ${names[1]} справа. U — верх, F — перед, R — правая грань.`:'Задай шесть разных цветов центров, чтобы определить ориентацию решения.';
    if(render)renderer.setState(frame.state);
  }
  function updateLiveMapping(){liveDisplayToInput=Array.from(applyAlg(indexLabels,[...frame.moves,...liveMoves]));}
  function paint(index,live=false){if(busy||disposed)return;const rawIndex=(live?liveDisplayToInput:frame?.displayToInput)?.[index]??index;input[rawIndex]=selectedColor;updateInput();callbacks.onInputChange?.(Array.from(input));}
  function setInput(next){input=Array.from(next);liveMoves=[];updateInput();}
  function setFrameColor(color,{render=true}={}){frameColor=determineCrossColor(input,color,frameColor);if(config.crossColor==='auto')config.autoCrossColor=frameColor;updateInput({render});return getFrame();}
  function getFrame(){return {...frame,color:frameColor,state:[...frame.state],moves:[...frame.moves],centers:[...frame.centers],displayToInput:[...frame.displayToInput],inputToDisplay:[...frame.inputToDisplay]};}
  function setScramble(record){
    scrambleMoves=Array.from(record?.moves||[]);
    $('[data-action="copy-scramble"]').disabled=!scrambleMoves.length;
    $('[data-scramble-notation]').textContent=scrambleMoves.length?scrambleMoves.join(' '):'Создай новый скрамбл кнопкой в блоке раскраски';
    const centers=record?.centers;
    $('[data-scramble-frame]').textContent=centers?.length===6?`Перед началом: ${NAMES[centers[0]].toLowerCase()} сверху · ${NAMES[centers[2]].toLowerCase()} спереди · ${NAMES[centers[1]].toLowerCase()} справа`:'Начни с собранного куба. Ориентация будет указана здесь.';
  }
  function setStatus(text){$('.cfop-status').textContent=text;}
  function showValidation(report){const errors=report.errors||report.issues||[];$('.cfop-errors').hidden=!errors.length;$('.cfop-errors').innerHTML=errors.map(e=>`<p>${esc(e.message||e)}</p>`).join('');for(const e of errors)for(const index of e.indices||e.faceletIndices||[])$(`[data-sticker="${frame?.inputToDisplay[index]??index}"]`)?.classList.add('is-error');}
  function card(c,recommended=false){
    const cost=c.cost&&typeof c.cost==='object'?c.cost:{};
    const score=Number(c.score??cost.score),htm=Number(c.htm??cost.htm??c.moves?.length??0);
    const sourceArray=c.sources||c.source?[...(c.sources||[]),...(c.source?[{url:c.source,label:'Источник'}]:[])]:[];
    const links=sourceArray.slice(0,4).map(s=>typeof s==='string'?{url:s,label:'Источник'}:s).filter(s=>/^https?:\/\//.test(s.url||''));
    return `<article class="cfop-candidate ${recommended?'is-recommended':''}" data-candidate="${esc(c.id)}"><div class="cfop-candidate-tags">${recommended?'<span class="cfop-rec-label">Рекомендация</span>':''}<span>${esc(c.family||'CFOP')}</span><span>${htm} HTM</span>${Number.isFinite(score)?`<span>Оценка ${score.toFixed(1)}</span>`:''}${c.route?`<span>${esc(c.route)}</span>`:''}${['OLL','COLL','EOLL'].includes(c.family)&&Number.isFinite(c.totalCost)?`<span>С продолжением ${c.totalCost.toFixed(1)}</span>`:''}</div><h3>${esc(c.family==='EOLL'?'Подготовка рёбер · EOLL':c.title||c.name||c.family||'Вариант')}</h3><code>${esc(movesText(c)||'Этап уже выполнен')}</code>${c.expectedPll?`<p class="cfop-continuation">Далее: ${esc(c.expectedPll)}</p>`:''}<div class="cfop-candidate-footer"><button type="button" data-choose="${esc(c.id)}">Выбрать и выполнить</button><span>${links.map(s=>`<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.label||'Источник')}</a>`).join(' · ')}</span></div></article>`;
  }
  function drawCandidates(){const recommended=candidates.find(c=>c.id===recommendedId)||candidates[0];$('.cfop-recommendation').innerHTML=recommended?card(recommended,true):'<div class="cfop-choice-empty">Поиск ещё не дал вариантов.</div>';const rest=candidates.filter(c=>c!==recommended);$('.cfop-alternatives').innerHTML=rest.slice(0,visibleCount).map(c=>card(c)).join('');$('[data-count]').textContent=candidates.length?String(candidates.length):'';$('[data-action="show-more"]').hidden=visibleCount>=rest.length;root.querySelectorAll('[data-choose]').forEach(b=>b.disabled=busy);}
  function showCandidates(next,{stage,coverage={},recommendedId:id}={}){candidates=Array.from(next||[]);recommendedId=id||candidates[0]?.id;visibleCount=12;$('.cfop-choice-title h2').textContent=stageName(stage);$('.cfop-coverage').textContent=coverage.message||[coverage.completedDepth!=null?'Глубина '+coverage.completedDepth:null,coverage.visitedNodes?'Проверено '+Number(coverage.visitedNodes).toLocaleString('ru')+' узлов':null,coverage.exhaustedDeclaredDomain?'Поиск в указанной области завершён':coverage.incomplete?'Лучшие найденные варианты; поиск можно продолжить':null].filter(Boolean).join(' · ');$('[data-action="search-more"]').hidden=!['CROSS','F2L'].includes(stage);drawCandidates();}
  function setTimeline({executed=[],current=null,upcoming=[],stage}={}){
    liveMoves=[...executed];updateLiveMapping();
    allMoves=[...executed,...(current?[current]:[]),...upcoming];$('[data-stage]').textContent=stageName(stage);$('[data-action="copy"]').disabled=!allMoves.length;
    $('.cfop-moves').innerHTML=allMoves.length?[...executed.map(m=>`<span class="is-done">${esc(m)}</span>`),...(current?[`<strong class="is-current">${esc(current)}</strong>`]:[]),...upcoming.map(m=>`<span>${esc(m)}</span>`)].join(' '):'<span class="cfop-moves-empty">Здесь появятся ходы решения</span>';
    // Only the notation area scrolls; animation never scrolls the workspace.
    const box=$('.cfop-moves'),active=$('.is-current');
    if(active){const bounds=box.getBoundingClientRect(),move=active.getBoundingClientRect();if(move.top<bounds.top+8)box.scrollTop+=move.top-bounds.top-8;else if(move.bottom>bounds.bottom-8)box.scrollTop+=move.bottom-bounds.bottom+8;}
    else if(!allMoves.length)box.scrollTop=0;
  }
  function setBusy(value){busy=Boolean(value);renderer.setEditable(!busy);root.querySelectorAll('[data-choose]').forEach(b=>b.disabled=busy);$('[data-action="solve"]').disabled=busy;root.querySelectorAll('[data-sticker]').forEach(b=>b.disabled=busy);}
  function click(event){const target=event.target.closest('button');if(!target||!root.contains(target))return;if(target.dataset.color!==undefined){selectedColor=Number(target.dataset.color);root.querySelectorAll('[data-color]').forEach(node=>node.setAttribute('aria-pressed',String(Number(node.dataset.color)===selectedColor)));return;}if(target.dataset.sticker!==undefined){paint(Number(target.dataset.sticker));return;}if(target.dataset.choose){callbacks.onChoose?.(target.dataset.choose);return;}
    const action=target.dataset.action;
    if(action==='clear'){const next=new Array(54).fill(255);for(let f=0;f<6;f++)next[f*9+4]=input[f*9+4]<6?input[f*9+4]:f;setInput(next);callbacks.onInputChange?.(Array.from(input));}
    else if(action==='solved'){setInput(SOLVED);callbacks.onInputChange?.(Array.from(input));}
    else if(action==='camera')renderer.resetCamera();
    else if(action==='demo')(callbacks.onRandom||callbacks.onDemo)?.();
    else if(action==='solve')callbacks.onSolve?.(Array.from(input),getSettings());
    else if(action==='pause')callbacks.onPause?.();else if(action==='resume')callbacks.onResume?.();else if(action==='next')callbacks.onStepForward?.();else if(action==='back')callbacks.onStepBack?.();else if(action==='restart')callbacks.onRestart?.();else if(action==='search-more')callbacks.onMore?.();
    else if(action==='show-more'){visibleCount+=24;drawCandidates();}
    else if(action==='copy-scramble')copy(scrambleMoves.join(' '),'Скрамбл скопирован');
    else if(action==='copy-setup')copy(frame.moves.join(' '),'Поворот перед решением скопирован');
    else if(action==='copy')copy([...frame.moves,...allMoves].join(' '),'Поворот и ходы решения скопированы');
  }
  async function copy(value,label){
    if(!value)return;
    try{await navigator.clipboard.writeText(value);setStatus(label);}
    catch{
      const previous=document.activeElement,area=document.createElement('textarea');area.value=value;area.style.cssText='position:fixed;left:-9999px;top:0';document.body.append(area);area.select();
      let success=false;try{success=document.execCommand('copy');}catch{}area.remove();previous?.focus({preventScroll:true});setStatus(success?label:'Выдели запись и нажми Ctrl+C.');
    }
  }
  function change(event){const key=event.target.dataset.setting;if(!key)return;config[key]=event.target.type==='checkbox'?event.target.checked:key==='rankMode'?event.target.value:event.target.value==='auto'?'auto':Number(event.target.value);$('[data-speed]').textContent=config.speed+'×';callbacks.onSettingsChange?.(getSettings());}
  function inputEvent(event){if(event.target.dataset.setting==='speed')change(event);}
  root.addEventListener('click',click);root.addEventListener('change',change);root.addEventListener('input',inputEvent);
  updateInput();
  return {renderer,setInput,setScramble,setFrameColor,getFrame,getInput:()=>Array.from(input),getSettings,showStatus:setStatus,showValidation,showCandidates,setTimeline,setBusy,collapseEditor(){root.querySelector('.cfop-editor').open=false;},expandEditor(){root.querySelector('.cfop-editor').open=true;},dispose(){disposed=true;renderer.dispose();root.removeEventListener('click',click);root.removeEventListener('change',change);root.removeEventListener('input',inputEvent);container.replaceChildren();}};
}
