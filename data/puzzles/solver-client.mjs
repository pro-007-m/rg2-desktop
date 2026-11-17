import {applyAlg} from './core.mjs';
import {orientForCross} from '../solver/orientation.mjs';
import {centers,isCross,isF2L,isOLL,isSolved,areCornersSolved,stateKey} from '../solver/core.mjs';

export function next3Stage(state,branch=null){
  if(isSolved(state))return 'DONE';
  if(!isCross(state))return 'CROSS';
  if(!isF2L(state))return 'F2L';
  if(branch==='COLL')return areCornersSolved(state)?'EPLL':'COLL';
  if(branch==='EPLL')return 'EPLL';
  return isOLL(state)?'PLL':'LAST_LAYER';
}
export const STAGE_NAMES={CROSS:'Крест · CROSS',F2L:'Пара · F2L',LAST_LAYER:'Ориентация · OLL / COLL',COLL:'Углы · COLL',EPLL:'Рёбра · EPLL',PLL:'Перестановка · PLL',DONE:'Головоломка собрана'};
function aborted(){return new DOMException('Расчёт отменён','AbortError');}
export async function suggest3(raw,{crossColor=0,rankMode='execution',prepareColl=true,branch=null,more=0,signal}={}){
  if(signal?.aborted)throw aborted();
  const original=Uint8Array.from(raw),frame=orientForCross(original,crossColor),state=Uint8Array.from(frame.state),stage=next3Stage(state,branch);
  if(stage==='DONE')return {stage,candidates:[],coverage:{message:'Куб уже собран.'}};
  const setup=[...frame.moves],hash=stateKey(state);
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('../solver/worker.mjs',import.meta.url),{type:'module'});
    const timeout=setTimeout(()=>finish(new Error('Поиск превысил время ожидания. Попробуй ещё раз.')),120000);
    const abort=()=>finish(aborted());
    function finish(error,result){clearTimeout(timeout);signal?.removeEventListener('abort',abort);worker.terminate();error?reject(error):resolve(result);}
    signal?.addEventListener('abort',abort,{once:true});
    worker.onerror=e=>{e.preventDefault();finish(new Error(e.message||'Не удалось запустить локальный поиск.'));};
    worker.onmessage=({data})=>{
      if(data.id!==1||data.revision!==0||data.hash!==hash)return;
      if(data.error){finish(new Error(data.error));return;}
      try{
        const candidates=data.candidates.map(c=>{
          const moves=[...setup,...c.moves],actual=applyAlg(original,3,moves);
          if(!c.state||actual.length!==c.state.length||actual.some((v,i)=>v!==c.state[i]))throw new Error('Проверка найденного алгоритма не пройдена.');
          return {...c,moves,stage,title:c.title||STAGE_NAMES[stage],method:'CFOP + COLL',setupMoves:setup};
        });
        finish(null,{stage,candidates,coverage:data.coverage});
      }catch(e){finish(e);}
    };
    worker.postMessage({id:1,revision:0,state:[...state],inputState:[...state],frameCenters:centers(state),stage,settings:{crossColor,rankMode,prepareColl},more,normalize:false});
  });
}
export async function suggest(game,options={}){
  if(game.spec.kind==='cube'&&game.spec.size===3)return suggest3(game.state,options);
  if(game.spec.kind==='cube'&&game.spec.size>=4&&options.method!=='constructive'){
    const {extractVirtual3,lift3Algorithm}=await import('./solver-nxn.mjs'),projection=extractVirtual3(game.state,game.spec.size);
    if(projection.readyFor3){
      const found=await suggest3(projection.state,options);
      const candidates=found.candidates.map(candidate=>{
        const moves=lift3Algorithm(candidate.moves,game.spec.size),state=applyAlg(game.state,game.spec.size,moves),after=extractVirtual3(state,game.spec.size);
        if(!after.readyFor3||after.state.some((v,i)=>v!==candidate.state[i]))throw new Error('Переход между большим кубом и этапом 3×3 не прошёл проверку.');
        return {...candidate,moves,state:[...state],method:'Редукция + CFOP / COLL',virtualState:candidate.state,verified:true};
      });
      return {...found,method:'Редукция + CFOP / COLL',candidates,coverage:{...found.coverage,message:'Центры и рёбра собраны. '+(found.coverage?.message||'Продолжаем по методу CFOP + COLL.')}};
    }
  }
  const module=await import('./solver-general.mjs');
  return module.suggestPuzzle(game,options);
}
