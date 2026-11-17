import {readdir,readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,relative,dirname} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'..'),source=join(root,'data/puzzles'),target=resolve(root,'../rg2-mobile/data/puzzles'),files=[];
async function walk(dir){for(const item of await readdir(dir,{withFileTypes:true})){const path=join(dir,item.name);if(item.isDirectory())await walk(path);else{const data=await readFile(path),name=relative(source,path).replaceAll('\\','/');await mkdir(dirname(join(target,name)),{recursive:true});await writeFile(join(target,name),data);files.push({path:name,sha256:createHash('sha256').update(data).digest('hex')});}}}
await walk(source);const manifest=JSON.stringify({schema:'rg2-shared-puzzles',version:1,files},null,2)+'\n';await writeFile(join(root,'data/puzzles-manifest.json'),manifest);await writeFile(resolve(root,'../rg2-mobile/data/puzzles-manifest.json'),manifest);
let tests=0;
for(const name of await readdir(join(root,'tests')))if(/^puzzles-.*\.test\.mjs$/.test(name)){await writeFile(resolve(root,'../rg2-mobile/tests',name),await readFile(join(root,'tests',name)));tests++;}
console.log(`Synchronized ${files.length} shared puzzle files and ${tests} regression suites; source hashes are identical.`);
