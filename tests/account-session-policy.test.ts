import {test} from 'node:test';import assert from 'node:assert/strict';
import {missingCredential,selectedStore} from '../src/account/session-policy.cjs';
import {readCliAccessToken} from '../src/account/session';
import {mkdtempSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('only known missing credentials become signed out',()=>{
 assert.equal(missingCredential('darwin',{code:44}),true);assert.equal(missingCredential('darwin',{code:'ETIMEDOUT'}),false);
 assert.equal(missingCredential('linux',{code:1,stderr:''}),true);assert.equal(missingCredential('linux',{code:1,stderr:'permission denied'}),false);
 assert.equal(missingCredential('win32',{stderr:'0x80070490'}),true);
});
test('a dangling storage preference cannot select an unrelated backend',()=>{
 const root=mkdtempSync(join(tmpdir(),'moeicons-plugin-preference-'));
 try{symlinkSync(join(root,'absent'),join(root,'session-store.json'));assert.throws(()=>selectedStore({MOEICONS_STATE_DIR:root,MOEICONS_DISABLE_SYSTEM_KEYCHAIN:'1'}),/not readable securely/);assert.throws(()=>selectedStore({MOEICONS_STATE_DIR:root}),/not readable securely/);}
 finally{rmSync(root,{recursive:true,force:true});}
});

test('file fallback treats only an absent or empty store as signed out', async()=>{
 const root=mkdtempSync(join(tmpdir(),'moeicons-plugin-session-'));
 const previous={disable:process.env.MOEICONS_DISABLE_SYSTEM_KEYCHAIN,dir:process.env.MOEICONS_TOKEN_STORE_DIR};
 process.env.MOEICONS_DISABLE_SYSTEM_KEYCHAIN='1';process.env.MOEICONS_TOKEN_STORE_DIR=root;
 const file=join(root,'token-store.json');
 const valid={accountId:'fixture',accessToken:'fixture-access',refreshToken:'fixture-refresh',expiresAt:Date.now()+60_000,scope:'openid',storedAt:1};
 try{
  assert.equal((await readCliAccessToken()).kind,'signedOut');
  const cases:[string,unknown,string][]=[
   ['empty',{},'signedOut'],
   ['invalid entry',{invalid:'fixture'},'unknown'],
   ['missing fields',{fixture:{storedAt:1,accessToken:'fixture-access',expiresAt:Date.now()+60_000}},'unknown'],
   ['mixed valid and corrupt',{fixture:valid,invalid:'fixture'},'unknown'],
   ['valid',{fixture:valid},'token'],
  ];
  for(const [name,value,expected] of cases){writeFileSync(file,JSON.stringify(value),{mode:0o600});assert.equal((await readCliAccessToken()).kind,expected,name);}
  rmSync(file);symlinkSync(join(root,'missing-target'),file);assert.equal((await readCliAccessToken()).kind,'unknown');
 }finally{
  if(previous.disable===undefined)delete process.env.MOEICONS_DISABLE_SYSTEM_KEYCHAIN;else process.env.MOEICONS_DISABLE_SYSTEM_KEYCHAIN=previous.disable;
  if(previous.dir===undefined)delete process.env.MOEICONS_TOKEN_STORE_DIR;else process.env.MOEICONS_TOKEN_STORE_DIR=previous.dir;
  rmSync(root,{recursive:true,force:true});
 }
});
