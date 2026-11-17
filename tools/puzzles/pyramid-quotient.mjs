// SPDX-License-Identifier: GPL-3.0-only
import {discoverPyramidSeeds} from './pyramid-seeds.mjs';
import {applyPolyAlg,normalizePolyMove} from '../../data/puzzles/poly-core.mjs';
const key=p=>Array.from(p).join(',');
const inv=p=>{const q=new Uint16Array(p.length);p.forEach((v,i)=>q[v]=i);return q;};
const mul=(a,b)=>Uint16Array.from(b,v=>a[v]);
const id=n=>Uint16Array.from({length:n},(_,i)=>i);
const identity=p=>p.every((v,i)=>v===i);
const inverseWord=(w,p)=>[...w].reverse().map(t=>normalizePolyMove({...p.parseMove(t),turns:-p.parseMove(t).turns},p).token);
const leaf=word=>({word,length:word.length});
const cat=(a,b)=>!a?.length?b:!b?.length?a:{a,b,length:a.length+b.length};
const reverse=a=>a?.length?{rev:a,length:a.length}:a;
export function flatten(w,p,limit=1000000){if(w.length>limit)throw Error('word too long '+w.length);const result=[];function walk(n,rev=false){if(!n?.length)return;if(n.word){result.push(...(rev?inverseWord(n.word,p):n.word));return;}if(n.rev){walk(n.rev,!rev);return;}if(rev){walk(n.b,true);walk(n.a,true);}else{walk(n.a);walk(n.b);}}walk(w);const simple=[];for(const token of result){const move=p.parseMove(token),last=simple.length?p.parseMove(simple.at(-1)):null;if(last&&move.axis===last.axis&&String(move.layers)===String(last.layers)&&move.whole===last.whole){simple.pop();const turns=(last.turns+move.turns+6)%3;if(turns)simple.push(normalizePolyMove({...move,turns},p).token);}else simple.push(token);}return simple;}
function reduceGenerators(gens){const table=[],out=[],seen=new Set();for(const gen of [...gens].sort((a,b)=>a.w.length-b.w.length)){let g=gen;for(let i=0;i<g.p.length;i++)if(g.p[i]!==i){const j=g.p[i];if(!table[i])table[i]=[];const t=table[i][j];if(!t){table[i][j]=g;out.push(g);break;}g={p:mul(t.inv,g.p),w:cat(reverse(t.w),g.w)};g.inv=inv(g.p);} }for(const g of out){g.inv??=inv(g.p);const k=key(g.p);if(seen.has(k))throw Error('filter duplicate');seen.add(k);}return out;}
export function makeSGS(gens,{log=console.log}={}){
 const n=gens[0].p.length,chain=[];let current=reduceGenerators(gens),size=1n;
 while(current.length){
  let base=-1,best=Infinity;
  // Prefer the smallest nontrivial generator orbit, reducing Schreier work.
  const done=new Set();
  for(let i=0;i<n;i++)if(!done.has(i)){
   const orbit=[i];done.add(i);for(let q=0;q<orbit.length;q++)for(const g of current){const v=g.p[orbit[q]];if(!done.has(v)){done.add(v);orbit.push(v);}}
   if(orbit.length>1&&orbit.length<best){best=orbit.length;base=i;}
  }
  if(base<0)break;
  const trans=Array(n),points=[base];trans[base]={p:id(n),inv:id(n),w:leaf([])};
  for(let head=0;head<points.length;head++){const x=points[head],tx=trans[x];for(const g of current){const y=g.p[x];if(trans[y])continue;const p=mul(g.p,tx.p);trans[y]={p,inv:inv(p),w:cat(g.w,tx.w)};points.push(y);}}
  const schreier=[];
  for(const x of points)for(const g of current){const y=g.p[x],p=mul(trans[y].inv,mul(g.p,trans[x].p));if(!identity(p))schreier.push({p,inv:inv(p),w:cat(reverse(trans[y].w),cat(g.w,trans[x].w))});}
  chain.push({base,trans});size*=BigInt(points.length);log?.({level:chain.length,base,orbit:points.length,gens:current.length,schreier:schreier.length,maxWord:Math.max(...current.map(g=>g.w.length)),size:String(size)});
  current=reduceGenerators(schreier);if(chain.length>n)throw Error('chain loop');
 }
 return {chain,size,solve(p,puzzle){let r=p,word=leaf([]);for(const level of chain){const t=level.trans[r[level.base]];if(!t)throw Error('quotient nonmember');r=mul(t.inv,r);word=cat(word,t.w);}if(!identity(r))throw Error('quotient remainder');return flatten(reverse(word),puzzle);}};
}
export function quotientModel(order){const discovery=discoverPyramidSeeds(order),model=discovery.model,{puzzle,pieces,pieceFacets,orbits}=model;
 const extra=new Set(discovery.found.keys()),core=orbits.filter(o=>!extra.has(o.id)),indices=[];
 for(const orbit of core)for(const piece of orbit.indices)indices.push(...(orbit.oriented?[pieceFacets[piece][0]]:pieces[piece]));
 const local=new Map(indices.map((f,i)=>[f,i])),generators=[];
 for(const g of model.generators){const p=Uint16Array.from(indices,i=>local.get(g.permutation[i]));if(p.some(v=>v===undefined))throw Error('incomplete quotient');generators.push({p,inv:inv(p),w:leaf(g.word)});}
 const descriptions=indices.map(f=>{const piece=model.pieceOf[f],orbit=model.orbits[model.orbitOf[piece]];return {f,piece,orbit};});
 function permutation(state){const out=new Uint16Array(indices.length);for(const orbit of core){const bySignature=new Map();for(const piece of orbit.indices){const fs=pieceFacets[piece],signature=orbit.oriented?fs.map(f=>model.goal[f]).join(','):fs.map(f=>model.goal[f]).sort((a,b)=>a-b).join(',');bySignature.set(signature,piece);}
   for(const piece of orbit.indices){const fs=pieceFacets[piece],signature=orbit.oriented?fs.map(f=>state[f]).join(','):fs.map(f=>state[f]).sort((a,b)=>a-b).join(','),source=bySignature.get(signature);if(source===undefined)throw Error('unknown colour piece');for(const f of (orbit.oriented?[fs[0]]:fs)){const src=orbit.oriented?pieceFacets[source][0]:pieces[source].find(s=>model.goal[s]===state[f]);out[local.get(f)]=local.get(src);}}
  }if(new Set(out).size!==out.length)throw Error('duplicate piece');return out;}
 return {...discovery,core,indices,generators,permutation};
}
if(process.argv[1]?.endsWith('pyramid-quotient.mjs')){const n=Number(process.argv[2]??8),start=performance.now(),m=quotientModel(n);console.log({n,degree:m.indices.length,missing:m.missing,buildMs:Math.round(performance.now()-start)});const s=makeSGS(m.generators);console.log({size:String(s.size),sgsMs:Math.round(performance.now()-start)});let state=m.model.goal;const scramble=[];for(let i=0;i<50;i++){const g=m.model.generators[Math.floor(Math.random()*m.model.generators.length)];scramble.push(g.token);}state=applyPolyAlg(state,m.model.puzzle,scramble);const solution=s.solve(m.permutation(state),m.model.puzzle),result=applyPolyAlg(state,m.model.puzzle,solution);console.log({moves:solution.length,solved:m.indices.every(f=>result[f]===m.model.goal[f]),ms:Math.round(performance.now()-start)});}
