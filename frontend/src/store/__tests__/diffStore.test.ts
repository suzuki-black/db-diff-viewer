import { beforeEach, describe, expect, it } from 'vitest'
import { useDiffStore, type RecordDiffSummary } from '../diffStore'
import { DEFAULT_DIFF_FILTER } from '@/types'

// テスト用ダミーデータ
const DUMMY_SUMMARY: RecordDiffSummary = {
  total: 10, equal: 5, added: 2, deleted: 1, modified: 2,
}

// 各テスト前にストアをリセット
function resetStore() {
  useDiffStore.setState({
    tableDiffResult: null,
    tableDiffLoading: false,
    selectedTableName: null,
    recordDiffResult: null,
    recordDiffLoading: false,
    schemaDiffResult: null,
    schemaDiffLoading: false,
    filter: { ...DEFAULT_DIFF_FILTER },
    focusedRowIndex: null,
    recordDiffSummaryCache: {},
  })
}

describe('diffStore', () => {
  beforeEach(resetStore)

  // ── 初期状態 ────────────────────────────────────────────────
  it('初期状態が正しい', () => {
    const s = useDiffStore.getState()
    expect(s.tableDiffResult).toBeNull()
    expect(s.selectedTableName).toBeNull()
    expect(s.recordDiffResult).toBeNull()
    expect(s.schemaDiffResult).toBeNull()
    expect(s.filter).toEqual(DEFAULT_DIFF_FILTER)
    expect(s.recordDiffSummaryCache).toEqual({})
  })

  // ── setSelectedTableName ─────────────────────────────────────
  describe('setSelectedTableName', () => {
    it('テーブル名を設定する', () => {
      useDiffStore.getState().setSelectedTableName('users')
      expect(useDiffStore.getState().selectedTableName).toBe('users')
    })

    it('recordDiffResult と schemaDiffResult を同時にリセットする', () => {
      // 事前にダミーを入れる
      useDiffStore.setState({
        recordDiffResult: {
          columns: ['id'],
          records: [],
          totalLeft: 0,
          totalRight: 0,
          summary: { total: 0, equal: 0, added: 0, deleted: 0, modified: 0 },
        },
        schemaDiffResult: {
          columns: [],
          indexes: [],
          summary: {
            columnsAdded: 0, columnsDeleted: 0, columnsModified: 0,
            indexesAdded: 0, indexesDeleted: 0, indexesModified: 0,
          },
        },
      })

      useDiffStore.getState().setSelectedTableName('orders')

      const s = useDiffStore.getState()
      expect(s.selectedTableName).toBe('orders')
      expect(s.recordDiffResult).toBeNull()
      expect(s.schemaDiffResult).toBeNull()
    })

    it('null を渡すとテーブル選択を解除する', () => {
      useDiffStore.getState().setSelectedTableName('users')
      useDiffStore.getState().setSelectedTableName(null)
      expect(useDiffStore.getState().selectedTableName).toBeNull()
    })
  })

  // ── setFilter ────────────────────────────────────────────────
  describe('setFilter', () => {
    it('指定したフィールドのみ更新し他を保持する', () => {
      useDiffStore.getState().setFilter({ showEqual: false })

      const { filter } = useDiffStore.getState()
      expect(filter.showEqual).toBe(false)
      expect(filter.showAdded).toBe(true)
      expect(filter.showDeleted).toBe(true)
      expect(filter.showModified).toBe(true)
    })

    it('複数フィールドを同時に更新できる', () => {
      useDiffStore.getState().setFilter({ showEqual: false, showAdded: false })

      const { filter } = useDiffStore.getState()
      expect(filter.showEqual).toBe(false)
      expect(filter.showAdded).toBe(false)
    })
  })

  // ── storeRecordDiffSummary ───────────────────────────────────
  describe('storeRecordDiffSummary', () => {
    it('サマリをキャッシュに追加する', () => {
      useDiffStore.getState().storeRecordDiffSummary('users', DUMMY_SUMMARY)
      expect(useDiffStore.getState().recordDiffSummaryCache['users']).toEqual(DUMMY_SUMMARY)
    })

    it('複数テーブルのサマリを独立して保持する', () => {
      const summary2: RecordDiffSummary = { total: 5, equal: 5, added: 0, deleted: 0, modified: 0 }
      useDiffStore.getState().storeRecordDiffSummary('users', DUMMY_SUMMARY)
      useDiffStore.getState().storeRecordDiffSummary('orders', summary2)

      const cache = useDiffStore.getState().recordDiffSummaryCache
      expect(cache['users']).toEqual(DUMMY_SUMMARY)
      expect(cache['orders']).toEqual(summary2)
    })

    it('既存エントリを上書き更新できる', () => {
      const updated: RecordDiffSummary = { total: 20, equal: 18, added: 1, deleted: 1, modified: 0 }
      useDiffStore.getState().storeRecordDiffSummary('users', DUMMY_SUMMARY)
      useDiffStore.getState().storeRecordDiffSummary('users', updated)

      expect(useDiffStore.getState().recordDiffSummaryCache['users']).toEqual(updated)
    })
  })

  // ── resetDiff ────────────────────────────────────────────────
  describe('resetDiff', () => {
    it('差分結果・選択・フィルターをリセットする', () => {
      useDiffStore.getState().setSelectedTableName('users')
      useDiffStore.getState().setFilter({ showEqual: false })

      useDiffStore.getState().resetDiff()

      const s = useDiffStore.getState()
      expect(s.selectedTableName).toBeNull()
      expect(s.tableDiffResult).toBeNull()
      expect(s.filter).toEqual(DEFAULT_DIFF_FILTER)
    })

    it('recordDiffSummaryCache は resetDiff 後も保持される', () => {
      useDiffStore.getState().storeRecordDiffSummary('users', DUMMY_SUMMARY)

      useDiffStore.getState().resetDiff()

      expect(useDiffStore.getState().recordDiffSummaryCache['users']).toEqual(DUMMY_SUMMARY)
    })
  })

  // ── ローディングフラグ ───────────────────────────────────────
  it('setTableDiffLoading でローディング状態を切り替える', () => {
    useDiffStore.getState().setTableDiffLoading(true)
    expect(useDiffStore.getState().tableDiffLoading).toBe(true)

    useDiffStore.getState().setTableDiffLoading(false)
    expect(useDiffStore.getState().tableDiffLoading).toBe(false)
  })

  it('setFocusedRowIndex でハイライト行を設定・解除できる', () => {
    useDiffStore.getState().setFocusedRowIndex(42)
    expect(useDiffStore.getState().focusedRowIndex).toBe(42)

    useDiffStore.getState().setFocusedRowIndex(null)
    expect(useDiffStore.getState().focusedRowIndex).toBeNull()
  })
})
