export function formatTime(time: string | null): string {
  if (!time) return ''
  // Handle "09:00" or "0900" or "9:00"
  const clean = time.replace(':', '')
  // Fallback if parsing fails or unexpected format
  if (clean.length < 3) return time

  const hour24 = parseInt(clean.slice(0, -2))
  const minute = clean.slice(-2)

  if (isNaN(hour24)) return time

  const ampm = hour24 >= 12 ? 'PM' : 'AM'
  const hour12 = hour24 % 12 || 12

  return `${hour12}:${minute} ${ampm}`
}
