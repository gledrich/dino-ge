type ProjectFiles = Map<string, Blob>;

type Snapshot = {
  name: string;
  entry: string;
  files: ProjectFiles;
};

type StoredFile = Blob | { bytes: ArrayBuffer; type: string };

type Project = Omit<Snapshot, 'files'> & {
  key: string;
  id: string;
  files: Map<string, StoredFile>;
  revisions?: Map<string, string>;
};

const maxFiles = 512;
const maxBytes = 16 * 1024 * 1024;
const storeName = 'projects';
const projectName = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const scriptType = 'text/javascript';
const rasterExtensions = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/gif', 'gif'],
  ['image/webp', 'webp']
]);

function checkPath(path: string) {
  if (path.length > 512 || path.split('/').some(part =>
    !part || part.startsWith('.') || part.includes('\0') || /[\\:<>|?*"]/.test(part)
  )) {
    throw new Error('Invalid project path.');
  }
}

function checkSize(files: ReadonlyMap<string, StoredFile>) {
  let bytes = 0;
  for (const file of files.values()) bytes += file instanceof Blob ? file.size : file.bytes.byteLength;
  if (files.size > maxFiles || bytes > maxBytes) {
    throw new Error('Projects can contain up to 512 files and 16 MiB.');
  }
}

function asBlob(file: StoredFile): Blob {
  return file instanceof Blob ? file : new Blob([file.bytes], { type: file.type });
}

const editableProjectFile = /\.(?:m?js|json|tmj|tsj)$/;
const jsonProjectFile = /\.(?:json|tmj|tsj)$/;

function scriptFile(text: string, previous?: StoredFile): StoredFile {
  const next = new TextEncoder().encode(text);
  if (!previous) return { bytes: next.buffer, type: scriptType };
  if (previous instanceof Blob) return new Blob([previous, next], { type: scriptType });
  const bytes = new Uint8Array(previous.bytes.byteLength + next.byteLength);
  bytes.set(new Uint8Array(previous.bytes));
  bytes.set(next, previous.bytes.byteLength);
  return { bytes: bytes.buffer, type: scriptType };
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function inStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const opening = indexedDB.open('dino-ge-playground', 1);
  opening.onupgradeneeded = () => opening.result.createObjectStore(storeName, { keyPath: 'key' });
  const database = await requestResult(opening);
  try {
    const transaction = database.transaction(storeName, mode);
    const committed = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error ?? new Error('Project changes were not saved.'));
    });
    const [result] = await Promise.all([operation(transaction.objectStore(storeName)), committed]);
    return result;
  } finally {
    database.close();
  }
}

function keyFor(id: string) {
  const separator = id.indexOf('/');
  return separator === -1 ? `script:${id}` : `project:${id.slice(0, separator).toLowerCase()}`;
}

function findProject(store: IDBObjectStore, id: string): Promise<Project | undefined> {
  return requestResult(store.get(keyFor(id))).then((project: Project | undefined) =>
    project?.id === id ? project : undefined
  );
}

async function makeProject(name: string, entry: string, files: ProjectFiles): Promise<Project> {
  if (!projectName.test(name)) throw new Error('Invalid project name.');
  checkPath(entry);
  if (!entry.endsWith('.js') || !files.has(entry)) throw new Error('Choose an included JavaScript entry file.');
  checkSize(files);
  const paths = new Set<string>();
  for (const path of files.keys()) {
    checkPath(path);
    const canonical = path.toLowerCase();
    if (paths.has(canonical)) throw new Error('A file path was supplied more than once.');
    paths.add(canonical);
  }

  const id = `${name}/${entry.slice(0, -3)}`;
  // Store bytes directly so IndexedDB does not need to stage Blob files.
  const entries = await Promise.all([...files].map(async ([path, file]) =>
    [path, { bytes: await file.arrayBuffer(), type: file.type }] as const
  ));
  return { key: keyFor(id), id, name, entry, files: new Map(entries) };
}

