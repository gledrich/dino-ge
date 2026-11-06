import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import MarkdownIt from 'markdown-it';

const root = fileURLToPath(new URL('../', import.meta.url));
const docs = join(root, 'docs');
const output = join(root, 'dist', 'pages');
const guide = join(output, 'guide');
const demos = join(guide, 'demos');
const markdown = new MarkdownIt();
const { version } = JSON.parse(await readFile(join(root, 'packages/dino-ge/package.json'), 'utf8'));

function renderPage(source, css) {
  const body = source.replace(/^---\n---\n/, '');
  const title = body.match(/^# (.+)$/m)[1];
  return `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} | Dino GE</title><link rel="stylesheet" href="${css}">
<body><main>${markdown.render(body)}</main></body></html>
`;
}

execFileSync('npm', ['run', 'build', '-w', 'dino-ge'], { cwd: root, stdio: 'inherit' });
await rm(output, { recursive: true, force: true });
await mkdir(guide, { recursive: true });
execFileSync('npm', ['run', 'docs', '-w', 'dino-ge', '--', '--out', join(output, 'api')], {
  cwd: root, stdio: 'inherit',
});

for (const dir of ['', 'guide']) {
  const source = join(docs, dir);
  for (const file of await readdir(source)) {
    if (!file.endsWith('.md')) continue;
    const body = await readFile(join(source, file), 'utf8');
    const css = dir ? 'guide.css' : 'guide/guide.css';
    await writeFile(join(output, dir, file.replace(/\.md$/, '.html')), renderPage(body, css));
  }
}
await cp(join(docs, 'guide/guide.css'), join(guide, 'guide.css'));
await cp(join(docs, 'guide/demos'), demos, {
  recursive: true,
  filter: source => !source.endsWith('/source.md'),
});
await cp(join(root, 'packages/dino-ge/dist'), join(demos, 'engine'), { recursive: true });

const game = join(root, 'packages/example/amber-ruins');
const expedition = join(demos, 'amber-ruins');
for (const name of ['game.js', 'outpost.js', 'outpost-world.js', 'assets']) {
  await cp(join(game, name), join(expedition, name), { recursive: true });
}
await cp(join(root, 'website/preview/touch-arrows.js'), join(expedition, 'touch-arrows.js'));

const assets = join(demos, 'assets');
await mkdir(assets, { recursive: true });
for (const name of ['explorer-walk.png', 'pickup.wav']) {
  await cp(join(game, 'assets', name), join(assets, name));
}
const release = 'https://cdn.jsdelivr.net/gh/gledrich/dino-ge@v' + version;
const gameAssets = release + '/packages/example/amber-ruins';
const releaseEngine = 'https://cdn.jsdelivr.net/npm/dino-ge@' + version + '/dist/index.js';
for (const slug of await readdir(join(docs, 'guide/demos'), { withFileTypes: true })) {
  if (!slug.isDirectory()) continue;
  const source = await readFile(join(docs, 'guide/demos', slug.name, 'source.md'), 'utf8');
  const script = await readFile(join(demos, slug.name, 'main.js'), 'utf8');
  const body = source.replace('{% include_relative main.js %}', () => script.trimEnd());
  await writeFile(join(demos, slug.name, 'source.html'), renderPage(body, '../../guide.css'));
  const file = join(demos, slug.name, 'index.html');
  const html = await readFile(file, 'utf8');
  if (!html.includes(releaseEngine)) {
    throw new Error('Update the Pages demo engine pin to ' + version + ' in ' + slug.name);
  }
  const local = html
    .replace(releaseEngine, '../engine/index.js')
    .replace(gameAssets + '/assets/', '../assets/')
    .replace(gameAssets + '/game.js', './game.js')
    .replace(release + '/website/preview/touch-arrows.js', './touch-arrows.js');
  if (local.includes('https://cdn.jsdelivr.net/')) {
    throw new Error('Update the Pages asset pins to ' + version + ' in ' + slug.name);
  }
  await writeFile(file, local);
}

await writeFile(join(output, '.nojekyll'), '');
console.log(`Dino GE ${version} Pages output: ${output}`);
