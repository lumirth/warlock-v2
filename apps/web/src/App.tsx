import { Routes, Route } from 'react-router-dom'
import { Link } from 'react-router-dom'
import { Code2Icon, HomeIcon } from 'lucide-react'
import courseSearchLogo from './assets/course-search-logo.png'
import { SearchPage } from './pages/SearchPage'
import { CoursePage } from './pages/CoursePage'
import { buttonVariants } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { PageContainer } from '@/components/PageContainer'

function App() {
  return (
    <div className="bg-background text-foreground min-h-screen">
      <header className="bg-card sticky top-0 border-b">
        <PageContainer className="flex h-[60px] items-center gap-3">
          <Link
            to="/"
            className="text-foreground flex min-w-0 items-center gap-2 no-underline"
          >
            <img
              src={courseSearchLogo}
              alt=""
              aria-hidden
              className="size-9 shrink-0"
            />
            <span className="truncate text-lg leading-6 font-semibold sm:text-2xl">
              UIUC Course Search
            </span>
          </Link>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  to="/"
                  aria-label="Home"
                  className={buttonVariants({
                    variant: 'ghost',
                    size: 'icon-sm',
                  })}
                >
                  <HomeIcon aria-hidden />
                </Link>
              </TooltipTrigger>
              <TooltipContent>Home</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  href="https://github.com/lewisblack/uiuc-course-search"
                  target="_blank"
                  rel="noreferrer"
                  aria-label="GitHub"
                  className={buttonVariants({
                    variant: 'ghost',
                    size: 'icon-sm',
                  })}
                >
                  <Code2Icon aria-hidden />
                </a>
              </TooltipTrigger>
              <TooltipContent>GitHub</TooltipContent>
            </Tooltip>
          </div>
        </PageContainer>
      </header>

      <main>
        <Routes>
          <Route path="/" element={<SearchPage />} />
          <Route path="/course/:subject/:number" element={<CoursePage />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
