import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { readProjectSnapshot } from '../src/language/project';
import { analyzeDocument } from '../src/language/analyze';

const cliRoot = process.env.MOEICONS_CLI_REPO || resolve('../moe-icons-cli');
const available = fs.existsSync(join(cliRoot, 'src/core/generate.ts'));
if (process.env.MOEICONS_CLI_REPO && !available) throw new Error('Required CLI checkout is missing');
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
for (const [target, bitmap, compiledFactory] of [['react', true, false], ['vue', true, false], ['react', false, false], ['vue', false, false], ['vanilla', false, false], ['vanilla', false, true]] as const) {
  test(`real CLI ${target} ${bitmap ? "bitmap" : "SVG"} ${compiledFactory ? "compiled factory" : "source"} generation is understood by the plugin in a nested project`, { skip: !available }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'moe-cli-plugin-'));
    try {
      const project = join(root, 'apps/site');
      await mkdir(join(project, '.moeicons'), { recursive: true });
      await writeFile(join(project, 'package.json'), '{"name":"fixture","version":"1.0.0"}');
      const group = !bitmap ? 'moe-outline' : 'moe-3d-metal';
      const catalog = JSON.stringify({ schemaVersion: 1, catalogVersion: '1.0.0', sourceVersion: '1.0.0', sourceCommit: 'a'.repeat(40), generatorCommit: 'b'.repeat(40), styleGroups: [
        !bitmap ? { id: group, type: 'outline', tiers: ['free','pro'], formats: ['svg'], imageSizes: [] } : { id: group, type: 'bitmap', tiers: ['pro'], formats: ['webp'], imageSizes: [256], variants: ['moe-3d-metal-256-webp'] },
      ], icons: [{ id: 'archive-box', prefix: 'ar', label: 'Archive box', aliases: [], availableIn: [group] }] });
      await writeFile(join(project, '.moeicons/catalog.json'), catalog);
      await writeFile(join(project, '.moeicons/install-metadata.json'), JSON.stringify({ schemaVersion: 1, artifactVersion: '1.0.0', tier: 'pro', target, descriptorSha256: 'c'.repeat(64), artifactSha256: 'd'.repeat(64), catalogSha256: sha(catalog), installedAt: '2026-10-07T00:00:00Z', managedFiles: { '.moeicons/catalog.json': sha(catalog) } }));
      await writeFile(join(project, 'moeicons.config.json'), JSON.stringify({ schemaVersion: 2, tier: 'pro', target, outputDir: 'src/moeicons', defaultTheme: 'metal', themes: { metal: !bitmap ? { styleGroup: group, format: 'svg' } : { styleGroup: group, format: 'webp', imageSize: 256 } }, icons: ['archive-box'] }));
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0L24 24"/></svg>';
      const archive = !bitmap ? { 'assets/moe-outline/archive-box.svg': Buffer.from(svg), 'assets/manifest.json': Buffer.from(JSON.stringify({schemaVersion:1,assets:[{path:'moe-outline/archive-box.svg',size:Buffer.byteLength(svg),sha256:sha(svg)}]})) } : { 'assets/moe-3d-metal-256-webp/archive-box.webp': new Uint8Array([82,73,70,70,1]) };
      if (compiledFactory) {
        const factory = 'function n() { return document.createElementNS("http://www.w3.org/2000/svg", "svg"); } export { n as createArchiveBox, n as default };';
        const artifactPath = '.moeicons/artifact/vanilla/moe-outline/ArchiveBox.js';
        await mkdir(join(project, '.moeicons/artifact/vanilla/moe-outline'), { recursive: true });
        await writeFile(join(project, artifactPath), factory);
        const metadataPath = join(project, '.moeicons/install-metadata.json');
        const metadata = JSON.parse(await fs.promises.readFile(metadataPath, 'utf8'));
        metadata.managedFiles[artifactPath] = sha(factory);
        await writeFile(metadataPath, JSON.stringify(metadata));
        Object.assign(archive, { 'vanilla/moe-outline/ArchiveBox.js': Buffer.from(factory) });
      }
      const { runGenerateUseCase } = await import(pathToFileURL(join(cliRoot, 'src/core/generate.ts')).href);
      const result = await runGenerateUseCase({ cwd: project, env: {}, signal: new AbortController().signal, now: () => new Date('2026-10-07T00:00:00Z'), ui: { select: async () => 'pro', confirm: async () => true, text: async () => '', note() {}, progress: () => ({ stop() {} }) } }, fs, { noTailwind: true, archiveFiles: archive });
      assert.equal(result.ok, true, JSON.stringify(result));
      await writeFile(join(project, 'tsconfig.json'), '{"compilerOptions":{"baseUrl":".","paths":{"@/*":["src/*"]}}}');
      const snapshot = await readProjectSnapshot(project);
      assert.equal(snapshot.version, '1.0.0');
      const module = snapshot.resolver(join(project, 'src/App.tsx'))('@/moeicons');
      assert.ok(module, 'CLI output must be a verified import surface');
      assert.ok(module.exports.has(target === 'vanilla' ? 'MoeOutline' : 'ArchiveBox'), [...module.exports.keys()].join(','));
      const text = target === 'vue' ? `<script setup>import { ArchiveBox, Missing } from '@/moeicons';</script><template><ArchiveBox /></template>` : `import { ${target === 'vanilla' ? 'MoeOutline' : 'ArchiveBox'}, Missing } from '@/moeicons'; ${target === 'react' ? '<ArchiveBox />' : 'MoeOutline.createArchiveBox()'};`;
      const analysis = analyzeDocument(text, target === 'vue' ? 'vue' : target === 'react' ? 'typescriptreact' : 'typescript', snapshot.resolver(join(project, 'src/App.tsx')));
      assert.ok(analysis.occurrences.some(item => item.symbol.iconId === 'archive-box'));
      assert.equal(analysis.issues.length, 1);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}
