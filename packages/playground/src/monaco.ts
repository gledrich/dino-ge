import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import { StandaloneServices } from 'monaco-editor/editor/standalone/browser/standaloneServices.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker.js?worker';
import TypeScriptWorker from 'monaco-editor/language/typescript/ts.worker.js?worker';

// Bind before the Playground starts capturing the page console for game output.
const browserDebug = console.debug.bind(console);
const browserInfo = console.info.bind(console);
const browserWarn = console.warn.bind(console);
const browserError = console.error.bind(console);
const logLevelChanged = new monaco.Emitter<number>();
let logLevel = 3; // Monaco's default, Info.

const monacoServices: monaco.editor.IEditorOverrideServices = {
  logService: {
    onDidChangeLogLevel: logLevelChanged.event,
    getLevel: () => logLevel,
    setLevel(level: number) {
      if (level === logLevel) return;
      logLevel = level;
      logLevelChanged.fire(level);
    },
    trace: (...args: unknown[]) => { if (logLevel === 1) browserDebug(...args); },
    debug: (...args: unknown[]) => { if (logLevel && logLevel <= 2) browserDebug(...args); },
    info: (...args: unknown[]) => { if (logLevel && logLevel <= 3) browserInfo(...args); },
    warn: (...args: unknown[]) => { if (logLevel && logLevel <= 4) browserWarn(...args); },
    error: (...args: unknown[]) => { if (logLevel) browserError(...args); },
    flush() {},
    dispose: () => logLevelChanged.dispose(),
  },
};

globalThis.MonacoEnvironment = {
  getWorker(_workerId, label) {
    if (label === 'json') return new JsonWorker();
    return label === 'typescript' || label === 'javascript'
      ? new TypeScriptWorker()
      : new EditorWorker();
  },
};

// The React wrapper creates a model before creating an editor. Install the
// logger before that first model initialises Monaco's standalone services.
StandaloneServices.initialize(monacoServices);

// Keep the existing browser-console API while loading Monaco from this build.
(globalThis as typeof globalThis & { monaco: typeof monaco }).monaco = monaco;
loader.config({ monaco });
