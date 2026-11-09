import { createBrowserRouter } from 'react-router'
import { AppLayout } from './components/layout/AppLayout'
import { ChatPageKeyed } from './pages/ChatPageKeyed'
import { HomePage } from './pages/HomePage'
import { JobDetailPage } from './pages/JobDetailPage'
import { JobsPage } from './pages/JobsPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { SourcesPage } from './pages/SourcesPage'

export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { path: '/', element: <HomePage /> },
      // keyed by id so switching conversations remounts the Flue session
      { path: '/c/:conversationId', element: <ChatPageKeyed /> },
      { path: '/jobs', element: <JobsPage /> },
      { path: '/jobs/:jobId', element: <JobDetailPage /> },
      { path: '/sources', element: <SourcesPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])

