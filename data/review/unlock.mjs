/* Local developer feature gate. It is not an account or a security boundary. */
export const DEVELOPER_KEY='twistforge.developer.enabled.v1';
export const DEVELOPER_PHRASE='Я знал, что так будет';
export const CHALLENGE_TITLE='Что ты здесь делаешь?!?';
export function validDeveloperPhrase(value){return typeof value==='string'&&value.normalize('NFC').trim()===DEVELOPER_PHRASE;}
export function createTapCounter({required=5,windowMs=12000,now=()=>Date.now()}={}){
  let count=0,last=0;
  return {tap(){const time=now();if(time-last>windowMs)count=0;last=time;count++;if(count>=required){count=0;return {ready:true,remaining:0};}return {ready:false,remaining:required-count};},reset(){count=0;last=0;},get count(){return count;}};
}
function storageEnabled(storage){try{return storage?.getItem(DEVELOPER_KEY)==='true';}catch{return false;}}
export function createDeveloperGate({document=globalThis.document,storage=document?.defaultView?.localStorage,launcher,iconUrl='app-icon.png',onUnlocked=()=>{},onChanged=()=>{},onStatus=()=>{},now}={}){
  if(!document)throw new TypeError('Developer gate needs a document.');
  const win=document.defaultView,counter=createTapCounter({now});
  let enabled=storageEnabled(storage),challengeShown=false,binding=null,disposed=false,busy=false,generation=0;
  const animations=new Set(),overlays=new Set();
  function write(value){enabled=Boolean(value);try{storage?.setItem(DEVELOPER_KEY,String(enabled));}catch{}onChanged(enabled);}
  function cleanupAnimation(){generation++;for(const animation of animations)animation.cancel();animations.clear();for(const node of overlays)node.remove();overlays.clear();launcher?.classList.remove('tf-review-arriving');if(launcher){launcher.style.opacity='';launcher.style.transform='';}busy=false;}
  async function animate(node,keyframes,options){
    if(!node.animate)return;
    let animation;try{animation=node.animate(keyframes,{fill:'forwards',...options});}catch{return;}animations.add(animation);
    try{await animation.finished;}catch{}finally{animations.delete(animation);}
  }
  async function celebrate(card){
    cleanupAnimation();const token=generation;busy=true;
    const reduce=Boolean(win.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    if(reduce||!card?.isConnected||!launcher?.isConnected){busy=false;return;}
    const start=card.getBoundingClientRect();
    if(start.width<1||start.height<1){busy=false;return;}
    launcher.hidden=false;launcher.classList.add('tf-review-arriving');
    const ghost=document.createElement('div');ghost.className='tf-unlock-flight';ghost.setAttribute('aria-hidden','true');
    Object.assign(ghost.style,{left:start.left+'px',top:start.top+'px',width:start.width+'px',height:start.height+'px'});
    const paper=card.cloneNode(true);paper.classList.add('tf-unlock-paper');paper.removeAttribute('id');
    paper.querySelectorAll('[id]').forEach(el=>el.removeAttribute('id'));paper.querySelectorAll('input,button').forEach(el=>{el.tabIndex=-1;el.disabled=true;});
    const origami=document.createElement('div');origami.className='tf-unlock-origami';
    for(const face of ['top','left','right']){const side=document.createElement('span');side.className='tf-origami-face '+face;for(let i=0;i<9;i++)side.append(document.createElement('i'));origami.append(side);}
    const icon=document.createElement('img');icon.src=iconUrl;icon.alt='';icon.className='tf-unlock-icon';
    ghost.append(paper,origami,icon);document.body.append(ghost);overlays.add(ghost);card.style.visibility='hidden';
    const edge=104,x=start.left+start.width/2-edge/2,y=start.top+start.height/2-edge/2;
    try{
      await Promise.all([
        animate(ghost,[{transform:'perspective(800px) rotateY(0deg) rotateZ(0deg)',borderRadius:'18px'},{transform:'perspective(800px) rotateY(185deg) rotateZ(22deg)',borderRadius:'35px',offset:.62},{left:x+'px',top:y+'px',width:edge+'px',height:edge+'px',transform:'perspective(800px) rotateY(360deg) rotateZ(-8deg)',borderRadius:'26px'}],{duration:720,easing:'cubic-bezier(.35,.02,.2,1)'}),
        animate(paper,[{opacity:1,transform:'scale(1)'},{opacity:0,transform:'scale(.14)',offset:.84},{opacity:0,transform:'scale(.1)'}],{duration:680,easing:'ease-in'}),
        animate(origami,[{opacity:0,transform:'translate(-50%,-50%) rotateX(10deg) rotateY(-45deg) scale(.2)'},{opacity:1,transform:'translate(-50%,-50%) rotateX(10deg) rotateY(315deg) scale(1)',offset:.7},{opacity:1,transform:'translate(-50%,-50%) rotateX(10deg) rotateY(315deg) scale(1)'}],{duration:720,easing:'ease-in-out'})
      ]);
      if(disposed||token!==generation)return;
      await Promise.all([animate(icon,[{opacity:0,transform:'scale(.9)'},{opacity:1,transform:'scale(1)'}],{duration:220}),animate(origami,[{opacity:1},{opacity:0}],{duration:220})]);
      if(disposed||token!==generation)return;
      const target=launcher.getBoundingClientRect(),tx=target.left+Math.min(target.width,58)/2-edge/2,ty=target.top+target.height/2-edge/2;
      await animate(ghost,[{left:x+'px',top:y+'px',width:edge+'px',height:edge+'px',transform:'rotate(-8deg) scale(1)'},{left:(x+tx)/2+'px',top:Math.min(y,ty)-55+'px',width:edge+'px',height:edge+'px',transform:'rotate(160deg) scale(.8)',offset:.42},{left:tx+'px',top:ty+'px',width:edge+'px',height:edge+'px',transform:'rotate(360deg) scale(.38)'}],{duration:740,easing:'cubic-bezier(.3,.02,.4,1)'});
      if(disposed||token!==generation)return;
      launcher.classList.remove('tf-review-arriving');
      await animate(launcher,[{transform:'scale(.8)',boxShadow:'0 0 0 0 var(--accent)'},{transform:'scale(1.08)',boxShadow:'0 0 0 13px transparent',offset:.6},{transform:'scale(1)',boxShadow:'0 0 0 18px transparent'}],{duration:360,easing:'ease-out'});
    }finally{
      card.style.visibility='';ghost.remove();overlays.delete(ghost);
      if(token===generation){busy=false;launcher?.classList.remove('tf-review-arriving');launcher?.getAnimations?.().forEach(a=>a.cancel());}
    }
  }
  function renderChallenge(){
    if(!binding?.host?.isConnected||disposed)return;
    binding.host.querySelector('[data-tf-developer-card]')?.remove();
    if(enabled){
      const status=document.createElement('section');status.className='tf-developer-status';status.dataset.tfDeveloperCard='true';
      status.innerHTML='<div><strong>Режим разработчика открыт</strong><p>Пометки, предпросмотр и экспорт доступны через кнопку «Режим правок».</p></div><button type="button" data-tf-lock>Скрыть режим разработчика</button>';
      status.querySelector('button').onclick=()=>{cleanupAnimation();write(false);challengeShown=false;renderChallenge();onStatus('Режим разработчика скрыт. Пометки сохранены.');};binding.host.append(status);return;
    }
    if(!challengeShown)return;
    const card=document.createElement('section');card.className='tf-dev-challenge';card.dataset.tfDeveloperCard='true';
    const title=document.createElement('h3');title.textContent=CHALLENGE_TITLE;
    const description=document.createElement('p');description.textContent='У каждой двери есть свой алгоритм. Знаешь этот?';
    const form=document.createElement('form'),label=document.createElement('label');label.textContent='Код разработчика';
    const input=document.createElement('input');input.type='password';input.autocomplete='off';input.spellcheck=false;input.maxLength=128;input.setAttribute('aria-label','Код разработчика');input.dataset.tfDeveloperCode='true';label.append(input);
    const submit=document.createElement('button');submit.type='submit';submit.textContent='Открыть';
    const feedback=document.createElement('p');feedback.className='tf-dev-feedback';feedback.setAttribute('role','status');
    form.append(label,submit);card.append(title,description,form,feedback);binding.host.append(card);
    form.onsubmit=async event=>{
      event.preventDefault();if(busy||disposed)return;
      if(!validDeveloperPhrase(input.value)){feedback.textContent='Код не подошёл. Попробуй ещё раз.';input.setAttribute('aria-invalid','true');return;}
      input.removeAttribute('aria-invalid');feedback.textContent='Верный поворот. Режим правок открыт.';submit.disabled=true;input.value='';
      write(true);await celebrate(card);
      if(!disposed){renderChallenge();onUnlocked({animated:true});onStatus('Режим правок открыт. Добро пожаловать в мастерскую.');}
    };
    win.setTimeout(()=>{if(card.isConnected&&!busy)input.focus({preventScroll:true});},0);
  }
  function unbind(){if(!binding)return;binding.element.removeEventListener('click',binding.click);binding.element.removeEventListener('keydown',binding.key);binding.host?.querySelector('[data-tf-developer-card]')?.remove();binding=null;counter.reset();}
  function bindBuildNumber(element,settingsHost){
    if(disposed)return;
    if(binding?.element===element&&binding?.host?.isConnected)return;
    if(busy&&!binding?.host?.isConnected)cleanupAnimation();unbind();
    if(!element||!settingsHost)return;
    if(!['BUTTON','A'].includes(element.tagName)){element.setAttribute('role','button');element.tabIndex=0;}
    element.classList.add('tf-build-number');element.setAttribute('aria-label','Номер сборки. Пять нажатий открывают доступ разработчика.');
    const click=()=>{if(enabled){renderChallenge();return;}const result=counter.tap();if(result.ready){challengeShown=true;renderChallenge();}else if(result.remaining<=2)onStatus(`Ещё ${result.remaining} ${result.remaining===1?'нажатие':'нажатия'}…`);};
    const key=event=>{if(!['BUTTON','A'].includes(element.tagName)&&(event.key==='Enter'||event.key===' ')){event.preventDefault();click();}};
    binding={element,host:settingsHost,click,key};element.addEventListener('click',click);element.addEventListener('keydown',key);renderChallenge();
  }
  return {get enabled(){return enabled;},get busy(){return busy;},bindBuildNumber,setEnabled(value){cleanupAnimation();write(value);challengeShown=false;renderChallenge();},dispose(){if(disposed)return;disposed=true;cleanupAnimation();unbind();},debug(){return {enabled,busy,challengeShown,taps:counter.count,animations:animations.size,overlays:overlays.size};}};
}
