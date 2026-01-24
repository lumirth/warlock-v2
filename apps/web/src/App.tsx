import { Routes, Route } from 'react-router-dom'
import { AppShell, Burger, Group, Title, Button, Container } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { Link } from 'react-router-dom'
import { SearchPage } from './pages/SearchPage'
import { CoursePage } from './pages/CoursePage'

function App() {
  const [opened, { toggle }] = useDisclosure()

  return (
    <AppShell
      header={{ height: 60 }}
      padding="md"
    >
      <AppShell.Header>
        <Container size="lg" h="100%">
            <Group h="100%" px="md">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Title order={3} style={{ color: 'inherit', textDecoration: 'none' }}>
              <Link to="/" style={{ color: 'inherit', textDecoration: 'none' }}>
                UIUC Course Search
              </Link>
            </Title>
            <Group ml="auto" visibleFrom="sm">
                <Button variant="subtle" component={Link} to="/">Home</Button>
                <Button variant="subtle" component="a" href="https://github.com/lewisblack/uiuc-course-search" target="_blank">
                    GitHub
                </Button>
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
