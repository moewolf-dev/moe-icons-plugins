import { build, context } from "esbuild";

const watch = process.argv.includes("--watch");

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
  console.log("build complete: dist/extension.js");
}
