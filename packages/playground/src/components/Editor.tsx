import React, { useCallback, useEffect, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import * as Dino from 'dino-ge';
import { getScript, getFilesList, setCurrentScriptId, updateScript } from '../utils/helpers';
import { Edit, instrumentCode, getSourceMapping } from '../utils/ast-utils';
import { useMonacoEditor } from '../hooks/useMonacoEditor';
import '../styles/editor.css';

interface EditorProps {
  currentScriptId: string;
  onRefresh: (value: string) => void;
}

const CodeEditor: React.FC<EditorProps> = ({ currentScriptId, onRefresh }) => {
  const [scripts, setScripts] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isFormatting, setIsFormatting] = useState(false);
  const [editorValue, setEditorValue] = useState<string>('');
  const { monacoEditorRef, formatCode, applyEdits, pushEditOperations } = useMonacoEditor();

  const handleSave = useCallback(async (value: string) => {
    setIsSaving(true);
    onRefresh(value);
    setTimeout(() => setIsSaving(false), 500);
  }, [onRefresh]);

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
    const loadScript = async () => {
      setIsSaving(true);
      const script = await getScript(currentScriptId);
      const formatted = await formatCode(script);
      setEditorValue(formatted);
      const result = instrumentCode(formatted);
      if (result.error) console.warn(result.error);
      setIsSaving(false);
    };
    loadScript();
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

    const handleRefreshEvent = () => {
      onRefresh(editorValue);
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
      window.dispatchEvent(new CustomEvent('playground-editor-value', { detail: editorValue }));
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
    window.addEventListener('playground-refresh', handleRefreshEvent);
    window.addEventListener('playground-update-code', handleUpdateCodeEvent);
    window.addEventListener('playground-get-value', handleGetValueEvent);
    window.addEventListener('playground-apply-edit', handleApplyEditEvent);
    window.addEventListener('playground-apply-multi-edit', handleApplyMultiEditEvent);

    return () => {
      window.removeEventListener('playground-insert-text', handleInsertText);
      window.removeEventListener('playground-refresh', handleRefreshEvent);
      window.removeEventListener('playground-update-code', handleUpdateCodeEvent);
      window.removeEventListener('playground-get-value', handleGetValueEvent);
      window.removeEventListener('playground-apply-edit', handleApplyEditEvent);
      window.removeEventListener('playground-apply-multi-edit', handleApplyMultiEditEvent);
    };
  }, [editorValue, onRefresh, formatCode, applyEdits, pushEditOperations, monacoEditorRef]);

  const handleScriptChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setCurrentScriptId(e.target.value);
    window.dispatchEvent(new CustomEvent('playground-script-selected', { detail: e.target.value }));
  };

  const handleNewScript = async () => {
    const name = window.prompt('Enter script name:');
    if (name) {
      await updateScript('', false, name);
      setCurrentScriptId(name);
      window.dispatchEvent(new CustomEvent('playground-script-selected', { detail: name }));
    }
  };

  const handleEditorDidMount = async (editor: any, monaco: any) => {
    monacoEditorRef.current = editor;

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
        monaco.languages.typescript;

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
          <i 
            className="fa-solid fa-plus new-script" 
            title="New Script" 
            onClick={handleNewScript}
          />
          <select 
            className="script-selector" 
            value={currentScriptId} 
            onChange={handleScriptChange}
          >
            {scripts.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <i 
            className={`fa-solid fa-wand-magic-sparkles format-btn ${isFormatting ? 'active' : ''}`}
            title="Format Code (Shift+Alt+F)"
            onClick={handleFormat}
          />
          <i 
            className={`fa-solid fa-cloud ${isSaving ? 'saving' : 'save'}`} 
            title="Save (Ctrl+S)"
            onClick={() => handleSave(editorValue)}
          />
        </div>
      </div>
      <div className="editor-textbox">
        <Editor
          height="100%"
          defaultLanguage="javascript"
          theme="vs-dark"
          value={editorValue}
          onChange={(value) => {
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
