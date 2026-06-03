import {
  ActionIcon,
  alpha,
  Anchor,
  Badge,
  Button,
  Card,
  Container,
  createTheme,
  Paper,
  rem,
  Select,
  Switch,
  type CSSVariablesResolver,
  type MantineColorsTuple,
  type MantineThemeOverride,
} from '@mantine/core'

const CONTAINER_SIZES: Record<string, string> = {
  xxs: rem('200px'),
  xs: rem('300px'),
  sm: rem('400px'),
  md: rem('500px'),
  lg: rem('600px'),
  xl: rem('1400px'),
  xxl: rem('1600px'),
}

function colors(value: string): MantineColorsTuple {
  return value.split(',') as unknown as MantineColorsTuple
}

const zincColors = colors('#fafafa,#f4f4f5,#e4e4e7,#d4d4d8,#a1a1aa,#52525b,#3f3f46,#27272a,#18181b,#09090b,#71717A')
const slateColors = colors('#f8fafc,#f1f5f9,#e2e8f0,#cbd5e1,#94a3b8,#475569,#334155,#1e293b,#0f172a,#020817,#64748B')
const grayColors = colors('#f9fafb,#f3f4f6,#e5e7eb,#d1d5db,#9ca3af,#4b5563,#374151,#1f2937,#111827,#030712,#6B7280')
const neutralColors = colors('#fafafa,#f5f5f5,#e5e5e5,#d4d4d4,#a3a3a3,#525252,#404040,#262626,#171717,#0a0a0a,#737373')
const stoneColors = colors('#fafaf9,#f5f5f4,#e7e5e4,#d6d3d1,#a8a29e,#57534e,#44403c,#292524,#1c1917,#0c0a09,#78716C')
const redColors = colors('#FEF2F2,#FEE2E2,#FECACA,#FCA5A5,#F87171,#DC2626,#B91C1C,#991B1B,#7F1D1D,#450A0A,#EF4444')
const roseColors = colors('#fff1f2,#ffe4e6,#fecdd3,#fda4af,#fb7185,#e11d48,#be123c,#9f1239,#881337,#4c0519,#F43F5E')
const orangeColors = colors('#fff7ed,#ffedd5,#fed7aa,#fdba74,#fb923c,#f97316,#ea580c,#9a3412,#7c2d12,#431407,#F97316')
const amberColors = colors('#FFFBEB,#FEF3C7,#FDE68A,#FCD34D,#FBBF24,#f59e0b,#D97706,#92400E,#78350F,#451A03,#F59E0B')
const yellowColors = colors('#fefce8,#fef9c3,#fef08a,#fde047,#facc15,#ca8a04,#a16207,#854d0e,#713f12,#3f2c06,#F59E0B')
const limeColors = colors('#f7fee7,#ecfccb,#d9f99d,#bef264,#a3e635,#4d7c0f,#3f6212,#365314,#1a2e05,#0f1903,#84CC16')
const greenColors = colors('#F0FDF4,#DCFCE7,#BBF7D0,#86EFAC,#4ADE80,#22c55e,#16A34A,#166534,#14532D,#052E16,#10B981')
const emeraldColors = colors('#ecfdf5,#d1fae5,#a7f3d0,#6ee7b7,#34d399,#059669,#047857,#065f46,#064e3b,#022c22,#10B981')
const tealColors = colors('#f0fdfa,#ccfbf1,#99f6e4,#5eead4,#2dd4bf,#0d9488,#0f766e,#115e59,#134e4a,#042f2e,#14B8A6')
const cyanColors = colors('#ecfeff,#cffafe,#a5f3fc,#67e8f9,#22d3ee,#0891b2,#0e7490,#155e75,#164e63,#083344,#06B6D4')
const skyColors = colors('#f0f9ff,#e0f2fe,#bae6fd,#7dd3fc,#38bdf8,#0284c7,#0369a1,#075985,#0c4a6e,#082f49,#0EA5E9')
const blueColors = colors('#eff6ff,#dbeafe,#bfdbfe,#93c5fd,#60a5fa,#3b82f6,#2563eb,#1e40af,#1e3a8a,#172554,#3B82F6')
const indigoColors = colors('#eef2ff,#e0e7ff,#c7d2fe,#a5b4fc,#818cf8,#4f46e5,#4338ca,#3730a3,#312e81,#1e1b4b,#6366F1')
const violetColors = colors('#f5f3ff,#ede9fe,#ddd6fe,#c4b5fd,#a78bfa,#7c3aed,#6d28d9,#5b21b6,#4c1d95,#1e1b4b,#8B5CF6')
const purpleColors = colors('#faf5ff,#f3e8ff,#e9d5ff,#d8b4fe,#c084fc,#9333ea,#7e22ce,#6b21a8,#581c87,#2e1065,#A855F7')
const fuchsiaColors = colors('#fdf4ff,#fae8ff,#f5d0fe,#f0abfc,#e879f9,#c026d3,#a21caf,#86198f,#701a75,#4a044e,#D946EF')
const pinkColors = colors('#fdf2f8,#fce7f3,#fbcfe8,#f9a8d4,#f472b6,#db2777,#be185d,#9d174d,#831843,#500724,#EC4899')

