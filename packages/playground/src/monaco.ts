import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import TypeScriptWorker from 'monaco-editor/language/typescript/ts.worker.js?worker';

globalThis.MonacoEnvironment = {
  getWorker(_workerId, label) {
    return label === 'typescript' || label === 'javascript'
      ? new TypeScriptWorker()
      : new EditorWorker();
  },
};

// Keep the existing browser-console API while loading Monaco from this build.
(globalThis as typeof globalThis & { monaco: typeof monaco }).monaco = monaco;
loader.config({ monaco });
