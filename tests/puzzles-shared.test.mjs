import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve,join,relative} from 'node:path';
const root=resolve(import.meta.dirname,'..'),manifest=JSON.parse(await readFile(join(root,'data/puzzles-manifest.json'),'utf8'));
assert.equal(manifest.schema,'rg2-shared-puzzles');assert.equal(manifest.version,1);assert.ok(manifest.files.length>20);
const found=[];async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())await walk(p);else found.push(relative(join(root,'data/puzzles'),p).replaceAll('\\','/'));}}
await walk(join(root,'data/puzzles'));assert.deepEqual(found.sort(),manifest.files.map(f=>f.path).sort(),'manifest describes every shared file');
for(const file of manifest.files){assert.match(file.path,/^[A-Za-z0-9_./-]+$/);assert.ok(!file.path.includes('..'));const bytes=await readFile(join(root,'data/puzzles',file.path));assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256,file.path);}
const sibling=resolve(root,root.endsWith('desktop-shell')?'../rg2-mobile/data':'../desktop-shell/data');
try{const other=await readFile(join(sibling,'puzzles-manifest.json'),'utf8');assert.deepEqual(JSON.parse(other),manifest,'Desktop and Android share one module revision');}catch(error){if(error.code!=='ENOENT')throw error;}
console.log(`PASS ${manifest.files.length} exact shared source hashes and Desktop/Android manifest parity when both checkouts exist.`);
