let currentScriptId = 'script';
const scriptEndpoint = (id: string) => `/api/scripts/${encodeURIComponent(id)}`;

export const setCurrentScriptId = (id: string) => {
  currentScriptId = id;
};

export const getCurrentScriptId = () => currentScriptId;

export type GameFolder = { name: string; files: { path: string; file: File }[] };

export const spriteImageTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
export const maxSpriteImageBytes = 5 * 1024 * 1024;

export async function storeSpriteImage(file: File, id: string): Promise<string> {
  const query = new URLSearchParams({ name: file.name });
  const response = await fetch(`${scriptEndpoint(id)}/assets?${query}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || typeof result.url !== 'string') {
    throw new Error(result.error || 'Could not save the image to this workspace.');
  }
  return result.url;
}

export function readGameFolder(selection: FileList): GameFolder {
  const [first] = Array.from(selection);
  const folder = first?.webkitRelativePath.split('/')[0] ?? '';
  const name = folder.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  const files = Array.from(selection).flatMap(file => {
    const [root, ...parts] = file.webkitRelativePath.split('/');
    if (root !== folder || !parts.length || parts.some(part => part.startsWith('.') || part === 'node_modules')) return [];
    return [{ path: parts.join('/'), file }];
  });
  if (!name || !files.some(({ path }) => path.endsWith('.js'))) {
    throw new Error('Choose a game folder that contains a JavaScript entry file.');
  }
  if (files.length > 512 || files.reduce((bytes, { file }) => bytes + file.size, 0) > 16 * 1024 * 1024) {
    throw new Error('Game folders can contain up to 512 files and 16 MiB.');
  }
  return { name, files };
}

export async function importGameFolder(folder: GameFolder, entry: string): Promise<string> {
  const files = await Promise.all(folder.files.map(({ path, file }) => new Promise<{ path: string; content: string }>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ path, content: String(reader.result).split(',')[1] });
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  })));
  const response = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: folder.name, entry, files }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Could not import the game folder (HTTP ${response.status}).`);
  }
  const result = await response.json();
  return result.id;
}

export async function createScript(id: string): Promise<void> {
  if (!id || id.includes('/') || id.includes('\\')) throw new Error('Enter a script name without directories.');
  const response = await fetch(scriptEndpoint(id), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: '', create: true }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || 'Could not create the script.');
  }
}

const createInitialFile = async (id: string) => {
  const defaultContent = `import { Engine, Scene, Sprite, Vector2, Text } from 'dino-ge';

new Engine({
  onLoad: () => {
    console.log('Game Ready!');
    new Text({
      text: 'Dino GE Playground',
      position: new Vector2(100, 100),
      colour: 'white'
    });
  },
  update: () => {}
}, { 
  containerId: 'playground-canvas-container',
  backgroundColour: '#264653' 
});
`;
  
  await fetch(scriptEndpoint(id), {
    method: 'PUT',
    body: JSON.stringify({
      data: defaultContent,
    }),
    headers: {
      'Content-Type': 'application/json',
    },
  });

  return defaultContent;
};

export const getFilesList = async (): Promise<string[]> => {
  const res = await fetch('/files');
  if (res.ok) {
    return await res.json();
  }
  return [];
};

export const getScript = async (id: string = currentScriptId): Promise<string> => {
  const res = await fetch(scriptEndpoint(id));

  if (res.status === 404 && !id.includes('/')) {
    return await createInitialFile(id);
  } else if (res.status === 200) {
    return await res.json();
  } else {
    window.alert('Error loading script');
    return '';
  }
};

export const updateScript = async (data: string, upsert = true, id: string = currentScriptId) => {
  const res = await fetch(scriptEndpoint(id), {
    method: 'PUT',
    body: JSON.stringify({
      data,
      upsert,
    }),
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    window.alert('Error updating script.');
  }
};
