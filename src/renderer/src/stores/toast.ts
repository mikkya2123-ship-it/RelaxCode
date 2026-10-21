import { create } from 'zustand'
import { useSettingsStore } from '@/stores/settings'

export interface ToastItem {
  id: number
  title: string
  description?: string
  variant: 'default' | 'error'
}

interface ToastState {
  toasts: ToastItem[]
  toast: (item: Omit<ToastItem, 'id'>) => void
  dismiss: (id: number) => void
}

let nextId = 1

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  toast: (item) => {
    const id = nextId++
    set((s) => ({ toasts: [...s.toasts, { ...item, id }] }))
    const notifications = useSettingsStore.getState().settings?.notifications
    if (item.variant === 'error' && notifications?.errorsSticky) return
    const seconds = Math.max(1, notifications?.toastSeconds ?? 4)
    // An error is worth reading twice as long as a confirmation.
    const timeout = item.variant === 'error' ? Math.max(seconds, 6) : seconds
    setTimeout(() => get().dismiss(id), timeout * 1000)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))

export function toast(title: string, description?: string, variant: 'default' | 'error' = 'default'): void {
  useToastStore.getState().toast({ title, description, variant })
}
