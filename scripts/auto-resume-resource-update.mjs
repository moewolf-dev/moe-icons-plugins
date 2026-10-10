import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {workflowRunPathMatches} from './workflow-run-path.cjs';
const REPO='moewolf-dev/moe-icons-plugins';
export function resourceUpdateRecovery({run,eventRun,jobs}) {
 if(!run || run.repository?.full_name!==REPO || run.head_repository?.full_name!==REPO || run.head_branch!=='main'
   || run.event!=='repository_dispatch' || !workflowRunPathMatches(run,'.github/workflows/resource-update.yml')) return {retry:false,reason:'untrusted original receiver'};
 if(run.status!=='completed' || !['failure','timed_out'].includes(run.conclusion) || Number(run.run_attempt)!==1) return {retry:false,reason:'outside bounded first failure'};
 if(!eventRun || String(eventRun.id)!==String(run.id) || String(eventRun.run_attempt)!==String(run.run_attempt) || eventRun.head_sha!==run.head_sha) return {retry:false,reason:'stale event'};
 if(!jobs?.some(job=>job.name==='update' && ['failure','timed_out'].includes(job.conclusion))) return {retry:false,reason:'receiver update did not fail'};
 return {retry:true,runId:String(run.id),nextAttempt:2};
}
export function main(env=process.env) {
 if(env.GITHUB_REPOSITORY!==REPO || !env.GITHUB_TOKEN) throw Error('trusted receiver context is required');
 const gh=args=>execFileSync('gh',args,{encoding:'utf8',timeout:60000,env:{...env,GH_TOKEN:env.GITHUB_TOKEN,GH_PROMPT_DISABLED:'1'},maxBuffer:8*1024*1024});
 const eventRun=JSON.parse(execFileSync(process.execPath,['-e',`process.stdout.write(require('node:fs').readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'))`],{env,encoding:'utf8'})).workflow_run;
 if(!/^[1-9][0-9]*$/.test(String(eventRun?.id))) throw Error('invalid receiver run ID');
 let run=JSON.parse(gh(['api',`repos/${REPO}/actions/runs/${eventRun.id}`]));
 const jobs=JSON.parse(gh(['api',`repos/${REPO}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`])).jobs;
 let result=resourceUpdateRecovery({run,eventRun,jobs});
 if(result.retry) {
  run=JSON.parse(gh(['api',`repos/${REPO}/actions/runs/${run.id}`]));
  result=resourceUpdateRecovery({run,eventRun,jobs});
  if(result.retry) gh(['run','rerun',String(run.id),'--failed','--repo',REPO]);
 }
 console.log(JSON.stringify(result));return result;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) main();
