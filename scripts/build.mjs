import { build } from "esbuild";

const watch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node16",
  sourcemap: true,
  minify: false,
};

if (watch) {
  const ctx = await build({
    ...options,
    sourcemap: true,
  });
  await ctx.watch();
  console.log("watching for changes...");
} else {
  await build(options);
  console.log("build complete: dist/extension.js");
}
