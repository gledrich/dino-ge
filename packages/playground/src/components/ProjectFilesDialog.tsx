import { useEffect, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import { listProjectModules, readProjectModule, saveProjectModule } from '../utils/helpers';

export default function ProjectFilesDialog({ scriptId, onClose }: { scriptId: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [modules, setModules] = useState<string[]>();
  const [path, setPath] = useState('');
  const [loaded, setLoaded] = useState<{ path: string; value: string }>();
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const ready = loaded?.path === path && !!path;
  const dirty = ready && draft !== loaded?.value;

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
      setPath(files[0] ?? '');
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [scriptId]);

  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    void readProjectModule(scriptId, path, controller.signal).then(value => {
      if (controller.signal.aborted) return;
      setLoaded({ path, value });
      setDraft(value);
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [path, scriptId]);

  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setError('');
    setStatus('');
    try {
      await saveProjectModule(scriptId, path, draft);
      setLoaded({ path, value: draft });
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
      {ready && (
        <div className="project-module-editor">
          <Editor height="100%" defaultLanguage="javascript" theme="vs-dark" value={draft}
            path={`file:///projects/${scriptId.split('/')[0]}/${path.split('/').map(encodeURIComponent).join('/')}`}
            onChange={(value: string | undefined) => { setDraft(value ?? ''); setStatus(''); }}
            options={{ automaticLayout: true, minimap: { enabled: false }, readOnly: saving, wordWrap: 'on' }} />
        </div>
      )}
      {error && <p className="import-game-error" role="alert">{error}</p>}
      {status && <p role="status">{status}</p>}
      {dirty && !status && <p>Save or discard your changes to switch files or close.</p>}
      <div className="project-module-actions">
        {dirty && <button type="button" className="scene-control" disabled={saving} onClick={() => {
          setDraft(loaded?.value ?? '');
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
