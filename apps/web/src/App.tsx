import { Routes, Route } from 'react-router-dom'
import { ActionIcon, AppShell, Box, Container, Group, Title, Tooltip } from '@mantine/core'
import { IconBrandGithub, IconHome } from '@tabler/icons-react'
import { Link } from 'react-router-dom'
import courseSearchLogo from './assets/course-search-logo.png'
import { SearchPage } from './pages/SearchPage'
import { CoursePage } from './pages/CoursePage'

function App() {
  return (
    <AppShell
      header={{ height: 60 }}
      padding="md"
    >
      <AppShell.Header>
        <Container size="lg" h="100%">
          <Group h="100%" wrap="nowrap">
            <Link
              to="/"
              style={{ color: 'inherit', textDecoration: 'none', minWidth: 0, display: 'flex', alignItems: 'center', gap: 'var(--mantine-spacing-xs)' }}
            >
              <Box
                component="img"
                src={courseSearchLogo}
                alt=""
                aria-hidden
                style={{ width: 36, height: 36, flex: '0 0 auto' }}
              />
              <Title order={3} style={{ color: 'inherit', textDecoration: 'none', minWidth: 0 }}>
                UIUC Course Search
              </Title>
            </Link>
            <Group ml="auto" gap="xs" wrap="nowrap">
              <Tooltip label="Home">
                <ActionIcon variant="subtle" component={Link} to="/" aria-label="Home">
                  <IconHome size={18} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="GitHub">
                <ActionIcon
                  variant="subtle"
                  component="a"
                  href="https://github.com/lewisblack/uiuc-course-search"
                  target="_blank"
                  rel="noreferrer"
                  aria-label="GitHub"
                >
                  <IconBrandGithub size={18} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Group>
        </Container>
      </AppShell.Header>

      <AppShell.Main>
        <Routes>
          <Route path="/" element={<SearchPage />} />
          <Route path="/course/:subject/:number" element={<CoursePage />} />
        </Routes>
      </AppShell.Main>
    </AppShell>
  )
}

export default App
