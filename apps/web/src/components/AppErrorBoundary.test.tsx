import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppErrorBoundary } from './AppErrorBoundary'

function BrokenView(): never {
  throw new Error('render failed')
}

function suppressExpectedWindowError(event: ErrorEvent): void {
  event.preventDefault()
}

describe('AppErrorBoundary', () => {
  beforeEach(() => {
    window.addEventListener('error', suppressExpectedWindowError)
  })

  afterEach(() => {
    window.removeEventListener('error', suppressExpectedWindowError)
    vi.restoreAllMocks()
  })

  it('replaces an unexpected render failure with a recoverable page', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    render(
      <AppErrorBoundary>
        <BrokenView />
      </AppErrorBoundary>
    )

    expect(
      screen.getByRole('heading', { name: 'The app needs a fresh start' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Reload course search' })
    ).toBeInTheDocument()
  })
})
