import { Routes, Route } from 'react-router-dom'
import { ActionIcon, AppShell, Container, Group, Title, Tooltip } from '@mantine/core'
import { IconBrandGithub, IconHome } from '@tabler/icons-react'
import { Link } from 'react-router-dom'
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
          <Group h="100%" px="md" wrap="nowrap">
            <Title order={3} style={{ color: 'inherit', textDecoration: 'none', minWidth: 0 }}>
              <Link to="/" style={{ color: 'inherit', textDecoration: 'none' }}>
                UIUC Course Search
              </Link>
            </Title>
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
