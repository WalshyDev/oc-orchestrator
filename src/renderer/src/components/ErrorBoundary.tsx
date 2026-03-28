import React from 'react'
import { Warning } from '@phosphor-icons/react'

interface ErrorBoundaryProps {
  children: React.ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('[ErrorBoundary] Uncaught error:', error)
    console.error('[ErrorBoundary] Component stack:', errorInfo.componentStack)
  }

  handleReload = (): void => {
    window.location.reload()
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-kumo-base text-kumo-default">
          <div className="flex flex-col items-center gap-6 max-w-md p-8 rounded-xl bg-kumo-elevated border border-kumo-line">
            <Warning size={48} weight="fill" className="text-kumo-warning" />

            <h1 className="text-xl font-semibold text-kumo-strong">
              Something went wrong
            </h1>

            <p className="text-sm text-kumo-subtle text-center leading-relaxed">
              {this.state.error?.message || 'An unexpected error occurred while rendering the application.'}
            </p>

            <div className="flex items-center gap-3 mt-2">
              <button
                onClick={this.handleReload}
                className="px-4 py-2 rounded-lg bg-kumo-brand text-kumo-contrast text-sm font-medium hover:bg-kumo-brand-hover transition-colors cursor-pointer"
              >
                Reload
              </button>

              <a
                href="https://github.com/nichochar/oc-orchestrator/issues"
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 rounded-lg bg-kumo-control text-kumo-default text-sm font-medium hover:bg-kumo-fill-hover transition-colors"
              >
                Report Issue
              </a>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
