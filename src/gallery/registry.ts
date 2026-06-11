import { create } from "zustand"
import type { GalleryCoordinator } from "./GalleryCoordinator"

export type MediaKind = "image" | "video" | "glb"

/** What a DOM `<MediaBlock>` hands the WebGL gallery: the element to track plus
 *  everything Gallery.ts used to scrape from data-attributes. */
export interface MediaItemMeta {
  id: number
  el: HTMLElement
  kind: MediaKind
  src: string
  portrait: boolean
  uri: string | null
  title: string
}

interface GalleryRegistry {
  items: MediaItemMeta[]
  register(meta: MediaItemMeta): void
  unregister(id: number): void
}

export const useGalleryRegistry = create<GalleryRegistry>((set) => ({
  items: [],
  register: (meta) => set((s) => ({ items: [...s.items, meta] })),
  unregister: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
}))

let nextId = 0
export const allocMediaId = () => nextId++

/** Live coordinator instance (set by <GalleryOverlay> once the canvas mounts). */
export const galleryApi: { current: GalleryCoordinator | null } = { current: null }

/** DOM hover handlers route here; no-op until the WebGL side is up. */
export function hoverMedia(id: number, hovered: boolean) {
  galleryApi.current?.setHover(id, hovered)
}
