import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,copyFile,readFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
const run=promisify(execFile);
test('CLI-only verification reuses canonical resource identity and rejects a failed publisher',async()=>{
 const root=await mkdtemp(join(tmpdir(),'moe-cli-input-'));
 const identity={schemaVersion:1,eventId:'resource:0.0.19:cli:0.0.6',sourceRepository:'moewolf-dev/moe-icons-code-library',sourceVersion:'0.0.19',sourceCommit:'a'.repeat(40),cliVersion:'0.0.6',resourceVersion:'0.0.19',descriptorSha256:'b'.repeat(64),resourceDigest:'b'.repeat(64),verifiedDelivery:true};
 const receipt={version:'0.0.7',releaseCommit:'c'.repeat(40),runId:'123',npmIntegrity:'sha512-fixture',provenance:true,conclusion:'success'};
 try{
  await mkdir(join(root,'scripts'));await mkdir(join(root,'data'));await mkdir(join(root,'bin'));
  await copyFile('scripts/verify-cli-input.mjs',join(root,'scripts/verify-cli-input.mjs'));
  await writeFile(join(root,'data/release-state.json'),JSON.stringify({current:{resourceVersion:'0.0.19'},events:[{phase:'verified',tag:'v0.0.9',event:identity}]}));
  await writeFile(join(root,'bin/git'),`#!${process.execPath}\nconsole.log('fixture-blob');`,{mode:0o755});
  await writeFile(join(root,'bin/gh'),`#!${process.execPath}
const fs=require('node:fs'),path=require('node:path');const args=process.argv.slice(2);let out;
if(args[0]==='run'){const dir=args[args.indexOf('--dir')+1];fs.writeFileSync(path.join(dir,'cli-publish-receipt.json'),${JSON.stringify(JSON.stringify(receipt))});process.exit(0);}
const route=args[1];if(route.includes('/actions/runs/'))out={path:'.github/workflows/publish.yml',conclusion:process.env.FAILED?'failure':'success',head_sha:'d'.repeat(40)};
else if(route.includes('/commits/'))out={sha:'c'.repeat(40)};
else if(route.includes('/releases/'))out={draft:false,tag_name:'v0.0.7'};
else out={content:Buffer.from(JSON.stringify({resourceVersion:'0.0.19',privateDescriptorSha256:'b'.repeat(64),sourceCommit:'a'.repeat(40)})).toString('base64')};console.log(JSON.stringify(out));`,{mode:0o755});
  await writeFile(join(root,'preload.mjs'),`globalThis.fetch=async url=>Response.json(String(url).includes('registry')?{dist:{integrity:'sha512-fixture'}}:{pro:{version:'0.0.19',descriptorSha256:'b'.repeat(64)}});`);
  const env={...process.env,PATH:join(root,'bin')+':'+process.env.PATH,CLI_VERSION:'0.0.7',CLI_RELEASE_COMMIT:'c'.repeat(40),CLI_PUBLISH_HEAD:'d'.repeat(40),CLI_PUBLISH_RUN_ID:'123',RESOURCE_VERSION:'0.0.19',DESCRIPTOR_SHA256:'b'.repeat(64),CLI_NPM_INTEGRITY:'sha512-fixture',EVENT_ID:'resource:0.0.19:cli:0.0.7'};
  await run(process.execPath,['--import',join(root,'preload.mjs'),'scripts/verify-cli-input.mjs',join(root,'output')],{cwd:root,env});
  assert.deepEqual(JSON.parse(await readFile(join(root,'output/event.json'),'utf8')),{...identity,eventId:env.EVENT_ID,cliVersion:'0.0.7'});
  await assert.rejects(run(process.execPath,['--import',join(root,'preload.mjs'),'scripts/verify-cli-input.mjs',join(root,'failed')],{cwd:root,env:{...env,FAILED:'1'}}),/CLI producer mismatch/);
 }finally{await rm(root,{recursive:true,force:true});}
});
