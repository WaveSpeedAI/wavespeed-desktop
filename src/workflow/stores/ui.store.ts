/**
 * UI Zustand store — manages panel visibility and selection state.
 *
 * Right panel shows Config/Results tabs when a node is selected.
 * Settings panel is a separate toggle.
 */
import { create } from 'zustand'

export interface UIState {
  selectedNodeId: string | null
  showNodeConfig: boolean
  showResults: boolean
  showSettings: boolean
  showNodePalette: boolean
  showWorkflowPanel: boolean
  previewSrc: string | null
  previewItems: string[]
  previewIndex: number
  /** Naming dialog state */
  showNamingDialog: boolean
  namingDialogDefault: string
  namingDialogResolve: ((name: string | null) => void) | null

  selectNode: (nodeId: string | null) => void
  toggleNodeConfig: () => void
  toggleResults: () => void
  toggleSettings: () => void
  toggleNodePalette: () => void
  toggleWorkflowPanel: () => void
  openPreview: (src: string, items?: string[]) => void
  prevPreview: () => void
  nextPreview: () => void
  closePreview: () => void
  /** Show naming dialog and return a promise that resolves with the name or null */
  promptWorkflowName: (defaultName?: string) => Promise<string | null>
  resolveNamingDialog: (name: string | null) => void
}

export const useUIStore = create<UIState>((set, get) => ({
  selectedNodeId: null,
  showNodeConfig: true,
  showResults: false,
  showSettings: false,
  showNodePalette: true,
  showWorkflowPanel: false,
  previewSrc: null,
  previewItems: [],
  previewIndex: -1,
  showNamingDialog: false,
  namingDialogDefault: '',
  namingDialogResolve: null,

  selectNode: (nodeId) => set({
    selectedNodeId: nodeId,
    showSettings: false
  }),

  toggleNodeConfig: () => set(s => ({ showNodeConfig: !s.showNodeConfig })),
  toggleResults: () => set(s => ({ showResults: !s.showResults })),
  toggleSettings: () => set(s => ({ showSettings: !s.showSettings, selectedNodeId: s.showSettings ? s.selectedNodeId : null })),
  toggleNodePalette: () => set(s => ({ showNodePalette: !s.showNodePalette, showWorkflowPanel: false })),
  toggleWorkflowPanel: () => set(s => ({ showWorkflowPanel: !s.showWorkflowPanel, showNodePalette: false })),
  openPreview: (src, items) => set(() => {
    const list = Array.isArray(items) && items.length > 0 ? items : [src]
    const idx = Math.max(0, list.indexOf(src))
    return {
      previewSrc: src,
      previewItems: list,
      previewIndex: idx
    }
  }),
  prevPreview: () => set(s => {
    if (s.previewItems.length <= 1 || s.previewIndex < 0) return {}
    const nextIndex = (s.previewIndex - 1 + s.previewItems.length) % s.previewItems.length
    return { previewIndex: nextIndex, previewSrc: s.previewItems[nextIndex] ?? s.previewSrc }
  }),
  nextPreview: () => set(s => {
    if (s.previewItems.length <= 1 || s.previewIndex < 0) return {}
    const nextIndex = (s.previewIndex + 1) % s.previewItems.length
    return { previewIndex: nextIndex, previewSrc: s.previewItems[nextIndex] ?? s.previewSrc }
  }),
  closePreview: () => set({ previewSrc: null, previewItems: [], previewIndex: -1 }),

  promptWorkflowName: (defaultName = '') => {
    return new Promise<string | null>(resolve => {
      set({ showNamingDialog: true, namingDialogDefault: defaultName, namingDialogResolve: resolve })
    })
  },

  resolveNamingDialog: (name) => {
    const { namingDialogResolve } = get()
    if (namingDialogResolve) namingDialogResolve(name)
    set({ showNamingDialog: false, namingDialogResolve: null })
  }
}))
