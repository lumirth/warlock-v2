import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { PageContainer } from '@/components/PageContainer'

type AppErrorBoundaryState = {
  hasError: boolean
}

export class AppErrorBoundary extends Component<
  { children: ReactNode },
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unexpected application error', error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children

    return (
      <main id="main-content">
        <PageContainer className="py-16">
          <div className="mx-auto max-w-xl">
            <h1 className="text-3xl font-semibold">The app needs a fresh start</h1>
            <p className="text-muted-foreground mt-3 leading-7">
              An unexpected error interrupted this page. Reload to restore a
              clean search session.
            </p>
            <Button
              type="button"
              className="mt-6"
              onClick={() => window.location.reload()}
            >
              Reload course search
            </Button>
          </div>
        </PageContainer>
      </main>
    )
  }
}
