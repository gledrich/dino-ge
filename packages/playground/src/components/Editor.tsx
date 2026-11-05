import React, { useCallback, useEffect, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import { typescript, type editor } from 'monaco-editor';
import * as Dino from 'dino-ge';
import { usePlayground } from '../context/PlaygroundContext';
import ProjectFilesDialog from './ProjectFilesDialog';
import { createScript, getScript, getFilesList, readGameFolder, importGameFolder, type GameFolder } from '../utils/helpers';
import { Edit, instrumentCode, getSourceMapping, getSceneObjectCreation, getSceneObjectDeletion, getSceneObjectDuplication, getSpriteImageReplacement, type CanvasPlacementTransaction } from '../utils/ast-utils';
import { createSceneObject, duplicateSceneObject, getSceneSource, insertSceneObjectCode, isReplaceableSprite, restoreSceneTransform, sceneAssetDragEvent, sceneAssetDragType, sceneObjectCodeEvent, sceneObjectDragType, sceneObjectKinds, scenePointerDragEvent, type CanvasTransformChange, type SceneImageAsset, type SceneObjectPlacement, type ScenePointerDrag, type ScenePointerDragItem } from '../utils/scene-objects';
import { useMonacoEditor } from '../hooks/useMonacoEditor';
import '../styles/editor.css';

interface EditorProps {
  currentScriptId: string;
  onSave: (value: string) => Promise<void>;
  onSelectScript: (scriptId: string) => void;
}

type SceneHistoryEntry = {
  model: editor.ITextModel;
  run: HTMLElement;
  scene: Dino.Scene | null;
  before: number;
  after: number;
} & (
  | { transforms: CanvasTransformChange[] }
  | { object: Dino.GameObject; spriteImage?: { before: HTMLImageElement; after: HTMLImageElement }; removed?: boolean }
);

const CodeEditor: React.FC<EditorProps> = ({ currentScriptId, onSave, onSelectScript }) => {
  const { setActiveTab, setIsEditorVisible } = usePlayground();
  const [scripts, setScripts] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isFormatting, setIsFormatting] = useState(false);
  const [editorValue, setEditorValue] = useState<string>('');
  const [folder, setFolder] = useState<GameFolder>();
  const [entryFile, setEntryFile] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [projectFilesOpen, setProjectFilesOpen] = useState(false);
  const [isObjectOverEditor, setIsObjectOverEditor] = useState(false);
  const [dropFeedback, setDropFeedback] = useState<{ scriptId: string; message: string; error: boolean }>();
  const editorDropTarget = useRef<HTMLDivElement>(null);
  const draggedAsset = useRef<SceneImageAsset | null>(null);
  const projectFilesButton = useRef<HTMLButtonElement>(null);
  const folderPicker = useRef<HTMLInputElement>(null);
  const loadedScriptId = useRef('');
  const sceneHistory = useRef<SceneHistoryEntry[]>([]);
  const { monacoEditorRef, formatCode, applyEdits, pushEditOperations } = useMonacoEditor();

  const dropObjectCode = useCallback((item: ScenePointerDragItem) => {
    const { sourceId, tag, error } = insertSceneObjectCode(item, currentScriptId);
    const message = sourceId ? `Inserted ${tag}. Reset game to preview it.`
      : error ?? 'Open a script before dropping an object into the editor.';
    setDropFeedback({ scriptId: currentScriptId, message, error: !sourceId });
    return !!sourceId;
  }, [currentScriptId]);

  useEffect(() => {
    const endDrag = () => {
      draggedAsset.current = null;
      setIsObjectOverEditor(false);
    };
    const clearDrop = () => {
      endDrag();
      setDropFeedback(undefined);
    };
    const updatePointerDrag = (event: Event) => {
      const { detail } = event as CustomEvent<ScenePointerDrag | null>;
      if (detail) {
        const target = document.elementFromPoint(detail.point.x, detail.point.y);
        if (target && editorDropTarget.current?.contains(target)) {
          setIsObjectOverEditor(detail.phase === 'preview');
          if (detail.phase === 'drop') dropObjectCode(detail);
          return;
        }
      }
      setIsObjectOverEditor(false);
    };
    const trackAssetDrag = (event: Event) => { draggedAsset.current = (event as CustomEvent<SceneImageAsset | null>).detail; };
    window.addEventListener(sceneAssetDragEvent, trackAssetDrag);
    window.addEventListener(scenePointerDragEvent, updatePointerDrag);
    window.addEventListener('dragend', endDrag);
    window.addEventListener('playground-before-run', clearDrop);
    return () => {
      window.removeEventListener(sceneAssetDragEvent, trackAssetDrag);
      window.removeEventListener(scenePointerDragEvent, updatePointerDrag);
      window.removeEventListener('dragend', endDrag);
      window.removeEventListener('playground-before-run', clearDrop);
    };
  }, [dropObjectCode]);

  const handleSave = useCallback(async (value: string) => {
    if (loadedScriptId.current !== currentScriptId) return;
    setIsSaving(true);
    try {
      await onSave(value);
    } catch (error) {
      console.error('Could not save the script', error);
    } finally {
      setIsSaving(false);
    }
  }, [currentScriptId, onSave]);

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
      const { edits, transforms } = (event as CustomEvent<CanvasPlacementTransaction>).detail;
      const model: editor.ITextModel | null = monacoEditorRef.current?.getModel();
      const run = document.querySelector<HTMLElement>('script[data-playground-script]');
      const scene = Dino.Engine.currentScene;
      const objects = scene?.objects ?? Dino.Engine.objects;
      if (!model || run?.dataset.playgroundScript !== currentScriptId || !transforms.length) return;
      for (const { object } of transforms) {
        if (!objects.has(object) || !object.metadata.sourceId ||
            Array.from(objects).filter(item => item.metadata.sourceId === object.metadata.sourceId).length !== 1) return;
      }
      const previousRevision = model.getAlternativeVersionId();
      if (!applySourceEdits(edits)) return;
      const revision = model.getAlternativeVersionId();
      if (revision !== previousRevision) {
        recordSceneHistory({ model, run, scene, transforms, before: previousRevision, after: revision });
      }
      for (const { object, after } of transforms) {
        window.dispatchEvent(new CustomEvent('playground-placement-history', { detail: { object, state: after } }));
      }
      event.preventDefault();
    };

    const addSceneObject = (event: Event) => {
      const placement = (event as CustomEvent<SceneObjectPlacement>).detail;
      const codeOnly = event.type === sceneObjectCodeEvent;
      const allowStandalone = codeOnly && placement.kind !== 'Sprite';
      const model: editor.ITextModel | null = monacoEditorRef.current?.getModel();
      const run = document.querySelector<HTMLElement>('script[data-playground-script]');
      const liveRun = run?.dataset.playgroundScript === currentScriptId ? run : null;
      if (!model || loadedScriptId.current !== currentScriptId || (!liveRun && !allowStandalone)) return;
      if (codeOnly && liveRun && Dino.Engine.currentScene) {
        placement.scene = getSceneSource(Dino.Engine.currentScene);
        if (!placement.scene) {
          placement.error = 'Insert object code in a named scene class declared in the open script.';
          return;
        }
      }
      if (placement.scene && placement.scene.scriptId !== currentScriptId) {
        placement.error = 'The active scene belongs to a different script.';
        return;
      }
      const creation = getSceneObjectCreation(model.getValue(), placement, allowStandalone);
      if (!creation) {
        placement.error = placement.scene
          ? 'Use an inline onLoad method on the scene class to add palette objects.'
          : codeOnly
            ? 'Check the script syntax and use one editable Engine setup to insert object code.'
            : 'Scene placement needs one Dino GE Engine with an editable inline configuration or a local const callback object used only by that Engine.';
        return;
      }
      const before = model.getAlternativeVersionId();
      if (applySourceEdits(creation.edits)) {
        placement.tag = creation.tag;
        placement.sourceId = creation.sourceId;
        if (codeOnly) {
          setActiveTab('editor');
          setIsEditorVisible(true);
          const mapping = getSourceMapping()[creation.sourceId];
          if (mapping) {
            const position = model.getPositionAt(mapping.start);
            monacoEditorRef.current?.setPosition(position);
            monacoEditorRef.current?.revealPositionInCenterIfOutsideViewport(position);
          }
          return;
        }
        if (!liveRun) return;
        const scene = Dino.Engine.currentScene;
        const object = createSceneObject(placement);
        const after = model.getAlternativeVersionId();
        recordSceneHistory({ model, run: liveRun, scene, object, before, after });
        Dino.Engine.selectedObject = object;
      }
    };

    const replaceSpriteImage = (event: Event) => {
      const { object, image, source } = (event as CustomEvent<{
        object: Dino.Sprite; image: HTMLImageElement; source: string;
      }>).detail;
      const { Engine } = Dino;
      const model = monacoEditorRef.current?.getModel();
      const run = document.querySelector<HTMLElement>('script[data-playground-script]');
      const scene = Engine.currentScene;
      if (!model || loadedScriptId.current !== currentScriptId || run?.dataset.playgroundScript !== currentScriptId ||
          !Engine.paused || !Engine.debug || Engine.selectedObject !== object || !isReplaceableSprite(object)) return;
      const sourceId = object.metadata.sourceId;
      if (!sourceId) return;
      const matches = Array.from(scene?.objects ?? Engine.objects).filter(item => item.metadata.sourceId === sourceId);
      if (matches.length !== 1 || matches[0] !== object) return;
      const edit = getSpriteImageReplacement(model.getValue(), sourceId, source);
      const before = model.getAlternativeVersionId();
      if (!edit || !applySourceEdits([edit])) return;
      const previousImage = object.img;
      object.img = image;
      const after = model.getAlternativeVersionId();
      if (before !== after) recordSceneHistory({ model, run, scene, object, before, after,
        spriteImage: { before: previousImage, after: image } });
      event.preventDefault();
    };

    const editSceneObject = (event: Event) => {
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
      const matchesConstructor = (type?: string) => type && Dino[type as keyof typeof Dino] === object.constructor;
      if (event.type === 'playground-duplicate-scene-object') {
        const position = object.transform.position.clone();
        position.set(position.x + 24, position.y + 24);
        const copy = getSceneObjectDuplication(model.getValue(), sourceId, position.x, position.y);
        if (!copy || !matchesConstructor(copy.type)) return;
        const before = model.getAlternativeVersionId();
        let duplicate: Dino.GameObject | undefined;
        try {
          duplicate = duplicateSceneObject(object, copy.type, copy.options, copy.tag, copy.sourceId, position);
        } catch {
          return;
        }
        if (!duplicate) return;
        if (!applySourceEdits([copy.edit])) {
          Dino.Engine.destroyObject(duplicate);
          return;
        }
        recordSceneHistory({ model, run, scene, object: duplicate, before, after: model.getAlternativeVersionId() });
        Dino.Engine.selectedObject = duplicate;
        window.dispatchEvent(new CustomEvent('playground-scene-history', {
          detail: `Created ${copy.tag}. Save the script to keep it.`,
        }));
        event.preventDefault();
        return;
      }
      const deletion = getSceneObjectDeletion(model.getValue(), sourceId);
      if (!deletion || !matchesConstructor(getSourceMapping()[sourceId]?.type)) return;
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
    window.addEventListener('playground-update-sprite-image', replaceSpriteImage);
    window.addEventListener('playground-add-scene-object', addSceneObject);
    window.addEventListener(sceneObjectCodeEvent, addSceneObject);
    window.addEventListener('playground-remove-scene-object', editSceneObject);
    window.addEventListener('playground-duplicate-scene-object', editSceneObject);
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
      window.removeEventListener('playground-update-sprite-image', replaceSpriteImage);
      window.removeEventListener('playground-add-scene-object', addSceneObject);
      window.removeEventListener(sceneObjectCodeEvent, addSceneObject);
      window.removeEventListener('playground-remove-scene-object', editSceneObject);
      window.removeEventListener('playground-duplicate-scene-object', editSceneObject);
      window.removeEventListener('playground-before-run', clearSceneHistory);
      window.removeEventListener('playground-code-history', changeCodeHistory);
      window.removeEventListener('playground-apply-edit', handleApplyEditEvent);
      window.removeEventListener('playground-apply-multi-edit', handleApplyMultiEditEvent);
    };
  }, [currentScriptId, editorValue, formatCode, applyEdits, pushEditOperations, monacoEditorRef, setActiveTab, setIsEditorVisible]);

  const syncSceneHistory = (model: editor.ITextModel, event: editor.IModelContentChangedEvent) => {
    if (!event.isUndoing && !event.isRedoing) return;
    const revision = model.getAlternativeVersionId();
    const entry = sceneHistory.current.findLast(item => item.run.isConnected &&
      item.run.dataset.playgroundScript === loadedScriptId.current && item.model === model &&
      revision === (event.isUndoing ? item.before : item.after));
    if (!entry) return;

    const { scene } = entry;
    const active = scene === Dino.Engine.currentScene;
    const objects = scene?.objects ?? Dino.Engine.objects;
    if ('transforms' in entry) {
      const changes = entry.transforms.filter(({ object }) => objects.has(object));
      if (!changes.length) return;
      for (const { object, before, after } of changes) {
        const state = event.isUndoing ? before : after;
        restoreSceneTransform(object, state);
        window.dispatchEvent(new CustomEvent('playground-placement-history', { detail: { object, state } }));
      }
      const [{ object, before, after }] = changes;
      const state = event.isUndoing ? before : after;
      const change = state.rotation === undefined ? 'placement' : 'rotation';
      const detail = changes.length > 1
        ? `${event.isUndoing ? 'Undid' : 'Restored'} canvas changes for ${changes.length} objects.`
        : `${event.isUndoing ? 'Undid' : 'Restored'} ${change} for ${object.metadata.tag}.`;
      window.dispatchEvent(new CustomEvent('playground-scene-history', { detail }));
      return;
    }
    const { object, spriteImage, removed } = entry;
    if (spriteImage) {
      if (object instanceof Dino.Sprite && objects.has(object)) {
        object.img = event.isUndoing ? spriteImage.before : spriteImage.after;
        const detail = `${event.isUndoing ? 'Restored the previous' : 'Restored the replacement'} image for ${object.metadata.tag}.`;
        window.dispatchEvent(new CustomEvent('playground-scene-history', { detail }));
      }
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

  const selectNewScript = (scriptId: string) => {
    setScripts(previous => previous.includes(scriptId) ? previous : [...previous, scriptId]);
    onSelectScript(scriptId);
  };

  const handleNewScript = async () => {
    const name = window.prompt('Enter script name:')?.trim().replace(/\.js$/, '');
    if (!name) return;
    setImportError('');
    try {
      await createScript(name);
      selectNewScript(name);
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
      selectNewScript(id);
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
            onChange={event => onSelectScript(event.target.value)}
          >
            {scripts.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          {currentScriptId.includes('/') && <button type="button" className="import-game-button" ref={projectFilesButton}
            disabled={importing} onClick={() => setProjectFilesOpen(true)}>Project files</button>}
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
      {projectFilesOpen && <ProjectFilesDialog key={currentScriptId} scriptId={currentScriptId}
        onClose={() => {
          setProjectFilesOpen(false);
          projectFilesButton.current?.focus();
        }} />}
      {dropFeedback?.scriptId === currentScriptId && <p className={`editor-drop-feedback${dropFeedback.error ? ' editor-drop-error' : ''}`}
        role={dropFeedback.error ? 'alert' : 'status'}>{dropFeedback.message}</p>}
      <div className="editor-textbox" ref={editorDropTarget}
        onDragOverCapture={event => {
          const { types } = event.dataTransfer;
          if (!types.includes(sceneObjectDragType) && !(draggedAsset.current && types.includes(sceneAssetDragType))) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = 'copy';
          setIsObjectOverEditor(true);
        }}
        onDragLeave={event => {
          if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
            setIsObjectOverEditor(false);
          }
        }}
        onDropCapture={event => {
          setIsObjectOverEditor(false);
          const { dataTransfer } = event;
          if (!dataTransfer.types.includes(sceneObjectDragType) && !dataTransfer.types.includes(sceneAssetDragType)) return;
          event.preventDefault();
          event.stopPropagation();
          const kind = sceneObjectKinds.find(item => item === dataTransfer.getData(sceneObjectDragType));
          const asset = draggedAsset.current;
          const item = kind ? { kind } : asset && asset.tag === dataTransfer.getData(sceneAssetDragType) ? { asset } : undefined;
          if (item && dropObjectCode(item)) monacoEditorRef.current?.focus();
        }}>
        {isObjectOverEditor && <div className="editor-drop-guide" aria-hidden="true">
          <span><i className="fa-solid fa-code" /> Drop to insert code</span>
        </div>}
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
