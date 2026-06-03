import { useId, useState, type ComponentProps } from 'react'
import { CheckIcon, MessageCircleIcon, SendIcon, XIcon } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type {
  FeedbackIssue,
  FeedbackKind,
  FeedbackSubmitDto,
} from '@uiuc-course-search/query-types'
import { api } from '../lib/api-client'

type FeedbackContext = Omit<
  Partial<FeedbackSubmitDto>,
  'kind' | 'issue' | 'page' | 'expected' | 'message'
>

interface FeedbackButtonProps {
  buttonLabel: string
  page: 'search' | 'course'
  kind: FeedbackKind
  issue: FeedbackIssue
  context?: FeedbackContext
  expectedPlaceholder?: string
  messagePlaceholder?: string
  fullWidth?: boolean
  buttonVariant?: ComponentProps<typeof Button>['variant']
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
  buttonVariant = 'ghost',
}: FeedbackButtonProps) {
  const [open, setOpen] = useState(false)
  const [expected, setExpected] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const expectedId = useId()
  const messageId = useId()

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
      setError(
        err instanceof Error ? err.message : 'Feedback could not be sent'
      )
    } finally {
      setSubmitting(false)
    }
  }

  if (success) {
    return (
      <Alert
        className={cn('border-success/30 text-success', fullWidth && 'w-full')}
      >
        <CheckIcon aria-hidden />
        <AlertDescription className="text-success">
          Feedback received.
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className={cn('flex flex-col gap-2', fullWidth && 'w-full')}>
      {!open && (
        <Button
          variant={buttonVariant}
          size="xs"
          className={cn(fullWidth && 'w-full')}
          onClick={() => setOpen(true)}
        >
          <MessageCircleIcon data-icon="inline-start" aria-hidden />
          {buttonLabel}
        </Button>
      )}

      {open && (
        <Card size="sm">
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle>Send feedback</CardTitle>
            <Button variant="ghost" size="xs" onClick={() => setOpen(false)}>
              <XIcon data-icon="inline-start" aria-hidden />
              Close
            </Button>
          </CardHeader>
          <CardContent>
            <FieldGroup className="gap-3">
              <Field>
                <FieldLabel htmlFor={expectedId} className="sr-only">
                  Expected result
                </FieldLabel>
                <Input
                  id={expectedId}
                  autoComplete="off"
                  placeholder={expectedPlaceholder}
                  value={expected}
                  onChange={(event) => setExpected(event.currentTarget.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={messageId} className="sr-only">
                  Feedback note
                </FieldLabel>
                <Textarea
                  id={messageId}
                  placeholder={messagePlaceholder}
                  rows={2}
                  value={message}
                  onChange={(event) => setMessage(event.currentTarget.value)}
                />
              </Field>
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <div className="flex justify-end">
                <Button size="xs" onClick={submit} disabled={submitting}>
                  {submitting ? (
                    <Spinner data-icon="inline-start" aria-hidden />
                  ) : (
                    <SendIcon data-icon="inline-start" aria-hidden />
                  )}
                  Send
                </Button>
              </div>
            </FieldGroup>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
