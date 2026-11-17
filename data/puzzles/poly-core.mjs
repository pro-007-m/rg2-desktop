/* Regular tetrahedron/dodecahedron mechanics, independently generated from planes. */
const EPS=1e-9,LOOKUP_EPS=2e-6,QUANT=1e7,MAX_MOVES=100000;
const PHI=(1+Math.sqrt(5))/2;
const INTERNAL=new WeakMap(),MODELS=new Map();
const add=(a,b)=>a.map((v,i)=>v+b[i]),sub=(a,b)=>a.map((v,i)=>v-b[i]);
const mul=(a,k)=>a.map(v=>v*k),dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const length=a=>Math.hypot(...a),unit=a=>mul(a,1/length(a));
const distance=(a,b)=>length(sub(a,b));
const mean=vertices=>mul(vertices.reduce((sum,p)=>add(sum,p),[0,0,0]),1/vertices.length);
const quant=v=>Math.round(v*QUANT);
const vectorKey=v=>v.map(quant).join(',');
const signature=vertices=>vertices.map(vectorKey).sort().join(';');
const frozenVector=v=>Object.freeze(v.map(x=>Math.abs(x)<1e-13?0:x));
function freezePolygon(vertices){return Object.freeze(vertices.map(frozenVector));}
function modelOf(puzzle){const internal=INTERNAL.get(puzzle);if(!internal)throw new TypeError('Неизвестная модель головоломки.');return internal;}
function normalizeKind(kind){
  const key=String(kind).toLowerCase();
  if(['pyramid','pyraminx','tetrahedron','tetra'].includes(key))return 'pyramid';
  if(['dodecahedron','dodeca','minx','megaminx'].includes(key))return 'dodecahedron';
  throw new RangeError('Поддерживаются Pyramid и Dodecahedron.');
}
function checkOrder(order){if(!Number.isInteger(order)||order<2||order>20)throw new RangeError('Размер должен быть целым числом от 2 до 20.');return order;}
function rotate(point,axis,angle){
  const c=Math.cos(angle),s=Math.sin(angle);
  return add(add(mul(point,c),mul(cross(axis,point),s)),mul(axis,dot(axis,point)*(1-c)));
}
function faceBasis(normal){
  const reference=Math.abs(normal[1])<.9?[0,1,0]:[0,0,1];
  const u=unit(cross(reference,normal));return [u,cross(normal,u)];
}
function orderPolygon(vertices,normal){
  const center=mean(vertices),[u,v]=faceBasis(normal);
  return [...vertices].sort((a,b)=>Math.atan2(dot(sub(a,center),v),dot(sub(a,center),u))-Math.atan2(dot(sub(b,center),v),dot(sub(b,center),u)));
}
function polygonArea(vertices,normal){
  let sum=[0,0,0];for(let i=0;i<vertices.length;i++)sum=add(sum,cross(vertices[i],vertices[(i+1)%vertices.length]));
  return Math.abs(dot(sum,normal))/2;
}
function cleanPolygon(vertices){
  const out=[];
  for(const p of vertices)if(!out.length||distance(p,out.at(-1))>EPS)out.push(p);
  if(out.length>1&&distance(out[0],out.at(-1))<EPS)out.pop();
  let changed=true;
  while(changed&&out.length>3){
    changed=false;
    for(let i=0;i<out.length;i++){
      const a=out[(i+out.length-1)%out.length],b=out[i],c=out[(i+1)%out.length];
      if(length(cross(sub(b,a),sub(c,b)))<EPS*length(sub(c,a))){out.splice(i,1);changed=true;break;}
    }
  }
  return out;
}
function clip(vertices,normal,offset,positive){
  const out=[];const side=value=>positive?value>=-EPS:value<=EPS;
  for(let i=0;i<vertices.length;i++){
    const a=vertices[i],b=vertices[(i+1)%vertices.length],da=dot(a,normal)-offset,db=dot(b,normal)-offset;
    const insideA=side(da),insideB=side(db);
    if(insideA)out.push(a);
    if(insideA!==insideB){
      const t=da/(da-db);out.push(add(a,mul(sub(b,a),Math.max(0,Math.min(1,t)))));
    }
  }
  return cleanPolygon(out);
}
function split(vertices,normal,offset,faceNormal){
  let minimum=Infinity,maximum=-Infinity;
  for(const point of vertices){const value=dot(point,normal)-offset;minimum=Math.min(minimum,value);maximum=Math.max(maximum,value);}
  if(minimum>=-EPS||maximum<=EPS)return [vertices];
  return [clip(vertices,normal,offset,false),clip(vertices,normal,offset,true)].filter(p=>p.length>=3&&polygonArea(p,faceNormal)>1e-12);
}
function regularHull(kind){
  if(kind==='pyramid'){
    const vertices=[[0,3,0],[-Math.sqrt(6),-1,Math.sqrt(2)],[Math.sqrt(6),-1,Math.sqrt(2)],[0,-1,-2*Math.sqrt(2)]];
    const ids=['U','L','R','B'];
    return {vertices,faces:vertices.map((point,i)=>{const normal=mul(unit(point),-1);return {id:ids[i],normal,vertices:orderPolygon(vertices.filter((_,j)=>j!==i),normal)};}),axisVectors:vertices.map(unit),axisIds:ids};
  }
  const vertices=[];
  for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1])vertices.push([x,y,z]);
  for(const a of [-1,1])for(const b of [-1,1])vertices.push([0,a/PHI,b*PHI],[a/PHI,b*PHI,0],[a*PHI,0,b/PHI]);
  const found=new Map();
  for(let i=0;i<vertices.length;i++)for(let j=i+1;j<vertices.length;j++)for(let k=j+1;k<vertices.length;k++){
    const c=cross(sub(vertices[j],vertices[i]),sub(vertices[k],vertices[i]));if(length(c)<EPS)continue;
    let normal=unit(c),offset=dot(normal,vertices[i]);
    const values=vertices.map(v=>dot(normal,v)-offset);
    if(values.every(v=>v<=EPS)){}
    else if(values.every(v=>v>=-EPS)){normal=mul(normal,-1);offset=-offset;}
    else continue;
    if(offset<EPS)continue;
    const key=vectorKey(normal);if(!found.has(key))found.set(key,{normal,offset});
  }
  if(found.size!==12)throw new Error('Не удалось построить правильный додекаэдр.');
  const planes=[...found.values()],scale=1/planes[0].offset;
  let points=vertices.map(v=>mul(v,scale));
  let faces=planes.map(plane=>({normal:plane.normal,vertices:points.filter(v=>Math.abs(dot(plane.normal,v)-1)<EPS)}));
  // One face faces straight up; all remaining IDs are stable by ring and azimuth.
  const top=[...faces].sort((a,b)=>b.normal[1]-a.normal[1]||b.normal[2]-a.normal[2])[0].normal;
  const rotateAxis=cross(top,[0,1,0]),angle=Math.acos(Math.max(-1,Math.min(1,top[1])));
  const align=p=>length(rotateAxis)<EPS?p:rotate(p,unit(rotateAxis),angle);
  points=points.map(align);faces=faces.map(face=>({normal:align(face.normal),vertices:face.vertices.map(align)}));
  faces.sort((a,b)=>Math.round(b.normal[1]*1e8)-Math.round(a.normal[1]*1e8)||Math.atan2(a.normal[0],a.normal[2])-Math.atan2(b.normal[0],b.normal[2]));
  faces=faces.map((face,i)=>({...face,id:String.fromCharCode(65+i),vertices:orderPolygon(face.vertices,face.normal)}));
  return {vertices:points,faces,axisVectors:faces.map(face=>face.normal),axisIds:faces.map(face=>face.id)};
}
function cutsFor(kind,order){
  if(kind==='pyramid')return Array.from({length:order-1},(_,i)=>3-4*(i+1)/order);
  const m=Math.floor(order/2),s=order>14?2:order>8?1:0;
  const positive=Array.from({length:m},(_,i)=>1-(i+1+s)/((m+s)*PHI*PHI));
  return [...positive,...positive.map(value=>-value).reverse()];
}
function layerAt(thresholds,value){let layer=0;while(layer<thresholds.length&&value<thresholds[layer]-EPS)layer++;return layer;}
function canonicalPlane(normal,offset){
  const first=normal.find(v=>Math.abs(v)>EPS);
  if(first<0){normal=mul(normal,-1);offset=-offset;}
  return {normal,offset,key:vectorKey(normal)+':'+quant(offset)};
}
function polygonMatches(a,b){
  return a.length===b.length&&a.every(point=>b.some(other=>distance(point,other)<LOOKUP_EPS));
}
function blackCell(face,center){
  const origin=mean(face.vertices),delta=sub(center,origin);
  if(length(delta)<LOOKUP_EPS)return true;
  for(let i=0;i<face.vertices.length;i++){
    const middle=mul(add(face.vertices[i],face.vertices[(i+1)%face.vertices.length]),.5),ray=sub(middle,origin);
    if(dot(delta,ray)>0&&length(cross(delta,ray))<LOOKUP_EPS*length(ray))return true;
  }
  return false;
}
function orientationKeys(hull,axes){
  const initial=hull.map((_,i)=>i),queue=[initial],seen=new Set();
  for(let cursor=0;cursor<queue.length;cursor++){
    const pattern=queue[cursor],key=pattern.join(',');if(seen.has(key))continue;seen.add(key);
    if(seen.size>60)throw new Error('Неверная группа вращений многогранника.');
    for(const axis of axes){
      const output=[];
      for(let i=0;i<hull.length;i++){
        const normal=rotate(hull[i].normal,axis.normal,axis.angle);
        const destination=hull.findIndex(face=>distance(face.normal,normal)<LOOKUP_EPS);
        if(destination<0)throw new Error('Ось не является симметрией многогранника.');
        output[destination]=pattern[i];
      }
      if(!seen.has(output.join(',')))queue.push(output);
    }
  }
  return seen;
}
export function createPolyPuzzle(kind,order){
  kind=normalizeKind(kind);checkOrder(order);const id=`${kind}-${order}`;
  if(MODELS.has(id)){const model=MODELS.get(id);MODELS.delete(id);MODELS.set(id,model);return model;}
  const regular=regularHull(kind),thresholds=cutsFor(kind,order),rotationOrder=kind==='pyramid'?3:5;
  const hull=regular.faces.map((face,index)=>{
    const vertices=freezePolygon(face.vertices),normal=frozenVector(face.normal),center=frozenVector(mean(vertices));
    return Object.freeze({index,face:face.id,id:face.id,color:index,vertices,polygon:vertices,normal,center});
  });
  const axes=regular.axisVectors.map((vector,i)=>{
    const normal=frozenVector(vector),projections=regular.vertices.map(v=>dot(v,normal));
    const layerCount=kind==='dodecahedron'?Math.floor(order/2):thresholds.length+1;
    return Object.freeze({id:regular.axisIds[i],normal,vector:normal,order:rotationOrder,angle:2*Math.PI/rotationOrder,
      thresholds:Object.freeze([...thresholds]),nearThresholds:Object.freeze(kind==='dodecahedron'?thresholds.slice(0,layerCount):[...thresholds]),projectionMin:Math.min(...projections),projectionMax:Math.max(...projections),layerCount,bandCount:thresholds.length+1,
      layerForProjection:value=>{const band=layerAt(thresholds,value);return band<layerCount?band:-1;}});
  });
  const planes=new Map();
  for(const axis of axes)for(const offset of thresholds){const plane=canonicalPlane(axis.normal,offset);planes.set(plane.key,plane);}
  const facelets=[],lookup=new Map(),centers=new Map();
  for(const face of hull){
    let parts=[face.vertices];
    for(const plane of planes.values()){const next=[];for(const part of parts)next.push(...split(part,plane.normal,plane.offset,face.normal));parts=next;}
    const [u,v]=faceBasis(face.normal);
    parts.sort((a,b)=>quant(dot(mean(a),v))-quant(dot(mean(b),v))||quant(dot(mean(a),u))-quant(dot(mean(b),u))||signature(a).localeCompare(signature(b)));
    for(const part of parts){
      const index=facelets.length,vertices=freezePolygon(part),center=frozenVector(mean(vertices)),black=kind==='dodecahedron'&&order%2===0&&blackCell(face,center);
      const item=Object.freeze({index,face:face.id,faceIndex:face.index,color:black?hull.length:face.color,black,hidden:black,
        vertices,polygon:vertices,normal:face.normal,center,area:polygonArea(vertices,face.normal)});
      const key=signature(vertices);if(lookup.has(key))throw new Error('Обнаружены совпадающие наклейки.');lookup.set(key,index);
      const cellKey=vectorKey(center);if(!centers.has(cellKey))centers.set(cellKey,[]);centers.get(cellKey).push(index);facelets.push(item);
    }
  }
  const internal={lookup,centers,permutations:new Map(),permutationBytes:0,orientationKeys:orientationKeys(hull,axes)};
  let puzzle;
  puzzle=Object.freeze({id,kind,order,size:order,faceCount:hull.length,faceletCount:facelets.length,blackColor:hull.length,
    facelets:Object.freeze(facelets),hull:Object.freeze(hull),axes:Object.freeze(axes),
    solvedState:()=>Uint32Array.from(facelets,item=>item.color),normalizeMove:move=>normalizePolyMove(move,puzzle),parseMove:move=>parsePolyMove(move,puzzle),
    parseAlg:alg=>parsePolyAlg(alg,puzzle),moveInfo:move=>polyMoveInfo(move,puzzle),layerFor:(axisId,index)=>{
      const axis=axes.find(item=>item.id===axisId);if(!axis||!facelets[index])throw new RangeError('Неверная ось или наклейка.');return axis.layerForProjection(dot(facelets[index].center,axis.normal));
    },getPermutation:move=>getPolyPermutation(puzzle,move),isSolved:state=>isPolySolved(state,puzzle)});
  INTERNAL.set(puzzle,internal);
  // Cached models are bounded; sessions/renderers may retain their own current model.
  while(MODELS.size>=3)MODELS.delete(MODELS.keys().next().value);
  MODELS.set(id,puzzle);return puzzle;
}
function power(turns,order){
  if(!Number.isSafeInteger(turns))throw new TypeError('Степень хода должна быть целой.');
  const n=((turns%order)+order)%order;return n>order/2?n-order:n;
}
function suffix(turns){const n=Math.abs(turns);return (n===1?'':n)+(turns<0?"'":'');}
function defaultToken(move,puzzle){
  const axis=puzzle.axes.find(axis=>axis.id===move.axis),lo=move.layers[0],hi=move.layers.at(-1),count=axis.layerCount;
  let base;
  if(move.whole)base=axis.id+'v';
  else if(puzzle.kind==='pyramid'&&lo===0&&hi===0)base=axis.id.toLowerCase();
  else if(puzzle.kind==='pyramid'&&lo===0&&hi===Math.min(1,count-2))base=axis.id;
  else if(lo===hi)base=(lo===0?'':lo+1)+axis.id;
  else base=(lo===0?(hi===1?'':hi+1):`${lo+1}-${hi+1}`)+axis.id+'w';
  return base+suffix(move.turns);
}
export function normalizePolyMove(input,puzzle){
  modelOf(puzzle);if(typeof input==='string')return parsePolyMove(input,puzzle);
  if(!input||typeof input!=='object')throw new TypeError('Неверный формат хода.');
  const axis=puzzle.axes.find(axis=>axis.id===String(input.axis).toUpperCase());
  if(!axis||!Array.isArray(input.layers)||!input.layers.length)throw new TypeError('Неверная ось или слои хода.');
  const layers=[...input.layers].sort((a,b)=>a-b);
  const whole=input.whole===true||(puzzle.kind==='pyramid'&&layers.length===axis.bandCount&&layers[0]===0&&layers.at(-1)===axis.bandCount-1);
  if(whole&&(layers.length!==axis.bandCount||layers[0]!==0||layers.at(-1)!==axis.bandCount-1))throw new RangeError('Полное вращение должно включать все геометрические полосы.');
  for(let i=0;i<layers.length;i++)if(!Number.isInteger(layers[i])||layers[i]<0||layers[i]>=(whole?axis.bandCount:axis.layerCount)||(i&&layers[i]!==layers[i-1]+1))throw new RangeError('Слои должны быть непрерывными, без повторений.');
  const turns=power(input.turns,axis.order);if(!turns)throw new RangeError('Пустой поворот.');
  const move={axis:axis.id,layers:Object.freeze(layers),turns,whole};return Object.freeze({...move,token:defaultToken(move,puzzle)});
}
function rawPolyMove(token,puzzle){
  const match=/^(?:(\d+)(?:-(\d+))?)?([A-La-lURBurbu])([wv]?)(\d*)(\'?)$/.exec(token);
  if(!match)throw new SyntaxError(`Неизвестный ход: ${token}`);
  const [,first,last,letter,modifier,number,prime]=match;
  const axis=puzzle.axes.find(axis=>axis.id===letter.toUpperCase());if(!axis)throw new SyntaxError(`Нет оси ${letter} у этой головоломки.`);
  const turns=power(Number(number||1)*(prime?-1:1),axis.order);let start,end;
  if(modifier==='v'){
    if(first||last)throw new SyntaxError('У полного вращения нет номера слоя.');start=0;end=axis.bandCount-1;
  }else if(last){start=Number(first)-1;end=Number(last)-1;}
  else if(modifier==='w'){start=0;end=Number(first||2)-1;}
  else if(first){start=end=Number(first)-1;}
  else if(puzzle.kind==='pyramid'&&letter===letter.toUpperCase()){start=0;end=Math.min(1,axis.layerCount-2);}
  else start=end=0;
  if(start<0||end<start||end>=(modifier==='v'?axis.bandCount:axis.layerCount))throw new RangeError('Слой не подходит для этой головоломки.');
  if(!turns)return null;
  return normalizePolyMove({axis:axis.id,layers:Array.from({length:end-start+1},(_,i)=>start+i),turns,whole:modifier==='v'},puzzle);
}
export function parsePolyAlg(input,puzzle){
  modelOf(puzzle);
  if(Array.isArray(input)){
    const out=[];for(const item of input){const next=typeof item==='string'||Array.isArray(item)?parsePolyAlg(item,puzzle):[normalizePolyMove(item,puzzle)];if(out.length+next.length>MAX_MOVES)throw new RangeError('Слишком много ходов.');for(const move of next)out.push(move);}return out;
  }
  if(typeof input!=='string'||input.length>1500000)throw new TypeError('Алгоритм должен быть строкой допустимой длины.');
  const text=input.replace(/[’‘′`´ʼ]/g,"'").replace(/²/g,'2').replace(/\/\/[^\r\n]*/g,'');let cursor=0;
  const skip=()=>{while(cursor<text.length&&/[\s.·]/.test(text[cursor]))cursor++;};
  const append=(out,moves)=>{if(out.length+moves.length>MAX_MOVES)throw new RangeError('Слишком много ходов.');for(const move of moves)out.push(move);};
  const invert=moves=>[...moves].reverse().map(move=>invertPolyMove(move,puzzle));
  function group(moves){
    skip();let count=1;const match=/^\d+/.exec(text.slice(cursor));if(match){count=Number(match[0]);cursor+=match[0].length;}
    if(!Number.isSafeInteger(count)||count>MAX_MOVES||count*moves.length>MAX_MOVES)throw new RangeError('Слишком большое повторение.');
    skip();if(text[cursor]==="'"){moves=invert(moves);cursor++;}const out=[];for(let i=0;i<count;i++)append(out,moves);return out;
  }
  function sequence(stops='',depth=0){
    if(depth>24)throw new RangeError('Слишком глубокая вложенность.');const out=[];
    while(true){skip();const char=text[cursor];if(!char||stops.includes(char))return out;
      if(char==='('){cursor++;const moves=sequence(')',depth+1);if(text[cursor++]!==')')throw new SyntaxError('Не закрыта скобка.');append(out,group(moves));}
      else if(char==='['){cursor++;const a=sequence(',:]',depth+1),separator=text[cursor++];
        if(separator===']'){append(out,group(a));continue;}if(separator!==','&&separator!==':')throw new SyntaxError('Неверный коммутатор.');
        const b=sequence(']',depth+1);if(text[cursor++]!==']'||!a.length||!b.length)throw new SyntaxError('Неверный коммутатор.');const moves=[];append(moves,a);append(moves,b);append(moves,invert(a));if(separator===',')append(moves,invert(b));append(out,group(moves));
      }else{const match=/^(?:\d+(?:-\d+)?)?[A-La-lURBurbu][wv]?\d*'?/.exec(text.slice(cursor));if(!match)throw new SyntaxError(`Неизвестный ход (позиция ${cursor+1}).`);cursor+=match[0].length;const move=rawPolyMove(match[0],puzzle);if(move)append(out,[move]);}
    }
  }
  const out=sequence();skip();if(cursor!==text.length)throw new SyntaxError('Лишняя закрывающая скобка.');return out;
}
export function parsePolyMove(input,puzzle){if(typeof input!=='string')return normalizePolyMove(input,puzzle);const moves=parsePolyAlg(input,puzzle);if(moves.length!==1)throw new SyntaxError('Ожидается один ход.');return moves[0];}
export function invertPolyMove(input,puzzle){const move=normalizePolyMove(input,puzzle);return normalizePolyMove({...move,turns:-move.turns},puzzle);}
export function invertPolyAlg(input,puzzle){return parsePolyAlg(input,puzzle).reverse().map(move=>invertPolyMove(move,puzzle));}
export function formatPolyMove(input,puzzle){return normalizePolyMove(input,puzzle).token;}
export function formatPolyAlg(input,puzzle){return parsePolyAlg(input,puzzle).map(move=>move.token).join(' ');}
export function polyMoveInfo(input,puzzle){
  const move=normalizePolyMove(input,puzzle),axis=puzzle.axes.find(axis=>axis.id===move.axis),selected=new Set(move.layers),affected=[];
  for(const facelet of puzzle.facelets)if(selected.has(layerAt(axis.thresholds,dot(facelet.center,axis.normal))))affected.push(facelet.index);
  const bands=[];for(let i=0;i<axis.bandCount;i++)bands.push({min:i===axis.bandCount-1?axis.projectionMin:axis.thresholds[i],max:i===0?axis.projectionMax:axis.thresholds[i-1],moving:selected.has(i),layer:i});
  const cutPlanes=axis.thresholds.flatMap((offset,i)=>selected.has(i)!==selected.has(i+1)?[{normal:axis.normal,offset}]:[]),affectedIndices=Uint32Array.from(affected);
  return {move,axis:axis.normal,axisId:axis.id,angle:-move.turns*axis.angle,angleRad:-move.turns*axis.angle,affectedIndices,affected:affectedIndices,bands:bands.reverse(),cutPlanes};
}
function entryFor(puzzle,input){
  const data=modelOf(puzzle),move=normalizePolyMove(input,puzzle),key=`${move.axis}:${move.layers.join(',')}:${move.turns}`;
  if(data.permutations.has(key)){const hit=data.permutations.get(key);data.permutations.delete(key);data.permutations.set(key,hit);return hit;}
  const info=polyMoveInfo(move,puzzle),permutation=Uint32Array.from({length:puzzle.faceletCount},(_,i)=>i),seen=new Set();
  for(const source of info.affectedIndices){
    const facelet=puzzle.facelets[source],vertices=facelet.vertices.map(point=>rotate(point,info.axis,info.angle));
    let destination=data.lookup.get(signature(vertices));
    if(destination===undefined){
      const center=rotate(facelet.center,info.axis,info.angle),q=center.map(quant),candidates=[];
      for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++)candidates.push(...(data.centers.get([q[0]+x,q[1]+y,q[2]+z].join(','))||[]));
      const matches=candidates.filter(index=>polygonMatches(vertices,puzzle.facelets[index].vertices));
      if(matches.length!==1)throw new Error(`Ход ${move.token} не сохраняет геометрию (${source}, совпадений ${matches.length}).`);destination=matches[0];
    }
    if(seen.has(destination))throw new Error('Поворот не образует перестановку.');seen.add(destination);permutation[destination]=source;
  }
  const affectedSet=new Set(info.affectedIndices);
  if(seen.size!==info.affectedIndices.length||[...seen].some(index=>!affectedSet.has(index)))throw new Error('Поворот пересёк границу слоя.');
  const changed=[];for(let i=0;i<permutation.length;i++)if(permutation[i]!==i)changed.push(i);
  const moved=Uint32Array.from(changed),bytes=permutation.byteLength+moved.byteLength,entry={permutation,moved,bytes};
  while(data.permutations.size&&(data.permutations.size>=64||data.permutationBytes+bytes>4*1024*1024)){const oldest=data.permutations.keys().next().value;data.permutationBytes-=data.permutations.get(oldest).bytes;data.permutations.delete(oldest);}
  data.permutations.set(key,entry);data.permutationBytes+=bytes;return entry;
}
export function getPolyPermutation(puzzle,move){return entryFor(puzzle,move).permutation.slice();}
function checkState(state,puzzle){modelOf(puzzle);if(!(Array.isArray(state)||ArrayBuffer.isView(state))||state.length!==puzzle.faceletCount)throw new TypeError('Неверная длина состояния.');if(!(state instanceof Uint32Array))for(const value of state)if(!Number.isInteger(value)||value<0||value>0xffffffff)throw new TypeError('Неверное значение наклейки.');}
export function applyPolyMove(state,puzzle,move){checkState(state,puzzle);const {permutation,moved}=entryFor(puzzle,move),out=Uint32Array.from(state);for(const index of moved)out[index]=state[permutation[index]];return out;}
export function applyPolyAlg(state,puzzle,algorithm){
  checkState(state,puzzle);const moves=parsePolyAlg(algorithm,puzzle),out=Uint32Array.from(state),scratch=new Uint32Array(out.length);
  for(const move of moves){const {permutation,moved}=entryFor(puzzle,move);for(const index of moved)scratch[index]=out[permutation[index]];for(const index of moved)out[index]=scratch[index];}return out;
}
export function isPolySolved(state,puzzle,{rotationAgnostic=true}={}){
  checkState(state,puzzle);const colors=new Array(puzzle.faceCount);
  for(const facelet of puzzle.facelets){const value=state[facelet.index];if(facelet.black){if(value!==puzzle.blackColor)return false;continue;}if(value>=puzzle.faceCount)return false;const old=colors[facelet.faceIndex];if(old!==undefined&&old!==value)return false;colors[facelet.faceIndex]=value;}
  return rotationAgnostic?modelOf(puzzle).orientationKeys.has(colors.join(',')):colors.every((color,i)=>color===i);
}
export function generatePolyScramble(puzzle,{length:count=Math.max(20,puzzle.order*6),rng=Math.random}={}){
  modelOf(puzzle);if(!Number.isInteger(count)||count<0||count>10000||typeof rng!=='function')throw new RangeError('Неверные параметры скрамбла.');
  const random=n=>{const value=rng();if(!Number.isFinite(value)||value<0||value>=1)throw new RangeError('Неверное случайное число.');return Math.floor(value*n);};
  const out=[];let previous='';for(let i=0;i<count;i++){
    const options=puzzle.axes.filter(axis=>axis.id!==previous),axis=options[random(options.length)],width=1+random(puzzle.kind==='dodecahedron'?axis.layerCount:axis.layerCount-1),turns=1+random(axis.order-1);
    out.push(normalizePolyMove({axis:axis.id,layers:Array.from({length:width},(_,j)=>j),turns},puzzle));previous=axis.id;
  }return out;
}
export function polyCacheStats(puzzle){const data=modelOf(puzzle);return {modelCount:MODELS.size,entries:data.permutations.size,bytes:data.permutationBytes,maxEntries:64,maxBytes:4*1024*1024};}
export class PolySession{
  #puzzle;#state;#moves=[];#cursor=0;
  constructor(kind,order){this.#puzzle=typeof kind==='object'?(modelOf(kind),kind):createPolyPuzzle(kind,order);this.#state=this.#puzzle.solvedState();}
  get puzzle(){return this.#puzzle;}get state(){return this.#state.slice();}get cursor(){return this.#cursor;}get moves(){return [...this.#moves];}get historyLength(){return this.#moves.length;}get canUndo(){return this.#cursor>0;}get canRedo(){return this.#cursor<this.#moves.length;}get solved(){return isPolySolved(this.#state,this.#puzzle);}
  apply(move){const parsed=parsePolyMove(move,this.#puzzle);this.applyAlg([parsed]);return parsed;}
  applyAlg(algorithm){const moves=parsePolyAlg(algorithm,this.#puzzle);if(!moves.length)return [];if(this.#cursor+moves.length>MAX_MOVES)throw new RangeError('История слишком длинная.');const state=applyPolyAlg(this.#state,this.#puzzle,moves);this.#moves=this.#moves.slice(0,this.#cursor).concat(moves);this.#cursor=this.#moves.length;this.#state=state;return moves;}
  undo(){if(!this.canUndo)return false;this.#state=applyPolyMove(this.#state,this.#puzzle,invertPolyMove(this.#moves[this.#cursor-1],this.#puzzle));this.#cursor--;return true;}
  redo(){if(!this.canRedo)return false;this.#state=applyPolyMove(this.#state,this.#puzzle,this.#moves[this.#cursor]);this.#cursor++;return true;}
  reset(){this.#state=this.#puzzle.solvedState();this.#moves=[];this.#cursor=0;}
  toJSON(){return {schema:'rg2-poly-session',version:1,kind:this.#puzzle.kind,order:this.#puzzle.order,moves:this.#moves.map(move=>move.token),cursor:this.#cursor};}
  serialize(){return JSON.stringify(this.toJSON());}
  static restore(input){
    if(typeof input==='string'){if(input.length>8*1024*1024)throw new RangeError('Сессия слишком большая.');input=JSON.parse(input);}
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['schema','version','kind','order','moves','cursor'].includes(key))||input.schema!=='rg2-poly-session'||input.version!==1)throw new TypeError('Неизвестный формат сессии.');
    const puzzle=createPolyPuzzle(input.kind,input.order);
    if(!Array.isArray(input.moves)||input.moves.length>MAX_MOVES||!Number.isInteger(input.cursor)||input.cursor<0||input.cursor>input.moves.length)throw new TypeError('Неверная история сессии.');
    const moves=input.moves.map(token=>{if(typeof token!=='string'||token.length>64)throw new TypeError('Неверный ход сессии.');return parsePolyMove(token,puzzle);});
    const session=new PolySession(puzzle);session.#moves=moves;session.#cursor=input.cursor;session.#state=applyPolyAlg(puzzle.solvedState(),puzzle,moves.slice(0,input.cursor));return session;
  }
}
export function createPolySession(kind,order){return new PolySession(kind,order);}
export function restorePolySession(input){return PolySession.restore(input);}
