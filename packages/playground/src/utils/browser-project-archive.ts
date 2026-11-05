import { browserWorkspace } from './browser-workspace';

const maxFiles = 512;
const maxBytes = 16 * 1024 * 1024;
const maxArchiveBytes = 24 * 1024 * 1024;

function encodeFile(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export async function exportBrowserProject(id: string): Promise<File> {
  const project = await browserWorkspace.snapshot(id);
  if (!project) throw new Error('The project was not found.');
  const { name, entry, files } = project;
  const encoded = await Promise.all(Array.from(files, async ([path, file]) => ({
    path,
    type: file.type,
    data: await encodeFile(file),
  })));
  const archive = JSON.stringify({ format: 'dino-ge-project', version: 1, name, entry, files: encoded });
  return new File([archive], `${name}.dino-project.json`, { type: 'application/json' });
}

export async function downloadBrowserProject(id: string): Promise<void> {
  const file = await exportBrowserProject(id);
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function restoreBrowserProject(file: Blob): Promise<string> {
  if (file.size > maxArchiveBytes) throw new Error('The project backup exceeds 24 MiB.');
  const archive: unknown = await file.text().then(text => JSON.parse(text)).catch(() => null);
  if (typeof archive !== 'object' || archive === null ||
      !('format' in archive) || archive.format !== 'dino-ge-project' ||
      !('version' in archive) || archive.version !== 1 ||
      !('name' in archive) || typeof archive.name !== 'string' ||
      !('entry' in archive) || typeof archive.entry !== 'string' ||
      !('files' in archive) || !Array.isArray(archive.files) ||
      !archive.files.length || archive.files.length > maxFiles) {
    throw new Error('Choose a valid Dino GE project backup.');
  }

  const files = new Map<string, Blob>();
  let bytes = 0;
  for (const item of archive.files) {
    if (!item || typeof item.path !== 'string' || typeof item.type !== 'string' ||
        typeof item.data !== 'string' || files.has(item.path)) {
      throw new Error('The backup contains an invalid or duplicate file.');
    }
    let binary: string;
    try {
      binary = atob(item.data);
    } catch {
      throw new Error('The backup contains invalid file data.');
    }
    bytes += binary.length;
    if (bytes > maxBytes) throw new Error('The project backup contains more than 16 MiB of files.');
    const data = Uint8Array.from(binary, character => character.charCodeAt(0));
    files.set(item.path, new Blob([data], { type: item.type }));
  }

  const used = new Set((await browserWorkspace.list()).filter(id => id.includes('/'))
    .map(id => id.split('/')[0].toLowerCase()));
  const base = archive.name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '').slice(0, 64) || 'restored-project';
  let name = base;
  for (let i = 2; used.has(name); i++) {
    const suffix = `-${i}`;
    name = base.slice(0, 64 - suffix.length) + suffix;
  }
  return browserWorkspace.importProject(name, archive.entry, files);
}
