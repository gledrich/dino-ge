import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as Dino from 'dino-ge';
import { getScript, setCurrentScriptId as rememberScriptId, updateScript } from '../utils/helpers';
import { instrumentCode, rebaseModule } from '../utils/ast-utils';
import { trackProjectObjectSources } from '../utils/project-object-source';
import { usePlayground } from '../context/PlaygroundContext';

const { Engine, Loader } = Dino;

type RunChange = { kind: 'reset' } | { kind: 'switch'; scriptId: string };

export const usePlaygroundScripts = () => {
  const runId = useRef(0);
  const stopTrackingSources = useRef<() => void>(undefined);
  const [pendingRunChange, setPendingRunChange] = useState<RunChange>();
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
  useEffect(() => () => {
    ++runId.current;
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
    window.dispatchEvent(new Event('playground-before-run'));
    Engine.terminateCurrent();
    Engine.destroyAll();
    Engine.currentScene = null;
    Engine.destroyAll();
    Engine.camera.reset();
    Engine.selectedObject = null;
    Loader.clear();
    
    document.querySelectorAll('script[data-playground-script]').forEach(s => s.remove());
    
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
      const encodedPath = currentScriptId.split('/').map(encodeURIComponent).join('/');
      if (currentScriptId.includes('/')) {
        const entryUrl = new URL(`/project-runs/${run}/${encodedPath}.js`, location.href);
        script.textContent = `${rebaseModule(result.code, entryUrl)}\n//# sourceURL=${entryUrl.href}`;
        stopTrackingSources.current = trackProjectObjectSources(currentScriptId, run);
      } else script.textContent = result.code;
      script.setAttribute('data-playground-script', currentScriptId);
      document.body.appendChild(script);
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

  return { handleSave, selectScript, pendingRunChange, cancelRunChange, confirmRunChange };
};
