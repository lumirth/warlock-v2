import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupTextarea,
} from './input-group'

describe('InputGroup', () => {
  it('focuses textarea controls when addon text is clicked', () => {
    render(
      <InputGroup>
        <InputGroupAddon>Prompt</InputGroupAddon>
        <InputGroupTextarea aria-label="Feedback" />
      </InputGroup>
    )

    fireEvent.click(screen.getByText('Prompt'))

    expect(screen.getByLabelText('Feedback')).toHaveFocus()
  })
})
