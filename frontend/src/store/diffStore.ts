import { create } from 'zustand'
import type {
  TableDiffResult,
  RecordDiffResult,
  SchemaDiffResult,
  DiffFilter,
} from '@/types'
import { DEFAULT_DIFF_FILTER as defaultFilter } from '@/types'

/** テーブルごとのレコード差分サマリ（一度スキャンしたら永続キャッシュ） */
export interface RecordDiffSummary {
  total:    number
  equal:    number
  added:    number
  deleted:  number
  modified: number
}

interface DiffState {
  // テーブル差分
  tableDiffResult: TableDiffResult | null
  tableDiffLoading: boolean

  // レコード差分
  selectedTableName: string | null
  recordDiffResult: RecordDiffResult | null
  recordDiffLoading: boolean

  // スキーマ差分
  schemaDiffResult: SchemaDiffResult | null
  schemaDiffLoading: boolean

  // フィルター
  filter: DiffFilter

  // ミニマップ連動: 現在ハイライト中の行インデックス
  focusedRowIndex: number | null

  /**
   * テーブルごとのレコード差分サマリキャッシュ。
   * キーはテーブル名。一度レコード差分ジョブが完了すると登録され、
   * テーブル一覧画面でレコード差分状況を一目で確認できるようにする。
   */
  recordDiffSummaryCache: Record<string, RecordDiffSummary>

  // Actions
  setTableDiffResult: (result: TableDiffResult | null) => void
  setTableDiffLoading: (loading: boolean) => void
  setSelectedTableName: (name: string | null) => void
  setRecordDiffResult: (result: RecordDiffResult | null) => void
  setRecordDiffLoading: (loading: boolean) => void
  setSchemaDiffResult: (result: SchemaDiffResult | null) => void
  setSchemaDiffLoading: (loading: boolean) => void
  setFilter: (filter: Partial<DiffFilter>) => void
  setFocusedRowIndex: (index: number | null) => void
  /** レコード差分ジョブ完了時にサマリを記録する */
  storeRecordDiffSummary: (tableName: string, summary: RecordDiffSummary) => void
  resetDiff: () => void
}

export const useDiffStore = create<DiffState>((set) => ({
  tableDiffResult: null,
  tableDiffLoading: false,
  selectedTableName: null,
  recordDiffResult: null,
  recordDiffLoading: false,
  schemaDiffResult: null,
  schemaDiffLoading: false,
  filter: { ...defaultFilter },
  focusedRowIndex: null,
  recordDiffSummaryCache: {},

  setTableDiffResult: (result) => set({ tableDiffResult: result }),
  setTableDiffLoading: (loading) => set({ tableDiffLoading: loading }),
  setSelectedTableName: (name) => set({ selectedTableName: name, recordDiffResult: null, schemaDiffResult: null }),
  setRecordDiffResult: (result) => set({ recordDiffResult: result }),
  setRecordDiffLoading: (loading) => set({ recordDiffLoading: loading }),
  setSchemaDiffResult: (result) => set({ schemaDiffResult: result }),
  setSchemaDiffLoading: (loading) => set({ schemaDiffLoading: loading }),
  setFilter: (filter) => set((state) => ({ filter: { ...state.filter, ...filter } })),
  setFocusedRowIndex: (index) => set({ focusedRowIndex: index }),
  storeRecordDiffSummary: (tableName, summary) =>
    set((state) => ({
      recordDiffSummaryCache: { ...state.recordDiffSummaryCache, [tableName]: summary },
    })),
  resetDiff: () =>
    set({
      tableDiffResult: null,
      selectedTableName: null,
      recordDiffResult: null,
      schemaDiffResult: null,
      filter: { ...defaultFilter },
      focusedRowIndex: null,
      // recordDiffSummaryCache は意図的に保持（別セッションでも再利用）
    }),
}))
