/* Adapter between the shared review tool and the existing offline reader. */
import {mountReview} from './ui.mjs';

async function start(){
  const app=window.RG2App;
  if(!app||!await app.ready)return null;
  const getArticle=()=>{
    const route=app.state.route,item=route?.type==='item'?app.items.get(route.id):null;
    const element=document.querySelector('#article-body');
    if(!item||!element||/^ABOUT(?:[-_]|$)/i.test(item.id))return null;
    return {id:item.id,title:item.title,path:app.lessonPath(item.id),html:item.html||'',element};
  };
  const getLessons=()=>[...app.items.values()].filter(item=>item.kind==='article'&&!/^ABOUT(?:[-_]|$)/i.test(item.id))
    .map(item=>({id:item.id,title:item.title,path:app.lessonPath(item.id)}));
  const sanitize=html=>app.sanitizeArticle(html);
  const exportFile=async(text,name)=>{
    if(typeof text!=='string'||new TextEncoder().encode(text).byteLength>8*1024*1024)throw new Error('Пакет правок превышает 8 МБ.');
    if(window.RG2Platform?.post?.('export-review',{text,name}))return true;
    if(window.chrome?.webview?.postMessage){window.chrome.webview.postMessage({type:'export-review',text,name});return true;}
    const url=URL.createObjectURL(new Blob([text],{type:'application/json'})),link=document.createElement('a');
    link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return true;
  };
  const api=mountReview({app,getArticle,getLessons,openLesson:id=>app.openItem(id),sanitize,
    applyArticlePreview:options=>app.applyArticlePreview(options),exportFile,
    appVersion:app.version,iconUrl:new URL('../app-icon.png',import.meta.url).href});
  window.TwistForgeReview={
    get ready(){return api.ready;},
    receiveImport:async text=>{await api.ready;return api.importReview(text);},
    handleBack:()=>api.handleBack?.()===true,
    pause:()=>api.pause?.(),
    debug:()=>api.debug?.(),
    exportReview:()=>api.exportReview(),
    importReview:text=>api.importReview(text),
    get instance(){return api;}
  };
  const refresh=()=>{
    api.refresh();
    const number=document.querySelector('#app-version');
    if(number)api.bindBuildNumber(number,number.closest('section'));
  };
  document.addEventListener('rg2:navigation',refresh);
  window.addEventListener('rg2:pause',()=>api.pause?.());
  await api.ready;refresh();
  return api;
}

window.TwistForgeReviewReady=start().catch(error=>{
  console.error('TwistForge review could not start',error);
  window.RG2App?.toast('Не удалось открыть режим правок. Перезапусти приложение.');
  return null;
});