export const browserWorkspace = {
  async list(): Promise<string[]> {
    return inStore('readonly', async store => {
      const projects: Project[] = await requestResult(store.getAll());
      return projects.map(project => project.id).sort();
    });
  },

  async importProject(name: string, entry: string, files: ProjectFiles): Promise<string> {
    const project = await makeProject(name, entry, files);
    try {
      await inStore('readwrite', async store => { await requestResult(store.add(project)); });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'ConstraintError') {
        throw new Error(`A project named "${name}" already exists.`);
      }
      throw error;
    }
    return project.id;
  },

  async seed(project: Snapshot): Promise<void> {
    const entry = await makeProject(project.name, project.entry, project.files);
    await inStore('readwrite', async store => {
      if (await requestResult(store.count()) === 0) await requestResult(store.add(entry));
    });
  },

  async snapshot(id: string): Promise<Snapshot | undefined> {
    const project = await inStore('readonly', store => findProject(store, id));
    if (project) return {
      name: project.name, entry: project.entry,
      files: new Map([...project.files].map(([path, file]) => [path, asBlob(file)])),
    };
  },

  async readScript(id: string): Promise<string | undefined> {
    const project = await browserWorkspace.snapshot(id);
    return project?.files.get(project.entry)?.text();
  },

  async listModules(id: string): Promise<string[]> {
    const project = await browserWorkspace.snapshot(id);
    if (!project) return [];
    return [...project.files.keys()].filter(path => path !== project.entry && editableProjectFile.test(path)).sort();
  },

  async readModule(id: string, path: string): Promise<{ value: string; revision: string }> {
    checkPath(path);
    const project = await inStore('readonly', store => findProject(store, id));
    const file = project?.files.get(path);
    if (!project || !file || path === project.entry || !editableProjectFile.test(path)) {
      throw new Error('The project module was not found.');
    }
    return { value: await asBlob(file).text(), revision: project.revisions?.get(path) ?? 'initial' };
  },

  async saveModule(id: string, path: string, data: string, expected: string): Promise<string | null> {
    checkPath(path);
    return inStore('readwrite', async store => {
      const project = await findProject(store, id);
      if (!project || !project.files.has(path) || path === project.entry || !editableProjectFile.test(path)) {
        throw new Error('The project module was not found.');
      }
      const revisions = project.revisions ??= new Map();
      if ((revisions.get(path) ?? 'initial') !== expected) return null;
      const revision = crypto.randomUUID();
      revisions.set(path, revision);
      const file = jsonProjectFile.test(path)
        ? { bytes: new TextEncoder().encode(data).buffer, type: 'application/json' }
        : scriptFile(data);
      project.files.set(path, file);
      checkSize(project.files);
      await requestResult(store.put(project));
      return revision;
    });
  },

  async listSprites(id: string): Promise<{ path: string; name: string; file: Blob }[]> {
    const project = await browserWorkspace.snapshot(id);
    if (!project) return [];
    return [...project.files].flatMap(([path, file]) => {
      const filename = path.split('/').at(-1)!;
      if (!/\.(png|jpe?g|gif|webp)$/i.test(filename)) return [];
      const name = filename.replace(/(?:-[a-f0-9]{64})?\.[^.]+$/i, '');
      return [{ path, name, file }];
    }).sort((a, b) => a.path.localeCompare(b.path));
  },

  async importSprite(id: string, file: File): Promise<string> {
    const extension = rasterExtensions.get(file.type);
    if (!extension) throw new Error('Choose a PNG, JPEG, GIF or WebP image.');
    if (file.size > 5 * 1024 * 1024) throw new Error('Sprite images can be up to 5 MiB.');
    const bytes = await file.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
    const label = file.name.replace(/\.[^.]*$/, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '').slice(0, 48) || 'sprite';
    return inStore('readwrite', async store => {
      const project = await findProject(store, id);
      if (!project) throw new Error('The open script could not be found.');
      const parent = project.entry.slice(0, project.entry.lastIndexOf('/') + 1);
      const path = `${parent}_dino-assets/${label}-${hash}.${extension}`;
      checkPath(path);
      project.files.set(path, { bytes, type: file.type });
      checkSize(project.files);
      await requestResult(store.put(project));
      return path;
    });
  },

  async writeScript(id: string, text: string, mode: 'create' | 'replace' | 'append'): Promise<void> {
    checkPath(id);
    await inStore('readwrite', async store => {
      let project = await findProject(store, id);
      if (mode === 'create' && project) throw new Error('A script with that name already exists.');
      if (!project) {
        if (id.includes('/')) throw new Error('The project was not found.');
        const entry = id.endsWith('.js') ? id : `${id}.js`;
        project = { key: keyFor(id), id, name: id, entry, files: new Map() };
      }
      const previous = project.files.get(project.entry);
      project.files.set(project.entry, scriptFile(text, mode === 'append' ? previous : undefined));
      checkSize(project.files);
      await requestResult(store.put(project));
    });
  }
};

export async function seedBrowserWorkspace(): Promise<void> {
  if ((await browserWorkspace.list()).length) return;
  const name = 'amber-ruins';
  const base = `/templates/${name}/`;
  const load = async (url: string) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Could not load the Amber Ruins starter project.');
    return response;
  };
  const { entry, files }: { entry: string; files: string[] } =
    await (await load(`/templates/${name}.workspace.json`)).json();
  const assets = await Promise.all(files.map(async path => {
    checkPath(path);
    const url = base + path.split('/').map(encodeURIComponent).join('/');
    return [path, await (await load(url)).blob()] as const;
  }));
  await browserWorkspace.seed({ name, entry, files: new Map(assets) });
}
