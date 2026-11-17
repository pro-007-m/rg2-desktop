import {readdir,readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,relative,dirname} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'..'),source=join(root,'data/review'),mobile=resolve(root,'../rg2-mobile'),files=[];
async function walk(dir){for(const item of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const path=join(dir,item.name);if(item.isDirectory())await walk(path);else{const data=await readFile(path),name=relative(source,path).replaceAll('\\','/');await mkdir(dirname(join(mobile,'data/review',name)),{recursive:true});await writeFile(join(mobile,'data/review',name),data);files.push({path:name,sha256:createHash('sha256').update(data).digest('hex')});}}}
await walk(source);
const manifest=JSON.stringify({schema:'twistforge-shared-review',version:1,files},null,2)+'\n';
await writeFile(join(root,'data/review-manifest.json'),manifest);await writeFile(join(mobile,'data/review-manifest.json'),manifest);
let tests=0;for(const name of await readdir(join(root,'tests')))if(/^review-.*\.test\.(?:mjs|cjs)$/.test(name)){await writeFile(join(mobile,'tests',name),await readFile(join(root,'tests',name)));tests++;}
console.log(`Synchronized ${files.length} review files and ${tests} review suites.`);
