/// <reference types="vite/client" />

declare module 'monaco-editor/editor/standalone/browser/standaloneServices.js' {
  import type { editor } from 'monaco-editor';
  export const StandaloneServices: { initialize(overrides: editor.IEditorOverrideServices): unknown };
}

declare module "*.css" {
  const content: { [className: string]: string };
  export default content;
}

interface Window {
  ace: any;
  js_beautify: (text: string, options?: any) => string;
  Dino: any;
}

declare const ace: any;
declare const js_beautify: (text: string, options?: any) => string;

interface PlaygroundEvent extends CustomEvent {
  detail: any;
}
