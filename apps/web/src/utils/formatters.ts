export function formatTime(time: string | null): string {
  if (!time) return ''
  // Handle "09:00" or "0900" or "9:00"
  const trimmed = time.trim()
  const match = /^(\d{1,2}):?(\d{2})$/.exec(trimmed)
  // Fallback if parsing fails or unexpected format
  if (!match) return time

  const hour24 = Number.parseInt(match[1], 10)
  const minuteNumber = Number.parseInt(match[2], 10)

  if (hour24 < 0 || hour24 > 23 || minuteNumber < 0 || minuteNumber > 59) {
    return time
  }

  const ampm = hour24 >= 12 ? 'PM' : 'AM'
  const hour12 = hour24 % 12 || 12

  return `${hour12}:${match[2]} ${ampm}`
}
