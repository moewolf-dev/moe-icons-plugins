import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {artifactRecord,retrieve}=require('../scripts/durable-release-artifact.cjs');

test('S00: aggregate production ZIP metadata cannot be restored or accepted',async()=>{
  assert.throws(()=>artifactRecord({}),/aggregate production ZIP recovery is retired/);
  await assert.rejects(retrieve({}),/aggregate production ZIP recovery is retired/);
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'retired-production-zip-'));
  try {
    const destination=path.join(root,'must-not-exist.zip');
    const result=spawnSync(process.execPath,[path.resolve('scripts/durable-release-artifact.cjs'),'retrieve','--zip',destination],{encoding:'utf8'});
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/aggregate production ZIP recovery is retired/);
    assert.equal(fs.existsSync(destination),false);
  } finally {
    fs.rmSync(root,{recursive:true,force:true});
  }
});
