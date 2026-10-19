import { build, context } from "esbuild";
import { stat } from "node:fs/promises";

const watch = process.argv.includes("--watch");
const MAX_STARTUP_BUNDLE_BYTES = 1024 * 1024;

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  external: ["vscode", "./engine.js"],
  format: "cjs",
  platform: "node",
  target: "node16",
  sourcemap: true,
  minify: true,
};

const engine = { ...options, entryPoints: ["src/language/engine.ts"], outfile: "dist/engine.js", external: [] };

if (watch) {
  const ctx = await context({
    ...options,
    sourcemap: true,
  });
  const engineContext = await context(engine);
  await Promise.all([ctx.watch(), engineContext.watch()]);
  console.log("watching for changes...");
} else {
  await Promise.all([build(options), build(engine)]);
  const startupBytes = (await stat("dist/extension.js")).size;
  if (startupBytes > MAX_STARTUP_BUNDLE_BYTES) {
    throw new Error(`extension startup bundle exceeds ${MAX_STARTUP_BUNDLE_BYTES} bytes; keep the full catalog out of activation`);
  }
  console.log("build complete: dist/extension.js");
}
