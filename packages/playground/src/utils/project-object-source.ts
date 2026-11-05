import { Engine, type GameObject } from 'dino-ge';
import { getLineInfo } from 'acorn';
import { getSourceOffset, mapSourceOffset, type Edit } from './ast-utils';

export interface ProjectObjectSource {
  scriptId: string;
  path: string;
  lineNumber: number;
  column: number;
  run: number;
  urlVariant: boolean;
}

export const openProjectObjectSourceEvent = 'playground-open-project-object-source';
export interface ProjectPlacementDraft { value: string; edits: Edit[]; onSaved: () => void }
export type ProjectObjectSourceRequest = {
  source: ProjectObjectSource;
  trigger: HTMLButtonElement;
  prepareDraft?: (value: string) => ProjectPlacementDraft | string;
};

const objectSources = new WeakMap<GameObject, ProjectObjectSource>();
type ModuleRevision = { original: string; latest: string; changes: Edit[][] };
let activeProject: { scriptId: string; run: number; modules: Map<string, ModuleRevision | null> } | undefined;

export function getProjectObjectSource(object: GameObject) {
  return objectSources.get(object);
}

export function markProjectModuleEdited(scriptId: string, path: string) {
  if (activeProject?.scriptId === scriptId) activeProject.modules.set(path, null);
}

export function recordProjectPlacementSave(source: ProjectObjectSource, before: string, draft: ProjectPlacementDraft): boolean {
  if (activeProject?.scriptId !== source.scriptId) return false;
  const previous = activeProject.modules.get(source.path);
  if (activeProject.run !== source.run || source.urlVariant || previous === null || (previous && previous.latest !== before)) return false;
  activeProject.modules.set(source.path, {
    original: previous?.original ?? before,
    latest: draft.value,
    changes: [...(previous?.changes ?? []), draft.edits],
  });
  return true;
}

export function getProjectObjectLocation(source: ProjectObjectSource, value: string, preview?: ProjectPlacementDraft) {
  if (activeProject?.scriptId !== source.scriptId || activeProject.run !== source.run) return;
  const revision = activeProject.modules.get(source.path);
  if (revision === null || (revision && (source.urlVariant || revision.latest !== value))) return;
  if (!revision && !preview) return { lineNumber: source.lineNumber, column: source.column };
  let offset = getSourceOffset(revision?.original ?? value, source.lineNumber, source.column);
  for (const edits of [...(revision?.changes ?? []), ...(preview ? [preview.edits] : [])]) {
    if (offset === undefined) return;
    offset = mapSourceOffset(offset, edits);
  }
  if (offset === undefined) return;
  const { line, column } = getLineInfo(preview?.value ?? value, offset);
  return { lineNumber: line, column: column + 1 };
}

/** Capture the module that created the object, even if it registers later. */
export function trackProjectObjectSources(scriptId: string, run: number) {
  const session = { scriptId, run, modules: new Map<string, ModuleRevision | null>() };
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
      let urlVariant: boolean;
      try {
        const url = new URL(match[1]);
        path = decodeURIComponent(url.pathname.slice(prefix.pathname.length));
        const canonicalUrl = new URL(path.split('/').map(encodeURIComponent).join('/'), prefix);
        urlVariant = url.href !== canonicalUrl.href;
      } catch {
        break;
      }
      if (path === entryPath) break;
      if (!/\.m?js$/.test(path) || path.split('/').some(part => part.startsWith('.') || part === 'node_modules')) break;
      objectSources.set(object, { scriptId, run, path, urlVariant, lineNumber: Number(match[2]), column: Number(match[3]) });
      break;
    }
  });
  return () => {
    stop();
    if (activeProject === session) activeProject = undefined;
  };
}
