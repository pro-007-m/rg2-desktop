export async function suggestPuzzle(game,{signal,onProgress=()=>{},crossColor=0,maxMs=180000,method='reduction'}={}){
  if(signal?.aborted)throw new DOMException('Расчёт отменён','AbortError');
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./solver-general-worker.mjs',import.meta.url),{type:'module'});
    const abort=()=>finish(new DOMException('Расчёт отменён','AbortError'));
    const timeout=setTimeout(()=>finish(new Error('Поиск превысил бюджет времени. Позиция сохранена; расчёт можно повторить.')),maxMs);
    function finish(error,result){clearTimeout(timeout);signal?.removeEventListener('abort',abort);worker.terminate();error?reject(error):resolve(result);}
    signal?.addEventListener('abort',abort,{once:true});
    worker.onerror=e=>{e.preventDefault();finish(new Error(e.message||'Не удалось выполнить локальный расчёт.'));};
    worker.onmessage=({data})=>{if(data.progress){onProgress(data.progress);return;}if(data.error)finish(new Error(data.error));else if(data.result)finish(null,data.result);};
    worker.postMessage({spec:game.spec,state:[...game.state],initialState:[...(game.goal||game.initial)],options:{crossColor,maxMs,method}});
  });
}
