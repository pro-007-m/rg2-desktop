import {applyAlg,rotateToCross,isF2L,stateKey,solvedSlots} from './core.mjs';
import {searchCross,searchF2L} from './search.mjs';
import {loadCatalog,getApplicable,costScore,bestContinuation,matchF2L} from './catalog.mjs';
let catalogPromise;
const getCatalog=()=>catalogPromise??=loadCatalog();
const score=(moves,settings)=>costScore(moves,settings.rankMode==='htm'?'htm':'execution');
function decorate(c,settings){
 const cost=score(c.moves,settings),lookahead=c.estimatedTotalHTM??c.htm??cost;
 return {...c,score:cost,title:c.title|| (c.family==='CROSS'?`Крест${c.xCrossSlots?.length?' + '+c.xCrossSlots.length+' пара':''}`:`Пара ${c.targetSlot||''} · ${c.solvedAfter?.length||0}/4`),recommendationScore:settings.rankMode==='htm'?lookahead:cost+Math.max(0,lookahead-(c.htm||0))*.75};
}
self.onmessage=async event=>{
 const {id,revision,state:raw,stage,settings={},more=0,normalize=false}=event.data;
 const state=Uint8Array.from(raw),hash=stateKey(state);
 try{
  let result;
  if(stage==='CROSS'){
   const colors=normalize?(settings.crossColor==='auto'?[0,1,2,3,4,5]:[Number(settings.crossColor??0)]):[null];
   const candidates=[],reports=[];
   for(const color of colors){
    const frame=color===null?{state,moves:[]}:rotateToCross(state,color);
    const found=searchCross(frame.state,{maxCandidates:24*(more+1),maxMillis:2400+more*1500,maxNodes:300000*(more+1),extraDepth:Math.min(3,1+more)});
    for(const candidate of found.candidates){
     const look=searchF2L(Uint8Array.from(candidate.state),{maxCandidates:1,maxMillis:180,maxNodes:4000,lookahead:true});
     const first=look.candidates[0];
     candidates.push(decorate({...candidate,id:`${color??'d'}:${candidate.id}`,family:'CROSS',moves:[...frame.moves,...candidate.moves],estimatedTotalHTM:candidate.htm+(first?.estimatedTotalHTM??first?.htm??0),crossColor:color,expectedPll:undefined},settings));
    }
    reports.push(found.coverage);
   }
   candidates.sort((a,b)=>a.recommendationScore-b.recommendationScore||a.htm-b.htm);
   result={candidates,coverage:{...reports[0],incomplete:reports.some(r=>!r.exhaustedDeclaredDomain),message:`Крест: кратчайшая длина ${Math.min(...reports.map(r=>r.minimumHTM))} HTM доказана таблицей всех 190 080 состояний. ${colors.length===6?'Сравнены 6 цветов. ':''}Альтернативы: ${candidates.length}; область поиска — до ${Math.max(...reports.map(r=>r.requestedMaxDepth))} ходов. Продолжение F2L оценено в пределах бюджета.`}};
  }else if(stage==='F2L'){
   const found=searchF2L(state,{maxCandidates:32*(more+1),maxMillis:2800+more*1800,maxNodes:60000*(more+1),extraDepth:Math.min(6,2+more)});
   const catalog=await getCatalog(),profile=settings.rankMode==='htm'?'htm':'execution',source=matchF2L(state,{catalog,profile,lookahead:false});
   const unique=new Map();
   for(const c of [...found.candidates,...source]){
    const key=c.moves.join(' '),old=unique.get(key);unique.set(key,{...old,...c,family:'F2L',targetSlot:c.targetSlot||c.slot,solvedAfter:c.solvedAfter||c.solvedSlots});
   }
   const candidates=[...unique.values()].map(c=>decorate(c,settings)),continuations=new Map();
   for(const c of candidates){
    if(isF2L(c.state)){
     const tail=bestContinuation(Uint8Array.from(c.state),{catalog,allowEollPrep:settings.prepareColl,profile,preferColl:true});
     if(tail){c.recommendationScore=c.score+(tail.totalCost??tail.cost??0);c.expectedPll=`${tail.family}: ${tail.moves.join(' ')}`;}
    }else if(c.estimatedTotalHTM==null){
     const key=stateKey(c.state);
     if(!continuations.has(key))continuations.set(key,searchF2L(Uint8Array.from(c.state),{maxCandidates:1,maxMillis:100,maxNodes:3000,lookahead:true}).candidates[0]);
     const next=continuations.get(key),remaining=next?.estimatedTotalHTM??next?.htm??(4-solvedSlots(c.state).length)*8;
     c.recommendationScore=c.score+remaining*(settings.rankMode==='htm'?1:.75);
    }
   }
   candidates.sort((a,b)=>a.recommendationScore-b.recommendationScore||a.htm-b.htm);
   result={...found,candidates,coverage:{...found.coverage,message:`Найдено ${candidates.length} вариантов: все применимые формулы базы (${source.length}) и поиск вставок. Сохраняются крест и ${solvedSlots(state).length} собранные пары на границах этапов. Проверено ${found.coverage.visitedNodes||0} узлов; ${found.coverage.exhaustedDeclaredDomain?'объявленная область перебрана.':'поиск ограничен бюджетом, его можно продолжить.'}`}};
  }else{
   const catalog=await getCatalog();
   const candidates=getApplicable(state,{stage,catalog,preferColl:true,allowEollPrep:settings.prepareColl,profile:settings.rankMode==='htm'?'htm':'execution'}).map(c=>({...c,score:c.cost,expectedPll:c.expectedPll?`${c.nextColl?.moves?.length?'COLL: '+c.nextColl.moves.join(' ')+'; затем ':''}${c.expectedPll.title||'PLL'} · ${c.expectedPll.moves?.join(' ')||'без ходов'}`:undefined}));
   result={candidates,coverage:{exhaustedDeclaredDomain:true,message:`Проверены все применимые формулы локальной базы, включая AUF и ориентации. ${candidates.length} вариантов. Для OLL/COLL рейтинг учитывает следующий PLL.`}};
  }
  for(const c of result.candidates){const actual=applyAlg(state,c.moves);if(c.state&&stateKey(actual)!==stateKey(c.state))throw new Error('Результат алгоритма не совпадает с состоянием куба.');c.state=Array.from(actual);}
  self.postMessage({id,revision,hash,stage,...result});
 }catch(error){self.postMessage({id,revision,hash,stage,error:error.message,stack:error.stack});}
};
