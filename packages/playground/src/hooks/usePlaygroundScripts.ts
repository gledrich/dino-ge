import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import * as Dino from 'dino-ge';
import { browserPreviewUrl, getScript, readProjectModule, setCurrentScriptId as rememberScriptId, updateScript } from '../utils/helpers';
import { instrumentCode, instrumentHostedEntry, rebaseModule } from '../utils/ast-utils';
import { isUneditedProjectRunModule, trackProjectObjectSources } from '../utils/project-object-source';
import runtimeModulePath from '../utils/game-module-runtime.js?url&no-inline';
import { browserWorkspace } from '../utils/browser-workspace';
import { startBrowserPreview } from '../utils/browser-preview';
import { screenUIPreview } from '../utils/screen-ui-preview';
import { findScreenUICall, resolveScreenUISource } from '../utils/screen-ui-source';
import { usePlayground } from '../context/PlaygroundContext';

const { Engine, Input, Loader } = Dino;

type RunChange = { kind: 'reset' } | { kind: 'switch'; scriptId: string };
export type GameRunError = Dino.EngineRuntimeError | { phase: 'script'; error: unknown };

export const usePlaygroundScripts = () => {
  const runId = useRef(0);
  const browserPreview = useRef<ReturnType<typeof startBrowserPreview>>(undefined);
  const previewControls = useRef({ paused: false, debug: false });
  const retireScript = useRef<() => void>(undefined);
  const cancelPendingScript = useRef<() => void>(undefined);
  const stopTrackingSources = useRef<() => void>(undefined);
  const [pendingRunChange, setPendingRunChange] = useState<RunChange>();
  const [runtimeError, setRuntimeError] = useState<GameRunError>();
  const { 
    currentScriptId, 
    setCurrentScriptId, 
    isViewportReady, 
    isPaused,
    isDebug,
    pendingCanvasPlacements,
    setIsPaused 
  } = usePlayground();
  const editingScreenUI = useSyncExternalStore(screenUIPreview.subscribe, () => screenUIPreview.getSnapshot().editing);
  const keepSceneOnSave = useRef(false);
  useEffect(() => {
    const reportError = ({ detail }: CustomEvent<Dino.EngineRuntimeError>) => setRuntimeError(detail);
    Engine.on('gameRuntimeError', reportError);
    return () => Engine.off('gameRuntimeError', reportError);
  }, []);
  useEffect(() => () => {
    ++runId.current;
    retireScript.current?.();
    browserPreview.current?.dispose();
    stopTrackingSources.current?.();
    stopTrackingSources.current = undefined;
  }, []);
  useLayoutEffect(() => {
    keepSceneOnSave.current = (isPaused && isDebug && !editingScreenUI) || pendingCanvasPlacements.size > 0;
    previewControls.current = { paused: isPaused, debug: isDebug };
    browserPreview.current?.setControls(previewControls.current);
  }, [isPaused, isDebug, editingScreenUI, pendingCanvasPlacements]);

  const updatePlayground = useCallback(async (fromSave = false) => {
    if (!isViewportReady) return;
    const run = ++runId.current;
    let scriptText: string;
    try {
      scriptText = await getScript(currentScriptId);
    } catch (error) {
      if (run === runId.current) setRuntimeError({ phase: 'script', error });
      return;
    }
    if (run !== runId.current || (fromSave && (keepSceneOnSave.current || screenUIPreview.hasPendingMoves()))) return;
    if (browserPreviewUrl) {
      try {
        const snapshot = await browserWorkspace.snapshot(currentScriptId);
        const container = document.getElementById('playground-canvas-container');
        if (!snapshot || !container) throw new Error('Could not open the game preview.');
        const original = await snapshot.files.get(snapshot.entry)?.text();
        if (run !== runId.current) return;
        if (original === undefined) throw new Error('Could not read the hosted game entry.');
        const entry = instrumentHostedEntry(original, currentScriptId);
        window.dispatchEvent(new CustomEvent('playground-syntax-error', { detail: entry.error ?? null }));
        if (entry.error) return;
        browserPreview.current?.dispose();
        setRuntimeError(undefined);
        window.dispatchEvent(new CustomEvent('playground-before-run', { detail: { scriptId: currentScriptId, source: original } }));
        browserPreview.current = startBrowserPreview(container, browserPreviewUrl, snapshot, previewControls.current, error => {
          if (run === runId.current) setRuntimeError({ phase: 'script', error });
        }, currentScriptId, { original, runtime: entry.code });
      } catch (error) {
        if (run === runId.current) setRuntimeError({ phase: 'script', error });
      }
      return;
    }

    const result = instrumentCode(scriptText, false, currentScriptId);
    window.dispatchEvent(new CustomEvent('playground-syntax-error', { detail: result.error ?? null }));
    if (result.error) return;

    stopTrackingSources.current?.();
    stopTrackingSources.current = undefined;
    window.dispatchEvent(new CustomEvent('playground-before-run', { detail: { scriptId: currentScriptId, source: scriptText } }));
    Engine.terminateCurrent();
    Engine.destroyAll();
    Engine.currentScene = null;
    Engine.destroyAll();
    Engine.camera.reset();
    Engine.selectedObject = null;
    Loader.clear();
    Input.setActions({});
    
    retireScript.current?.();
    
    const container = document.getElementById('playground-canvas-container');
    if (container) {
      container.querySelectorAll('[data-playground-game]').forEach(game => {
        game.dispatchEvent(new Event('dino-playground-dispose'));
        game.remove();
      });
      container.querySelectorAll('canvas').forEach(c => c.remove());
    }

    requestAnimationFrame(() => {
      if (run !== runId.current) return;
      setRuntimeError(undefined);
      const script = document.createElement('script');
      script.type = 'module';
      script.dataset.playgroundScript = currentScriptId;
      script.dataset.playgroundRun = String(run);
      const moduleUrls: string[] = [];
      const createModuleUrl = (code: string) => {
        const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
        moduleUrls.push(url);
        return url;
      };
      const releaseUrls = () => moduleUrls.splice(0).forEach(url => URL.revokeObjectURL(url));
      const cancel = () => { delete script.dataset.playgroundRun; };
      const sources = new AbortController();
      let stopScreenUI: (() => void) | undefined;
      cancelPendingScript.current = cancel;
      retireScript.current = () => {
        sources.abort();
        stopScreenUI?.();
        script.remove();
        releaseUrls();
      };
      document.body.appendChild(script);
      const loadEntry = async () => {
        const encodedPath = currentScriptId.split('/').map(encodeURIComponent).join('/');
        const isProject = currentScriptId.includes('/');
        const sourceUrl = new URL(isProject ? `/project-runs/${run}/${encodedPath}.js` : `/scripts/${encodedPath}.js`, location.href);
        const base = isProject ? sourceUrl : new URL(document.baseURI);
        const runtimeUrl = new URL(runtimeModulePath, import.meta.url).href;
        const entry = `${rebaseModule(result.code, base, runtimeUrl, run)}\n//# sourceURL=${sourceUrl.href}`;
        const entryUrl = createModuleUrl(entry);
        if (isProject) stopTrackingSources.current = trackProjectObjectSources(currentScriptId, run, entryUrl);
        const [project, ...modules] = currentScriptId.split('/');
        const sourceBase = isProject ? new URL(`/project-runs/${run}/${encodeURIComponent(project)}/`, location.href)
          : new URL('./', sourceUrl);
        const entryPath = `${isProject ? modules.join('/') : currentScriptId}.js`;
        // Observe module loads directly so a full resource timing buffer cannot drop their revisions.
        const runningRevisions = new Map<string, string>();
        const recordModuleRevisions = (entries: readonly PerformanceEntry[]) => {
          for (const entry of entries) {
            if (!entry.name.startsWith(sourceBase.href) || runningRevisions.has(entry.name)) continue;
            const revision = (entry as PerformanceResourceTiming).serverTiming
              ?.find(timing => timing.name === 'dino-source')?.description;
            if (revision) runningRevisions.set(entry.name, revision);
          }
        };
        const moduleObserver = isProject && typeof PerformanceObserver !== 'undefined' &&
          PerformanceObserver.supportedEntryTypes?.includes('resource')
          ? new PerformanceObserver(list => recordModuleRevisions(list.getEntries())) : undefined;
        if (moduleObserver) {
          moduleObserver.observe({ type: 'resource' });
          sources.signal.addEventListener('abort', () => moduleObserver.disconnect(), { once: true });
        }
        let sourceIndex: number | undefined;
        let sourceRequest = 0;
        const screenUI = screenUIPreview.start(index => {
          sourceIndex = index;
          sourceRequest++;
        });
        const unsubscribe = Engine.observeScreenUI(snapshot => {
          screenUI.publish(snapshot);
          const drawn = snapshot.source;
          if (!drawn || drawn.index !== sourceIndex) return;
          sourceIndex = undefined;
          const control = snapshot.controls[drawn.index];
          const position = resolveScreenUISource(drawn.stack, sourceBase, { url: entryUrl, path: entryPath });
          if (!control || !position || !position.path.endsWith('.js')) return;
          const isEntry = position.path === entryPath;
          if (!isEntry && !isUneditedProjectRunModule(currentScriptId, run, position.path)) return;
          const request = sourceRequest;
          const address = new URL(position.path.split('/').map(encodeURIComponent).join('/'), sourceBase).href;
          const loadSource = isEntry ? Promise.resolve({ value: scriptText, revision: undefined })
            : readProjectModule(currentScriptId, position.path, sources.signal);
          void loadSource.then(({ value: source, revision }) => {
            if (moduleObserver) recordModuleRevisions(moduleObserver.takeRecords());
            const runningRevision = runningRevisions.get(address);
            if (!isEntry && runningRevision && runningRevision !== revision) return;
            const call = findScreenUICall(source, control.kind, position, isEntry ? entry : source);
            if (call && request === sourceRequest) {
              screenUI.setSource(drawn.index, { ...position, ...call, source, kind: control.kind, scriptId: currentScriptId,
                entry: isEntry, writeVerified: isEntry || !!revision && runningRevision === revision });
            }
          }).catch(() => {});
        }, () => sourceIndex, screenUIPreview.getEditing);
        stopScreenUI = () => {
          unsubscribe();
          screenUI.dispose();
        };
        // A launcher with no exports keeps import() from calling a game's exported `then`.
        const launcherUrl = createModuleUrl(`import ${JSON.stringify(entryUrl)};`);
        await import(/* @vite-ignore */ launcherUrl);
      };
      void loadEntry().catch((error: unknown) => {
        if (!script.isConnected || !script.dataset.playgroundRun) return;
        const referencesBlob = error instanceof Error && moduleUrls.some(url => error.message.includes(url));
        setRuntimeError({ phase: 'script', error: referencesBlob ? 'A game module could not load. Check the import paths.' : error });
        console.error('Could not run the game script', error);
      }).finally(() => {
        releaseUrls();
        if (cancelPendingScript.current === cancel) cancelPendingScript.current = undefined;
      });
    });
  }, [currentScriptId, isViewportReady]);

  const handleRefresh = useCallback(async (editorValue: string, fromSave = false) => {
    const activeRun = runId.current;
    const keepCurrentScene = fromSave && (keepSceneOnSave.current || screenUIPreview.hasPendingMoves());
    try {
      await updateScript(editorValue, false, currentScriptId);
    } catch (error) {
      console.error('Could not save the game script', error);
      if (activeRun === runId.current) setRuntimeError({ phase: 'script', error });
      return;
    }
    if (fromSave && (keepCurrentScene || keepSceneOnSave.current || screenUIPreview.hasPendingMoves() || activeRun !== runId.current)) return;
    await updatePlayground(fromSave);
    if (!fromSave || !keepSceneOnSave.current) setIsPaused(false);
  }, [currentScriptId, updatePlayground, setIsPaused]);
  const handleSave = useCallback((editorValue: string) => handleRefresh(editorValue, true), [handleRefresh]);

  useEffect(() => {
    let current = true;
    queueMicrotask(() => { if (current) void updatePlayground(); });
    return () => { current = false; };
  }, [updatePlayground]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'Enter') {
        window.dispatchEvent(new CustomEvent('playground-refresh'));
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const performRunChange = useCallback((change: RunChange) => {
    cancelPendingScript.current?.();
    if (change.kind === 'switch') {
      ++runId.current;
      rememberScriptId(change.scriptId);
      setCurrentScriptId(change.scriptId);
      window.dispatchEvent(new CustomEvent('playground-script-selected', { detail: change.scriptId }));
      return;
    }

    let editorValue: string | undefined;
    const capture = (event: Event) => { editorValue = (event as CustomEvent<string>).detail; };
    window.addEventListener('playground-editor-value', capture);
    window.dispatchEvent(new Event('playground-get-value'));
    window.removeEventListener('playground-editor-value', capture);

    const reset = editorValue === undefined
      ? updatePlayground().then(() => setIsPaused(false))
      : handleRefresh(editorValue);
    reset.catch(error => console.error('Could not reset the game', error));
  }, [handleRefresh, setCurrentScriptId, setIsPaused, updatePlayground]);

  const requestRunChange = useCallback((change: RunChange) => {
    if (pendingRunChange || (change.kind === 'switch' && change.scriptId === currentScriptId)) return;
    if (pendingCanvasPlacements.size || screenUIPreview.hasPendingMoves()) setPendingRunChange(change);
    else performRunChange(change);
  }, [currentScriptId, pendingCanvasPlacements.size, pendingRunChange, performRunChange]);

  const selectScript = (scriptId: string) => requestRunChange({ kind: 'switch', scriptId });
  const cancelRunChange = () => setPendingRunChange(undefined);
  const confirmRunChange = () => {
    if (!pendingRunChange) return;
    setPendingRunChange(undefined);
    performRunChange(pendingRunChange);
  };

  useEffect(() => {
    const refresh = () => requestRunChange({ kind: 'reset' });
    window.addEventListener('playground-refresh', refresh);
    return () => window.removeEventListener('playground-refresh', refresh);
  }, [requestRunChange]);

  return { handleSave, selectScript, pendingRunChange, cancelRunChange, confirmRunChange, runtimeError };
};
