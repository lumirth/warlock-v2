import { MantineProvider } from '@mantine/core'
import type { ReactNode } from 'react'
import { shadcnCssVariableResolver, shadcnTheme } from '../theme'

interface TestMantineProviderProps {
  children: ReactNode
}

export function TestMantineProvider({ children }: TestMantineProviderProps) {
  return (
    <MantineProvider theme={shadcnTheme} cssVariablesResolver={shadcnCssVariableResolver}>
      {children}
    </MantineProvider>
  )
}
