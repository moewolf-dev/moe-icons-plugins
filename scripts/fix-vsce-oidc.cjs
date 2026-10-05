// Temporary compatibility fix for npm vsce 4.0.0, matching Microsoft's upstream
// src/oidc.ts: API 7.2-preview.1 and FederatedToken authentication.
// Fail closed if the installed implementation differs; never change credentials.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const file = require.resolve('@vscode/vsce/out/oidc.js');
const source = fs.readFileSync(file, 'utf8');
const oldUrl = "}/_apis/gallery/token`, request";
const newUrl = "}/_apis/gallery/token?api-version=7.2-preview.1`, request";
const oldAuth = 'Authorization: `Bearer ${oidcToken}`';
const newAuth = 'Authorization: `FederatedToken ${oidcToken}`';
if (source.includes(newUrl) && source.includes(newAuth)) {
  console.log('vsce already includes the upstream OIDC fix.');
} else {
  assert.equal(require('@vscode/vsce/package.json').version, '4.0.0');
  assert.equal(source.split(oldUrl).length, 2, 'Unexpected token exchange URL');
  assert.equal(source.split(oldAuth).length, 2, 'Unexpected token exchange authentication');
  fs.writeFileSync(file, source.replace(oldUrl, newUrl).replace(oldAuth, newAuth));
  console.log('Applied the upstream OIDC compatibility fix to vsce 4.0.0.');
}
