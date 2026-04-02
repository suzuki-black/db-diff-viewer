import { create } from 'zustand'
import { connectionsApi } from '@/api/connections'
import type { Connection, SelectedDBPair } from '@/types'

// localStorage キー
const PAIR_STORAGE_KEY = 'dbdiff_last_selected_pair'

function loadSavedPair(): SelectedDBPair {
  try {
    const raw = localStorage.getItem(PAIR_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SelectedDBPair>
      return {
        leftConnectionId:  parsed.leftConnectionId  ?? null,
        rightConnectionId: parsed.rightConnectionId ?? null,
      }
    }
  } catch {
    // localStorage 読み取り失敗は無視
  }
  return { leftConnectionId: null, rightConnectionId: null }
}

function savePair(pair: SelectedDBPair): void {
  try {
    localStorage.setItem(PAIR_STORAGE_KEY, JSON.stringify(pair))
  } catch {
    // localStorage 書き込み失敗は無視
  }
}

function clearSavedPair(): void {
  try {
    localStorage.removeItem(PAIR_STORAGE_KEY)
  } catch {
    // ignore
  }
}

interface ConnectionState {
  connections: Connection[]
  loading: boolean
  selectedPair: SelectedDBPair
  // Actions
  fetchConnections: () => Promise<void>
  addConnection: (c: Connection) => void
  updateConnection: (c: Connection) => void
  removeConnection: (id: number) => void
  setSelectedPair: (pair: Partial<SelectedDBPair>) => void
  clearSelectedPair: () => void
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  connections: [],
  loading: false,
  // 前回の選択ペアを復元
  selectedPair: loadSavedPair(),

  fetchConnections: async () => {
    set({ loading: true })
    try {
      const connections = await connectionsApi.list()
      set({ connections })
      // 復元されたIDが実在するか検証。片方でも存在しなければクリア
      const { selectedPair } = get()
      const ids = new Set(connections.map(c => c.id))
      const leftValid  = selectedPair.leftConnectionId  === null || ids.has(selectedPair.leftConnectionId)
      const rightValid = selectedPair.rightConnectionId === null || ids.has(selectedPair.rightConnectionId)
      if (!leftValid || !rightValid) {
        const cleaned: SelectedDBPair = {
          leftConnectionId:  leftValid  ? selectedPair.leftConnectionId  : null,
          rightConnectionId: rightValid ? selectedPair.rightConnectionId : null,
        }
        set({ selectedPair: cleaned })
        savePair(cleaned)
      }
    } finally {
      set({ loading: false })
    }
  },

  addConnection: (c) => {
    set((state) => ({ connections: [...state.connections, c] }))
  },

  updateConnection: (c) => {
    set((state) => ({
      connections: state.connections.map((existing) => (existing.id === c.id ? c : existing)),
    }))
  },

  removeConnection: (id) => {
    set((state) => {
      const newPair: SelectedDBPair = {
        leftConnectionId:
          state.selectedPair.leftConnectionId === id ? null : state.selectedPair.leftConnectionId,
        rightConnectionId:
          state.selectedPair.rightConnectionId === id ? null : state.selectedPair.rightConnectionId,
      }
      savePair(newPair)
      return {
        connections: state.connections.filter((c) => c.id !== id),
        selectedPair: newPair,
      }
    })
  },

  setSelectedPair: (pair) => {
    set((state) => {
      const newPair = { ...state.selectedPair, ...pair }
      savePair(newPair)
      return { selectedPair: newPair }
    })
  },

  clearSelectedPair: () => {
    clearSavedPair()
    set({ selectedPair: { leftConnectionId: null, rightConnectionId: null } })
  },
}))
