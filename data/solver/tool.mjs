import {SOLVED,applyAlg,applyMove,validate,stateKey,isCross,isF2L,isOLL,isSolved,areCornersSolved} from './core.mjs';
import {createSolverView} from './view.mjs';
const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}};
const save=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));}catch{}};
const labels={CROSS:'креста',F2L:'пары F2L',LAST_LAYER:'OLL / COLL',COLL:'COLL',EPLL:'EPLL',PLL:'PLL'};
export function mount(container){
 let disposed=false,worker=null,jobId=0,revision=0,pending=null,abort=null,running=false,paused=true,active=false,stage=null,decision=null,queue=[],executed=[],history=[],more=0,normalize=true,branch=null;
 let initial=read('rg2.cfop.input',Array.from(SOLVED)),state=Uint8Array.from(initial),settings=read('rg2.cfop.settings',{});
 if(!Array.isArray(initial)||initial.length!==54)initial=Array.from(SOLVED);
 const view=createSolverView(container,{onInputChange,onSolve:solve,onDemo:demo,onChoose:choose,onPause:pause,onResume:resume,onStepForward:()=>play(true),onStepBack:back,onRestart:restart,onMore:moreSearch,onSettingsChange:changeSettings},settings);
 settings=view.getSettings();view.setInput(initial);
 function timeline(current=null){view.setTimeline({executed,current,upcoming:queue.slice(current?1:0),stage});}
 function cancel(){revision++;pending=null;worker?.terminate();worker=null;abort?.abort();abort=null;queue=[];running=false;view.setBusy(false);}
 function getWorker(){
  if(worker)return worker;
  worker=new Worker(new URL('./worker.mjs',import.meta.url),{type:'module'});
  worker.onmessage=({data})=>{
   if(disposed||!pending||data.id!==pending.id||data.revision!==revision||data.hash!==stateKey(state))return;
   const snapshot=pending.snapshot;pending=null;view.setBusy(false);
   if(data.error){paused=true;view.showStatus('Поиск остановлен: '+data.error);return;}
   decision={state:snapshot,executedPrefix:[...executed],historyPrefix:[...history],candidates:data.candidates,stage:data.stage};
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
  pending={id:++jobId,snapshot:Uint8Array.from(state)};
  getWorker().postMessage({id:pending.id,revision,state:Array.from(state),stage,settings,more,normalize:first});
 }
 function onInputChange(next){cancel();active=false;paused=true;initial=next;state=Uint8Array.from(next);executed=[];history=[];decision=null;stage=null;save('rg2.cfop.input',next);view.showValidation({errors:[]});view.showCandidates([]);view.showStatus('Раскраска изменена. Нажми «Проверить и найти решение».');timeline();}
 function restoreDecision(){if(!decision)return;state=Uint8Array.from(decision.state);executed=[...decision.executedPrefix];history=[...decision.historyPrefix];queue=[];view.renderer.setState(state);}
 function moreSearch(){if(running||pending||!decision)return;restoreDecision();paused=true;more++;request(decision.stage,normalize);}
 function solve(next,config){
  cancel();settings=config;initial=Array.from(next);state=Uint8Array.from(next);executed=[];history=[];decision=null;more=0;normalize=true;branch=null;stage=null;save('rg2.cfop.input',initial);
  const report=validate(state);view.showValidation(report);timeline();
  if(!report.valid){active=false;view.showStatus('Исправь отмеченные ошибки раскраски.');return;}
  active=true;paused=Boolean(settings.pauseForChoice);view.collapseEditor();
  if(isSolved(state)){stage='DONE';active=false;view.showStatus('Куб уже собран.');view.showCandidates([],{stage});timeline();return;}
  request('CROSS',true);
 }
 function demo(){const alg="R U2 F' L D2 B R2 U' F2 D L2 B' R U F' D2 R2 B2 U L'";const next=Array.from(applyAlg(SOLVED,alg));view.setInput(next);onInputChange(next);view.showStatus('Загружен пример. Нажми «Проверить и найти решение».');}
 function choose(id,{single=false}={}){
  if(disposed||running||pending||!decision)return;
  const candidate=decision.candidates.find(c=>c.id===id);if(!candidate)return;
  revision++;state=Uint8Array.from(decision.state);executed=[...decision.executedPrefix];history=[...decision.historyPrefix];stage=decision.stage;queue=Array.from(candidate.moves);view.renderer.setState(state);active=true;paused=single;timeline();
  branch=candidate.family==='EOLL'?(candidate.route==='EOLL → PLL'?'PLL':'COLL'):candidate.family==='COLL'?'EPLL':null;
  view.showStatus(`Выбран ${candidate.title||candidate.family}. ${queue.length} ходов.`);if(queue.length)play(single);else next();
 }
 async function play(single=false){
  if(disposed||running||pending||!active)return;
  if(!queue.length){if(decision&&stateKey(state)===stateKey(decision.state)){choose(decision.candidates[0]?.id,{single});return;}next();return;}
  running=true;view.setBusy(true);if(!single)paused=false;
  const runRevision=revision;
  try{
   do{
    const token=queue[0];timeline(token);abort=new AbortController();
    await view.renderer.animateMove(token,{duration:240/Math.max(.25,Number(settings.speed)||1),signal:abort.signal});
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
 function restart(){cancel();active=false;paused=true;decision=null;executed=[];history=[];stage=null;state=Uint8Array.from(initial);view.setInput(initial);view.expandEditor();view.showCandidates([]);timeline();view.showStatus('Возврат к исходной раскраске. Нажми «Проверить и найти решение».');}
 function changeSettings(next){const colorChanged=next.crossColor!==settings.crossColor,rankingChanged=next.rankMode!==settings.rankMode||next.prepareColl!==settings.prepareColl;settings=next;save('rg2.cfop.settings',settings);if(colorChanged&&active){restart();view.showStatus('Цвет креста изменён. Запусти поиск для исходной раскраски.');}else if(rankingChanged&&active&&!running){const target=decision?.stage||stage,frame=normalize;if(decision)restoreDecision();cancel();paused=true;request(target,frame);}}
 const api={dispose(){disposed=true;cancel();view.dispose();},debug(){return {state:Array.from(state),executed:[...executed],queue:[...queue],stage,paused,running,searching:Boolean(pending),active,candidates:decision?.candidates||[]};}};
 // Local QA and native automation use the same public actions as the visible controls.
 container.cfopSolver=api;
 return ()=>{api.dispose();delete container.cfopSolver;};
}
