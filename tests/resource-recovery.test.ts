import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore release controller is an executable ESM tool.
import {resourceUpdateRecovery} from '../scripts/auto-resume-resource-update.mjs';
function fixture(){const run={id:42,run_attempt:1,head_sha:'a'.repeat(40),head_branch:'main',path:'.github/workflows/resource-update.yml@main',repository:{full_name:'moewolf-dev/moe-icons-plugins'},head_repository:{full_name:'moewolf-dev/moe-icons-plugins'},event:'repository_dispatch',status:'completed',conclusion:'failure'};return {run,eventRun:{...run},jobs:[{name:'update',conclusion:'failure'}]};}
test('only a first failed exact receiver can retry its retained original payload',()=>{
 assert.equal(resourceUpdateRecovery(fixture()).retry,true);
 for(const change of [{run_attempt:2},{head_branch:'other'},{event:'workflow_dispatch'},{path:'.github/workflows/resource-update.yml@other'},{conclusion:'success'}]){
  const input=fixture();Object.assign(input.run,change);assert.equal(resourceUpdateRecovery(input).retry,false);
 }
 const stale=fixture();stale.eventRun.run_attempt=2;assert.equal(resourceUpdateRecovery(stale).retry,false);
});
