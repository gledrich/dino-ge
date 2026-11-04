#!/usr/bin/env node
import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { constants, existsSync } from 'fs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const DIST_DIR = path.join(__dirname, 'dist');
const PUBLIC_DIR = path.join(__dirname, 'public');
const SCRIPTS_DIR = path.join(process.cwd(), 'scripts');

const ENV = process.env.ENVIRONMENT || 'prod';

await fs.mkdir(SCRIPTS_DIR, { recursive: true });
if (!(await fs.lstat(SCRIPTS_DIR)).isDirectory()) {
  throw new Error('The scripts path must be a directory, not a symbolic link.');
}

const scriptsRoot = await fs.realpath(SCRIPTS_DIR);
const noFollow = constants.O_NOFOLLOW ?? 0;

// Resolve dino-ge dist path
let DINO_GE_DIST;
try {
  DINO_GE_DIST = path.join(
    path.dirname(require.resolve('dino-ge/package.json')),
    'dist'
  );
} catch {
  DINO_GE_DIST = path.join(__dirname, '../dino-ge/dist');
}

app.use(express.json());

app.use('/scripts', async (req, res, next) => {
  try {
    const requested = path.resolve(scriptsRoot, `.${decodeURIComponent(req.path)}`);
    const resolved = await fs.realpath(requested);
    if (resolved.startsWith(scriptsRoot + path.sep)) return next();
  } catch (err) {
    if (!(err instanceof URIError) && err.code !== 'ENOENT' && err.code !== 'ENOTDIR') return next(err);
  }
  res.sendStatus(404);
}, express.static(scriptsRoot, { fallthrough: false, index: false, redirect: false }));

// Explicit Static File Serving based on ENVIRONMENT
if (ENV === 'prod') {
  console.log('Serving production build from dist/');
  app.use(express.static(DIST_DIR));
} else {
  console.log('Serving development assets from public/');
  if (existsSync(PUBLIC_DIR)) app.use(express.static(PUBLIC_DIR));
}

app.use('/built', express.static(DINO_GE_DIST));

app.get('/api/types', async (req, res) => {
  try {
    const types = {};
    const walk = async (dir, base = 'dist') => {
      const files = await fs.readdir(dir, { withFileTypes: true });
      for (const file of files) {
        const fullPath = path.join(dir, file.name);
        const relPath = `${base}/${file.name}`;
        if (file.isDirectory()) {
          await walk(fullPath, relPath);
        } else if (file.name.endsWith('.d.ts')) {
          types[relPath] = await fs.readFile(fullPath, 'utf-8');
        }
      }
    };
    await walk(DINO_GE_DIST);

    res.json(types);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const getFilePath = (id) =>
  path.join(scriptsRoot, id.endsWith('.js') ? id : `${id}.js`);

app.param('id', (req, res, next, id) => {
  if (id.includes('/') || id.includes('\\') || id.includes('\0') ||
      (process.platform === 'win32' && id.includes(':'))) {
    return res.status(400).json({ error: 'Invalid script ID' });
  }
  next();
});

// API Routes
app.get('/files', async (req, res) => {
  try {
    const files = await fs.readdir(scriptsRoot, { withFileTypes: true });
    const scripts = files
      .filter((file) => file.isFile() && file.name.endsWith('.js'))
      .map((file) => file.name.slice(0, -3));
    res.json(scripts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/scripts/:id', async (req, res) => {
  try {
    const filePath = getFilePath(req.params.id);
    if (!(await fs.lstat(filePath)).isFile()) return res.sendStatus(404);
    const file = await fs.readFile(filePath, { encoding: 'utf8', flag: constants.O_RDONLY | noFollow });
    res.json(file);
  } catch (err) {
    res.status(['ENOENT', 'ELOOP'].includes(err.code) ? 404 : 500).json({ error: err.message });
  }
});

app.put('/api/scripts/:id', async (req, res) => {
  try {
    const filePath = getFilePath(req.params.id);
    const existing = await fs.lstat(filePath, { throwIfNoEntry: false });
    if (existing && !existing.isFile()) return res.sendStatus(404);
    const data = String(req.body.data);
    const mode = req.body.upsert ? constants.O_APPEND : constants.O_TRUNC;
    await fs.writeFile(filePath, data, { flag: constants.O_WRONLY | constants.O_CREAT | mode | noFollow });
    res.json({ success: true });
  } catch (err) {
    res.status(err.code === 'ELOOP' ? 404 : 500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`Dino GE Playground (${ENV}): http://localhost:${PORT}`);
  console.log(`Scripts directory: ${SCRIPTS_DIR}`);
});

// Graceful shutdown
const shutdown = () => {
  console.log('Shutting down server...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
