/**
 * UI Zustand store — manages panel visibility and selection state.
 *
 * Right panel shows Config/Results tabs when a node is selected.
 * Settings panel is a separate toggle.
 */
import { create } from 'zustand'

export interface UIState {
  selectedNodeId: string | null
  selectedNodeIds: Set<string>
  showNodeConfig: boolean
  showResults: boolean
  showSettings: boolean
  showNodePalette: boolean
  showWorkflowPanel: boolean
  /** Shared left sidebar width for both Workflows and Nodes panels */
  sidebarWidth: number
  previewSrc: string | null
  previewItems: string[]
  previewIndex: number
  /** Naming dialog state */
  showNamingDialog: boolean
  namingDialogDefault: string
  namingDialogResolve: ((result: { name: string; overwriteId?: string } | null) => void) | null
  /** Canvas interaction mode: 'select' for marquee selection, 'hand' for pan */
  interactionMode: 'select' | 'hand'

  selectNode: (nodeId: string | null) => void
  selectNodes: (nodeIds: string[]) => void
  setInteractionMode: (mode: 'select' | 'hand') => void
  toggleNodeConfig: () => void
  toggleResults: () => void
  toggleSettings: () => void
  toggleNodePalette: () => void
  toggleWorkflowPanel: () => void
  setSidebarWidth: (width: number) => void
  openPreview: (src: string, items?: string[]) => void
  prevPreview: () => void
  nextPreview: () => void
  closePreview: () => void
  /** Show naming dialog and return a promise that resolves with the name (+ optional overwrite id) or null */
  promptWorkflowName: (defaultName?: string) => Promise<{ name: string; overwriteId?: string } | null>
  resolveNamingDialog: (result: { name: string; overwriteId?: string } | null) => void
}

export const useUIStore = create<UIState>((set, get) => ({
  selectedNodeId: null,
  selectedNodeIds: new Set<string>(),
  showNodeConfig: true,
  showResults: false,
  showSettings: false,
  showNodePalette: true,
  showWorkflowPanel: false,
  sidebarWidth: 220,
  previewSrc: null,
  previewItems: [],
  previewIndex: -1,
  showNamingDialog: false,
  namingDialogDefault: '',
  namingDialogResolve: null,
  interactionMode: 'hand',

  selectNode: (nodeId) => set({
    selectedNodeId: nodeId,
    selectedNodeIds: nodeId ? new Set([nodeId]) : new Set(),
    showSettings: false
  }),

  selectNodes: (nodeIds) => set({
    selectedNodeId: nodeIds.length === 1 ? nodeIds[0] : nodeIds.length > 0 ? nodeIds[nodeIds.length - 1] : null,
    selectedNodeIds: new Set(nodeIds),
    showSettings: false
  }),

  setInteractionMode: (mode) => set({ interactionMode: mode }),

  toggleNodeConfig: () => set(s => ({ showNodeConfig: !s.showNodeConfig })),
  toggleResults: () => set(s => ({ showResults: !s.showResults })),
  toggleSettings: () => set(s => ({ showSettings: !s.showSettings, selectedNodeId: s.showSettings ? s.selectedNodeId : null })),
  toggleNodePalette: () => set(s => ({ showNodePalette: !s.showNodePalette, showWorkflowPanel: false })),
  toggleWorkflowPanel: () => set(s => ({ showWorkflowPanel: !s.showWorkflowPanel, showNodePalette: false })),
  setSidebarWidth: (width) => set({ sidebarWidth: Math.max(180, Math.min(400, width)) }),
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
    return new Promise<{ name: string; overwriteId?: string } | null>(resolve => {
      set({ showNamingDialog: true, namingDialogDefault: defaultName, namingDialogResolve: resolve })
    })
  },

  resolveNamingDialog: (result) => {
    const { namingDialogResolve } = get()
    if (namingDialogResolve) namingDialogResolve(result)
    set({ showNamingDialog: false, namingDialogResolve: null })
  }
}))
