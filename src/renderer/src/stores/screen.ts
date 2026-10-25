import { create } from 'zustand'

/** One capture of the app's window after one of its tools ran. */
export interface ScreenFrame {
  id: string
  server: string
  dataUrl: string
  caption: string
  at: number
}

const FRAME_LIMIT = 60

interface ScreenState {
  /** Newest last, so the feed reads chronologically. */
  frames: ScreenFrame[]
  addFrame: (frame: Omit<ScreenFrame, 'id'>) => void
  clearFrames: (server?: string) => void
}

export const useScreenStore = create<ScreenState>((set) => ({
  frames: [],
  addFrame: (frame) =>
    set((state) => ({
      frames: [...state.frames, { ...frame, id: `${frame.at}-${Math.random().toString(36).slice(2, 8)}` }].slice(
        -FRAME_LIMIT
      )
    })),
  clearFrames: (server) =>
    set((state) => ({
      frames: server ? state.frames.filter((item) => item.server !== server) : []
    }))
}))
