import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {test} from 'node:test';
const root=resolve(import.meta.dirname,'..');
test('shared review code is hash pinned and available on both platforms',async()=>{
 const manifest=JSON.parse(await readFile(join(root,'data/review-manifest.json'),'utf8'));
 assert.equal(manifest.schema,'twistforge-shared-review');assert.equal(manifest.version,1);
 assert.deepEqual((await readdir(join(root,'data/review'))).sort(),manifest.files.map(f=>f.path).sort());
 for(const file of manifest.files){assert.match(file.path,/^[A-Za-z0-9_.-]+$/);assert.equal(createHash('sha256').update(await readFile(join(root,'data/review',file.path))).digest('hex'),file.sha256);}
 const sibling=resolve(root,root.endsWith('desktop-shell')?'../rg2-mobile':'../desktop-shell');
 try{assert.deepEqual(JSON.parse(await readFile(join(sibling,'data/review-manifest.json'),'utf8')),manifest);}catch(error){if(error.code!=='ENOENT')throw error;}
});
