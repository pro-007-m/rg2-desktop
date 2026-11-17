// SPDX-License-Identifier: GPL-3.0-only
import {buildModel} from '../../data/puzzles/solver-poly-large.mjs';
import {getPolyPermutation,normalizePolyMove} from '../../data/puzzles/poly-core.mjs';
const sparse=p=>new Map(Array.from(p).flatMap((v,i)=>v!==i?[[i,v]]:[]));
const inverse=p=>new Map([...p].map(([a,b])=>[b,a]));
function compose(a,b){const out=new Map();for(const i of new Set([...a.keys(),...b.keys()])){const mid=b.get(i)??i,v=a.get(mid)??mid;if(v!==i)out.set(i,v);}return out;}
const comm=(a,b)=>compose(compose(compose(a,b),inverse(a)),inverse(b));
const conjugate=(p,g)=>new Map([...p].map(([a,b])=>[g.get(a)??a,g.get(b)??b]));
const invertWord=(word,p)=>[...word].reverse().map(t=>p.parseMove(t)).map(m=>normalizePolyMove({...m,turns:-m.turns},p).token);
const commWord=(a,b,p)=>[...a,...b,...invertWord(a,p),...invertWord(b,p)];
function cycle3(p){if(p.size!==3)return null;const a=Math.min(...p.keys()),b=p.get(a),c=p.get(b);return c!==a&&p.get(c)===a?[a,b,c]:null;}
export function discoverPyramidSeeds(order){
 const model=buildModel('pyramid',order),{puzzle,generators,orbits,orbitOf,pieces,pieceFacets}=model,wanted=new Set(orbits.filter(o=>o.oriented).map(o=>o.id)),found=new Map(),H=[];
 const full=new Map(generators.map(g=>[g.token,sparse(g.permutation)]));
 function fullWord(word){let p=new Map();for(const token of word){const move=puzzle.parseMove(token),g=generators.find(g=>g.axis===move.axis&&g.layer===move.layers[0]),value=full.get(g.token);p=compose(p,move.turns===1?value:inverse(value));}return p;}
 let examined=0;
 function accept(p,word){examined++;const cycle=cycle3(p);if(!cycle)return;const id=orbitOf[cycle[0]];if(!wanted.has(id)||found.has(id)||cycle.some(i=>orbitOf[i]!==id))return;
   const actual=fullWord(word),expected=new Map();for(const dest of cycle)for(let f=0;f<pieceFacets[dest].length;f++)expected.set(pieceFacets[dest][f],pieceFacets[p.get(dest)][f]);
   if(actual.size!==expected.size||[...expected].some(([a,b])=>actual.get(a)!==b))return;
   found.set(id,{cycle,word,p});
 }
 for(const a of generators.filter(g=>g.axis==='U'))for(const b of generators.filter(g=>g.axis==='L')){const p=comm(a.p,b.p);if(!p.size)continue;const word=commWord(a.word,b.word,puzzle);H.push({p,word,a,b});accept(p,word);for(const power of [2,3,5,7]){let q=new Map();for(let i=0;i<power;i++)q=compose(q,p);accept(q,Array.from({length:power},()=>word).flat());}}
 const direct=found.size,gs=generators.flatMap(g=>[g,{...g,p:inverse(g.p),word:invertWord(g.word,puzzle)}]);
 for(const h of H)for(const g of gs){
   const p=comm(h.p,g.p),word=commWord(h.word,g.word,puzzle);accept(p,word);for(const power of [2,3,5]){let q=new Map();for(let i=0;i<power;i++)q=compose(q,p);accept(q,Array.from({length:power},()=>word).flat());}
   const conjugated=[...g.word,...h.word,...invertWord(g.word,puzzle)];accept(comm(h.p,conjugate(h.p,g.p)),commWord(h.word,conjugated,puzzle));
 }
 const nested=found.size;
 if(found.size<wanted.size)for(const h of H)for(const g of gs)for(const g2 of gs.filter(g=>g.layer===0||g.layer===order-1)){
   const point=compose(g2.p,g.p),word=[...g2.word,...g.word,...h.word,...invertWord([...g2.word,...g.word],puzzle)];accept(comm(h.p,conjugate(h.p,point)),commWord(h.word,word,puzzle));
   if(found.size===wanted.size)break;
 }
 return {model,wanted,found,missing:[...wanted].filter(id=>!found.has(id)),direct,nested,examined};
}
if(process.argv[1]?.endsWith('pyramid-seeds.mjs'))for(const order of process.argv.slice(2).map(Number).length?process.argv.slice(2).map(Number):[4,5,8]){const t=performance.now(),r=discoverPyramidSeeds(order);console.log(JSON.stringify({order,wanted:r.wanted.size,found:r.found.size,missing:r.missing.map(id=>({id,pieces:r.model.orbits[id].indices.length,facets:r.model.orbits[id].stickers})),direct:r.direct,nested:r.nested,examined:r.examined,ms:Math.round(performance.now()-t),examples:[...r.found].slice(0,8).map(([id,v])=>({id,word:v.word.join(' ')}))}));}
