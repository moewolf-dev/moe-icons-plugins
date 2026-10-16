import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
const update=readFileSync('.github/workflows/resource-update.yml','utf8');
const resume=readFileSync('.github/workflows/resource-update-auto-resume.yml','utf8');
for(const [name,text] of [['update',update],['resume',resume]]) test(`legacy plugin ${name} has an unconditional job guard`,()=>{
 const body=text.split(`\n  ${name}:\n`)[1];assert.ok(body);const conditions=body.match(/^    if:.*$/gm);assert.deepEqual(conditions,['    if: false']);
 if(name==='update')assert.match(body,/^    needs: \[small-pack-policy\]$/m);
});
test('resource policy rejects before credentials, checkout or transfer',()=>{
 const body=update.split('\n  small-pack-policy:\n')[1].split('\n  update:')[0];
 assert.match(body,/^    permissions: \{\}$/m);assert.doesNotMatch(body,/uses:|secrets\.|curl|wget|gh api/);
 const script=body.split('        run: |\n')[1].split('\n').map(line=>line.replace(/^          /,'')).join('\n');
 const dir=mkdtempSync(join(tmpdir(),'plugin-small-pack-guard-'));
 try{const result=spawnSync('bash',['-euo','pipefail','-c',script],{cwd:dir,encoding:'utf8',env:{PATH:process.env.PATH,MOEICONS_AUTO_RELEASE_ENABLED:'true'}});assert.equal(result.status,78);assert.deepEqual(readdirSync(dir),[]);}finally{rmSync(dir,{recursive:true,force:true});}
});
