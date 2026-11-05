import { useEffect, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { listProjectModules, readProjectModule, saveProjectModule } from '../utils/helpers';
import { isProjectObjectLocationCurrent, markProjectModuleEdited, type ProjectObjectSource, type ProjectObjectSourceRequest, type ProjectPlacementDraft } from '../utils/project-object-source';

export default function ProjectFilesDialog({ scriptId, initialSource, prepareDraft, onClose }: {
  scriptId: string; initialSource?: ProjectObjectSource; prepareDraft?: ProjectObjectSourceRequest['prepareDraft']; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [modules, setModules] = useState<string[]>();
  const [path, setPath] = useState('');
  const [loaded, setLoaded] = useState<{ path: string; value: string }>();
  const [draft, setDraft] = useState('');
  const [placementDraft, setPlacementDraft] = useState<ProjectPlacementDraft>();
  const prepareInitialDraft = useRef(prepareDraft);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const ready = loaded?.path === path && !!path;
  const dirty = ready && draft !== loaded?.value;
  const staleLocation = initialSource?.path === path && !isProjectObjectLocationCurrent(initialSource);

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
    void readProjectModule(scriptId, path, controller.signal).then(value => {
      if (controller.signal.aborted) return;
      setLoaded({ path, value });
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
  }, [path, scriptId, initialSource]);

  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setError('');
    setStatus('');
    try {
      const value = placementDraft?.value ?? draft;
      await saveProjectModule(scriptId, path, value);
      placementDraft?.onSaved();
      setPlacementDraft(undefined);
      markProjectModuleEdited(scriptId, path);
      setLoaded({ path, value });
      setDraft(value);
      setStatus('Saved. Reset the game to run the updated module.');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not save the module.');
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
          <select className="scene-control" value={path} disabled={dirty || saving} onChange={event => {
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
              if (path !== initialSource?.path || !isProjectObjectLocationCurrent(initialSource)) return;
              const position = editor.getModel()?.validatePosition(initialSource);
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
      {dirty && !status && <p>Save or discard your changes to switch files or close.</p>}
      <div className="project-module-actions">
        {dirty && <button type="button" className="scene-control" disabled={saving} onClick={() => {
          setDraft(loaded?.value ?? '');
          setPlacementDraft(undefined);
          setError('');
        }}>Discard changes</button>}
        <button type="button" className="scene-control" disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save module'}
        </button>
        <button type="button" className="scene-control" disabled={dirty || saving} onClick={close}>Close</button>
      </div>
    </dialog>
  );
}
