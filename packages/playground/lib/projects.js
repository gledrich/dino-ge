import fs from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';

const manifest = '.dino-ge-project.json';
const maxFiles = 512;
const maxBytes = 16 * 1024 * 1024;
const projectName = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

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
