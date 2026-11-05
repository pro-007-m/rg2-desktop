import {SOLVED,applyMove,validate,stateKey,isCross,isF2L,isOLL,isSolved,areCornersSolved} from './core.mjs';
import {createSolverView} from './view.mjs';
import {createScramble,restoreScramble} from './scramble.mjs';
const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}};
const save=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));}catch{}};
const labels={CROSS:'креста',F2L:'пары F2L',LAST_LAYER:'OLL / COLL',COLL:'COLL',EPLL:'EPLL',PLL:'PLL'};
const SCRAMBLE_KEY='rg2.cfop.scramble.v1';
export function mount(container){
 let disposed=false,worker=null,jobId=0,revision=0,pending=null,abort=null,running=false,paused=true,active=false,stage=null,decision=null,queue=[],executed=[],history=[],more=0,normalize=true,branch=null;
 let initial=read('rg2.cfop.input',Array.from(SOLVED)),settings=read('rg2.cfop.settings',{});
 if(!Array.isArray(initial)||initial.length!==54)initial=Array.from(SOLVED);
 let state=Uint8Array.from(initial),frameCenters=[],scrambleRecord=restoreScramble(read(SCRAMBLE_KEY,null),initial),lastRandomMoves=scrambleRecord?.moves;
 const view=createSolverView(container,{onInputChange,onSolve:solve,onRandom:newScramble,onDemo:newScramble,onChoose:choose,onPause:pause,onResume:resume,onStepForward:()=>play(true),onStepBack:back,onRestart:restart,onMore:moreSearch,onSettingsChange:changeSettings},settings);
 settings=view.getSettings();view.setInput(initial);rebaseInput();syncScramble(initial);
 function rebaseInput(color=settings.crossColor,{resetCamera=false}={}){const frame=view.setFrameColor(color);state=Uint8Array.from(frame.state);frameCenters=[...frame.centers];if(resetCamera)view.renderer.resetCamera();return frame;}
 function previewCross(candidate){if(!candidate?.baseState)return;const frame=view.setFrameColor(candidate.crossColor,{render:false});if(settings.crossColor==='auto'){settings=view.getSettings();save('rg2.cfop.settings',settings);}state=Uint8Array.from(candidate.baseState);frameCenters=[...frame.centers];view.renderer.setState(state);view.renderer.resetCamera();}
 function timeline(current=null){view.setTimeline({executed,current,upcoming:queue.slice(current?1:0),stage});}
 function cancel(){revision++;pending=null;worker?.terminate();worker=null;abort?.abort();abort=null;queue=[];running=false;view.setBusy(false);}
 function getWorker(){
  if(worker)return worker;
  worker=new Worker(new URL('./worker.mjs',import.meta.url),{type:'module'});
  worker.onmessage=({data})=>{
   if(disposed||!pending||data.id!==pending.id||data.revision!==revision||data.hash!==stateKey(state))return;
   const {snapshot,frameColor,centers}=pending;pending=null;view.setBusy(false);
   if(data.error){paused=true;view.showStatus('Поиск остановлен: '+data.error);return;}
   decision={state:snapshot,executedPrefix:[...executed],historyPrefix:[...history],candidates:data.candidates,stage:data.stage,frameColor,frameCenters:centers,selected:false};
   if(data.stage==='CROSS')previewCross(data.candidates[0]);
   if(settings.pauseForChoice)paused=true;
   view.showCandidates(data.candidates,{stage:data.stage,coverage:data.coverage});
   if(!data.candidates.length){paused=true;view.showStatus('В заданной области вариантов не найдено. Продолжи поиск или проверь раскраску.');return;}
   view.showStatus(`Найдено ${data.candidates.length} вариантов ${labels[stage]}. ${paused?'Выбери формулу или нажми «Продолжить».':'Выполняю рекомендацию.'}`);
   if(!paused)choose(data.candidates[0].id);
  };
  worker.onerror=event=>{event.preventDefault();pending=null;view.setBusy(false);paused=true;view.showStatus('Не удалось запустить поиск: '+event.message);};
  return worker;
 }
 function request(nextStage,first=false){
  if(disposed||!active||running)return;
  stage=nextStage;normalize=first;queue=[];timeline();view.setBusy(true);view.showStatus(`Сравниваю варианты ${labels[stage]}…`);
  pending={id:++jobId,snapshot:Uint8Array.from(state),frameColor:view.getFrame().color,centers:[...frameCenters]};
  getWorker().postMessage({id:pending.id,revision,state:Array.from(state),inputState:[...initial],frameCenters:[...frameCenters],stage,settings,more,normalize:first});
 }
 function clearScramble(){scrambleRecord=null;try{localStorage.removeItem(SCRAMBLE_KEY);}catch{}view.setScramble?.(null);}
 function syncScramble(input){scrambleRecord=restoreScramble(scrambleRecord,input);if(!scrambleRecord){clearScramble();return;}view.setScramble?.(scrambleRecord);save(SCRAMBLE_KEY,scrambleRecord);}
 function onInputChange(next){cancel();active=false;paused=true;initial=Array.from(next);rebaseInput();executed=[];history=[];decision=null;stage=null;branch=null;clearScramble();save('rg2.cfop.input',next);view.showValidation({errors:[]});view.showCandidates([]);view.showStatus('Раскраска изменена. Нажми «Проверить и найти решение».');timeline();}
 function restoreDecision(){if(!decision)return;view.setFrameColor(decision.frameColor,{render:false});frameCenters=[...decision.frameCenters];state=Uint8Array.from(decision.state);executed=[...decision.executedPrefix];history=[...decision.historyPrefix];queue=[];decision.selected=false;view.renderer.setState(state);}
 function moreSearch(){if(running||pending||!decision)return;restoreDecision();paused=true;more++;request(decision.stage,normalize);}
 function solve(next,config){
  cancel();settings=config;initial=Array.from(next);rebaseInput(undefined,{resetCamera:true});executed=[];history=[];decision=null;more=0;normalize=true;branch=null;stage=null;save('rg2.cfop.input',initial);syncScramble(initial);
  const report=validate(initial);view.showValidation(report);timeline();
  if(!report.valid){active=false;view.showStatus('Исправь отмеченные ошибки раскраски.');return;}
  active=true;paused=Boolean(settings.pauseForChoice);
  if(isSolved(state)){stage='DONE';active=false;view.showStatus('Куб уже собран.');view.showCandidates([],{stage});timeline();return;}
  request('CROSS',true);
 }
 function newScramble(){
  const input=view.getInput();
  cancel();active=false;paused=true;decision=null;executed=[];history=[];stage=null;more=0;normalize=true;branch=null;
  try{
   const record=createScramble(input,{previousMoves:lastRandomMoves});lastRandomMoves=[...record.moves];
   initial=[...record.state];view.setInput(initial);rebaseInput(undefined,{resetCamera:true});save('rg2.cfop.input',initial);
   scrambleRecord=record;save(SCRAMBLE_KEY,record);view.setScramble?.(record);view.showValidation({errors:[]});view.showCandidates([]);timeline();
   view.showStatus('Новый скрамбл готов: 20 ходов. Нажми «Проверить и найти решение», когда будешь готов.');
  }catch(error){
   initial=Array.from(input);view.setInput(initial);rebaseInput();syncScramble(initial);view.showCandidates([]);timeline();
   view.showValidation({errors:[{code:'CENTERS',message:error.message,indices:[4,13,22,31,40,49]}]});view.showStatus('Для нового скрамбла сначала задай шесть разных цветов центров.');
  }
 }
 function choose(id,{single=false}={}){
  if(disposed||running||pending||!decision)return;
  const candidate=decision.candidates.find(c=>c.id===id);if(!candidate)return;
  revision++;view.setFrameColor(decision.frameColor,{render:false});frameCenters=[...decision.frameCenters];state=Uint8Array.from(decision.state);executed=[...decision.executedPrefix];history=[...decision.historyPrefix];stage=decision.stage;queue=Array.from(candidate.moves);previewCross(candidate);view.renderer.setState(state);decision.selected=true;active=true;paused=single;timeline();
  branch=candidate.family==='EOLL'?(candidate.route==='EOLL → PLL'?'PLL':'COLL'):candidate.family==='COLL'?'EPLL':null;
  view.showStatus(`Выбран ${candidate.title||candidate.family}. ${queue.length} ходов.`);if(queue.length)play(single);else next();
 }
 async function play(single=false){
  if(disposed||running||pending||!active)return;
  if(!queue.length){if(decision&&!decision.selected){choose(decision.candidates[0]?.id,{single});return;}next();return;}
  running=true;view.setBusy(true);if(!single)paused=false;
  const runRevision=revision;
  try{
   do{
    const token=queue[0];timeline(token);abort=new AbortController();
    await view.renderer.animateMove(token,{duration:480/Math.max(.25,Number(settings.speed)||1),signal:abort.signal});
    if(disposed||runRevision!==revision)return;
    history.push({state:Uint8Array.from(state),token,stage,branch});state=applyMove(state,token);executed.push(token);queue.shift();view.renderer.setState(state);timeline();
    if(single){paused=true;break;}
   }while(queue.length&&!paused);
  }catch(error){if(error.name!=='AbortError'){paused=true;view.showStatus('Ошибка анимации: '+error.message);}}
  finally{if(runRevision===revision){running=false;abort=null;view.setBusy(false);}}
  if(disposed||runRevision!==revision)return;
  if(!queue.length)next();else if(paused)view.showStatus('Пауза. Можно продолжить, выполнить один ход или выбрать другую формулу.');
 }
 function next(){
  if(!active||disposed)return;
  view.renderer.resetCamera();
  if(isSolved(state)){stage='DONE';active=false;paused=true;queue=[];timeline();view.showStatus(`Куб собран · ${executed.length} записанных ходов. Можно вернуться к предыдущему выбору или начать сначала.`);return;}
  more=0;decision=null;
  const nextStage=branch==='COLL'?(areCornersSolved(state)?'EPLL':isOLL(state)?'PLL':'COLL'):branch||(!isCross(state)?'CROSS':!isF2L(state)?'F2L':!isOLL(state)?'LAST_LAYER':'PLL');branch=null;
  paused=paused||Boolean(settings.pauseForChoice);request(nextStage);
 }
 function pause(){paused=true;view.showStatus(running?'Остановлюсь после текущего хода.':'Пауза. Выбери вариант или нажми «Продолжить».');}
 function resume(){if(!active)return;paused=false;if(!running&&!pending)play();}
 function back(){
  if(running||pending||!history.length)return;
  const previous=history.pop();state=Uint8Array.from(previous.state);branch=previous.branch??null;executed.pop();
  if(decision&&history.length<decision.historyPrefix.length){decision=null;queue=[];view.showCandidates([],{stage:previous.stage});}
  queue.unshift(previous.token);stage=previous.stage;active=true;paused=true;revision++;view.renderer.setState(state);timeline();view.showStatus('Предыдущий ход. «Ход →» выполнит его снова.');
 }
 function restart(){cancel();active=false;paused=true;decision=null;executed=[];history=[];stage=null;branch=null;more=0;normalize=true;view.setInput(initial);rebaseInput(undefined,{resetCamera:true});syncScramble(initial);view.expandEditor?.();view.showCandidates([]);timeline();view.showStatus('Возврат к исходной раскраске. Нажми «Проверить и найти решение».');}
 function changeSettings(next){const colorChanged=next.crossColor!==settings.crossColor,rankingChanged=next.rankMode!==settings.rankMode||next.prepareColl!==settings.prepareColl;settings=next;save('rg2.cfop.settings',settings);if(colorChanged){restart();const frame=view.getFrame();view.showStatus(frame.validCenters?'Цвет креста теперь снизу. Нажми «Проверить и найти решение».':'Для выбранной ориентации задай шесть разных цветов центров.');}else if(rankingChanged&&active&&!running){const target=decision?.stage||stage,frame=normalize;if(decision)restoreDecision();cancel();paused=true;request(target,frame);}}
 const api={dispose(){disposed=true;cancel();view.dispose();},debug(){return {state:Array.from(state),input:[...initial],frame:view.getFrame(),frameCenters:[...frameCenters],visual:view.renderer.getVisualState?.()??null,scramble:scrambleRecord?{...scrambleRecord,moves:[...scrambleRecord.moves],centers:[...scrambleRecord.centers],state:[...scrambleRecord.state]}:null,executed:[...executed],queue:[...queue],stage,paused,running,searching:Boolean(pending),active,candidates:decision?.candidates||[]};}};
 // Local QA and native automation use the same public actions as the visible controls.
 container.cfopSolver=api;
 return ()=>{api.dispose();delete container.cfopSolver;};
}
