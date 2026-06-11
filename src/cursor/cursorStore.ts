import { create } from "zustand"

interface CursorStore {
  /** label text shown next to the pointer (null hides it) */
  text: string | null
  /** `light` renders it #e8e8e8 — the real site's `.cursor.isDark` */
  light: boolean
  setLabel(text: string | null, light?: boolean): void
}

export const useCursorStore = create<CursorStore>((set) => ({
  text: null,
  light: false,
  setLabel: (text, light = false) => set({ text, light }),
}))

export function setCursorLabel(text: string | null, light = false) {
  useCursorStore.getState().setLabel(text, light)
}
