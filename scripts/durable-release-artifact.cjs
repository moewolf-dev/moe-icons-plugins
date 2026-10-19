'use strict';

// CI FLOW RULE (S00): expired Actions retention must not trigger recovery of
// the full production ZIP from a private Release. Recovery will resolve exact
// content-addressed package identities from a candidate-set instead.
function artifactRecord() {
  throw new Error('aggregate production ZIP recovery is retired; package-set recovery is required');
}

async function retrieve() {
  throw new Error('aggregate production ZIP recovery is retired; package-set recovery is required');
}

if (require.main === module) {
  try {
    if (process.argv[2] !== 'retrieve') throw new Error('unsupported operation');
    throw new Error('aggregate production ZIP recovery is retired; package-set recovery is required');
  } catch (error) {
    process.stderr.write(`${error.message || error}\n`);
    process.exitCode = 1;
  }
}

module.exports = { artifactRecord, retrieve };
