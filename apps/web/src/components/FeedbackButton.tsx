import { useId, useState, type ComponentProps, type FormEvent } from 'react'
import { CheckIcon, MessageCircleIcon, SendIcon } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
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
import {
  FEEDBACK_EXPECTED_MAX_LENGTH,
  FEEDBACK_MESSAGE_MAX_LENGTH,
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
  const hasFeedback = Boolean(expected.trim() || message.trim())

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!hasFeedback) {
      setError('Add a short note before sending feedback.')
      return
    }
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
      setOpen(false)
      setExpected('')
      setMessage('')
    } catch {
      setError('That feedback did not go through. Give it another moment.')
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
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) setError(null)
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant={buttonVariant}
          size="xs"
          className={cn(fullWidth && 'w-full')}
        >
          <MessageCircleIcon data-icon="inline-start" aria-hidden />
          {buttonLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>What looked wrong?</DialogTitle>
          <DialogDescription>
            {page === 'search'
              ? 'Tell us what the result set missed without leaving this search.'
              : 'Tell us which course signal or source looks wrong.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <FieldGroup className="gap-3">
            <Field>
              <FieldLabel htmlFor={expectedId}>What did you expect?</FieldLabel>
              <Input
                id={expectedId}
                autoComplete="off"
                maxLength={FEEDBACK_EXPECTED_MAX_LENGTH}
                placeholder={expectedPlaceholder}
                value={expected}
                onChange={(event) => setExpected(event.currentTarget.value)}
              />
              <p className="text-muted-foreground text-right text-xs">
                {expected.length.toLocaleString()} /{' '}
                {FEEDBACK_EXPECTED_MAX_LENGTH.toLocaleString()}
              </p>
            </Field>
            <Field>
              <FieldLabel htmlFor={messageId}>Additional context</FieldLabel>
              <Textarea
                id={messageId}
                placeholder={messagePlaceholder}
                rows={2}
                maxLength={FEEDBACK_MESSAGE_MAX_LENGTH}
                value={message}
                onChange={(event) => setMessage(event.currentTarget.value)}
              />
              <p className="text-muted-foreground text-right text-xs">
                {message.length.toLocaleString()} /{' '}
                {FEEDBACK_MESSAGE_MAX_LENGTH.toLocaleString()}
              </p>
            </Field>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <DialogFooter>
              <Button
                size="xs"
                type="submit"
                disabled={submitting || !hasFeedback}
              >
                {submitting ? (
                  <Spinner data-icon="inline-start" aria-hidden />
                ) : (
                  <SendIcon data-icon="inline-start" aria-hidden />
                )}
                {submitting ? 'Sending feedback' : 'Send feedback'}
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}
