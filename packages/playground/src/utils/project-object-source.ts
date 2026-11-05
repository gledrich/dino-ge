import { Engine, type GameObject } from 'dino-ge';

export interface ProjectObjectSource {
  scriptId: string;
  path: string;
  lineNumber: number;
  column: number;
  run: number;
}

export const openProjectObjectSourceEvent = 'playground-open-project-object-source';
export interface ProjectPlacementDraft { value: string; onSaved: () => void }
export type ProjectObjectSourceRequest = {
  source: ProjectObjectSource;
  trigger: HTMLButtonElement;
  prepareDraft?: (value: string) => ProjectPlacementDraft | string;
};

const objectSources = new WeakMap<GameObject, ProjectObjectSource>();
let activeProject: { scriptId: string; run: number; editedModules: Set<string> } | undefined;

export function getProjectObjectSource(object: GameObject) {
  return objectSources.get(object);
}

export function markProjectModuleEdited(scriptId: string, path: string) {
  if (activeProject?.scriptId === scriptId) activeProject.editedModules.add(path);
}

export function isProjectObjectLocationCurrent(source: ProjectObjectSource) {
  return activeProject?.scriptId === source.scriptId && activeProject.run === source.run &&
    !activeProject.editedModules.has(source.path);
}

/** Capture the module that created the object, even if it registers later. */
export function trackProjectObjectSources(scriptId: string, run: number) {
  const session = { scriptId, run, editedModules: new Set<string>() };
  activeProject = session;
  const [project, ...entry] = scriptId.split('/');
  const prefix = new URL(`/project-runs/${run}/${encodeURIComponent(project)}/`, location.href);
  const enginePrefix = new URL('/built/', location.href).href;
  const entryPath = `${entry.join('/')}.js`;
  const stop = Engine.observeObjectCreation(object => {
    if (object.metadata.sourceId) return;
    const stack = new Error().stack;
    if (!stack) return;
    // V8 wraps named frames in parentheses. Firefox and Safari put the URL after @.
    let foundEngineFrame = false;
    for (const frame of stack.split('\n')) {
      const match = frame.trimEnd().match(/(https?:\/\/.+):(\d+):(\d+)\)?$/);
      if (match?.[1] === location.href || /<anonymous>:\d+:\d+/.test(frame)) break;
      if (!match) continue;
      if (match[1].startsWith(enginePrefix)) {
        foundEngineFrame = true;
        continue;
      }
      if (!match[1].startsWith(prefix.href)) {
        if (foundEngineFrame) break;
        continue;
      }
      let path: string;
      try {
        path = decodeURIComponent(new URL(match[1]).pathname.slice(prefix.pathname.length));
      } catch {
        break;
      }
      if (path === entryPath) break;
      if (!/\.m?js$/.test(path) || path.split('/').some(part => part.startsWith('.') || part === 'node_modules')) break;
      objectSources.set(object, { scriptId, run, path, lineNumber: Number(match[2]), column: Number(match[3]) });
      break;
    }
  });
  return () => {
    stop();
    if (activeProject === session) activeProject = undefined;
  };
}
