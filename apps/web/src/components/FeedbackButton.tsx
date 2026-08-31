import { useEffect, useId, useRef, useState, type ComponentProps, type FormEvent } from 'react'
import { CheckIcon, MessageCircleIcon, SendIcon, XIcon } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  FEEDBACK_EXPECTED_MAX_LENGTH,
  FEEDBACK_MESSAGE_MAX_LENGTH,
  type FeedbackSubmitDto,
} from '@uiuc-course-search/query-types'
import { api } from '../lib/api-client'

type Context = Omit<Partial<FeedbackSubmitDto>, 'page' | 'expected' | 'message'>
type Props = {
  buttonLabel: string
  page: 'search' | 'course'
  context?: Context
  expectedPlaceholder?: string
  messagePlaceholder?: string
  fullWidth?: boolean
  buttonVariant?: ComponentProps<typeof Button>['variant']
}
const controlClass = 'border-input focus-visible:border-ring focus-visible:ring-ring/50 w-full rounded-lg border bg-transparent px-2.5 text-sm outline-none focus-visible:ring-3'

function defaults(props: Props) {
  return {
    ...props,
    context: props.context ?? {},
    expectedPlaceholder: props.expectedPlaceholder ?? 'What did you expect instead?',
    messagePlaceholder: props.messagePlaceholder ?? 'Anything else we should know?',
    buttonVariant: props.buttonVariant ?? 'ghost',
  }
}

function hasText(...values: string[]) {
  return values.some((value) => Boolean(value.trim()))
}

function fullWidthClass(fullWidth?: boolean) {
  return fullWidth ? 'w-full' : undefined
}

export function FeedbackButton(rawProps: Props) {
  const { buttonLabel, page, context, expectedPlaceholder,
    messagePlaceholder, fullWidth, buttonVariant } = defaults(rawProps)
  const [open, setOpen] = useState(false)
  const [expected, setExpected] = useState('')
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState<string | null>(null)
  const id = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const firstField = useRef<HTMLInputElement>(null)
  const hasFeedback = hasText(expected, message)

  useEffect(() => {
    if (!open) return
    const element = dialog.current
    if (element && typeof element.showModal === 'function') {
      element.removeAttribute('open')
      element.showModal()
    }
    firstField.current?.focus()
  }, [open])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!hasFeedback) return setError('Add a short note before sending feedback.')
    setStatus('sending')
    setError(null)
    try {
      await api.submitFeedback({
        ...context, page,
        expected: expected.trim() || undefined,
        message: message.trim() || undefined,
      })
      setStatus('sent')
      setOpen(false)
      setExpected('')
      setMessage('')
    } catch {
      setStatus('idle')
      setError('That feedback did not go through. Give it another moment.')
    }
  }

  if (status === 'sent') return <Alert className={cn('border-success/30 text-success', fullWidthClass(fullWidth))}>
    <CheckIcon aria-hidden />
    <AlertDescription className="text-success">Feedback received.</AlertDescription>
  </Alert>

  return <>
    <Button variant={buttonVariant} size="xs" className={fullWidthClass(fullWidth)} onClick={() => setOpen(true)}>
      <MessageCircleIcon aria-hidden /> {buttonLabel}
    </Button>
    {open && <dialog
      ref={dialog}
      open
      aria-labelledby={`${id}-title`}
      className="bg-card text-card-foreground fixed inset-0 z-50 m-auto max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-lg rounded-lg border p-6 shadow-lg backdrop:bg-black/45"
      onCancel={() => setOpen(false)}
      onKeyDown={(event) => event.key === 'Escape' && setOpen(false)}
    >
      <Button size="icon-xs" variant="ghost" className="absolute top-3 right-3" aria-label="Close" onClick={() => setOpen(false)}>
        <XIcon aria-hidden />
      </Button>
      <h2 id={`${id}-title`} className="pr-8 text-base font-semibold">What looked wrong?</h2>
      <p className="text-muted-foreground mt-1 text-sm leading-6">
        {page === 'search' ? 'Tell us what the result set missed.' : 'Tell us which course signal or source looks wrong.'}
      </p>
      <form className="mt-4 flex flex-col gap-3" onSubmit={submit}>
        <label className="text-sm font-medium" htmlFor={`${id}-expected`}>What did you expect?</label>
        <input
          ref={firstField}
          id={`${id}-expected`}
          className={`${controlClass} h-8`}
          autoComplete="off"
          maxLength={FEEDBACK_EXPECTED_MAX_LENGTH}
          placeholder={expectedPlaceholder}
          value={expected}
          onChange={(event) => setExpected(event.currentTarget.value)}
        />
        <label className="text-sm font-medium" htmlFor={`${id}-message`}>Additional context</label>
        <textarea
          id={`${id}-message`}
          className={`${controlClass} min-h-16 py-2`}
          rows={2}
          maxLength={FEEDBACK_MESSAGE_MAX_LENGTH}
          placeholder={messagePlaceholder}
          value={message}
          onChange={(event) => setMessage(event.currentTarget.value)}
        />
        {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
        <Button size="xs" type="submit" className="self-end" disabled={status === 'sending' || !hasFeedback}>
          <SendIcon aria-hidden /> {status === 'sending' ? 'Sending feedback' : 'Send feedback'}
        </Button>
      </form>
    </dialog>}
  </>
}
