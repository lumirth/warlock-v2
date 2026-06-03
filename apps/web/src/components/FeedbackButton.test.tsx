import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api-client'
import { TestMantineProvider } from '../test/TestMantineProvider'
import { FeedbackButton } from './FeedbackButton'

vi.mock('../lib/api-client', () => ({
  api: {
    submitFeedback: vi.fn(),
  },
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderFeedbackButton() {
  render(
    <TestMantineProvider>
      <FeedbackButton
        buttonLabel="Results not right?"
        page="search"
        kind="search_results"
        issue="expected_different_results"
        context={{ query: 'professor fagen' }}
      />
    </TestMantineProvider>
  )
}

describe('FeedbackButton', () => {
  it('submits structured feedback context and shows completion state', async () => {
    vi.mocked(api.submitFeedback).mockResolvedValueOnce({
      id: 'feedback-1',
      status: 'accepted',
      received_at: 1780358400,
    })

    renderFeedbackButton()

    fireEvent.click(screen.getByRole('button', { name: /results not right/i }))
    fireEvent.change(screen.getByLabelText(/expected result/i), {
      target: { value: 'courses taught by Wade Fagen-Ulmschneider' },
    })
    fireEvent.change(screen.getByLabelText(/feedback note/i), {
      target: { value: 'The professor name should be enough.' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }))

    expect(await screen.findByText(/feedback received/i)).toBeInTheDocument()
    expect(api.submitFeedback).toHaveBeenCalledWith({
      kind: 'search_results',
      issue: 'expected_different_results',
      page: 'search',
      query: 'professor fagen',
      expected: 'courses taught by Wade Fagen-Ulmschneider',
      message: 'The professor name should be enough.',
    })
  })
})
