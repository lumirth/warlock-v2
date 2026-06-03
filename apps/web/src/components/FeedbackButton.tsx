import { useState } from 'react'
import { Alert, Button, Group, Paper, Stack, Text, TextInput, Textarea, type ButtonProps } from '@mantine/core'
import { IconCheck, IconMessageCircle, IconX } from '@tabler/icons-react'
import type { FeedbackIssue, FeedbackKind, FeedbackSubmitDto } from '@uiuc-course-search/query-types'
import { api } from '../lib/api-client'

type FeedbackContext = Omit<Partial<FeedbackSubmitDto>, 'kind' | 'issue' | 'page' | 'expected' | 'message'>

interface FeedbackButtonProps {
  buttonLabel: string
  page: 'search' | 'course'
  kind: FeedbackKind
  issue: FeedbackIssue
  context?: FeedbackContext
  expectedPlaceholder?: string
  messagePlaceholder?: string
  fullWidth?: boolean
  buttonVariant?: ButtonProps['variant']
}

export function FeedbackButton({
  buttonLabel,
  page,
  kind,
  issue,
  context = {},
  expectedPlaceholder = 'What did you expect instead?',
  messagePlaceholder = 'Anything else we should know?',
  fullWidth = false,
  buttonVariant = 'subtle',
}: FeedbackButtonProps) {
  const [open, setOpen] = useState(false)
  const [expected, setExpected] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setSubmitting(true)
    setError(null)

    try {
      await api.submitFeedback({
        ...context,
        kind,
        issue,
        page,
        expected: expected.trim() || undefined,
        message: message.trim() || undefined,
      })
      setSuccess(true)
      setExpected('')
      setMessage('')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Feedback could not be sent')
    } finally {
      setSubmitting(false)
    }
  }

  if (success) {
    return (
      <Alert color="teal" variant="light" icon={<IconCheck size={16} />} py="xs" w={fullWidth ? '100%' : undefined}>
        Feedback received.
      </Alert>
    )
  }

  return (
    <Stack gap="xs" w={fullWidth ? '100%' : undefined}>
      {!open && (
        <Button
          variant={buttonVariant}
          size="xs"
          fullWidth={fullWidth}
          leftSection={<IconMessageCircle size={14} />}
          onClick={() => setOpen(true)}
        >
          {buttonLabel}
        </Button>
      )}

      {open && (
        <Paper withBorder p="sm" radius="md" shadow="xs">
          <Stack gap="xs">
            <Group justify="space-between" align="center">
              <Text size="sm" fw={600}>Send feedback</Text>
              <Button
                variant="subtle"
                size="compact-xs"
                leftSection={<IconX size={12} />}
                onClick={() => setOpen(false)}
              >
                Close
              </Button>
            </Group>
            <TextInput
              aria-label="Expected result"
              placeholder={expectedPlaceholder}
              value={expected}
              onChange={(event) => setExpected(event.currentTarget.value)}
            />
            <Textarea
              aria-label="Feedback note"
              placeholder={messagePlaceholder}
              minRows={2}
              value={message}
              onChange={(event) => setMessage(event.currentTarget.value)}
            />
            {error && (
              <Alert color="red" variant="light" py="xs">
                {error}
              </Alert>
            )}
            <Group justify="flex-end">
              <Button size="xs" onClick={submit} loading={submitting}>
                Send
              </Button>
            </Group>
          </Stack>
        </Paper>
      )}
    </Stack>
  )
}
