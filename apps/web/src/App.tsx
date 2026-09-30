import { useEffect, useRef, useState } from 'react'
import { Link, Route, Routes, useLocation } from 'react-router-dom'
import { Code2Icon, MoonIcon, SunIcon } from 'lucide-react'
import courseSearchLogo from './assets/course-search-logo.svg'
import { SearchPage } from './pages/SearchPage'
import { CoursePage } from './pages/CoursePage'
import { buttonVariants } from '@/components/ui/button'
import { Button } from '@/components/ui/button'
import { PageContainer } from '@/components/PageContainer'

type ThemeMode = 'light' | 'dark'

const THEME_STORAGE_KEY = 'warlock-v2-theme'

function readStoredTheme(): ThemeMode | null {
  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)
    return storedTheme === 'light' || storedTheme === 'dark'
      ? storedTheme
      : null
  } catch {
    return null
  }
}

function writeStoredTheme(themeMode: ThemeMode): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, themeMode)
  } catch {
    // Theme persistence is optional; the applied document theme still works.
  }
}

function getInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light'

  const storedTheme = readStoredTheme()
  if (storedTheme) {
    return storedTheme
  }

  try {
    if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
      return 'dark'
    }
  } catch {
    return 'light'
  }

  return 'light'
}

function App() {
  const location = useLocation()
  const isSearchPage = location.pathname === '/'
  const mainRef = useRef<HTMLElement>(null)
  const [themeMode, setThemeMode] = useState<ThemeMode>(getInitialTheme)
  const nextThemeMode = themeMode === 'dark' ? 'light' : 'dark'

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', themeMode === 'dark')
    root.style.colorScheme = themeMode
    writeStoredTheme(themeMode)
  }, [themeMode])

  useEffect(() => {
    mainRef.current?.focus({ preventScroll: true })
    if (window.scrollY !== 0) {
      window.scrollTo({ top: 0, behavior: 'auto' })
    }
  }, [location.pathname])

  return (
    <div className="bg-background text-foreground min-h-screen">
      <a
        href="#main-content"
        className="bg-background text-foreground focus:ring-ring fixed top-2 left-2 z-50 -translate-y-20 rounded-md border px-3 py-2 text-sm font-medium shadow-sm focus:translate-y-0 focus:ring-3 focus:outline-none"
      >
        Skip to main content
      </a>
      <header className="bg-card sticky top-0 z-40 border-b">
        <PageContainer className="flex h-[60px] items-center gap-3">
          <Link
            to="/"
            className="text-foreground flex min-w-0 items-center gap-2 no-underline"
            aria-label="Course Warlock v2 Beta home"
          >
            <img
              src={courseSearchLogo}
              alt=""
              aria-hidden
              className="size-9 shrink-0"
            />
            {isSearchPage ? (
              <h1 className="text-base leading-5 font-semibold sm:text-2xl sm:leading-6">
                Course Warlock{' '}
                <span className="block text-xs font-medium sm:inline sm:text-sm">v2 Beta</span>
              </h1>
            ) : (
              <span className="text-base leading-5 font-semibold sm:text-2xl sm:leading-6">
                Course Warlock{' '}
                <span className="block text-xs font-medium sm:inline sm:text-sm">v2 Beta</span>
              </span>
            )}
          </Link>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              title={`Switch to ${nextThemeMode} mode`}
              aria-label={`Switch to ${nextThemeMode} mode`}
              onClick={() => setThemeMode(nextThemeMode)}
            >
              {themeMode === 'dark' ? (
                <SunIcon aria-hidden />
              ) : (
                <MoonIcon aria-hidden />
              )}
            </Button>
            <a
              href="https://github.com/lumirth/warlock-v2"
              target="_blank"
              rel="noreferrer"
              title="GitHub"
              aria-label="GitHub"
              className={buttonVariants({
                variant: 'ghost',
                size: 'icon-sm',
              })}
            >
              <Code2Icon aria-hidden />
            </a>
          </div>
        </PageContainer>
      </header>

      <main id="main-content" ref={mainRef} tabIndex={-1}>
        <Routes>
          <Route path="/" element={<SearchPage includeH1={false} />} />
          <Route path="/course/:subject/:number" element={<CoursePage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
      <footer className="mt-8 border-t">
        <PageContainer className="text-muted-foreground flex flex-wrap justify-between gap-2 py-5 text-xs">
          <p>Unofficial planning tool. Confirm details before registering.</p>
          <a
            href="https://courses.illinois.edu/"
            target="_blank"
            rel="noreferrer"
            className="font-medium underline"
          >
            Official Course Explorer
          </a>
        </PageContainer>
      </footer>
    </div>
  )
}

function NotFoundPage() {
  useEffect(() => {
    document.title = 'Page not found · Course Warlock v2 Beta'
  }, [])

  return (
    <PageContainer className="py-16">
      <div className="mx-auto max-w-xl">
        <p className="text-primary text-sm font-semibold">404</p>
        <h1 className="mt-2 text-3xl font-semibold">Page not found</h1>
        <p className="text-muted-foreground mt-3 leading-7">
          That address does not match a search or course page.
        </p>
        <Link to="/" className={buttonVariants({ className: 'mt-6' })}>
          Return to course search
        </Link>
      </div>
    </PageContainer>
  )
}

export default App
