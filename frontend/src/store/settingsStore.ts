import { create } from 'zustand'
import type { AppSettings, DiffAlgorithm, DiffFilter } from '@/types'
import { DEFAULT_APP_SETTINGS } from '@/types'

const SETTINGS_KEY = 'dbdiff_app_settings'

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppSettings>
      return {
        defaultFilter: { ...DEFAULT_APP_SETTINGS.defaultFilter, ...parsed.defaultFilter },
        diffAlgorithm: parsed.diffAlgorithm ?? DEFAULT_APP_SETTINGS.diffAlgorithm,
        batchSize: parsed.batchSize ?? DEFAULT_APP_SETTINGS.batchSize,
      }
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_APP_SETTINGS }
}

function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // ignore
  }
}

interface SettingsState {
  settings: AppSettings
  setDefaultFilter: (filter: DiffFilter) => void
  setDiffAlgorithm: (algo: DiffAlgorithm) => void
  setBatchSize: (size: number) => void
  resetSettings: () => void
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: loadSettings(),

  setDefaultFilter: (filter) => {
    set((state) => {
      const next = { ...state.settings, defaultFilter: filter }
      saveSettings(next)
      return { settings: next }
    })
  },

  setDiffAlgorithm: (algo) => {
    set((state) => {
      const next = { ...state.settings, diffAlgorithm: algo }
      saveSettings(next)
      return { settings: next }
    })
  },

  setBatchSize: (size) => {
    set((state) => {
      const next = { ...state.settings, batchSize: size }
      saveSettings(next)
      return { settings: next }
    })
  },

  resetSettings: () => {
    const def = { ...DEFAULT_APP_SETTINGS }
    saveSettings(def)
    set({ settings: def })
  },
}))
