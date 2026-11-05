import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as Dino from 'dino-ge';
import { getScript, setCurrentScriptId as rememberScriptId, updateScript } from '../utils/helpers';
import { instrumentCode, rebaseModule } from '../utils/ast-utils';
import { trackProjectObjectSources } from '../utils/project-object-source';
import runtimeModulePath from '../utils/game-module-runtime.js?url&no-inline';
import { usePlayground } from '../context/PlaygroundContext';

const { Engine, Loader } = Dino;

type RunChange = { kind: 'reset' } | { kind: 'switch'; scriptId: string };
export type GameRunError = Dino.EngineRuntimeError | { phase: 'script'; error: unknown };

export const usePlaygroundScripts = () => {
  const runId = useRef(0);
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
  const keepSceneOnSave = useRef(false);
  useEffect(() => {
    const reportError = ({ detail }: CustomEvent<Dino.EngineRuntimeError>) => setRuntimeError(detail);
    Engine.on('gameRuntimeError', reportError);
    return () => Engine.off('gameRuntimeError', reportError);
  }, []);
  useEffect(() => () => {
    ++runId.current;
    retireScript.current?.();
    stopTrackingSources.current?.();
    stopTrackingSources.current = undefined;
  }, []);
  useLayoutEffect(() => {
    keepSceneOnSave.current = (isPaused && isDebug) || pendingCanvasPlacements.size > 0;
  }, [isPaused, isDebug, pendingCanvasPlacements]);

  const updatePlayground = useCallback(async (fromSave = false) => {
    if (!isViewportReady) return;
    const run = ++runId.current;
    const scriptText = await getScript(currentScriptId);
    if (run !== runId.current || (fromSave && keepSceneOnSave.current)) return;
    const result = instrumentCode(scriptText, false, currentScriptId);
    window.dispatchEvent(new CustomEvent('playground-syntax-error', { detail: result.error ?? null }));
    if (result.error) return;

    stopTrackingSources.current?.();
    stopTrackingSources.current = undefined;
    window.dispatchEvent(new CustomEvent('playground-before-run', { detail: { scriptId: currentScriptId, source: scriptText } }));
    Engine.terminateCurrent();
    setRuntimeError(undefined);
    Engine.destroyAll();
    Engine.currentScene = null;
    Engine.destroyAll();
    Engine.camera.reset();
    Engine.selectedObject = null;
    Loader.clear();
    
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
      cancelPendingScript.current = cancel;
      retireScript.current = () => {
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
    const keepCurrentScene = fromSave && keepSceneOnSave.current;
    await updateScript(editorValue, false, currentScriptId);
    if (fromSave && (keepCurrentScene || keepSceneOnSave.current || activeRun !== runId.current)) return;
    await updatePlayground(fromSave);
    if (!fromSave || !keepSceneOnSave.current) setIsPaused(false);
  }, [currentScriptId, updatePlayground, setIsPaused]);
  const handleSave = useCallback((editorValue: string) => handleRefresh(editorValue, true), [handleRefresh]);

  useEffect(() => {
    updatePlayground();
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
    if (pendingCanvasPlacements.size) setPendingRunChange(change);
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