const neutralColorNames = ['zinc', 'slate', 'gray', 'neutral', 'stone']

function getKnownColor(themeColors: Record<string, unknown>, color: unknown): string | undefined {
  return typeof color === 'string' && Object.keys(themeColors).includes(color) ? color : undefined
}

function getFilledContrastColor(themeColors: Record<string, unknown>, color: unknown): string {
  const colorKey = getKnownColor(themeColors, color)
  return colorKey ? `var(--mantine-color-${colorKey}-contrast)` : 'var(--mantine-primary-color-contrast)'
}

export const shadcnTheme: MantineThemeOverride = createTheme({
  colors: {
    slate: slateColors,
    gray: grayColors,
    zinc: zincColors,
    neutral: neutralColors,
    stone: stoneColors,
    red: redColors,
    rose: roseColors,
    orange: orangeColors,
    amber: amberColors,
    yellow: yellowColors,
    lime: limeColors,
    green: greenColors,
    emerald: emeraldColors,
    teal: tealColors,
    cyan: cyanColors,
    sky: skyColors,
    blue: blueColors,
    indigo: indigoColors,
    violet: violetColors,
    purple: purpleColors,
    fuchsia: fuchsiaColors,
    pink: pinkColors,
    primary: orangeColors,
    secondary: stoneColors,
    dark: stoneColors,
    error: redColors,
    success: greenColors,
    info: blueColors,
    warning: amberColors,
  },
  focusRing: 'never',
  scale: 1,
  primaryColor: 'primary',
  primaryShade: { light: 5, dark: 6 },
  autoContrast: true,
  luminanceThreshold: 0.3,
  fontFamily: 'Geist, sans-serif',
  headings: {
    fontFamily: 'Geist, sans-serif',
    sizes: {
      h1: { fontSize: rem('36px'), lineHeight: rem('44px'), fontWeight: '600' },
      h2: { fontSize: rem('30px'), lineHeight: rem('38px'), fontWeight: '600' },
      h3: { fontSize: rem('24px'), lineHeight: rem('32px'), fontWeight: '600' },
      h4: { fontSize: rem('20px'), lineHeight: rem('30px'), fontWeight: '600' },
    },
  },
  radius: {
    xs: rem('2px'),
    sm: rem('4px'),
    md: rem('6px'),
    lg: rem('8px'),
    xl: rem('10px'),
  },
  defaultRadius: 'sm',
  spacing: {
    '4xs': rem('2px'),
    '3xs': rem('4px'),
    '2xs': rem('8px'),
    xs: rem('10px'),
    sm: rem('12px'),
    md: rem('16px'),
    lg: rem('20px'),
    xl: rem('24px'),
    '2xl': rem('28px'),
    '3xl': rem('32px'),
    '4xl': rem('40px'),
  },
  fontSizes: {
    xs: rem('12px'),
    sm: rem('14px'),
    md: rem('16px'),
    lg: rem('18px'),
    xl: rem('20px'),
    '2xl': rem('24px'),
    '3xl': rem('30px'),
    '4xl': rem('36px'),
    '5xl': rem('48px'),
  },
  lineHeights: {
    xs: rem('18px'),
    sm: rem('20px'),
    md: rem('24px'),
    lg: rem('28px'),
  },
  shadows: {
    xs: '0 1px 2px rgba(28, 25, 23, 0.05)',
    sm: '0 2px 8px rgba(28, 25, 23, 0.07)',
    md: '0 2px 8px rgba(28, 25, 23, 0.08)',
    lg: '0 2px 8px rgba(28, 25, 23, 0.09)',
    xl: '0 2px 8px rgba(28, 25, 23, 0.1)',
    xxl: '0 2px 8px rgba(28, 25, 23, 0.1)',
  },
  cursorType: 'pointer',
  other: {
    style: 'shadcn',
  },
  components: {
    Container: Container.extend({
      vars: (_, { size, fluid }) => ({
        root: {
          '--container-size': fluid
            ? '100%'
            : typeof size === 'string' && size in CONTAINER_SIZES
              ? CONTAINER_SIZES[size]
              : typeof size === 'number'
                ? rem(size)
                : typeof size === 'string'
                  ? size
                  : CONTAINER_SIZES.md,
        },
      }),
    }),
    Select: Select.extend({
      defaultProps: {
        checkIconPosition: 'right',
      },
    }),
    Switch: Switch.extend({
      styles: () => ({
        thumb: {
          backgroundColor: 'var(--mantine-color-default)',
          borderColor: 'var(--mantine-color-default-border)',
        },
        track: {
          borderColor: 'var(--mantine-color-default-border)',
        },
      }),
    }),
    ActionIcon: ActionIcon.extend({
      vars: (theme, props) => {
        const colorKey = getKnownColor(theme.colors, props.color)
        const variant = props.variant ?? 'filled'
        const isNeutralColor = colorKey && neutralColorNames.includes(colorKey)
        const isNeutralPrimaryColor = !colorKey && neutralColorNames.includes(theme.primaryColor)

        return {
          root: {
            '--ai-color': variant === 'filled'
              ? getFilledContrastColor(theme.colors, props.color)
              : variant === 'white' && (isNeutralColor || isNeutralPrimaryColor)
                ? 'var(--mantine-color-black)'
                : undefined,
          },
        }
      },
    }),
    Anchor: Anchor.extend({
      defaultProps: {
        underline: 'always',
      },
    }),
    Badge: Badge.extend({
      vars: (theme, props) => {
        const colorKey = getKnownColor(theme.colors, props.color)
        const variant = props.variant ?? 'filled'
        const isNeutralColor = colorKey && neutralColorNames.includes(colorKey)
        const isNeutralPrimaryColor = !colorKey && neutralColorNames.includes(theme.primaryColor)

        return {
          root: {
            '--badge-bg': variant === 'filled' && colorKey ? `var(--mantine-color-${colorKey}-filled)` : undefined,
            '--badge-color': variant === 'filled'
              ? getFilledContrastColor(theme.colors, props.color)
              : variant === 'white' && (isNeutralColor || isNeutralPrimaryColor)
                ? 'var(--mantine-color-black)'
                : undefined,
          },
        }
      },
    }),
    Button: Button.extend({
      vars: (theme, props) => {
        const colorKey = getKnownColor(theme.colors, props.color)
        const variant = props.variant ?? 'filled'
        const isNeutralColor = colorKey && neutralColorNames.includes(colorKey)
        const isNeutralPrimaryColor = !colorKey && neutralColorNames.includes(theme.primaryColor)

        return {
          root: {
            '--button-color': variant === 'filled'
              ? getFilledContrastColor(theme.colors, props.color)
              : variant === 'white' && (isNeutralColor || isNeutralPrimaryColor)
                ? 'var(--mantine-color-black)'
                : undefined,
          },
        }
      },
    }),
    Card: Card.extend({
      defaultProps: {
        p: 'md',
        radius: 'md',
        shadow: 'none',
        withBorder: true,
      },
    }),
    Paper: Paper.extend({
      defaultProps: {
        radius: 'md',
        shadow: 'none',
      },
    }),
  },
})

