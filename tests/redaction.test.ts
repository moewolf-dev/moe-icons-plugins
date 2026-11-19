import { test } from "node:test";
import assert from "node:assert/strict";
import { MoeiconsLogger } from "../src/logging/logger";
import { redactText, sanitizeDetail } from "../src/logging/redact";

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmaXh0dXJlIn0.c2lnbmF0dXJlLWZpeHR1cmU";

test("redacts credentials, emails, home paths, icon source and query signatures", () => {
  const value = [
    `Authorization: Bearer ${JWT}`,
    `"accessToken":"fixture-access-token" "refreshToken":"fixture-refresh-token"`,
    "contact user@example.com for help",
    "config at /Users/alice/private/project and C:\\Users\\alice\\secret",
    `<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>`,
    "https://api.moeicons.com/v1/plugin/account?access_token=fixture-token&x=1",
    "-----BEGIN PRIVATE KEY-----fixture-----END PRIVATE KEY-----",
  ].join("\n");
  const redacted = redactText(value, { homeDir: "/Users/alice" });
  assert.doesNotMatch(redacted, /fixture-access-token|fixture-refresh-token|fixture-token/);
  assert.doesNotMatch(redacted, new RegExp(JWT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(redacted, /user@example\.com/);
  assert.doesNotMatch(redacted, /alice/);
  assert.doesNotMatch(redacted, /<svg/);
  assert.doesNotMatch(redacted, /BEGIN PRIVATE KEY/);
  assert.match(redacted, /\[home\]/);
  assert.match(redacted, /\[redacted-icon-source\]/);
});

test("redacts a stand-alone SVG or data URI used as icon source", () => {
  assert.equal(redactText('<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>'), "[redacted-icon-source]");
  assert.match(redactText("data:image/png;base64,AAAA"), /\[redacted-data-uri\]/);
});

test("detail allowlist drops unknown fields and nested payloads", () => {
  const detail = sanitizeDetail({
    contractStatus: "staleGenerated",
    detail: "catalog-hash",
    httpStatus: 401,
    email: "user@example.com",
    token: "fixture-token",
    body: '{"schemaVersion":1}',
    nested: { accessToken: "fixture" },
  } as never);
  assert.equal(detail, "contractStatus=staleGenerated detail=catalog-hash httpStatus=401");
});

test("output channel logs lifecycle/error codes by default and detail only when enabled", () => {
  let enabled = false;
  const lines: string[] = [];
  const logger = new MoeiconsLogger(
    { appendLine: value => lines.push(value) },
    { diagnosticEnabled: () => enabled, now: () => new Date("2026-11-18T00:00:00Z"), homeDir: () => "/Users/alice" },
  );

  logger.lifecycle("extension.activated", { pluginVersion: "0.0.14", detail: "catalog-hash" });
  logger.error("MOE-ICON-0014", { httpStatus: 500, email: "user@example.com" });
  logger.diagnostic("project.contract", { contractStatus: "staleGenerated", detail: "catalog-hash" });
  assert.equal(lines.length, 2);
  assert.match(lines[0], /extension\.activated/);
  assert.doesNotMatch(lines[0], /catalog-hash/);
  assert.match(lines[1], /MOE-ICON-0014/);
  assert.doesNotMatch(lines[1], /user@example\.com|httpStatus/);

  enabled = true;
  logger.diagnostic("project.contract", {
    contractStatus: "staleGenerated",
    detail: "catalog-hash",
    httpStatus: 200,
    body: "secret body",
    email: "user@example.com",
  } as never);
  logger.lifecycle("home.path", { detail: "/Users/alice/project/secret" });
  assert.equal(lines.length, 4);
  assert.match(lines[2], /contractStatus=staleGenerated/);
  assert.match(lines[2], /detail=catalog-hash/);
  assert.doesNotMatch(lines[2], /secret body|user@example\.com/);
  assert.match(lines[3], /\[home\]/);
  assert.doesNotMatch(lines[3], /alice/);
});
