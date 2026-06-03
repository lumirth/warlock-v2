import type { ReactNode } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'

interface TestUiProviderProps {
  children: ReactNode
}

export function TestUiProvider({ children }: TestUiProviderProps) {
  return <TooltipProvider>{children}</TooltipProvider>
}
