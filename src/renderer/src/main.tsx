import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './app.css'

declare const __DEMO_MODE__: boolean

async function bootstrap(): Promise<void> {
  if (__DEMO_MODE__ && !window.api) {
    const { createDemoApi } = await import('./demoApi')
    window.api = createDemoApi()
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  )
}

bootstrap()
