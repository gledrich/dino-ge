import fs from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const manifest = '.dino-ge-project.json';
const maxFiles = 512;
const maxBytes = 16 * 1024 * 1024;
const projectName = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const maxImageBytes = 5 * 1024 * 1024;

export const spriteImageTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

function imageExtension(bytes, type) {
  if (type === 'image/png' && bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return 'png';
  if (type === 'image/jpeg' && bytes.subarray(0, 3).toString('hex') === 'ffd8ff') return 'jpg';
  if (type === 'image/gif' && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) return 'gif';
  if (type === 'image/webp' && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  throw new ProjectError('Choose a PNG, JPEG, GIF or WebP image.', 415);
}

export class ProjectError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function relativePath(value) {
  if (typeof value !== 'string' || value.length > 512) throw new ProjectError('Invalid project path.');
  const parts = value.split('/');
  if (parts.some(part => !part || part.startsWith('.') || part.includes('\0') || /[\\:<>|?*"]/.test(part))) {
    throw new ProjectError('Invalid project path.');
  }
  return parts;
}

export class ProjectStore {
  constructor(root) {
    this.root = realpathSync(root);
  }

  async list() {
    const entries = await fs.readdir(this.root, { withFileTypes: true });
    const scripts = [];
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.js') && !entry.name.startsWith('.')) {
        scripts.push(entry.name.slice(0, -3));
      } else if (entry.isDirectory() && projectName.test(entry.name)) {
        try {
          const metadata = JSON.parse(await fs.readFile(path.join(this.root, entry.name, manifest), 'utf8'));
          relativePath(metadata?.entry);
          if (metadata.entry.endsWith('.js')) scripts.push(`${entry.name}/${metadata.entry.slice(0, -3)}`);
        } catch (error) {
          if (error.code !== 'ENOENT' && !(error instanceof SyntaxError) && !(error instanceof ProjectError)) {
            throw error;
          }
        }
      }
    }
    return scripts.sort();
  }

  async scriptPath(id) {
    const parts = id.includes('/') ? relativePath(id) : [id];
    if (parts.length === 1 && (!id || id.startsWith('.') || id.includes('\\') || id.includes('\0') ||
        (process.platform === 'win32' && id.includes(':')))) {
      throw new ProjectError('Invalid script ID.');
    }
    const name = parts.pop();
    const directory = parts.length ? await fs.realpath(path.join(this.root, ...parts)) : this.root;
    if (directory !== this.root && !directory.startsWith(this.root + path.sep)) {
      throw new ProjectError('Invalid script directory.');
    }
    return path.join(directory, name.endsWith('.js') ? name : `${name}.js`);
  }

  async spriteDirectory(id) {
    const script = await this.scriptPath(id);
    if (!(await fs.lstat(script)).isFile()) throw new ProjectError('The open script could not be found.', 404);
    return path.join(path.dirname(script), '_dino-assets');
  }

  spriteUrl(filename) {
    return `/scripts/${path.relative(this.root, filename).split(path.sep).map(encodeURIComponent).join('/')}`;
  }

  async listSprites(id) {
    const directory = await this.spriteDirectory(id);
    const info = await fs.lstat(directory, { throwIfNoEntry: false });
    if (!info) return [];
    if (!info.isDirectory()) throw new ProjectError('The sprite asset directory is unavailable.');
    const files = await fs.readdir(directory, { withFileTypes: true });
    return files.flatMap(file => {
      const match = /^([a-z0-9_-]{1,48})-[a-f0-9]{64}\.(?:png|jpg|gif|webp)$/.exec(file.name);
      if (!file.isFile() || !match) return [];
      return [{ name: match[1], url: this.spriteUrl(path.join(directory, file.name)) }];
    }).sort((a, b) => a.url.localeCompare(b.url));
  }

  async importSprite(id, name, type, bytes) {
    if (!Buffer.isBuffer(bytes)) throw new ProjectError('Choose a PNG, JPEG, GIF or WebP image.', 415);
    if (bytes.length > maxImageBytes) throw new ProjectError('Sprite images can be up to 5 MiB.', 413);
    const extension = imageExtension(bytes, type);
    const directory = await this.spriteDirectory(id);
    await fs.mkdir(directory, { recursive: true });
    if (!(await fs.lstat(directory)).isDirectory()) throw new ProjectError('The sprite asset directory is unavailable.');

    const stem = typeof name === 'string' ? path.parse(name).name.toLowerCase() : '';
    const label = stem.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'sprite';
    const digest = createHash('sha256').update(bytes).digest('hex');
    const filename = path.join(directory, `${label}-${digest}.${extension}`);
    const temporary = path.join(directory, `.${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temporary, bytes, { flag: 'wx' });
      await fs.link(temporary, filename);
    } catch (error) {
      if (error.code !== 'EEXIST' || !(await fs.lstat(filename, { throwIfNoEntry: false }))?.isFile()) throw error;
    } finally {
      await fs.rm(temporary, { force: true });
    }
    return this.spriteUrl(filename);
  }

  async create(name, entry, writeProject) {
    const destination = path.join(this.root, name);
    try {
      await fs.mkdir(destination);
    } catch (error) {
      if (error.code === 'EEXIST') throw new ProjectError(`A project named "${name}" already exists.`, 409);
      throw error;
    }

    try {
      await writeProject(destination);
      await fs.writeFile(path.join(destination, manifest), JSON.stringify({ entry }), { flag: 'wx' });
    } catch (error) {
      await fs.rm(destination, { recursive: true, force: true });
      throw error;
    }
    return `${name}/${entry.slice(0, -3)}`;
  }

  async import(input) {
    const { name, entry, files } = input ?? {};
    if (typeof name !== 'string' || !projectName.test(name)) throw new ProjectError('Invalid project name.');
    relativePath(entry);
    if (!entry.endsWith('.js')) throw new ProjectError('Choose a JavaScript entry file.');
    if (!Array.isArray(files) || !files.length || files.length > maxFiles) {
      throw new ProjectError(`A game folder must contain between 1 and ${maxFiles} files.`);
    }

    const paths = new Set();
    let totalBytes = 0;
    const decoded = files.map(file => {
      const parts = relativePath(file?.path);
      const key = file.path.toLowerCase();
      if (paths.has(key)) throw new ProjectError('A file path was supplied more than once.');
      paths.add(key);
      if (typeof file.content !== 'string' || !/^[a-z0-9+/]*={0,2}$/i.test(file.content)) {
        throw new ProjectError('Invalid file contents.');
      }
      const bytes = Buffer.from(file.content, 'base64');
      if (bytes.toString('base64') !== file.content) throw new ProjectError('Invalid file contents.');
      totalBytes += bytes.length;
      if (totalBytes > maxBytes) throw new ProjectError('The game folder exceeds 16 MiB.', 413);
      return { parts, bytes };
    });
    if (!files.some(file => file.path === entry)) throw new ProjectError('The entry file was not included.');

    return this.create(name, entry, async destination => {
      for (const { parts, bytes } of decoded) {
        const filename = path.join(destination, ...parts);
        await fs.mkdir(path.dirname(filename), { recursive: true });
        await fs.writeFile(filename, bytes, { flag: 'wx' });
      }
    });
  }

  async seed(template) {
    if ((await this.list()).length) return;
    try {
      await this.create('amber-ruins', 'game.js', destination =>
        fs.cp(template, destination, { recursive: true, force: false,
          filter: source => !['README.md', 'generate-audio.py', 'explorer.png'].includes(path.basename(source)),
        })
      );
    } catch (error) {
      if (!(error instanceof ProjectError && error.status === 409)) throw error;
    }
  }
}
