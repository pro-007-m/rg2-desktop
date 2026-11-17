import {applyAlg} from './core.mjs';
import {applyPolyAlg,createPolyPuzzle} from './poly-core.mjs';
self.onmessage=async({data})=>{
  const {spec,state,initialState,options={}}=data,onProgress=progress=>self.postMessage({progress:typeof progress==='string'?progress:[progress.message||progress.title||'Планирую сборку',Number.isFinite(progress.moves)?`${progress.moves} ходов`:''].filter(Boolean).join(' · ')});
  try{
    let result;
    if(spec.kind==='cube'&&spec.size===2){const {suggest2}=await import('./solver-two.mjs');result=suggest2(state,options);}
    else if(spec.kind==='cube'){
      const {suggestNxN,suggestReduction}=await import('./solver-nxn.mjs');result=await(options.method==='constructive'?suggestNxN:suggestReduction)(state,spec.size,{...options,initialState,onProgress});
    }else{
      const {suggestPoly}=await import('./solver-poly.mjs'),puzzle=createPolyPuzzle(spec.kind,spec.size);result=await suggestPoly(state,puzzle,{...options,onProgress});
    }
    if(!result||!Array.isArray(result.candidates))throw new Error('Решатель вернул неверный результат.');
    for(const candidate of result.candidates){
      const actual=spec.kind==='cube'?applyAlg(state,spec.size,candidate.moves):applyPolyAlg(state,createPolyPuzzle(spec.kind,spec.size),candidate.moves);
      if(!candidate.state||actual.length!==candidate.state.length||actual.some((v,i)=>v!==candidate.state[i]))throw new Error('Найденная формула не прошла независимую проверку состояния.');
      candidate.state=[...actual];
    }
    self.postMessage({result});
  }catch(error){self.postMessage({error:error.message});}
};
