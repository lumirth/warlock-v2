import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TestUiProvider } from './test/TestUiProvider'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import App from './App'

beforeEach(() => {
  localStorage.clear()
  document.documentElement.className = ''
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('application boundary', () => {
  it('routes unknown addresses and keeps navigation accessible', () => {
    render(
      <TestUiProvider>
        <MemoryRouter initialEntries={['/missing']}>
          <App />
        </MemoryRouter>
      </TestUiProvider>
    )
    expect(screen.getByText(/skip to main content/i)).toHaveAttribute(
      'href',
      '#main-content'
    )
    expect(
      screen.getByRole('heading', { name: /page not found/i })
    ).toBeVisible()
    expect(
      screen.getByRole('link', { name: /return to course search/i })
    ).toHaveAttribute('href', '/')
  })

  it('applies and persists the selected theme', () => {
    render(
      <TestUiProvider>
        <MemoryRouter>
          <App />
        </MemoryRouter>
      </TestUiProvider>
    )
    fireEvent.click(
      screen.getByRole('button', { name: /switch to dark mode/i })
    )
    expect(document.documentElement).toHaveClass('dark')
    expect(localStorage.getItem('warlock-v2-theme')).toBe('dark')
  })

  it('contains unexpected render failures', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const suppress = (event: ErrorEvent) => event.preventDefault()
    window.addEventListener('error', suppress)
    const Broken = () => {
      throw new Error('boom')
    }
    render(
      <AppErrorBoundary>
        <Broken />
      </AppErrorBoundary>
    )
    expect(screen.getByRole('heading', { name: /fresh start/i })).toBeVisible()
    expect(
      screen.getByRole('button', { name: /reload course search/i })
    ).toBeVisible()
    window.removeEventListener('error', suppress)
  })
})
