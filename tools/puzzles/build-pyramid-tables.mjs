// SPDX-License-Identifier: GPL-3.0-only
// Deterministic generation of RG2's own commutators and quotient SGS.
// No network, APK, game history or pre-generated table is used as input.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {quotientModel,makeSGS,flatten} from './pyramid-quotient.mjs';

const {values}=parseArgs({options:{output:{type:'string'},verify:{type:'boolean',default:false},help:{type:'boolean',default:false}},strict:true});
if(values.help){
  console.log('node tools/puzzles/build-pyramid-tables.mjs [--verify] [--output PATH]\nWithout options, regenerates data/puzzles/solver-poly-pyramid-data.mjs.\n--verify recomputes everything and checks the existing runtime file without changing it.\n--output writes the result to another path, including together with --verify.');
  process.exit(0);
}
const runtime=fileURLToPath(new URL('../../data/puzzles/solver-poly-pyramid-data.mjs',import.meta.url));
const output=values.output?resolve(values.output):values.verify?null:runtime,data={},started=performance.now();
for(let order=4;order<=20;order++){
  const stepStart=performance.now(),model=quotientModel(order),sgs=makeSGS(model.generators,{log:null});
  const seeds=[...model.found].map(([orbit,{word}])=>[orbit,word.join(' ')]);
  const chain=sgs.chain.map(({base,trans})=>[base,trans.flatMap((t,i)=>t?[[i,flatten(t.w,model.model.puzzle).join(' ')]]:[])]);
  data[order]={seeds,chain,core:model.core.map(orbit=>orbit.id),size:String(sgs.size)};
  console.log(JSON.stringify({order,seeds:seeds.length,degree:model.indices.length,levels:chain.length,bytes:JSON.stringify(data[order]).length,ms:Math.round(performance.now()-stepStart)}));
}
// Retain the original header so the existing 1.6.0 runtime asset reproduces
// byte-for-byte. The public entry point now lives beside this file in tools/puzzles.
const generated=Buffer.from('/* Own RG2 constructive tables. Generated and verified by large-poly/build-pyramid-tables.mjs. */\nexport const PYRAMID_TABLES='+JSON.stringify(data)+';\n','utf8');
if(values.verify){
  const expected=await readFile(runtime);
  if(!generated.equals(expected))throw new Error('Generated tables differ from '+runtime);
}
if(output){await mkdir(dirname(output),{recursive:true});await writeFile(output,generated);}
console.log(JSON.stringify({pass:true,orders:Object.keys(data).length,bytes:generated.length,sha256:createHash('sha256').update(generated).digest('hex'),verified:values.verify,runtimeChanged:output===runtime,output,elapsedMs:Math.round(performance.now()-started)}));
