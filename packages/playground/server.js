#!/usr/bin/env node
import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { constants, existsSync } from 'fs';
import { moduleRevision, ProjectError, ProjectStore, spriteImageTypes } from './lib/projects.js';

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
const moduleRevisionHeader = 'X-Dino-Module-Revision';
const projects = new ProjectStore(scriptsRoot);
const bundledTemplate = path.join(DIST_DIR, 'templates/amber-ruins');
const template = existsSync(bundledTemplate) ? bundledTemplate : path.join(__dirname, '../example/amber-ruins');
await projects.seed(template);

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

app.post('/api/projects', express.json({ limit: '24mb' }), async (req, res) => {
  try {
    res.status(201).json({ id: await projects.import(req.body) });
  } catch (err) {
    res.status(err instanceof ProjectError ? err.status : 500).json({ error: err.message });
  }
});
app.put('/api/scripts/:id/modules', express.json({ limit: '24mb' }), async (req, res) => {
  try {
    const { data, revision } = req.body ?? {};
    if (typeof data !== 'string') return res.status(400).json({ error: 'Module contents must be text.' });
    const savedRevision = await projects.saveModule(req.params.id, req.query.path, data, revision);
    res.set(moduleRevisionHeader, savedRevision).json({ success: true });
  } catch (err) {
    res.status(scriptErrorStatus(err)).json({ error: err.message });
  }
});
app.use(express.json());

const serveWorkspace = [async (req, res, next) => {
  try {
    const requested = path.resolve(scriptsRoot, `.${decodeURIComponent(req.path)}`);
    const resolved = await fs.realpath(requested);
    if (resolved.startsWith(scriptsRoot + path.sep)) {
      if (req.params.run && (req.method === 'GET' || req.method === 'HEAD') && /\.m?js$/.test(requested)) {
        const stat = await fs.stat(resolved);
        if (stat.isFile() && stat.size <= 16 * 1024 * 1024) {
          const contents = await fs.readFile(resolved, { flag: constants.O_RDONLY | noFollow });
          // Pin the source to the bytes the module loader received for this run.
          return res.set('Server-Timing', `dino-source;desc="${moduleRevision(contents)}"`)
            .set('Cache-Control', 'no-store').type('text/javascript').send(contents);
        }
      }
      return next();
    }
  } catch (err) {
    if (!(err instanceof URIError) && err.code !== 'ENOENT' && err.code !== 'ENOTDIR') return next(err);
  }
  res.sendStatus(404);
}, express.static(scriptsRoot, { fallthrough: false, index: false, redirect: false })];
app.use('/scripts', serveWorkspace);
// A fresh URL prefix gives every run a separate browser module graph.
app.use('/project-runs/:run', serveWorkspace);

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

const scriptErrorStatus = err => {
  if (err instanceof ProjectError) return err.status;
  if (err.code === 'EEXIST') return 409;
  return ['ENOENT', 'ELOOP'].includes(err.code) ? 404 : 500;
};

// API Routes
app.get('/files', async (req, res) => {
  try {
    res.json(await projects.list());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/scripts/:id/assets', async (req, res) => {
  try {
    res.json(await projects.listSprites(req.params.id));
  } catch (err) {
    res.status(scriptErrorStatus(err)).json({ error: err.message });
  }
});

app.post('/api/scripts/:id/assets', express.raw({ type: spriteImageTypes, limit: '5mb' }), async (req, res) => {
  try {
    const type = req.get('content-type')?.split(';')[0].trim().toLowerCase();
    const url = await projects.importSprite(req.params.id, req.query.name, type, req.body);
    res.status(201).json({ url });
  } catch (err) {
    res.status(scriptErrorStatus(err)).json({ error: err.message });
  }
});

app.get('/api/scripts/:id/modules', async (req, res) => {
  try {
    if (req.query.path === undefined) return res.json(await projects.listModules(req.params.id));
    const { data, revision } = await projects.readModule(req.params.id, req.query.path);
    res.set(moduleRevisionHeader, revision).json(data);
  } catch (err) {
    res.status(scriptErrorStatus(err)).json({ error: err.message });
  }
});

app.get('/api/scripts/:id', async (req, res) => {
  try {
    const filePath = await projects.scriptPath(req.params.id);
    if (!(await fs.lstat(filePath)).isFile()) return res.sendStatus(404);
    const file = await fs.readFile(filePath, { encoding: 'utf8', flag: constants.O_RDONLY | noFollow });
    res.json(file);
  } catch (err) {
    res.status(scriptErrorStatus(err)).json({ error: err.message });
  }
});

app.put('/api/scripts/:id', async (req, res) => {
  try {
    const { create, data, upsert } = req.body ?? {};
    if (typeof data !== 'string') return res.status(400).json({ error: 'Script contents must be text.' });
    const filePath = await projects.scriptPath(req.params.id, { entryOnly: true });
    const existing = await fs.lstat(filePath, { throwIfNoEntry: false });
    if (existing && !existing.isFile()) return res.sendStatus(404);
    const mode = create === true ? constants.O_EXCL : upsert ? constants.O_APPEND : constants.O_TRUNC;
    await fs.writeFile(filePath, data, { flag: constants.O_WRONLY | constants.O_CREAT | mode | noFollow });
    res.json({ success: true });
  } catch (err) {
    res.status(scriptErrorStatus(err)).json({ error: err.code === 'EEXIST' ? 'A script with that name already exists.' : err.message });
  }
});

const PORT = process.env.PORT || 3000;
const host = process.env.HOST || '127.0.0.1';
const server = app.listen(PORT, host, () => {
  console.log(`Dino GE Playground (${ENV}): http://${host}:${server.address().port}`);
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
