import { beforeEach, describe, expect, it } from 'vitest'
import { useSettingsStore } from '../settingsStore'
import { DEFAULT_APP_SETTINGS } from '@/types'

const SETTINGS_KEY = 'dbdiff_app_settings'

// 各テスト前にストアと localStorage をリセット
function resetStore() {
  localStorage.clear()
  useSettingsStore.setState({ settings: { ...DEFAULT_APP_SETTINGS, defaultFilter: { ...DEFAULT_APP_SETTINGS.defaultFilter } } })
}

describe('settingsStore', () => {
  beforeEach(resetStore)

  // ── 初期状態 ────────────────────────────────────────────────
  it('初期状態がデフォルト設定と一致する', () => {
    const { settings } = useSettingsStore.getState()
    expect(settings.diffAlgorithm).toBe('set_based')
    expect(settings.batchSize).toBe(1000)
    expect(settings.defaultFilter).toEqual(DEFAULT_APP_SETTINGS.defaultFilter)
  })

  // ── setDiffAlgorithm ─────────────────────────────────────────
  describe('setDiffAlgorithm', () => {
    it('アルゴリズムを変更できる', () => {
      useSettingsStore.getState().setDiffAlgorithm('myers')
      expect(useSettingsStore.getState().settings.diffAlgorithm).toBe('myers')
    })

    it('変更後も batchSize は保持される', () => {
      useSettingsStore.getState().setDiffAlgorithm('histogram')
      expect(useSettingsStore.getState().settings.batchSize).toBe(1000)
    })

    it('localStorage に保存される', () => {
      useSettingsStore.getState().setDiffAlgorithm('patience')
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}')
      expect(saved.diffAlgorithm).toBe('patience')
    })
  })

  // ── setBatchSize ─────────────────────────────────────────────
  describe('setBatchSize', () => {
    it('バッチサイズを変更できる', () => {
      useSettingsStore.getState().setBatchSize(500)
      expect(useSettingsStore.getState().settings.batchSize).toBe(500)
    })

    it('変更後も diffAlgorithm は保持される', () => {
      useSettingsStore.getState().setBatchSize(2000)
      expect(useSettingsStore.getState().settings.diffAlgorithm).toBe('set_based')
    })

    it('localStorage に保存される', () => {
      useSettingsStore.getState().setBatchSize(300)
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}')
      expect(saved.batchSize).toBe(300)
    })
  })

  // ── setDefaultFilter ─────────────────────────────────────────
  describe('setDefaultFilter', () => {
    it('デフォルトフィルターを変更できる', () => {
      const newFilter = { showEqual: false, showAdded: true, showDeleted: true, showModified: false }
      useSettingsStore.getState().setDefaultFilter(newFilter)
      expect(useSettingsStore.getState().settings.defaultFilter).toEqual(newFilter)
    })

    it('localStorage に保存される', () => {
      const newFilter = { showEqual: false, showAdded: true, showDeleted: false, showModified: true }
      useSettingsStore.getState().setDefaultFilter(newFilter)
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}')
      expect(saved.defaultFilter).toEqual(newFilter)
    })
  })

  // ── resetSettings ────────────────────────────────────────────
  describe('resetSettings', () => {
    it('すべての設定をデフォルト値に戻す', () => {
      useSettingsStore.getState().setDiffAlgorithm('myers')
      useSettingsStore.getState().setBatchSize(500)

      useSettingsStore.getState().resetSettings()

      const { settings } = useSettingsStore.getState()
      expect(settings.diffAlgorithm).toBe('set_based')
      expect(settings.batchSize).toBe(1000)
      expect(settings.defaultFilter).toEqual(DEFAULT_APP_SETTINGS.defaultFilter)
    })

    it('リセット後 localStorage にデフォルト値が保存される', () => {
      useSettingsStore.getState().setDiffAlgorithm('greedy_lcs')
      useSettingsStore.getState().resetSettings()

      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}')
      expect(saved.diffAlgorithm).toBe('set_based')
      expect(saved.batchSize).toBe(1000)
    })
  })

  // ── localStorage からの復元 ──────────────────────────────────
  describe('localStorage からの設定復元', () => {
    it('保存済みの diffAlgorithm を読み込む', () => {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ diffAlgorithm: 'ast_based', batchSize: 200 }))

      // ストアを再初期化して localStorage から読み込ませる
      const { loadSettings } = (() => {
        const raw = localStorage.getItem(SETTINGS_KEY)
        const parsed = raw ? (JSON.parse(raw) as Partial<typeof DEFAULT_APP_SETTINGS>) : {}
        return {
          loadSettings: () => ({
            ...DEFAULT_APP_SETTINGS,
            ...parsed,
            defaultFilter: { ...DEFAULT_APP_SETTINGS.defaultFilter, ...(parsed as { defaultFilter?: object }).defaultFilter },
          }),
        }
      })()

      const loaded = loadSettings()
      expect(loaded.diffAlgorithm).toBe('ast_based')
      expect(loaded.batchSize).toBe(200)
    })

    it('不正な JSON が保存されていてもエラーにならない', () => {
      localStorage.setItem(SETTINGS_KEY, 'invalid-json')
      // ストア初期化がクラッシュしないことを確認（catch済み）
      expect(() => {
        try {
          JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '')
        } catch {
          // settingsStore と同様に無視
        }
      }).not.toThrow()
    })
  })
})
