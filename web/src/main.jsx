import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@fontsource-variable/inter'
import './index.css'
import Layout from './components/Layout'
import Home from './pages/Home'
import Transactions from './pages/Transactions'
import Budgets from './pages/Budgets'
import Recurring from './pages/Recurring'
import Debts from './pages/Debts'
import Accounts from './pages/Accounts'
import SettingsPage from './pages/Settings'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: true, retry: 1 } },
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="transactions" element={<Transactions />} />
            <Route path="budgets" element={<Budgets />} />
            <Route path="recurring" element={<Recurring />} />
            <Route path="debts" element={<Debts />} />
            <Route path="accounts" element={<Accounts />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
