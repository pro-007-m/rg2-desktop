import {createGame,restoreGame,saveGame,loadGame,normalizeSpec,FAMILY_NAMES} from './model.mjs';
import {createPuzzleRenderer} from './renderer.mjs';
import {suggest,STAGE_NAMES} from './solver-client.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}};
const CLOCK=ms=>{const total=Math.floor(ms/1000),minutes=Math.floor(total/60),seconds=String(total%60).padStart(2,'0');return `${minutes}:${seconds}.${Math.floor(ms%1000/100)}`;};
const PREFS='rg2.puzzles.settings';
const COLOURS=['Белый','Красный','Зелёный','Жёлтый','Оранжевый','Синий'];
const PRESETS=Array.from({length:19},(_,i)=>i+2);
const POLY_KEYS=['KeyU','KeyF','KeyR','KeyB','KeyL','KeyD','KeyJ','KeyK','KeyH','KeyN','KeyM','KeyG'];
const title=spec=>`${FAMILY_NAMES[spec.kind]} ${spec.kind==='cube'?`${spec.size}×${spec.size}`:`· ${spec.size}`}`;

export function mount(container,{initialSpec=null,initialState=null,onOpenSolver=null}={}){
  if(!document.querySelector('#puzzles-styles')){const css=document.createElement('link');css.id='puzzles-styles';css.rel='stylesheet';css.href=new URL('./view.css',import.meta.url);document.head.append(css);}
  const prefs={speed:1,quality:'auto',crossColor:0,pauseForChoice:true,...read(PREFS,{})};
  prefs.speed=Math.max(.25,Math.min(4,Number(prefs.speed)||1));prefs.crossColor=Number.isInteger(Number(prefs.crossColor))&&Number(prefs.crossColor)>=0&&Number(prefs.crossColor)<6?Number(prefs.crossColor):0;
  if(!['auto','high','medium','low'].includes(prefs.quality))prefs.quality='auto';
  let disposed=false,game=null,renderer=null,epoch=0,running=false,paused=false,queue=[],activeToken=null,animationAbort=null,searchAbort=null,searchGeneration=0,autoSolve=false,decision=null,decisionLimit=6,branch=null,saveTimer=null,qualityReport=null,saveFailure=false,fastForwardPending=false,fastForwarding=false;
  let resolveReady;const ready=new Promise(resolve=>resolveReady=resolve);
  const $=selector=>container.querySelector(selector);
  container.innerHTML=`<section class="puz" aria-label="Виртуальные головоломки">
    <header class="puz-header"><div><div class="puz-eyebrow">Практика · свободная сборка</div><h1>Твоя головоломка</h1><p class="puz-intro">Выбирай форму и размер, перемешивай и собирай. Подсказки помогут разобраться в следующем этапе.</p></div><span class="puz-badge"><i></i>Доступно без интернета</span></header>
    <form class="puz-config" data-form="configuration"><label>Головоломка<select data-setting="kind"><option value="cube">Куб</option><option value="pyramid">Пирамида</option><option value="dodecahedron">Додекаэдр</option></select></label><label>Размер<select data-setting="preset">${PRESETS.map(n=>`<option value="${n}" ${n===3?'selected':''}>${n} × ${n}</option>`).join('')}<option value="custom">Свой размер…</option></select></label><label>Свой размер<input data-setting="size" type="number" min="2" max="50" step="1" value="3" inputmode="numeric" required></label><button class="puz-primary" type="submit">Открыть</button></form>
    <section class="puz-card puz-history"><div class="puz-history-head"><h2>Ходы партии</h2><button type="button" data-action="copy-history">Копировать</button></div><div class="puz-moves" data-role="history" aria-live="off">Здесь появятся твои ходы и этапы решения.</div><form class="puz-formula" data-form="algorithm"><input data-setting="algorithm" aria-label="Международная запись алгоритма" placeholder="R U R' U' · 3Rw · 2R" autocomplete="off" spellcheck="false"><button type="submit">Выполнить</button></form></section>
    <div class="puz-layout" style="margin-top:20px"><div class="puz-card puz-arena"><div class="puz-stats"><div class="puz-stat"><span>Партия</span><strong data-role="puzzle-title">Куб 3×3</strong></div><div class="puz-stat"><span>Время</span><strong data-role="timer">0:00.0</strong></div><div class="puz-stat"><span>Ходы</span><strong data-role="count">0</strong></div><span class="puz-status-pill" data-role="game-status">Готово</span></div><div class="puz-scene" data-role="scene"><div class="puz-loader" data-role="loading">Готовлю головоломку…</div></div><p class="puz-arena-note"><span class="puz-desktop-help">Потяни деталь для поворота слоя · правая кнопка — осмотр · колесо — масштаб</span><span class="puz-mobile-help">Свайп по детали — ход · два пальца — масштаб и осмотр</span></p><div class="puz-arena-actions"><button data-action="scramble" class="puz-primary">Перемешать</button><button data-action="undo">← Отменить</button><button data-action="redo">Повторить →</button><button data-action="pause">Пауза</button><button data-action="resume">Продолжить</button><button data-action="step">Ход →</button><button data-action="camera">К виду ходов</button><button data-action="reset-attempt">Сначала</button><button data-action="fullscreen">Полный экран</button></div><div class="puz-turn-options"><label>Слоёв за ход<input type="number" data-setting="width" min="1" max="3" value="1" inputmode="numeric"></label><label>Глубина слоя<input type="number" data-setting="depth" min="1" max="3" value="1" inputmode="numeric"></label><label class="puz-check"><input type="checkbox" data-setting="double">Двойной ход</label></div><div class="puz-speed"><span>Проигрывание</span><input type="range" data-setting="speed" min="0.25" max="4" step="0.25" value="${prefs.speed}" aria-label="Скорость проигрывания"><output data-role="speed">${prefs.speed}×</output></div></div>
    <aside class="puz-side"><section class="puz-card puz-panel puz-solver"><div class="puz-panel-head"><h2>Следующий этап</h2><small data-role="method-badge">CFOP + COLL</small></div><div class="puz-solve-options"><label>Метод<select data-setting="method"><option>CFOP + COLL</option></select></label><label data-role="cross-row">Цвет креста снизу<select data-setting="cross-color">${COLOURS.map((c,i)=>`<option value="${i}" ${prefs.crossColor===i?'selected':''}>${c}</option>`).join('')}</select></label><label class="puz-check"><input type="checkbox" data-setting="pause-choice" ${prefs.pauseForChoice?'checked':''}>Пауза для выбора алгоритма</label></div><div class="puz-solve-actions"><button data-action="hint">Подсказать</button><button data-action="solve" class="puz-primary">Показать решение</button></div><p class="puz-message" data-role="message" role="status">Начни со скрамбла или сделай свои ходы. Здесь появится следующий этап решения.</p><progress class="puz-progress" data-role="progress" hidden></progress><div class="puz-candidates" data-role="candidates"></div><button data-action="more" hidden style="width:100%;margin-top:12px">Показать ещё варианты</button><p class="puz-caption">Решение проверяется на текущем состоянии. Подсказки отмечают попытку как учебную.</p></section>
    <section class="puz-card puz-panel"><div class="puz-panel-head"><h2>Повороты</h2><small data-role="axis-note">Грани U · R · F</small></div><div class="puz-axes" data-role="axes"></div><p class="puz-keyboard" data-role="keyboard-help"></p><label>Качество изображения<select data-setting="quality"><option value="auto">Автоматически</option><option value="high">Подробное</option><option value="medium">Сбалансированное</option><option value="low">Лёгкое</option></select></label><p class="puz-caption" data-role="quality">Качество подстраивается под устройство.</p></section>
    <section class="puz-card puz-panel"><h2>Перемешивание и партия</h2><div class="puz-scramble" data-role="scramble">Куб начинается собранным.</div><div class="puz-files"><button data-action="copy-scramble">Копировать скрамбл</button><button data-action="export">Сохранить в файл</button><button data-action="import">Открыть файл</button><button data-action="saved">Другие партии</button><button data-action="solved">Собранная головоломка</button><button data-action="old-solver" hidden>Открыть решатель по раскраске</button></div><div class="puz-saved" data-role="saved"></div><input type="file" data-role="file" accept="application/json,.json" hidden><p class="puz-caption" data-role="save-status">Позиция сохраняется на этом устройстве.</p></section></aside></div>
  </section>`;
  $('[data-setting=quality]').value=prefs.quality;
  $('[data-action=step]').insertAdjacentHTML('afterend','<button data-action="finish-stage">Выполнить этап сразу</button>');
  function message(text){if(!disposed)$('[data-role=message]').textContent=text;}
  function fullscreenChanged(){if(!disposed)$('[data-action=fullscreen]').textContent=document.fullscreenElement||$('.puz')?.classList.contains('puz-fullscreen')?'Выйти из полного экрана':'Полный экран';}
  function preference(){try{localStorage.setItem(PREFS,JSON.stringify(prefs));}catch{}}
  function nativePost(type,values={}){if(window.RG2Platform?.post?.(type,values))return true;if(window.chrome?.webview?.postMessage){window.chrome.webview.postMessage({type,...values});return true;}return false;}
  let nativeFocused=false;
  function focusChanged(){const enabled=Boolean(renderer&&document.activeElement===renderer.canvas);if(enabled!==nativeFocused){nativeFocused=enabled;window.chrome?.webview?.postMessage?.({type:'puzzle-focus',enabled});}}
  function cancelSearch(){searchGeneration++;searchAbort?.abort();searchAbort=null;decision=null;decisionLimit=6;renderChoices();$('[data-role=progress]').hidden=true;}
  function stopAll(){epoch++;cancelSearch();animationAbort?.abort();animationAbort=null;queue=[];activeToken=null;running=false;autoSolve=false;paused=true;fastForwardPending=false;fastForwarding=false;game?.stop();}
  async function persist(){if(!game||disposed)return;try{await saveGame(game);saveFailure=false;$('[data-role=save-status]').textContent='Партия сохранена на этом устройстве.';}catch(error){saveFailure=true;$('[data-role=save-status]').textContent=error.message;}}
  function scheduleSave(){if(saveTimer!==null)return;saveTimer=setTimeout(()=>{saveTimer=null;persist();},750);}
  function moveOptions(){return {width:Number($('[data-setting=width]').value)||1,depth:Number($('[data-setting=depth]').value)||1,double:$('[data-setting=double]').checked,tip:false};}
  async function openGame(next,{restore=false}={}){
    stopAll();const token=epoch;await persist();if(disposed)return;
    $('[data-role=loading]').hidden=false;
    try{
      const replacement=restore?next:await createGame(normalizeSpec(next),{crossColor:prefs.crossColor,...(initialState&&next.kind==='cube'&&Number(next.size)===3?{initialState}:{} )});initialState=null;
      if(disposed||token!==epoch)return;
      renderer?.dispose();game=replacement;branch=null;paused=false;
      const spec=game.spec,options={size:spec.size,quality:prefs.quality,mobile:Boolean(window.RG2Platform||matchMedia('(pointer:coarse)').matches),onMove:move=>enqueue([move],{source:'manual'}),onCommand:command=>action(command),getMoveOptions:moveOptions,onStatus:message,onQuality:q=>{qualityReport=q;renderQuality();}};
      if(spec.kind==='cube')renderer=createPuzzleRenderer($('[data-role=scene]'),options);
      else{const {createPolyRenderer}=await import('./poly-renderer.mjs');if(disposed||token!==epoch)return;renderer=createPolyRenderer($('[data-role=scene]'),{...options,puzzle:game.adapter.puzzle,keyboardMap:Object.fromEntries(game.adapter.puzzle.axes.map((a,i)=>[spec.kind==='pyramid'?({U:'KeyU',L:'KeyL',R:'KeyR',B:'KeyB'}[a.id]):POLY_KEYS[i],a.id]))});}
      renderer.setState(game.state);$('[data-role=loading]').hidden=true;
      $('[data-setting=kind]').value=spec.kind;$('[data-setting=size]').value=spec.size;$('[data-setting=preset]').value=spec.size<=20?String(spec.size):'custom';configureSize();
      const depthMax=spec.kind==='cube'?spec.size:Math.max(...game.adapter.puzzle.axes.map(a=>a.layerCount));
      for(const name of ['width','depth']){const field=$(`[data-setting=${name}]`);field.max=depthMax;field.value='1';}
      if(spec.kind==='pyramid'&&spec.size>=3)$('[data-setting=width]').value='2';
      $('[data-setting=depth]').max=depthMax-Number($('[data-setting=width]').value)+1;
      const methods=spec.kind==='cube'?(spec.size===3?[['cfop','CFOP + COLL']]:spec.size===2?[['ortega','Ortega']]:[['reduction','Редукция + CFOP / COLL'],['constructive','Центры → углы → рёбра']]):[['sgs','Группы деталей']];
      const field=$('[data-setting=method]');field.innerHTML=methods.map(([value,label])=>`<option value="${value}">${esc(label)}</option>`).join('');if(spec.kind==='cube'&&spec.size>=4&&methods.some(([id])=>id===prefs.nxnMethod))field.value=prefs.nxnMethod;$('[data-role=method-badge]').textContent=field.selectedOptions[0].textContent;
      $('[data-role=cross-row]').hidden=spec.kind!=='cube';$('[data-action=old-solver]').hidden=!(spec.kind==='cube'&&spec.size===3);
      renderAxes();render();scheduleSave();resolveReady(true);message('Головоломка готова. Перемешай её или начни с собственных ходов.');return true;
    }catch(error){if(token!==epoch||disposed)return;$('[data-role=loading]').hidden=true;message('Не удалось открыть головоломку: '+error.message);resolveReady(false);}
  }
  function configureSize(){const kind=$('[data-setting=kind]').value,max=kind==='cube'?50:20,field=$('[data-setting=size]');field.max=max;if(Number(field.value)>max)field.value=max;for(const o of $('[data-setting=preset]').options)if(o.value!=='custom')o.textContent=kind==='cube'?`${o.value} × ${o.value}`:`Размер ${o.value}`;}
  function renderQuality(){if(!qualityReport||disposed)return;const names={high:'Подробное',medium:'Сбалансированное',low:'Лёгкое'};$('[data-role=quality]').textContent=`${qualityReport.auto?'Авто · ':''}${names[qualityReport.quality]||qualityReport.quality} · разрешение ${Number(qualityReport.dpr||1).toFixed(2)}×` ;}
  function renderAxes(){
    const axes=game.spec.kind==='cube'?['U','R','F','D','L','B']:game.adapter.puzzle.axes.map(a=>a.id);
    $('[data-role=axes]').innerHTML=axes.map(name=>`<button data-axis="${esc(name)}" title="${esc(name)}">${esc(name)}</button>`).join('');
    $('[data-role=axis-note]').textContent=game.spec.kind==='cube'?'U — верх · F — перед · R — справа':game.spec.kind==='pyramid'?'U · L · R · B · поворот 120°':'A–L — грани · поворот 72°';
    $('[data-role=keyboard-help]').innerHTML=game.spec.kind==='dodecahedron'?`Клавиши <kbd>U F R B L D J K H N M G</kbd> соответствуют граням <kbd>A–L</kbd>. <kbd>Ctrl</kbd> — обратный, <kbd>Alt</kbd> — двойной ход.`:`Фокус на модели: <kbd>${axes.join(' ')}</kbd> — ходы, <kbd>Ctrl</kbd> — обратно, <kbd>Alt</kbd> — двойной. <kbd>Ctrl Z</kbd> / <kbd>Ctrl Y</kbd> — история. Ширина и глубина задаются над ползунком скорости.`;
  }
  function historyText(){return game.moves.slice(0,game.cursor).map(m=>game.adapter.format(m)).join(' ');}
  function render(){
    if(!game||disposed)return;const state=game.solved,from=Math.max(0,game.cursor-120),to=Math.min(game.moves.length,game.cursor+30),labels=new Map(game.segments.map(s=>[s.start,s.title]));
    const continuing=game.segments.find(s=>s.start<from&&s.end>from);if(continuing)labels.set(from,continuing.title);
    $('[data-role=puzzle-title]').textContent=title(game.spec);$('[data-role=count]').textContent=String(game.playerMoves);$('[data-role=timer]').textContent=CLOCK(game.time);
    $('[data-role=game-status]').textContent=state?'Собрано':searchAbort?'Поиск…':game.assisted?'Учебная сборка':paused?'Пауза':'Свободная сборка';
    $('[data-role=history]').innerHTML=(from?'<span class="puz-stage">Ранее '+from+' ходов</span> ':'')+game.moves.slice(from,to).map((m,i)=>{const index=i+from;return (labels.has(index)?`<span class="puz-stage">[${esc(labels.get(index))}]</span> `:'')+`<span class="${index>=game.cursor?'future':index===game.cursor-1?'current':''}">${esc(game.adapter.format(m))}</span>`;}).join(' ')+(activeToken?` <span class="current">${esc(activeToken)}</span>`:'')||'Здесь появятся твои ходы и этапы решения.';
    $('[data-role=scramble]').textContent=game.scramble||'Начальная позиция — собранная головоломка.';
    $('[data-action=undo]').disabled=!game.canUndo||running;$('[data-action=redo]').disabled=!game.canRedo||running;
    $('[data-action=resume]').disabled=!queue.length&&!decision;$('[data-action=step]').disabled=!queue.length&&!decision;
    $('[data-action=finish-stage]').disabled=!queue.length||fastForwarding;
    $('[data-action=hint]').disabled=running||Boolean(searchAbort);$('[data-action=solve]').disabled=running||Boolean(searchAbort);
    $('[data-setting=method]').disabled=running||Boolean(searchAbort);
    renderer?.setInteractive(!searchAbort&&!fastForwarding&&(!autoSolve||paused));renderQuality();
  }
  function renderChoices(){
    const host=$('[data-role=candidates]');if(!host)return;
    host.innerHTML=decision?.candidates?.slice(0,decisionLimit).map((c,i)=>`<article class="puz-choice ${i===0?'recommended':''}"><small>${i===0?'Рекомендация · ':''}${esc(c.family||decision.stage)}${Number.isFinite(c.htm)?` · ${c.htm} HTM`:''}</small><strong>${esc(c.title||STAGE_NAMES[decision.stage]||decision.stage)}</strong><code>${esc(c.moves.join(' '))||'Без дополнительных ходов'}</code><button data-choice="${i}" class="${i===0?'puz-primary':''}">Выбрать и выполнить</button></article>`).join('')||'';
    $('[data-action=more]').hidden=!decision||decisionLimit>=decision.candidates.length;
  }
  async function enqueue(algorithm,{source='manual',stage=null,append=false}={}){
    if(!game||disposed)return;
    try{
      const moves=game.adapter.parse(algorithm);if(!moves.length)return;
      if(moves.length>20000||queue.length+moves.length>20000)throw new Error('В очереди слишком много ходов. Выполни последовательность частями.');
      if(source==='manual'){cancelSearch();autoSolve=false;branch=null;if(!append)queue=queue.filter(c=>c.source==='manual');}
      queue.push(...moves.map(move=>({move,source,stage})));paused=false;pump();
    }catch(error){message(error.message);}
  }
  async function pump(single=false){
    if(running||!game||disposed||(!single&&paused)||!queue.length)return;
    running=true;const token=epoch;render();
    try{
      do{
        const next=queue.shift(),command=typeof next.move==='string'?game.adapter.parse(next.move)[0]:next.move;activeToken=game.adapter.format(command);render();animationAbort=new AbortController();
        await renderer.playMove(command,{duration:480/Math.max(.25,prefs.speed),signal:animationAbort.signal});
        if(disposed||token!==epoch)return;
        game.apply(command,{source:next.source,stage:next.stage});renderer.setState(game.state);activeToken=null;animationAbort=null;render();scheduleSave();
        if(single){paused=true;break;}
      }while(queue.length&&!paused);
    }catch(error){if(error.name!=='AbortError')message('Поворот остановлен: '+error.message);}
    finally{if(token===epoch){running=false;activeToken=null;animationAbort=null;render();}}
    if(disposed||token!==epoch)return;
    if(fastForwardPending){fastForwardPending=false;fastForward();return;}
    if(!queue.length){if(game.solved){autoSolve=false;game.stop();message(`Головоломка собрана · ${game.playerMoves} ходов${game.assisted?' · учебная попытка':''}.`);render();scheduleSave();}else if(autoSolve&&!paused)requestHint(true);}
  }
  async function fastForward(){
    if(disposed||!game||running||!queue.length)return;
    const token=epoch;running=true;fastForwarding=true;paused=false;renderer.setInteractive(false);message('Выполняю оставшиеся ходы этапа без анимации. История сохраняется.');render();
    try{
      while(queue.length&&!paused&&token===epoch&&!disposed){
        const batch=queue.splice(0,128);
        for(const entry of batch)game.apply(entry.move,{source:entry.source,stage:entry.stage});
        renderer.setState(game.state);render();scheduleSave();await new Promise(resolve=>setTimeout(resolve,0));
      }
    }catch(error){paused=true;message('Выполнение остановлено: '+error.message);}
    finally{if(token===epoch){running=false;fastForwarding=false;render();}}
    if(token!==epoch||disposed)return;
    await persist();
    if(game.solved){autoSolve=false;paused=true;message('Головоломка собрана. Все выполненные ходы записаны в истории.');render();}
    else if(autoSolve&&!paused&&!queue.length)requestHint(true);
    else if(!queue.length){paused=true;message('Этап выполнен. Можно запросить следующий.');render();}
  }
  async function requestHint(automatic=false){
    if(!game||running||disposed)return;
    if(game.solved){message('Головоломка уже собрана.');return;}
    game.stop();game.assisted=true;scheduleSave();
    cancelSearch();autoSolve=automatic;paused=false;const capture=game,cursor=game.cursor,gen=searchGeneration;searchAbort=new AbortController();
    $('[data-role=progress]').hidden=false;message('Анализирую текущую позицию и следующий этап…');render();
    try{
      const result=await suggest(game,{crossColor:prefs.crossColor,branch,method:$('[data-setting=method]').value,signal:searchAbort.signal,onProgress:text=>message(text)});
      if(disposed||game!==capture||game.cursor!==cursor||gen!==searchGeneration)return;
      searchAbort=null;decision=result;decisionLimit=6;$('[data-role=progress]').hidden=true;renderChoices();
      if(result.stage==='DONE'||game.solved){autoSolve=false;message('Головоломка уже собрана.');}
      else if(!result.candidates?.length){autoSolve=false;message(result.coverage?.message||'Для этой позиции не найден следующий этап.');}
      else{message(`${STAGE_NAMES[result.stage]||result.title||result.stage}. ${result.coverage?.message||'Выбери подходящий алгоритм.'}`);if(automatic&&!prefs.pauseForChoice)choose(0);else paused=true;}
    }catch(error){if(error.name!=='AbortError'&&gen===searchGeneration){autoSolve=false;message(error.message);}}
    finally{if(gen===searchGeneration){searchAbort=null;$('[data-role=progress]').hidden=true;render();}}
  }
  function choose(index,{single=false}={}){
    if(!decision||running)return;const c=decision.candidates[index];if(!c)return;
    const stage=c.title||STAGE_NAMES[decision.stage]||decision.stage;
    branch=c.family==='EOLL'?(c.route==='EOLL → PLL'?null:'COLL'):c.family==='COLL'?'EPLL':null;
    decision=null;renderChoices();game.assisted=true;queue=[];
    const moves=c.moves;queue=moves.map(move=>({move,source:'solver',stage}));
    paused=single;message(`Выбран ${stage}. ${moves.length} ходов.`);if(moves.length)pump(single);else if(autoSolve)requestHint(true);
  }
  async function action(name){
    if(disposed||!game)return;
    try{
      if(name==='camera')renderer.resetCamera();
      else if(name==='hint')requestHint(false);
      else if(name==='solve')requestHint(true);
      else if(name==='pause'){paused=true;autoSolve=false;game.stop();message('Пауза. Можно продолжить или выполнять по одному ходу.');render();scheduleSave();}
      else if(name==='resume'){paused=false;if(queue.length)pump();else if(decision)choose(0);render();}
      else if(name==='step'){paused=true;if(queue.length)pump(true);else if(decision)choose(0,{single:true});}
      else if(name==='finish-stage'){if(running){fastForwardPending=true;paused=true;}else fastForward();}
      else if(name==='undo'||name==='redo'){
        if(running)return;cancelSearch();autoSolve=false;queue=[];branch=null;const move=name==='undo'?(game.canUndo?game.adapter.inverse(game.moves[game.cursor-1]):null):(game.canRedo?game.moves[game.cursor]:null);if(!move)return;
        const token=epoch,current=game;running=true;animationAbort=new AbortController();try{await renderer.playMove(move,{duration:300/prefs.speed,signal:animationAbort.signal});}catch(error){if(token!==epoch||disposed)return;throw error;}if(disposed||token!==epoch||game!==current)return;game[name]();renderer.setState(game.state);running=false;animationAbort=null;render();scheduleSave();
      }else if(name==='scramble'){
        const spec=game.spec,opened=await openGame(spec);if(!opened||disposed||!game)return;const moves=game.adapter.scramble();game.applyInstant(moves,{source:'scramble',stage:'Перемешивание'});game.markScramble(moves);renderer.setState(game.state);render();scheduleSave();message('Новый скрамбл готов. Его текст можно повторить на собранной головоломке.');
      }else if(name==='solved')await openGame(game.spec);
      else if(name==='reset-attempt'){if(running)return;cancelSearch();autoSolve=false;queue=[];game.resetAttempt();renderer.setState(game.state);render();scheduleSave();}
      else if(name==='more'){decisionLimit+=12;renderChoices();}
      else if(name==='copy-history')await copy(historyText());
      else if(name==='copy-scramble')await copy(game.scramble||'');
      else if(name==='old-solver'){game.stop();await persist();localStorage.setItem('rg2.cfop.input',JSON.stringify([...game.state]));onOpenSolver?.();}
      else if(name==='export'){
        game.stop();const text=JSON.stringify(game.toJSON(),null,2);await persist();
        if(!nativePost('export-puzzle',{text,name:`RG2-${game.spec.kind}-${game.spec.size}.json`})){
          const url=URL.createObjectURL(new Blob([text],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`RG2-${game.spec.kind}-${game.spec.size}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
        }
        message('Файл партии готов. Его можно открыть в RG2 на другом устройстве.');
      }else if(name==='import'){
        if(!nativePost('import-puzzle'))$('[data-role=file]').click();
      }else if(name==='saved')await showSaved();
      else if(name==='fullscreen'){const root=$('.puz');if(window.RG2Platform)root.classList.toggle('puz-fullscreen');else if(document.fullscreenElement)await document.exitFullscreen();else await root.requestFullscreen();fullscreenChanged();}
    }catch(error){running=false;if(error.name!=='AbortError')message(error.message);render();}
  }
  async function copy(text){if(!text){message('Пока нет ходов для копирования.');return;}await navigator.clipboard.writeText(text);message('Ходы скопированы.');}
  async function receiveImport(text){try{const next=await restoreGame(text);if(!await openGame(next,{restore:true}))return false;message('Партия открыта. Можно продолжать сборку.');return true;}catch(error){message('Не удалось открыть файл: '+error.message);return false;}}
  async function showSaved(){const {listGames,loadSavedGame}=await import('./model.mjs'),list=await listGames();const host=$('[data-role=saved]');host.replaceChildren();for(const item of list){const button=document.createElement('button');button.innerHTML=`${esc(title(item.spec))}<small>${new Date(item.updatedAt).toLocaleString('ru')} · ${item.cursor} ходов</small>`;button.onclick=async()=>{const next=await loadSavedGame(item.key);await openGame(next,{restore:true});};host.append(button);}if(!list.length)host.textContent='Других сохранённых партий пока нет.';}
  const click=event=>{const choice=event.target.closest('[data-choice]');if(choice){choose(Number(choice.dataset.choice));return;}const axis=event.target.closest('[data-axis]');if(axis){const opts=moveOptions(),face=axis.dataset.axis;let token=face;if(game.spec.kind==='cube'){const d=opts.depth,w=opts.width;token=w===1?(d===1?'':d)+face:d===1?(w===2?'':w)+face+'w':`${d}-${d+w-1}${face}w`;}else if(opts.depth>1||opts.width>1)token=`${opts.depth}-${opts.depth+opts.width-1}${face}w`;if(opts.double)token+='2';enqueue(token,{source:'manual'});return;}const button=event.target.closest('[data-action]');if(button)action(button.dataset.action);};
  const submit=event=>{const form=event.target.closest('[data-form]');if(!form)return;event.preventDefault();if(form.dataset.form==='configuration'){try{const next=normalizeSpec({kind:$('[data-setting=kind]').value,size:Number($('[data-setting=size]').value)});openGame(next);}catch(e){message(e.message);}}else if(form.dataset.form==='algorithm'){enqueue($('[data-setting=algorithm]').value,{source:'manual'});}};
  let crossChange=0;
  async function changeCross(color){
    const generation=++crossChange,token=epoch;cancelSearch();autoSolve=false;paused=true;queue=[];branch=null;
    while(running&&!disposed&&token===epoch&&generation===crossChange)await new Promise(resolve=>setTimeout(resolve,20));
    if(disposed||token!==epoch||generation!==crossChange||!game||game.spec.kind!=='cube')return;
    const moves=game.setCrossFrame(color);renderer.resetCamera();
    if(moves.length)enqueue(moves,{source:'frame',stage:'Ориентация'});
    else{render();scheduleSave();}
    message(`${COLOURS[color]} — цвет креста снизу. Положение камеры возвращено к виду ходов.`);
  }
  const change=event=>{
    const key=event.target.dataset.setting;
    if(key==='preset'){if(event.target.value==='custom')$('[data-setting=size]').focus();else $('[data-setting=size]').value=event.target.value;}
    else if(key==='kind')configureSize();
    else if(key==='speed'){prefs.speed=Number(event.target.value);$('[data-role=speed]').textContent=prefs.speed+'×';preference();}
    else if(key==='quality'){prefs.quality=event.target.value;renderer?.setQuality(prefs.quality);preference();}
    else if(key==='pause-choice'){prefs.pauseForChoice=event.target.checked;preference();}
    else if(key==='method'){prefs.nxnMethod=event.target.value;preference();cancelSearch();autoSolve=false;paused=true;queue=[];branch=null;$('[data-role=method-badge]').textContent=event.target.selectedOptions[0].textContent;message('Метод выбран. Запроси следующий этап из текущей позиции.');render();}
    else if(key==='cross-color'){prefs.crossColor=Number(event.target.value);preference();changeCross(prefs.crossColor).catch(error=>message(error.message));}
    else if(key==='width'||key==='depth'){
      const limit=game?.spec.kind==='cube'?game.spec.size:Math.min(...game.adapter.puzzle.axes.map(a=>a.layerCount)),max=key==='depth'?Math.max(1,limit-(Number($('[data-setting=width]').value)||1)+1):limit;
      event.target.value=Math.max(1,Math.min(max,Math.round(Number(event.target.value)||1)));
      if(key==='width'){$('[data-setting=depth]').max=Math.max(1,limit-Number(event.target.value)+1);$('[data-setting=depth]').value=Math.min(Number($('[data-setting=depth]').value),Number($('[data-setting=depth]').max));}
    }
  };
  const file=async()=>{const item=$('[data-role=file]').files[0];if(item){if(item.size>8*1024*1024){message('Файл партии больше 8 МБ.');return;}await receiveImport(await item.text());$('[data-role=file]').value='';}};
  const pauseLifecycle=()=>{paused=true;autoSolve=false;game?.stop();cancelSearch();render();persist();};
  const visibility=()=>{if(document.hidden)pauseLifecycle();};
  const input=event=>{if(event.target.dataset.setting==='speed')change(event);};
  container.addEventListener('click',click);container.addEventListener('submit',submit);container.addEventListener('change',change);container.addEventListener('input',input);$('[data-role=file]').addEventListener('change',file);
  window.addEventListener('rg2:pause',pauseLifecycle);window.addEventListener('pagehide',pauseLifecycle);document.addEventListener('visibilitychange',visibility);
  document.addEventListener('focusin',focusChanged);document.addEventListener('focusout',focusChanged);
  document.addEventListener('fullscreenchange',fullscreenChanged);document.addEventListener('rg2:puzzle-fullscreen-change',fullscreenChanged);
  const clock=setInterval(()=>{if(game&&!disposed)$('[data-role=timer]').textContent=CLOCK(game.time);},100);
  const api={ready,newGame:spec=>openGame(spec),dispatch:move=>enqueue(move,{source:'manual'}),action,receiveImport,debug:()=>({spec:game?.spec,state:game?[...game.state]:null,initial:game?[...game.initial]:null,solved:game?.solved,cursor:game?.cursor,history:game?.moves.map(m=>game.adapter.format(m)),scramble:game?.scramble,segments:game?.segments,assisted:game?.assisted,paused,running,queued:queue.length,searching:Boolean(searchAbort),candidates:decision?.candidates||[],visual:renderer?.getVisualState?.(),saveFailure}),export:()=>game?.toJSON()};container.virtualPuzzle=api;
  (async()=>{try{const saved=!initialSpec&&!initialState?await loadGame():null;if(disposed)return;if(saved)await openGame(saved,{restore:true});else await openGame(initialSpec||read('rg2.puzzles.lastSpec',{kind:'cube',size:3}));}catch(error){message(error.message);await openGame({kind:'cube',size:3});}})();
  return ()=>{if(disposed)return;game?.stop();if(game)saveGame(game).catch(()=>{});disposed=true;stopAll();clearInterval(clock);clearTimeout(saveTimer);renderer?.dispose();container.removeEventListener('click',click);container.removeEventListener('submit',submit);container.removeEventListener('change',change);container.removeEventListener('input',input);window.removeEventListener('rg2:pause',pauseLifecycle);window.removeEventListener('pagehide',pauseLifecycle);document.removeEventListener('visibilitychange',visibility);document.removeEventListener('focusin',focusChanged);document.removeEventListener('focusout',focusChanged);document.removeEventListener('fullscreenchange',fullscreenChanged);document.removeEventListener('rg2:puzzle-fullscreen-change',fullscreenChanged);window.chrome?.webview?.postMessage?.({type:'puzzle-focus',enabled:false});delete container.virtualPuzzle;resolveReady(false);};
}
