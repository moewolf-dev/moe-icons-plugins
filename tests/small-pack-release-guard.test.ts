import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const update = readFileSync(".github/workflows/resource-update.yml", "utf8");
const resume = readFileSync(".github/workflows/resource-update-auto-resume.yml", "utf8");

test("resource receiver activates only for the bounded package-set and CLI actions", () => {
  const body = update.split("\n  update:\n")[1];
  assert.ok(body, "resource receiver job must exist");
  const condition = body.match(/^    if: (.*)$/m)?.[1];
  assert.ok(condition, "resource receiver must have an explicit fail-closed condition");
  assert.match(condition, /github\.repository == 'moewolf-dev\/moe-icons-plugins'/);
  assert.match(condition, /vars\.MOEICONS_AUTO_RELEASE_ENABLED == 'true'/);
  assert.deepEqual([...condition.matchAll(/github\.event\.action == '([^']+)'/g)].map(match => match[1]),
    ["moe-icons-cli-release", "moe-icons-package-set-release"]);
  assert.doesNotMatch(condition, /moe-icons-code-library-release/);
});

test("aggregate retry remains disabled and the active receiver checks its vendored pin before producer access", () => {
  const resumeBody = resume.split("\n  resume:\n")[1];
  assert.ok(resumeBody, "auto-resume job must exist");
  assert.deepEqual(resumeBody.match(/^    if:.*$/gm), ["    if: false"]);
  const pinCheck = update.indexOf("node scripts/verify-small-pack-pin.mjs");
  const producerRead = update.indexOf("node scripts/verify-package-set-input.mjs");
  assert.ok(pinCheck >= 0 && producerRead > pinCheck, "pin verification must precede producer reads");
  assert.match(update, /^permissions: \{\}$/m);
  assert.match(update, /update:[\s\S]*?permissions:\n      actions: write\n      contents: write/);
});
