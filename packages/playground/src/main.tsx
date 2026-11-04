import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { PlaygroundProvider } from './context/PlaygroundContext.tsx'
import './index.css'
import '@fortawesome/fontawesome-free/css/fontawesome.min.css'
import '@fortawesome/fontawesome-free/css/solid.min.css'
import './monaco'
import { getFilesList, setCurrentScriptId } from './utils/helpers'

getFilesList().then(files => {
  setCurrentScriptId(files.includes('script') ? 'script' : files[0] ?? 'script')
}).catch(error => console.error('Could not list scripts', error)).finally(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <PlaygroundProvider>
        <App />
      </PlaygroundProvider>
    </React.StrictMode>,
  )
})

