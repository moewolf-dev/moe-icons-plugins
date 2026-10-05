import { mkdtemp, mkdir, writeFile, readFile, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";

const plugin = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await mkdtemp(join(tmpdir(), "moe-core-host-"));
const workspace = join(temporary, "workspace");
const result = join(temporary, "result.json");
const testRoot = join(temporary, "tests");
const code = process.env.MOEICONS_VSCODE_BIN ?? (process.platform === "darwin" ? "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" : "code");
const hash = value => createHash("sha256").update(value).digest("hex");
try {
  await mkdir(join(workspace, ".moeicons"), { recursive: true });
  await mkdir(join(workspace, "src/moeicons"), { recursive: true });
  await mkdir(testRoot);
  await copyFile(join(plugin, "tests/integration/index.cjs"), join(testRoot, "index.js"));
  const files = {
    ".moeicons/catalog.json": JSON.stringify({ schemaVersion: 1, icons: [{ id: "ui-search" }] }),
    "src/moeicons/index.ts": "export const UiSearch = () => null;",
  };
  for (const [path, content] of Object.entries(files)) await writeFile(join(workspace, path), content);
  await writeFile(join(workspace, ".moeicons/install-metadata.json"), JSON.stringify({
    schemaVersion: 1, artifactVersion: "0.0.18", target: "react", generatedOutputDir: "src/moeicons",
    catalogSha256: hash(files[".moeicons/catalog.json"]),
    managedFiles: Object.fromEntries(Object.entries(files).map(([path, content]) => [path, hash(content)])),
  }));
  await writeFile(join(workspace, "src/App.tsx"), "import * as Icons from './moeicons';\nimport { Missing } from './moeicons';\nconst node = <Icons.UiSearch />;\n");
  const child = spawn(code, [
    `--extensionDevelopmentPath=${plugin}`, `--extensionTestsPath=${testRoot}`,
    `--user-data-dir=${join(temporary, "user")}`, `--extensions-dir=${join(temporary, "extensions")}`,
    "--disable-extensions", "--disable-workspace-trust", "--skip-welcome", "--skip-release-notes", workspace,
  ], { env: { ...process.env, MOEICONS_CORE_TEST_RESULT: result }, stdio: "inherit" });
  let startupError;
  child.on("error", error => { startupError = error; });
  const deadline = Date.now() + 60_000;
  let report;
  while (Date.now() < deadline) {
    if (startupError) throw startupError;
    try { report = JSON.parse(await readFile(result, "utf8")); break; } catch { /* Wait for the isolated host. */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!report || report.extensionHost !== "pass") throw new Error(`Extension Host did not pass. Inspect ${temporary}/user/logs`);
  console.log(JSON.stringify(report, null, 2));
  // CLI success alone is not test success: require the host-written report above.
  // Electron may still be flushing logs after the test report is written.
  try { await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
  catch { console.warn(`Host passed; retained temporary logs because VS Code is still shutting down: ${temporary}`); }
} catch (error) {
  console.error(error);
  console.error(`Retained test evidence: ${temporary}`);
  process.exitCode = 1;
}
