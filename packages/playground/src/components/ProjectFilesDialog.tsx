import { useEffect, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { listProjectModules, ProjectModuleConflict, readProjectModule, saveProjectModule } from '../utils/helpers';
import { getProjectObjectLocation, markProjectModuleEdited, recordProjectPlacementSave, type ProjectObjectSource, type ProjectObjectSourceRequest, type ProjectPlacementDraft } from '../utils/project-object-source';

export default function ProjectFilesDialog({ scriptId, initialSource, prepareDraft, onClose }: {
  scriptId: string; initialSource?: ProjectObjectSource; prepareDraft?: ProjectObjectSourceRequest['prepareDraft']; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [modules, setModules] = useState<string[]>();
  const [path, setPath] = useState('');
  const [loaded, setLoaded] = useState<{ path: string; value: string; revision: string }>();
  const [reload, setReload] = useState(0);
  const [draft, setDraft] = useState('');
  const [placementDraft, setPlacementDraft] = useState<ProjectPlacementDraft>();
  const prepareInitialDraft = useRef(prepareDraft);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const ready = loaded?.path === path && !!path;
  const dirty = ready && draft !== loaded?.value;
  const sourceLocation = ready && initialSource?.path === path
    ? getProjectObjectLocation(initialSource, loaded.value, placementDraft) : undefined;
  const staleLocation = ready && initialSource?.path === path && !sourceLocation;

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void listProjectModules(scriptId, controller.signal).then(files => {
      if (controller.signal.aborted) return;
      setModules(files);
      const sourcePath = initialSource?.path;
      if (sourcePath && !files.includes(sourcePath)) setError('The selected object’s source module is unavailable.');
      setPath(sourcePath && files.includes(sourcePath) ? sourcePath : files[0] ?? '');
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [scriptId, initialSource]);

  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    void readProjectModule(scriptId, path, controller.signal).then(({ value, revision }) => {
      if (controller.signal.aborted) return;
      setLoaded({ path, value, revision });
      setDraft(value);
      if (path !== initialSource?.path || !prepareInitialDraft.current) return;
      const proposed = prepareInitialDraft.current(value);
      prepareInitialDraft.current = undefined;
      if (typeof proposed === 'string') setError(proposed);
      else {
        setPlacementDraft(proposed);
        setDraft(proposed.value);
      }
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [path, scriptId, initialSource, reload]);

  const save = async () => {
    if (!loaded || !dirty || saving || conflict) return;
    setSaving(true);
    setError('');
    setStatus('');
    try {
      const value = placementDraft?.value ?? draft;
      const revision = await saveProjectModule(scriptId, path, value, loaded.revision);
      const canContinue = initialSource && placementDraft
        ? recordProjectPlacementSave(initialSource, loaded.value, placementDraft) : false;
      placementDraft?.onSaved();
      setPlacementDraft(undefined);
      if (!canContinue) markProjectModuleEdited(scriptId, path);
      setLoaded({ path, value, revision });
      setDraft(value);
      setStatus(canContinue ? 'Saved. You can keep editing the scene.' : 'Saved. Reset the game to run the updated module.');
    } catch (error) {
      if (error instanceof ProjectModuleConflict) {
        markProjectModuleEdited(scriptId, path);
        setConflict(true);
        setError(`${error.message} Copy any draft text you want to keep, then discard and reload.`);
      } else setError(error instanceof Error ? error.message : 'Could not save the module.');
    } finally {
      setSaving(false);
    }
  };

  const close = () => {
    if (dirty || saving) return;
    dialog.current?.close();
    onClose();
  };

  return (
    <dialog ref={dialog} className="project-files-dialog" aria-labelledby="project-files-title"
      onCancel={event => { event.preventDefault(); close(); }}
      onKeyDownCapture={event => {
        if (!event.ctrlKey && !event.metaKey) return;
        if (event.key.toLowerCase() === 's') {
          event.preventDefault();
          event.stopPropagation();
          void save();
        } else if (event.key === 'Enter') event.stopPropagation();
      }}>
      <h2 id="project-files-title">Project files</h2>
      {!modules && !error && <p role="status">Loading project files…</p>}
      {modules?.length === 0 && <p>This project has no other JavaScript modules.</p>}
      {!!modules?.length && (
        <label className="project-module-label">
          JavaScript module
          <select className="scene-control" value={path} disabled={dirty || saving || conflict} onChange={event => {
            setPath(event.target.value);
            setLoaded(undefined);
            setStatus('');
            setError('');
          }}>
            {modules.map(file => <option key={file} value={file}>{file}</option>)}
          </select>
        </label>
      )}
      {path && !ready && !error && <p role="status">Loading module…</p>}
      {ready && staleLocation && !status && !error && <p role="status">Reset the game to refresh the source location.</p>}
      {ready && (
        <div className="project-module-editor">
          <Editor height="100%" defaultLanguage="javascript" theme="vs-dark" value={draft} saveViewState={!initialSource}
            path={`file:///projects/${scriptId.split('/')[0]}/${path.split('/').map(encodeURIComponent).join('/')}`}
            onMount={(editor: editor.IStandaloneCodeEditor) => {
              if (!sourceLocation) return;
              const position = editor.getModel()?.validatePosition(sourceLocation);
              if (!position) return;
              editor.setPosition(position);
              editor.revealPositionInCenterIfOutsideViewport(position);
              editor.focus();
            }}
            onChange={(value: string | undefined) => { setDraft(value ?? ''); setStatus(''); }}
            options={{ automaticLayout: true, minimap: { enabled: false }, readOnly: saving || !!placementDraft, scrollBeyondLastLine: false, wordWrap: 'on' }} />
        </div>
      )}
      {error && <p className="import-game-error" role="alert">{error}</p>}
      {status && <p role="status">{status}</p>}
      {placementDraft && !status && <p>Review the proposed placement changes before saving.</p>}
      {dirty && !status && !conflict && <p>Save or discard your changes to switch files or close.</p>}
      <div className="project-module-actions">
        {(dirty || conflict) && <button type="button" className="scene-control" disabled={saving} onClick={() => {
          setDraft(loaded?.value ?? '');
          setPlacementDraft(undefined);
          setError('');
          if (conflict) {
            setConflict(false);
            setLoaded(undefined);
            setReload(value => value + 1);
          }
        }}>{conflict ? 'Discard and reload' : 'Discard changes'}</button>}
        <button type="button" className="scene-control" disabled={!dirty || saving || conflict} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save module'}
        </button>
        <button type="button" className="scene-control" disabled={dirty || saving} onClick={close}>Close</button>
      </div>
    </dialog>
  );
}
