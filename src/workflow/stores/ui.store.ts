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
  previewSrc: string | null
  /** Naming dialog state */
  showNamingDialog: boolean
  namingDialogDefault: string
  namingDialogResolve: ((name: string | null) => void) | null

  selectNode: (nodeId: string | null) => void
  toggleNodeConfig: () => void
  toggleResults: () => void
  toggleSettings: () => void
  toggleNodePalette: () => void
  openPreview: (src: string) => void
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
  previewSrc: null,
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
  toggleNodePalette: () => set(s => ({ showNodePalette: !s.showNodePalette })),
  openPreview: (src) => set({ previewSrc: src }),
  closePreview: () => set({ previewSrc: null }),

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
