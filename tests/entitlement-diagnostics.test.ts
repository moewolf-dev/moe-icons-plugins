import {test} from 'node:test';import assert from 'node:assert/strict';
import {entitlementIssues} from '../src/diagnostics/core';import {analyzeDocument} from '../src/language/analyze';
import type {PublicSymbol} from '../src/language/contracts';
const module={complete:true,exports:new Map<string,PublicSymbol>([['ProIcon',{kind:'component',iconId:'fixture',requiresPro:true}],['FreeIcon',{kind:'component',iconId:'fixture-free',requiresPro:false}],['Factory',{kind:'factory'}]])};
test('verified Pro references warn only on confirmed inactive entitlement',()=>{
 const a=analyzeDocument("import * as Icons from './icons'; <Icons.ProIcon/>; <Icons.FreeIcon/>;",'typescriptreact',()=>module);
 assert.equal(entitlementIssues(a.occurrences,{kind:'authenticated',tier:'free',status:'none',effectivePro:false,expiresAt:Date.now()+60000}).length,1);
 assert.equal(entitlementIssues(a.occurrences,{kind:'unknown',reason:'unavailable'}).length,0);
 assert.equal(entitlementIssues(a.occurrences,{kind:'authenticated',tier:'pro',status:'active',effectivePro:true,expiresAt:Date.now()+60000}).length,0);
});
test('deterministic malformed usage is coded while unfinished typing remains quiet',()=>{
 const a=analyzeDocument("import {ProIcon,Factory} from './icons'; <Factory/>; <ProIcon></Wrong>;",'typescriptreact',()=>module);
 assert.ok(a.issues.some(i=>i.key==='INVALID_SYMBOL_NAME'));assert.ok(a.issues.some(i=>i.key==='MALFORMED_USAGE'));
 const b=analyzeDocument("import {ProIcon} from './icons'; <ProIcon",'typescriptreact',()=>module);
 assert.equal(b.issues.length,0);
});
