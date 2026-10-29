import type { RelaxCodeApi } from './index'

declare global {
  interface Window {
    relaxcode: RelaxCodeApi
  }
}

export {}