export const shadcnCssVariableResolver: CSSVariablesResolver = () => ({
  variables: {
    '--mantine-heading-font-weight': '600',
    '--mantine-primary-color-filled-hover': alpha('var(--mantine-primary-color-filled)', 0.9),
    '--mantine-primary-color-light': 'var(--mantine-color-orange-light)',
    '--mantine-primary-color-light-hover': 'var(--mantine-color-orange-light-hover)',
    '--mantine-primary-color-light-color': 'var(--mantine-color-orange-light-color)',
  },
  light: {
    '--mantine-primary-color-contrast': 'var(--mantine-color-stone-0)',
    '--mantine-color-text': 'var(--mantine-color-stone-9)',
    '--mantine-color-body': 'var(--mantine-color-white)',
    '--mantine-color-error': 'var(--mantine-color-red-6)',
    '--mantine-color-placeholder': 'var(--mantine-color-stone-5)',
    '--mantine-color-anchor': 'var(--mantine-color-stone-8)',
    '--mantine-color-default': 'var(--mantine-color-stone-0)',
    '--mantine-color-default-hover': 'var(--mantine-color-stone-1)',
    '--mantine-color-default-color': 'var(--mantine-color-stone-9)',
    '--mantine-color-default-border': 'var(--mantine-color-stone-2)',
    '--mantine-color-dimmed': 'var(--mantine-color-stone-5)',
    '--mantine-color-secondary-filled': 'var(--mantine-color-white)',
    '--mantine-color-secondary-filled-hover': 'var(--mantine-color-stone-1)',
    '--mantine-color-secondary-light': 'var(--mantine-color-stone-1)',
    '--mantine-color-secondary-light-hover': alpha('var(--mantine-color-stone-1)', 0.8),
    '--mantine-color-secondary-light-color': 'var(--mantine-color-stone-8)',
    '--mantine-color-secondary-outline': 'var(--mantine-color-stone-2)',
    '--mantine-color-secondary-outline-hover': 'var(--mantine-color-stone-1)',
  },
  dark: {
    '--mantine-primary-color-contrast': 'var(--mantine-color-stone-0)',
    '--mantine-color-text': 'var(--mantine-color-stone-0)',
    '--mantine-color-body': 'var(--mantine-color-stone-9)',
    '--mantine-color-error': 'var(--mantine-color-red-4)',
    '--mantine-color-placeholder': 'var(--mantine-color-stone-4)',
    '--mantine-color-anchor': 'var(--mantine-color-stone-3)',
    '--mantine-color-default': 'var(--mantine-color-stone-9)',
    '--mantine-color-default-hover': 'var(--mantine-color-stone-7)',
    '--mantine-color-default-color': 'var(--mantine-color-stone-1)',
    '--mantine-color-default-border': 'var(--mantine-color-stone-7)',
    '--mantine-color-dimmed': 'var(--mantine-color-stone-4)',
    '--mantine-color-secondary-filled': 'var(--mantine-color-stone-8)',
    '--mantine-color-secondary-filled-hover': alpha('var(--mantine-color-stone-8)', 0.9),
    '--mantine-color-secondary-light': 'var(--mantine-color-stone-7)',
    '--mantine-color-secondary-light-hover': alpha('var(--mantine-color-stone-7)', 0.8),
    '--mantine-color-secondary-light-color': 'var(--mantine-color-stone-0)',
    '--mantine-color-secondary-outline': 'var(--mantine-color-stone-7)',
    '--mantine-color-secondary-outline-hover': 'var(--mantine-color-stone-7)',
  },
})
