import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import * as Dino from 'dino-ge';
import { getScript, updateScript } from '../utils/helpers';
import { instrumentCode, rebaseModule } from '../utils/ast-utils';
import { usePlayground } from '../context/PlaygroundContext';

const { Engine, Loader } = Dino;

export const usePlaygroundScripts = () => {
  const runId = useRef(0);
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
      script.textContent = currentScriptId.includes('/')
        ? rebaseModule(result.code, new URL(`/project-runs/${run}/${encodedPath}.js`, location.href))
        : result.code;
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
    const handleScriptSelected = (e: Event) => {
      const customEvent = e as CustomEvent<string>;
      setCurrentScriptId(customEvent.detail);
    };
    window.addEventListener('playground-script-selected', handleScriptSelected);
    return () => window.removeEventListener('playground-script-selected', handleScriptSelected);
  }, [setCurrentScriptId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'Enter') {
        window.dispatchEvent(new CustomEvent('playground-refresh'));
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    const refresh = () => {
      let editorValue: string | undefined;
      const capture = (event: Event) => { editorValue = (event as CustomEvent<string>).detail; };
      window.addEventListener('playground-editor-value', capture);
      window.dispatchEvent(new Event('playground-get-value'));
      window.removeEventListener('playground-editor-value', capture);

      const reset = editorValue === undefined
        ? updatePlayground().then(() => setIsPaused(false))
        : handleRefresh(editorValue);
      reset.catch(error => console.error('Could not reset the game', error));
    };
    window.addEventListener('playground-refresh', refresh);
    return () => window.removeEventListener('playground-refresh', refresh);
  }, [handleRefresh, setIsPaused, updatePlayground]);

  return { handleSave, updatePlayground };
};
