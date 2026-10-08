import {test} from 'node:test';import assert from 'node:assert/strict';
import {missingCredential} from '../src/account/session-policy.cjs';
test('only known missing credentials become signed out',()=>{
 assert.equal(missingCredential('darwin',{code:44}),true);assert.equal(missingCredential('darwin',{code:'ETIMEDOUT'}),false);
 assert.equal(missingCredential('linux',{code:1,stderr:''}),true);assert.equal(missingCredential('linux',{code:1,stderr:'permission denied'}),false);
 assert.equal(missingCredential('win32',{stderr:'0x80070490'}),true);
});
