import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TestUiProvider } from './test/TestUiProvider'
import App from './App'

beforeEach(() => {
  window.localStorage.clear()
  document.documentElement.className = ''
  document.documentElement.style.colorScheme = ''
})

afterEach(() => {
  cleanup()
  document.documentElement.className = ''
  document.documentElement.style.colorScheme = ''
})

describe('App shell', () => {
  it('renders the search brand as the page heading and toggles dark mode', () => {
    render(
      <TestUiProvider>
        <MemoryRouter initialEntries={['/']}>
          <App />
        </MemoryRouter>
      </TestUiProvider>
    )

    expect(
      screen.getByRole('heading', { level: 1, name: /uiuc course search/i })
    ).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: /switch to dark mode/i })
    )
    expect(document.documentElement).toHaveClass('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(window.localStorage.getItem('uiuc-course-search-theme')).toBe('dark')

    fireEvent.click(
      screen.getByRole('button', { name: /switch to light mode/i })
    )
    expect(document.documentElement).not.toHaveClass('dark')
    expect(document.documentElement.style.colorScheme).toBe('light')
    expect(window.localStorage.getItem('uiuc-course-search-theme')).toBe(
      'light'
    )
  })
})
