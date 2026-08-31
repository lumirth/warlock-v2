import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { api } from '../lib/api-client'
import { TestUiProvider } from '../test/TestUiProvider'
import { FeedbackButton } from './FeedbackButton'

vi.mock('../lib/api-client', () => ({
  api: { submitFeedback: vi.fn() },
}))

it('submits feedback with its search context and confirms receipt', async () => {
  vi.mocked(api.submitFeedback).mockResolvedValue({
    id: 'feedback-1',
    status: 'accepted',
    received_at: 1780358400,
  })
  render(
    <TestUiProvider>
      <FeedbackButton
        buttonLabel="Results not right?"
        page="search"
        context={{ query: 'professor fagen' }}
      />
    </TestUiProvider>
  )

  fireEvent.click(screen.getByRole('button', { name: /results not right/i }))
  fireEvent.change(screen.getByLabelText(/what did you expect/i), {
    target: { value: 'courses taught by Fagen' },
  })
  fireEvent.click(screen.getByRole('button', { name: /^send feedback$/i }))

  expect(await screen.findByText(/feedback received/i)).toBeVisible()
  expect(api.submitFeedback).toHaveBeenCalledWith({
    page: 'search',
    query: 'professor fagen',
    expected: 'courses taught by Fagen',
  })
})
