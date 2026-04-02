// ============================================================
// DB接続設定
// ============================================================

export type DbType = 'mysql' | 'postgresql'

export type SshAuthType = 'password' | 'key'

export interface SshConfig {
  host: string
  port: number
  username: string
  authType: SshAuthType
  password?: string
  keyPath?: string
  localBindPort?: number
}

export interface Connection {
  id: number
  name: string
  dbType: DbType
  host: string
  port: number
  username: string
  schemaName: string
  useSsh: boolean
  ssh?: SshConfig
  createdAt: string
  updatedAt: string
}

export interface ConnectionFormValues {
  name: string
  dbType: DbType
  host: string
  port: number
  username: string
  password: string
  schemaName: string
  useSsh: boolean
  sshHost?: string
  sshPort?: number
  sshUsername?: string
  sshAuthType?: SshAuthType
  sshPassword?: string
  sshKeyPath?: string
  localBindPort?: number
}

// ============================================================
// 差分関連
// ============================================================

export type DiffStatus = 'equal' | 'added' | 'deleted' | 'modified'

export interface TableDiffSummary {
  columnsAdded: number
  columnsDeleted: number
  columnsModified: number
}

export interface TableDiffItem {
  status: DiffStatus
  leftTable: string | null
  rightTable: string | null
  diffSummary?: TableDiffSummary
  leftCount?: number   // 近似レコード数
  rightCount?: number  // 近似レコード数
}

export interface TableDiffResult {
  tables: TableDiffItem[]
  summary: {
    total: number
    equal: number
    added: number
    deleted: number
    modified: number
  }
}

// ============================================================
// レコード差分
// ============================================================

export type RecordValues = Record<string, unknown>

export interface RecordDiffItem {
  status: DiffStatus
  primaryKeyValue: string
  leftValues: RecordValues | null
  rightValues: RecordValues | null
  diffColumns: string[]
}

export interface RecordDiffResult {
  columns: string[]
  records: RecordDiffItem[]
  totalLeft: number
  totalRight: number
  summary: {
    total: number
    equal: number
    added: number
    deleted: number
    modified: number
  }
  isPartial?: boolean
  partialNote?: string
}

// ============================================================
// テーブル構造差分
// ============================================================

export type ColumnDiffStatus = 'equal' | 'added' | 'deleted' | 'modified'

export interface ColumnInfo {
  name: string
  type: string
  nullable: boolean
  defaultValue: string | null
  extra: string
  comment: string
}

export interface ColumnDiffItem {
  status: ColumnDiffStatus
  columnName: string
  leftColumn: ColumnInfo | null
  rightColumn: ColumnInfo | null
  changedFields: string[]
}

export interface SchemaDiffResult {
  columns: ColumnDiffItem[]
  indexes: IndexDiffItem[]
  summary: {
    columnsAdded: number
    columnsDeleted: number
    columnsModified: number
    indexesAdded: number
    indexesDeleted: number
    indexesModified: number
  }
}

export interface IndexDiffItem {
  status: ColumnDiffStatus
  indexName: string
  leftIndex: Record<string, unknown> | null
  rightIndex: Record<string, unknown> | null
}

// ============================================================
// UI 状態
// ============================================================

export interface SelectedDBPair {
  leftConnectionId: number | null
  rightConnectionId: number | null
}

export type ViewMode = 'table-diff' | 'record-diff'

export interface DiffFilter {
  showEqual: boolean
  showAdded: boolean
  showDeleted: boolean
  showModified: boolean
}

export const DEFAULT_DIFF_FILTER: DiffFilter = {
  showEqual: true,
  showAdded: true,
  showDeleted: true,
  showModified: true,
}

// ============================================================
// 差分アルゴリズム
// ============================================================

export type DiffAlgorithm =
  | 'myers'
  | 'patience'
  | 'histogram'
  | 'greedy_lcs'
  | 'set_based'
  | 'ast_based'

// ============================================================
// アプリ設定
// ============================================================

export interface AppSettings {
  defaultFilter: DiffFilter
  diffAlgorithm: DiffAlgorithm
  batchSize: number
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  defaultFilter: {
    showEqual: true,
    showAdded: true,
    showDeleted: true,
    showModified: true,
  },
  diffAlgorithm: 'set_based',
  batchSize: 1000,
}

// ============================================================
// ジョブ進捗
// ============================================================

export type JobPhase =
  | 'pending'
  | 'queued'
  | 'counting'
  | 'fetching_left'
  | 'fetching_right'
  | 'computing'
  | 'finalizing'   // インデックス構築中（computing → done の間）
  | 'done'
  | 'error'
  | 'cancelled'

/** レコード本体を含まないサマリーのみのメタ情報 */
export interface RecordDiffMeta {
  columns: string[]
  totalLeft: number
  totalRight: number
  summary: {
    total: number
    equal: number
    added: number
    deleted: number
    modified: number
  }
  isPartial?: boolean
  partialNote?: string
}

/** ページネーション取得レスポンス */
export interface RecordDiffPage {
  records: RecordDiffItem[]
  offset: number
  limit: number
  total: number
  columns: string[]
}

export interface JobStatus {
  jobId: string
  status: string
  phase: JobPhase
  progressLeft: number
  progressRight: number
  totalLeft: number
  totalRight: number
  computeProgress: number
  computeTotal: number
  /** finalizing フェーズ（インデックス構築）の進捗 */
  finalizeProgress: number
  finalizeTotal: number
  /** result_meta: レコード本体なし・サマリーのみ */
  resultMeta?: RecordDiffMeta
  error?: string
  /** 左DBにテーブルが存在するか（片方のみ存在するケース対応） */
  tableExistsLeft: boolean
  /** 右DBにテーブルが存在するか（片方のみ存在するケース対応） */
  tableExistsRight: boolean
}

// ============================================================
// API レスポンス共通
// ============================================================

export interface ApiError {
  detail: string
}

export interface ConnectionTestResult {
  success: boolean
  message: string
  latencyMs?: number
}
