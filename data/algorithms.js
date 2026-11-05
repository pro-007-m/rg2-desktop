(function(root,factory){
  const api=factory();
  if(typeof module==='object' && module.exports)module.exports=api;
  if(root)root.RG2Algorithms=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:null,function(){
  'use strict';

  // Notation is recognized without normalizing the source. In particular M'2,
  // M2', wide moves, curly primes, grouping and Square-1 signs keep their spelling.
  const prime="['’′‘´]";
  const move=new RegExp('(?:[1-9][0-9]*)?[RLUDFBMESXYZrludfbmesxyz]w?(?:[0-9²³]+'+prime+'?|'+prime+'[0-9²³]*|[+-]{1,2})?','y');
  const word=/[A-Za-z0-9²³'’′‘´+\-]+/g;
  const gap=/^[\s()[\],:]*$/;
  const boundaryLetter=/[\p{L}\p{N}_]/u;
  const labels=/алгоритм[^:;\n]{0,100}:\s*[([]*\s*$|формула[^:;\n]{0,100}:\s*[([]*\s*$|algorithm[^:;\n]{0,100}:\s*[([]*\s*$/i;

  function describeWord(value){
    if(/^[0-9²³]+$/.test(value))return {repeat:true,count:0};
    // Names such as F2L and cubie labels such as URF are not move sequences.
    if(/^(?:F2L|OLL|PLL|COLL|CLL|ELL|LSE|OLLCP)$/i.test(value))return null;
    let at=0,count=0;
    while(at<value.length){
      move.lastIndex=at;
      const token=move.exec(value);
      if(!token || token.index!==at)return null;
      at=move.lastIndex;count++;
    }
    return count?{count,upper:/[A-Z]/.test(value),modifier:/[0-9²³'’′‘´+\-]/.test(value),single:value.length===1,
      ambiguous:count>1 && /^[A-Za-z]+$/.test(value)}:null;
  }

  function cubeSpans(text,options){
    const result=[];
    const minimum=Number.isInteger(options.minMoves)?Math.max(1,options.minMoves):3;
    let sequence=null;
    function finish(){
      if(!sequence)return;
      let start=sequence.start,end=sequence.end;
      // Include leading grouping, but leave a Russian label or explanatory
      // punctuation outside the copyable sequence.
      let cursor=start;
      while(cursor>0){
        let before=cursor;
        while(before>0 && /\s/.test(text[before-1]))before--;
        if(before>0 && /[([]/.test(text[before-1]))cursor=before-1;
        else break;
      }
      start=cursor;
      while(end<text.length){
        let after=end;
        while(after<text.length && /\s/.test(text[after]))after++;
        if(after<text.length && /[)\]]/.test(text[after]))end=after+1;
        else break;
      }
      const explicit=labels.test(text.slice(Math.max(0,start-140),start));
      const enough=sequence.count>=(explicit?1:minimum);
      const hasNotation=(sequence.upper || sequence.modifier || sequence.allSingle) && sequence.unambiguous;
      const left=start>0?text[start-1]:'';
      const right=end<text.length?text[end]:'';
      const leftBoundary=/[([]/.test(text[start]) || !boundaryLetter.test(left);
      const rightBoundary=/[)\]]/.test(text[end-1]) || !boundaryLetter.test(right);
      if(enough && hasNotation && leftBoundary && rightBoundary)result.push({start,end});
      sequence=null;
    }
    word.lastIndex=0;
    for(let match; (match=word.exec(text));){
      const value=match[0],start=match.index,end=start+value.length;
      const before=start>0?text[start-1]:'';
      const after=end<text.length?text[end]:'';
      const info=describeWord(value);
      if(!info || boundaryLetter.test(before) || boundaryLetter.test(after)) {finish();continue;}
      const between=sequence?text.slice(sequence.end,start):'';
      if(info.repeat){
        // A numeric repetition belongs to a closed group, not a numbered list.
        if(sequence && /^[)\]]+\s*$/.test(between))sequence.end=end;
        else if(/^\s*[(\[]/.test(text.slice(end))){
          if(sequence && gap.test(between))sequence.end=end;
          else {finish();sequence={start,end,count:0,upper:false,modifier:false,allSingle:true,unambiguous:false};}
        }
        else finish();
        continue;
      }
      if(sequence && !gap.test(between))finish();
      if(!sequence)sequence={start,end,count:0,upper:false,modifier:false,allSingle:true,unambiguous:false};
      sequence.end=end;sequence.count+=info.count;
      sequence.upper=sequence.upper || info.upper;
      sequence.modifier=sequence.modifier || info.modifier;
      sequence.allSingle=sequence.allSingle && info.single;
      sequence.unambiguous=sequence.unambiguous || !info.ambiguous;
    }
    finish();
    return result;
  }

  function squareSpans(text){
    const pair='\\(\\s*[+\\-−]?\\d+\\s*,\\s*[+\\-−]?\\d+\\s*\\)';
    const pattern=new RegExp('(?:/\\s*)?'+pair+'(?:\\s*/\\s*(?:'+pair+')?)*','g');
    const spans=[];
    for(let match; (match=pattern.exec(text));){
      if(!match[0].includes('/'))continue;
      // The slash is an actual Square-1 turn and is retained, including a final /.
      const leading=match[0].match(/^\s*/)[0].length;
      const trailing=match[0].match(/\s*$/)[0].length;
      const start=match.index+leading,end=match.index+match[0].length-trailing;
      if((start>0 && boundaryLetter.test(text[start-1])) || (end<text.length && boundaryLetter.test(text[end])))continue;
      spans.push({start,end});
    }
    return spans;
  }

  function splitAlgorithms(value,options){
    const text=String(value==null?'':value);options=options || {};
    const squares=squareSpans(text);
    const cubes=cubeSpans(text,options).filter(span=>!squares.some(square=>span.start<square.end && square.start<span.end));
    const spans=[...squares,...cubes].sort((a,b)=>a.start-b.start || b.end-a.end);
    const parts=[];let position=0;
    for(const span of spans){
      if(span.start<position)continue;
      if(span.start>position)parts.push({type:'text',text:text.slice(position,span.start)});
      parts.push({type:'algorithm',text:text.slice(span.start,span.end)});
      position=span.end;
    }
    if(position<text.length || !parts.length)parts.push({type:'text',text:text.slice(position)});
    return parts;
  }

  const blocks=new Set(['P','DIV','LI','TD','TH','BLOCKQUOTE','PRE','H1','H2','H3','H4','H5','H6']);
  const protectedTags=new Set(['A','IMG','BUTTON','SCRIPT','STYLE','TEXTAREA','INPUT','SVG','MATH']);

  function textRuns(container){
    const runs=[];let current=[];
    const flush=()=>{if(current.length)runs.push(current);current=[];};
    function visit(node){
      if(node.nodeType===3){current.push(node);return;}
      if(node.nodeType!==1)return;
      if(node.classList.contains('algorithm-block') || protectedTags.has(node.tagName)){flush();return;}
      if(node.tagName==='BR' || node.tagName==='HR'){flush();return;}
      const block=blocks.has(node.tagName);
      if(block)flush();
      [...node.childNodes].forEach(visit);
      if(block)flush();
    }
    [...container.childNodes].forEach(visit);flush();return runs;
  }

  function pointAt(nodes,offset){
    let remaining=offset;
    for(const node of nodes){
      if(remaining<=node.data.length)return {node,offset:remaining};
      remaining-=node.data.length;
    }
    const node=nodes[nodes.length-1];return {node,offset:node.data.length};
  }

  function makeBlock(document,formula,options){
    const block=document.createElement('span');block.className='algorithm-block';
    const code=document.createElement('code');code.className='algorithm-code';code.textContent=formula;block.appendChild(code);
    const actions=document.createElement('span');actions.className='algorithm-actions';
    const copy=document.createElement('button');copy.type='button';copy.className='copy-algorithm';
    copy.dataset.copyAlgorithm=formula;copy.title='Копировать алгоритм';copy.setAttribute('aria-label','Копировать алгоритм');
    if(typeof options.icon==='function')copy.innerHTML=options.icon('copy');else copy.textContent='Копировать';
    const focus=document.createElement('button');focus.type='button';focus.className='focus-algorithm';
    focus.title='Выделить алгоритм';focus.setAttribute('aria-label','Выделить алгоритм');focus.setAttribute('aria-pressed','false');focus.textContent='Выделить';
    actions.append(copy,focus);block.appendChild(actions);return block;
  }

  function prepare(container,options){
    if(!container || !container.ownerDocument)return [];
    options=options || {};
    const document=container.ownerDocument;
    // Original video links can include prose before or after a formula. Keep the
    // same link around its moves, retaining the surrounding words in their exact
    // order outside the block and the independent buttons outside the anchor.
    for(const anchor of [...container.querySelectorAll('a')]){
      if(anchor.closest('.algorithm-block') || anchor.querySelector('img'))continue;
      const parts=splitAlgorithms(anchor.textContent,{minMoves:2});
      const formulas=parts.filter(part=>part.type==='algorithm');
      if(formulas.length!==1)continue;
      const formula=formulas[0].text,whole=anchor.textContent,index=whole.indexOf(formula);
      const block=makeBlock(document,formula,options),code=block.querySelector('.algorithm-code');
      anchor.replaceWith(block);anchor.replaceChildren(document.createTextNode(formula));code.replaceChildren(anchor);
      if(index>0)block.before(document.createTextNode(whole.slice(0,index)));
      if(index+formula.length<whole.length)block.after(document.createTextNode(whole.slice(index+formula.length)));
    }
    for(const nodes of textRuns(container)){
      const text=nodes.map(node=>node.data).join('');
      // In an article even a two-move sequence is useful. Unlabelled single
      // notation symbols remain prose; named labels can explicitly introduce one.
      const parts=splitAlgorithms(text,{minMoves:2});
      const spans=[];let at=0;
      for(const part of parts){if(part.type==='algorithm')spans.push({start:at,end:at+part.text.length,text:part.text});at+=part.text.length;}
      // Reverse order keeps offsets in the original text nodes valid, including
      // formulas whose moves are separated only by inline B/SPAN/I markup.
      for(const span of spans.reverse()){
        const start=pointAt(nodes,span.start),end=pointAt(nodes,span.end);
        const range=document.createRange();range.setStart(start.node,start.offset);range.setEnd(end.node,end.offset);
        range.deleteContents();range.insertNode(makeBlock(document,span.text,options));range.detach();
      }
    }
    const result=[...container.querySelectorAll('.algorithm-block')];
    result.forEach((block,index)=>{
      const key=String(index);block.dataset.algorithmIndex=key;
      const focus=block.querySelector('.focus-algorithm');if(focus)focus.dataset.focusAlgorithm=key;
    });
    return result;
  }

  return {splitAlgorithms,prepare};
});
