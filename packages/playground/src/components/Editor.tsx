import React, { useCallback, useEffect, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import { typescript, type editor } from 'monaco-editor';
import * as Dino from 'dino-ge';
import { createScript, getScript, getFilesList, setCurrentScriptId, readGameFolder, importGameFolder, type GameFolder } from '../utils/helpers';
import { Edit, instrumentCode, getSourceMapping, getSceneObjectCreation, getSceneObjectDeletion } from '../utils/ast-utils';
import { createSceneObject, restoreSceneTransform, type SceneObjectPlacement, type SceneTransformState } from '../utils/scene-objects';
import { useMonacoEditor } from '../hooks/useMonacoEditor';
import '../styles/editor.css';

interface EditorProps {
  currentScriptId: string;
  onRefresh: (value: string) => void;
}

interface SceneHistoryEntry {
  model: editor.ITextModel;
  run: HTMLElement;
  scene: Dino.Scene | null;
  object: Dino.GameObject;
  before: number;
  after: number;
  transform?: { before: SceneTransformState; after: SceneTransformState };
  removed?: boolean;
}

const CodeEditor: React.FC<EditorProps> = ({ currentScriptId, onRefresh }) => {
  const [scripts, setScripts] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isFormatting, setIsFormatting] = useState(false);
  const [editorValue, setEditorValue] = useState<string>('');
  const [folder, setFolder] = useState<GameFolder>();
  const [entryFile, setEntryFile] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const folderPicker = useRef<HTMLInputElement>(null);
  const loadedScriptId = useRef('');
  const sceneHistory = useRef<SceneHistoryEntry[]>([]);
  const { monacoEditorRef, formatCode, applyEdits, pushEditOperations } = useMonacoEditor();

  const handleSave = useCallback(async (value: string) => {
    if (loadedScriptId.current !== currentScriptId) return;
    setIsSaving(true);
    onRefresh(value);
    setTimeout(() => setIsSaving(false), 500);
  }, [currentScriptId, onRefresh]);

  const handleFormat = useCallback(async () => {
    const model = monacoEditorRef.current?.getModel();
    if (!model) return;
    const value = model.getValue();

    setIsFormatting(true);
    const formatted = await formatCode(value);
    if (formatted !== value && monacoEditorRef.current?.getModel() === model &&
        model.getValue() === value) {
      pushEditOperations(formatted);
      setEditorValue(formatted);
    }
    setIsFormatting(false);
  }, [formatCode, monacoEditorRef, pushEditOperations]);

  const editorCommands = useRef({ save: handleSave, format: handleFormat });
  useEffect(() => {
    editorCommands.current = { save: handleSave, format: handleFormat };
  }, [handleSave, handleFormat]);

  useEffect(() => {
    const refreshScripts = async () => {
      const list = await getFilesList();
      setScripts(list);
    };
    refreshScripts();
  }, [currentScriptId]);

  useEffect(() => {
    let cancelled = false;
    const loadScript = async () => {
      loadedScriptId.current = '';
      setIsSaving(true);
      const script = await getScript(currentScriptId);
      const formatted = await formatCode(script);
      if (cancelled) return;
      loadedScriptId.current = currentScriptId;
      setEditorValue(formatted);
      const result = instrumentCode(formatted);
      if (result.error) console.warn(result.error);
      setIsSaving(false);
    };
    loadScript().catch(error => {
      if (!cancelled) {
        setIsSaving(false);
        console.error('Could not load script', error);
      }
    });
    return () => { cancelled = true; };
  }, [currentScriptId, formatCode]);

  useEffect(() => {
    const onSelectedObjectChanged = (e: any) => {
      const obj = e.detail as Dino.GameObject | null;
      if (obj && obj.metadata.sourceId) {
        const mapping = getSourceMapping()[obj.metadata.sourceId];
        if (mapping) {
          const editor = monacoEditorRef.current;
          if (editor) {
            const model = editor.getModel();
            if (model) {
              const startPos = model.getPositionAt(mapping.start);
              editor.revealPositionInCenter(startPos);
              editor.setPosition(startPos);
            }
          }
        }
      }
    };

    Dino.Engine.on('selectedObjectChanged', onSelectedObjectChanged);
    
    // If an object is already selected when the editor mounts, scroll to it
    if (Dino.Engine.selectedObject) {
      onSelectedObjectChanged({ detail: Dino.Engine.selectedObject });
    }

    return () => {
      Dino.Engine.off('selectedObjectChanged', onSelectedObjectChanged);
    };
  }, [monacoEditorRef]);


  useEffect(() => {
    const handleInsertText = (e: Event) => {
      const customEvent = e as CustomEvent<string>;
      setEditorValue(prev => {
        const newValue = prev + '\n' + customEvent.detail;
        const result = instrumentCode(newValue);
        if (result.error) {
          window.dispatchEvent(new CustomEvent('playground-syntax-error', { detail: result.error }));
        } else {
          window.dispatchEvent(new CustomEvent('playground-syntax-error', { detail: null }));
        }
        return newValue;
      });
    };

    const handleUpdateCodeEvent = (e: Event) => {
      const customEvent = e as CustomEvent<string>;
      setEditorValue(customEvent.detail);
      const result = instrumentCode(customEvent.detail);
      if (result.error) {
        window.dispatchEvent(new CustomEvent('playground-syntax-error', { detail: result.error }));
      } else {
        window.dispatchEvent(new CustomEvent('playground-syntax-error', { detail: null }));
      }
    };

    const handleGetValueEvent = () => {
      if (loadedScriptId.current === currentScriptId) {
        window.dispatchEvent(new CustomEvent('playground-editor-value', { detail: editorValue }));
      }
    };
    const syncSourceMapping = () => {
      if (loadedScriptId.current === currentScriptId) {
        instrumentCode(monacoEditorRef.current?.getValue() ?? editorValue);
      }
    };

    const applySourceEdits = (edits: Edit[]) => {
      const model = monacoEditorRef.current?.getModel();
      if (!model || loadedScriptId.current !== currentScriptId || !edits.length) return;
      const source: string = model.getValue();
      let updated = source;
      let boundary = source.length;
      for (const { start, end, newText } of [...edits].sort((a, b) => b.start - a.start || b.end - a.end)) {
        if (start < 0 || end < start || end > boundary) return;
        updated = updated.slice(0, start) + newText + updated.slice(end);
        boundary = start;
      }
      if (instrumentCode(updated, false).error) return;
      if (updated !== source) {
        model.pushStackElement();
        model.pushEditOperations([], edits.map(({ start, end, newText }) => {
          const from = model.getPositionAt(start);
          const to = model.getPositionAt(end);
          return { range: {
            startLineNumber: from.lineNumber, startColumn: from.column,
            endLineNumber: to.lineNumber, endColumn: to.column,
          }, text: newText };
        }), () => null);
        model.pushStackElement();
        const applied = model.getValue();
        setEditorValue(applied);
        instrumentCode(applied);
      }
      return true;
    };

    const recordSceneHistory = (entry: SceneHistoryEntry) => {
      sceneHistory.current = sceneHistory.current.filter(item => item.run === entry.run && item.model === entry.model);
      sceneHistory.current.push(entry);
    };

    const applyPlacement = (event: Event) => {
      const { edits, object, before, after } = (event as CustomEvent<{
        edits: Edit[]; object: Dino.GameObject; before: SceneTransformState; after: SceneTransformState;
      }>).detail;
      const model: editor.ITextModel | null = monacoEditorRef.current?.getModel();
      const run = document.querySelector<HTMLElement>('script[data-playground-script]');
      const scene = Dino.Engine.currentScene;
      if (!model || run?.dataset.playgroundScript !== currentScriptId ||
          !(scene?.objects ?? Dino.Engine.objects).has(object)) return;
      const previousRevision = model.getAlternativeVersionId();
      if (!applySourceEdits(edits)) return;
      const revision = model.getAlternativeVersionId();
      if (revision !== previousRevision) {
        recordSceneHistory({ model, run, scene, object, before: previousRevision, after: revision,
          transform: { before, after } });
      }
      event.preventDefault();
    };

    const addSceneObject = (event: Event) => {
      const placement = (event as CustomEvent<SceneObjectPlacement>).detail;
      const model: editor.ITextModel | null = monacoEditorRef.current?.getModel();
      const run = document.querySelector<HTMLElement>('script[data-playground-script]');
      if (!model || loadedScriptId.current !== currentScriptId || run?.dataset.playgroundScript !== currentScriptId) return;
      if (placement.scene && placement.scene.scriptId !== currentScriptId) {
        placement.error = 'The active scene belongs to a different script.';
        return;
      }
      const creation = getSceneObjectCreation(model.getValue(), placement);
      if (!creation) {
        placement.error = placement.scene
          ? 'Use an inline onLoad method on the scene class to add palette objects.'
          : 'Open a valid script with one Dino GE Engine and an inline onLoad block.';
        return;
      }
      const before = model.getAlternativeVersionId();
      if (applySourceEdits(creation.edits)) {
        placement.tag = creation.tag;
        placement.sourceId = creation.sourceId;
        const scene = Dino.Engine.currentScene;
        const object = createSceneObject(placement);
        const after = model.getAlternativeVersionId();
        recordSceneHistory({ model, run, scene, object, before, after });
        Dino.Engine.selectedObject = object;
      }
    };

    const removeSceneObject = (event: Event) => {
      const { detail: object } = event as CustomEvent<Dino.GameObject>;
      const model: editor.ITextModel | null = monacoEditorRef.current?.getModel();
      const run = document.querySelector<HTMLElement>('script[data-playground-script]');
      const scene = Dino.Engine.currentScene;
      const sourceId = object.metadata.sourceId;
      if (!model || loadedScriptId.current !== currentScriptId || run?.dataset.playgroundScript !== currentScriptId ||
          !Dino.Engine.paused || !Dino.Engine.debug || Dino.Engine.selectedObject !== object ||
          !sourceId || object.transform.parent || object.transform.children.size) return;
      const matching = Array.from(scene?.objects ?? Dino.Engine.objects)
        .filter(item => item.metadata.sourceId === sourceId);
      if (matching.length !== 1 || matching[0] !== object) return;
      const deletion = getSceneObjectDeletion(model.getValue(), sourceId);
      if (!deletion) return;
      const before = model.getAlternativeVersionId();
      if (!applySourceEdits([deletion])) return;
      Dino.Engine.destroyObject(object);
      recordSceneHistory({ model, run, scene, object, before, after: model.getAlternativeVersionId(), removed: true });
      window.dispatchEvent(new CustomEvent('playground-scene-history', {
        detail: `Deleted ${object.metadata.tag}. Save the script to keep this change.`,
      }));
      event.preventDefault();
    };

    const handleApplyEditEvent = async (e: Event) => {
      const customEvent = e as CustomEvent<Edit>;
      const { start, end, newText } = customEvent.detail;
      const editor = monacoEditorRef.current;
      if (editor) {
        const model = editor.getModel();
        if (model) {
          const startPos = model.getPositionAt(start);
          const endPos = model.getPositionAt(end);
          const range = {
            startLineNumber: startPos.lineNumber,
            startColumn: startPos.column,
            endLineNumber: endPos.lineNumber,
            endColumn: endPos.column
          };
          
          const newValueRaw = applyEdits([{ range, text: newText }]);
          if (newValueRaw) {
            const formatted = await formatCode(newValueRaw, { start, end: start + newText.length });
            if (editor.getModel() !== model || model.getValue() !== newValueRaw) return;
            if (formatted !== newValueRaw) {
              pushEditOperations(formatted);
              setEditorValue(formatted);
            } else {
              setEditorValue(newValueRaw);
            }
            instrumentCode(formatted);
          }
        }
      }
    };

    const handleApplyMultiEditEvent = async (e: Event) => {
      const customEvent = e as CustomEvent<Edit[]>;
      const edits = customEvent.detail;
      const editor = monacoEditorRef.current;
      if (editor && edits.length > 0) {
        const model = editor.getModel();
        if (model) {
          let minStart = Number.MAX_SAFE_INTEGER;
          let maxEnd = 0;

          const monacoEdits = edits.map(edit => {
            const startPos = model.getPositionAt(edit.start);
            const endPos = model.getPositionAt(edit.end);
            
            minStart = Math.min(minStart, edit.start);
            maxEnd = Math.max(maxEnd, edit.end + edit.newText.length);

            return {
              range: {
                startLineNumber: startPos.lineNumber,
                startColumn: startPos.column,
                endLineNumber: endPos.lineNumber,
                endColumn: endPos.column
              },
              text: edit.newText
            };
          });

          const newValueRaw = applyEdits(monacoEdits);
          if (newValueRaw) {
            const formatted = await formatCode(newValueRaw, { start: minStart, end: maxEnd });
            if (editor.getModel() !== model || model.getValue() !== newValueRaw) return;
            if (formatted !== newValueRaw) {
              pushEditOperations(formatted);
              setEditorValue(formatted);
            } else {
              setEditorValue(newValueRaw);
            }
            instrumentCode(formatted);
          }
        }
      }
    };

    window.addEventListener('playground-insert-text', handleInsertText);
    window.addEventListener('playground-update-code', handleUpdateCodeEvent);
    window.addEventListener('playground-get-value', handleGetValueEvent);
    window.addEventListener('playground-sync-source-mapping', syncSourceMapping);
    window.addEventListener('playground-apply-placement', applyPlacement);
    window.addEventListener('playground-add-scene-object', addSceneObject);
    window.addEventListener('playground-remove-scene-object', removeSceneObject);
    const clearSceneHistory = () => { sceneHistory.current = []; };
    window.addEventListener('playground-before-run', clearSceneHistory);
    const changeCodeHistory = (event: Event) => {
      const model: editor.ITextModel | null = monacoEditorRef.current?.getModel();
      if (!model || loadedScriptId.current !== currentScriptId) return;
      const { detail } = event as CustomEvent<'undo' | 'redo'>;
      if (detail === 'undo') void model.undo();
      if (detail === 'redo') void model.redo();
    };
    window.addEventListener('playground-code-history', changeCodeHistory);
    window.addEventListener('playground-apply-edit', handleApplyEditEvent);
    window.addEventListener('playground-apply-multi-edit', handleApplyMultiEditEvent);

    return () => {
      window.removeEventListener('playground-insert-text', handleInsertText);
      window.removeEventListener('playground-update-code', handleUpdateCodeEvent);
      window.removeEventListener('playground-get-value', handleGetValueEvent);
      window.removeEventListener('playground-sync-source-mapping', syncSourceMapping);
      window.removeEventListener('playground-apply-placement', applyPlacement);
      window.removeEventListener('playground-add-scene-object', addSceneObject);
      window.removeEventListener('playground-remove-scene-object', removeSceneObject);
      window.removeEventListener('playground-before-run', clearSceneHistory);
      window.removeEventListener('playground-code-history', changeCodeHistory);
      window.removeEventListener('playground-apply-edit', handleApplyEditEvent);
      window.removeEventListener('playground-apply-multi-edit', handleApplyMultiEditEvent);
    };
  }, [currentScriptId, editorValue, onRefresh, formatCode, applyEdits, pushEditOperations, monacoEditorRef]);

  const syncSceneHistory = (model: editor.ITextModel, event: editor.IModelContentChangedEvent) => {
    if (!event.isUndoing && !event.isRedoing) return;
    const revision = model.getAlternativeVersionId();
    const entry = sceneHistory.current.findLast(item => item.run.isConnected &&
      item.run.dataset.playgroundScript === loadedScriptId.current && item.model === model &&
      revision === (event.isUndoing ? item.before : item.after));
    if (!entry) return;

    const { object, scene, transform, removed } = entry;
    const active = scene === Dino.Engine.currentScene;
    const objects = scene?.objects ?? Dino.Engine.objects;
    if (transform) {
      if (!objects.has(object)) return;
      const state = event.isUndoing ? transform.before : transform.after;
      restoreSceneTransform(object, state);
      window.dispatchEvent(new CustomEvent('playground-placement-history', { detail: { object, state } }));
      const detail = `${event.isUndoing ? 'Undid' : 'Restored'} placement for ${object.metadata.tag}.`;
      window.dispatchEvent(new CustomEvent('playground-scene-history', { detail }));
      return;
    }
    const remove = removed ? event.isRedoing : event.isUndoing;
    if (remove && objects.has(object)) {
      if (Dino.Engine.selectedObject === object) Dino.Engine.selectedObject = null;
      if (active) Dino.Engine.destroyObject(object);
      else if (scene) scene.remove(object);
      else objects.delete(object);
    } else if (!remove && !objects.has(object)) {
      if (active) {
        Dino.Engine.registerObject(object);
        Dino.Engine.selectedObject = object;
      } else if (scene) scene.add(object);
      else objects.add(object);
    }
    const detail = `${remove ? 'Removed' : 'Restored'} ${object.metadata.tag}.`;
    window.dispatchEvent(new CustomEvent('playground-scene-history', { detail }));
  };

  const handleScriptChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setCurrentScriptId(e.target.value);
    window.dispatchEvent(new CustomEvent('playground-script-selected', { detail: e.target.value }));
  };

  const handleNewScript = async () => {
    const name = window.prompt('Enter script name:')?.trim().replace(/\.js$/, '');
    if (!name) return;
    setImportError('');
    try {
      await createScript(name);
      setCurrentScriptId(name);
      window.dispatchEvent(new CustomEvent('playground-script-selected', { detail: name }));
    } catch (error) {
      setImportError(String(error instanceof Error ? error.message : error));
    }
  };

  const selectFolder = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selection = event.target.files;
    if (!selection?.length) return;
    setImportError('');
    setFolder(undefined);
    try {
      const selected = readGameFolder(selection);
      const entries = selected.files.filter(({ path }) => path.endsWith('.js'));
      const preferred = entries.find(({ path }) => /^(game|index|script)\.js$/.test(path));
      setEntryFile((preferred ?? entries[0]).path);
      setFolder(selected);
    } catch (error) {
      setImportError(String(error instanceof Error ? error.message : error));
    } finally {
      event.target.value = '';
    }
  };

  const runImport = async () => {
    if (!folder || importing) return;
    setImporting(true);
    setImportError('');
    try {
      const id = await importGameFolder(folder, entryFile);
      setFolder(undefined);
      setCurrentScriptId(id);
      window.dispatchEvent(new CustomEvent('playground-script-selected', { detail: id }));
    } catch (error) {
      setImportError(String(error instanceof Error ? error.message : error));
    } finally {
      setImporting(false);
    }
  };

  const handleEditorDidMount = async (editor: any, monaco: any) => {
    monacoEditorRef.current = editor;
    const model: editor.ITextModel = editor.getModel();
    const historySubscription = model.onDidChangeContent(event => syncSceneHistory(model, event));
    editor.onDidDispose(() => historySubscription.dispose());

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      editorCommands.current.save(editor.getValue());
    });

    editor.addCommand(monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF, () => {
      editorCommands.current.format();
    });

    try {
      const response = await fetch('/api/types');
      if (!response.ok) {
        throw new Error(`Could not load Dino GE declarations (HTTP ${response.status})`);
      }

      const types: Record<string, string> = await response.json();
      const { javascriptDefaults, ScriptTarget, ModuleResolutionKind, ModuleKind } =
        typescript;

      // The JavaScript worker resolves declarations from its virtual files.
      const libraries = Object.entries(types).map(([path, content]) => ({
        filePath: `file:///node_modules/dino-ge/${path}`,
        content,
      }));
      javascriptDefaults.setExtraLibs(libraries);
      javascriptDefaults.setCompilerOptions({
        target: ScriptTarget.ESNext,
        allowNonTsExtensions: true,
        moduleResolution: ModuleResolutionKind.NodeJs,
        module: ModuleKind.ESNext,
        noEmit: true,
        checkJs: true,
        allowJs: true,
        baseUrl: 'file:///',
        paths: { 'dino-ge': ['node_modules/dino-ge/dist/index.d.ts'] },
      });
    } catch (err) {
      console.error('Failed to load types:', err);
    }
  };

  return (
    <div className="editor">
      <div className="banner">
        <div className="icons-container">
          <button type="button" className="editor-icon-button"
            title="New Script" 
            aria-label="New script"
            onClick={handleNewScript}
          ><i className="fa-solid fa-plus" aria-hidden="true" /></button>
          <select 
            className="script-selector" 
            aria-label="Current script"
            value={currentScriptId} 
            onChange={handleScriptChange}
          >
            {scripts.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <button type="button" className="import-game-button" disabled={importing}
            onClick={() => folderPicker.current?.click()}>Import game folder</button>
          <input ref={folderPicker} type="file" multiple hidden {...{ webkitdirectory: '' }}
            aria-label="Choose game folder" onChange={selectFolder} />
          <button type="button" className={`editor-icon-button format-btn ${isFormatting ? 'active' : ''}`}
            title="Format Code (Shift+Alt+F)"
            aria-label="Format code"
            onClick={handleFormat}
          ><i className="fa-solid fa-wand-magic-sparkles" aria-hidden="true" /></button>
          <button type="button" className={`editor-icon-button ${isSaving ? 'saving' : 'save'}`}
            title="Save (Ctrl+S)"
            aria-label="Save script"
            onClick={() => handleSave(editorValue)}
          ><i className="fa-solid fa-cloud" aria-hidden="true" /></button>
        </div>
      </div>
      {folder && (
        <div className="import-game-options">
          <span>{folder.name}</span>
          <label>Entry file <select value={entryFile} disabled={importing}
            onChange={event => setEntryFile(event.target.value)}>
            {folder.files.filter(({ path }) => path.endsWith('.js')).map(({ path }) => (
              <option key={path} value={path}>{path}</option>
            ))}
          </select></label>
          <button type="button" disabled={importing} onClick={runImport}>
            {importing ? 'Importing…' : 'Import and run'}
          </button>
          <button type="button" disabled={importing} onClick={() => setFolder(undefined)}>Cancel</button>
        </div>
      )}
      {importError && <p className="import-game-error" role="alert">{importError}</p>}
      <div className="editor-textbox">
        <Editor
          height="100%"
          defaultLanguage="javascript"
          theme="vs-dark"
          value={editorValue}
          onChange={(value: string | undefined) => {
            const newValue = value || '';
            setEditorValue(newValue);
            const result = instrumentCode(newValue);
            if (result.error) {
              window.dispatchEvent(new CustomEvent('playground-syntax-error', { detail: result.error }));
            } else {
              window.dispatchEvent(new CustomEvent('playground-syntax-error', { detail: null }));
            }
          }}
          onMount={handleEditorDidMount}
          options={{
            fontSize: 13,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 2,
            wordWrap: 'on'
          }}
        />
      </div>
    </div>
  );
};

export default CodeEditor;
