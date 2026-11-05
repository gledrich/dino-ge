import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { PlaygroundProvider } from './context/PlaygroundContext.tsx'
import './index.css'
import '@fortawesome/fontawesome-free/css/fontawesome.min.css'
import '@fortawesome/fontawesome-free/css/solid.min.css'
import './monaco'
import { browserPreviewUrl, getFilesList, setCurrentScriptId } from './utils/helpers'
import { seedBrowserWorkspace } from './utils/browser-workspace'

const initialiseWorkspace = async () => {
  if (browserPreviewUrl) await seedBrowserWorkspace();
  return getFilesList();
};

const root = ReactDOM.createRoot(document.getElementById('root')!);
initialiseWorkspace().then(files => {
  setCurrentScriptId(files.includes('script') ? 'script' : files[0] ?? 'script')
  root.render(
    <React.StrictMode>
      <PlaygroundProvider>
        <App />
      </PlaygroundProvider>
    </React.StrictMode>,
  );
}).catch(error => {
  console.error('Could not open the Playground workspace', error);
  root.render(
    <main style={{ padding: '1rem' }}>
      <h1>Could not open the Playground</h1>
      <p role="alert">{error instanceof Error ? error.message : 'The workspace could not be opened.'}</p>
      <button type="button" onClick={() => location.reload()}>Retry</button>
    </main>,
  );
});

