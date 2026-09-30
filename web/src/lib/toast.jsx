import { useSyncExternalStore } from 'react'
import { CircleAlert, CircleCheck } from 'lucide-react'

let items = []
let nextId = 0
const listeners = new Set()
const emit = () => listeners.forEach((listener) => listener())

function show(message, kind = 'info') {
  const item = { id: ++nextId, message, kind }
  items = [...items, item]
  emit()
  setTimeout(() => {
    items = items.filter((x) => x.id !== item.id)
    emit()
  }, 3800)
}

export const toast = {
  show,
  success: (message) => show(message, 'success'),
  error: (message) => show(message, 'error'),
}

export function Toaster() {
  const list = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => items,
  )
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[70] flex flex-col items-center gap-2 px-4 md:bottom-6">
      {list.map((t) => (
        <div
          key={t.id}
          className="animate-toast flex max-w-md items-center gap-2.5 rounded-2xl bg-ink px-4 py-3 text-sm font-medium text-bg shadow-xl"
        >
          {t.kind === 'error' ? (
            <CircleAlert size={18} className="shrink-0 text-bad" />
          ) : (
            <CircleCheck size={18} className="shrink-0 text-good" />
          )}
          {t.message}
        </div>
      ))}
    </div>
  )
}
