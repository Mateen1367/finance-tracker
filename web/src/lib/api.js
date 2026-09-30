import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from './toast'

async function request(method, path, body) {
  const isForm = body instanceof FormData
  const res = await fetch(`/api${path}`, {
    method,
    headers: body && !isForm ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  })
  const data = (res.headers.get('content-type') || '').includes('json') ? await res.json() : await res.text()
  if (!res.ok) {
    const detail = data?.detail
    throw new Error(typeof detail === 'string' ? detail : detail ? 'Please check the form and try again.' : `Request failed (${res.status})`)
  }
  return data
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  patch: (path, body) => request('PATCH', path, body),
  put: (path, body) => request('PUT', path, body),
  del: (path) => request('DELETE', path),
}

export function qs(params) {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false)
  return entries.length ? `?${new URLSearchParams(entries)}` : ''
}

export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => api.get('/settings') })
export const useSummary = (month) =>
  useQuery({ queryKey: ['summary', month], queryFn: () => api.get(`/summary${qs({ month })}`), placeholderData: keepPreviousData })
export const useTransactions = (filters) =>
  useQuery({ queryKey: ['transactions', filters], queryFn: () => api.get(`/transactions${qs(filters)}`), placeholderData: keepPreviousData })
export const useAccounts = () => useQuery({ queryKey: ['accounts'], queryFn: () => api.get('/accounts') })
export const useCategories = () => useQuery({ queryKey: ['categories'], queryFn: () => api.get('/categories') })
export const useRules = () => useQuery({ queryKey: ['rules'], queryFn: () => api.get('/rules') })
export const useDebts = () => useQuery({ queryKey: ['debts'], queryFn: () => api.get('/debts') })
export const usePlan = (extra) =>
  useQuery({ queryKey: ['plan', extra], queryFn: () => api.get(`/debts/plan${qs({ extra })}`), placeholderData: keepPreviousData })
export const useRecurring = () => useQuery({ queryKey: ['recurring'], queryFn: () => api.get('/recurring') })
export const useItems = () => useQuery({ queryKey: ['items'], queryFn: () => api.get('/items') })

/** A mutation that refreshes every screen afterwards and shows errors as a toast. */
export function useAction(fn, { onSuccess } = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: async (data, vars) => {
      await queryClient.invalidateQueries()
      onSuccess?.(data, vars)
    },
    onError: (e) => toast.error(e.message),
  })
}
