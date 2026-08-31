import type { ReactNode } from 'react'

interface TestUiProviderProps {
  children: ReactNode
}

export function TestUiProvider({ children }: TestUiProviderProps) {
  return children
}
