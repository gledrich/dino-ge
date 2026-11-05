import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const website = join(root, 'website');
const output = join(website, 'dist');
const site = join(output, 'site');
const preview = join(output, 'preview');
const engine = join(root, 'packages', 'dino-ge', 'dist');
const release = process.argv.includes('--release');
if (release && (!process.env.DINO_SITE_URL || !process.env.VITE_DINO_PREVIEW_URL)) {
  throw new Error('Set DINO_SITE_URL and VITE_DINO_PREVIEW_URL to the release HTTPS addresses.');
}
const broker = new URL(process.env.VITE_DINO_PREVIEW_URL ?? 'http://127.0.0.1:4174/broker.html');
if (!['http:', 'https:'].includes(broker.protocol) || broker.username || broker.password ||
    broker.pathname !== '/broker.html' || broker.search || broker.hash ||
    (broker.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(broker.hostname))) {
  throw new Error('Set VITE_DINO_PREVIEW_URL to the HTTPS broker.html URL on the dedicated preview origin.');
}
let editorOrigin;
if (release) {
  const publicSite = new URL(process.env.DINO_SITE_URL);
  const loopback = ['localhost', '127.0.0.1', '[::1]'];
  if (publicSite.protocol !== 'https:' || broker.protocol !== 'https:' ||
      publicSite.href !== publicSite.origin + '/' || publicSite.origin === broker.origin ||
      loopback.includes(publicSite.hostname) || loopback.includes(broker.hostname)) {
    throw new Error('Release builds require two different, non-loopback HTTPS origins.');
  }
  editorOrigin = publicSite.origin;
}

const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run the site build with npm run website:build.');

function run(...args) {
  const result = spawnSync(process.execPath, [npm, ...args], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, VITE_DINO_PREVIEW_URL: broker.href },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Build failed: npm ' + args.join(' '));
}

await rm(output, { recursive: true, force: true });
run('run', 'build', '-w', 'dino-ge');
run('run', 'build', '-w', 'dino-ge-playground', '--', '--outDir', site, '--emptyOutDir');

const editor = await readFile(join(site, 'index.html'), 'utf8');
const editorHead = editor.match(/<head>([\s\S]*?)<\/head>/)?.[1];
if (!editorHead?.includes('type="module"')) throw new Error('The built editor entry is missing its module.');

for (const item of ['index.html', 'site.css', 'docs', 'media', 'playground']) {
  await cp(join(website, item), join(site, item), { recursive: true });
}
const playground = join(site, 'playground', 'index.html');
const playgroundHtml = await readFile(playground, 'utf8');
// Keep Vite's generated import map, module and stylesheet links together.
const editorAssets = editorHead.replace(/<meta\b[^>]*>|<title>[\s\S]*?<\/title>/g, '').trim();
await writeFile(playground, playgroundHtml.replace('<!-- editor assets -->', () => editorAssets));
run('run', 'docs', '-w', 'dino-ge', '--', '--out', join(site, 'docs', 'api'));

await mkdir(preview, { recursive: true });
for (const file of ['broker.html', 'broker.js', 'runner.js', 'touch-arrows.js', 'worker.js']) {
  await cp(join(website, 'preview', file), join(preview, file));
}
if (editorOrigin) {
  const brokerPage = join(preview, 'broker.html');
  const html = await readFile(brokerPage, 'utf8');
  await writeFile(brokerPage, html.replace(
    '<!-- release editor origin -->',
    `<meta name="dino-editor-origin" content="${editorOrigin}">`
  ));
}
await cp(join(website, 'preview', 'touch-arrows.js'), join(site, 'playground', 'touch-arrows.js'));
await Promise.all([site, preview].map(directory => cp(engine, join(directory, 'built'), { recursive: true })));

const declarations = (await readdir(engine, { recursive: true, withFileTypes: true }))
  .filter(file => file.isFile() && file.name.endsWith('.d.ts'))
  .map(file => join(file.parentPath, file.name))
  .sort();
const types = await Promise.all(declarations.map(async file => [
  'dist/' + relative(engine, file).split(sep).join('/'),
  await readFile(file, 'utf8'),
]));
await writeFile(join(site, 'types.json'), JSON.stringify(Object.fromEntries(types)));
await writeFile(join(site, '_headers'),
  '/*\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Content-Type-Options: nosniff\n');
await writeFile(join(preview, '_headers'),
  '/*\n  X-Robots-Tag: noindex\n  X-Content-Type-Options: nosniff\n' +
  '/broker.html\n  Cache-Control: no-cache\n/worker.js\n  Cache-Control: no-cache\n');

console.log('Site output: ' + site);
console.log('Preview output: ' + preview);
