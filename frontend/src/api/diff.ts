import apiClient from './client'
import type {
  TableDiffResult, TableDiffItem, TableDiffSummary,
  RecordDiffResult, RecordDiffItem, RecordDiffMeta, RecordDiffPage,
  SchemaDiffResult, ColumnDiffItem, ColumnInfo, IndexDiffItem,
  DiffStatus, DiffAlgorithm, JobStatus, JobPhase,
} from '@/types'

export interface TableDiffRequest {
  leftConnectionId: number
  rightConnectionId: number
}

export interface RecordDiffRequest {
  leftConnectionId: number
  rightConnectionId: number
  tableName: string
  primaryKeys?: string[]
  offset?: number
  limit?: number
}

export interface RecordDiffJobRequest {
  leftConnectionId: number
  rightConnectionId: number
  tableName: string
  primaryKeys?: string[]
  algorithm?: DiffAlgorithm
  batchSize?: number
}

export interface SchemaDiffRequest {
  leftConnectionId: number
  rightConnectionId: number
  tableName: string
}

// ============================================================
// snake_case → camelCase 変換（APIレスポンスを型に合わせる）
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toTableDiffResult(data: any): TableDiffResult {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tables: data.tables.map((item: any): TableDiffItem => ({
      status: item.status as DiffStatus,
      leftTable: item.left_table ?? null,
      rightTable: item.right_table ?? null,
      diffSummary: item.diff_summary
        ? ({
            columnsAdded: item.diff_summary.columns_added,
            columnsDeleted: item.diff_summary.columns_deleted,
            columnsModified: item.diff_summary.columns_modified,
          } satisfies TableDiffSummary)
        : undefined,
      leftCount:  item.left_count  ?? undefined,
      rightCount: item.right_count ?? undefined,
    })),
    summary: {
      total: data.summary.total,
      equal: data.summary.equal,
      added: data.summary.added,
      deleted: data.summary.deleted,
      modified: data.summary.modified,
    },
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toRecordDiffResult(data: any): RecordDiffResult {
  return {
    columns: data.columns,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    records: data.records.map((item: any): RecordDiffItem => ({
      status: item.status as DiffStatus,
      primaryKeyValue: item.primary_key_value,
      leftValues: item.left_values ?? null,
      rightValues: item.right_values ?? null,
      diffColumns: item.diff_columns ?? [],
    })),
    totalLeft: data.total_left,
    totalRight: data.total_right,
    summary: {
      total: data.summary.total,
      equal: data.summary.equal,
      added: data.summary.added,
      deleted: data.summary.deleted,
      modified: data.summary.modified,
    },
    isPartial: data.is_partial ?? false,
    partialNote: data.partial_note ?? undefined,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toRecordDiffMeta(data: any): RecordDiffMeta {
  return {
    columns: data.columns,
    totalLeft: data.total_left,
    totalRight: data.total_right,
    summary: {
      total: data.summary.total,
      equal: data.summary.equal,
      added: data.summary.added,
      deleted: data.summary.deleted,
      modified: data.summary.modified,
    },
    isPartial: data.is_partial ?? false,
    partialNote: data.partial_note ?? undefined,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toRecordDiffPage(data: any): RecordDiffPage {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    records: data.records.map((item: any): RecordDiffItem => ({
      status: item.status as DiffStatus,
      primaryKeyValue: item.primary_key_value,
      leftValues: item.left_values ?? null,
      rightValues: item.right_values ?? null,
      diffColumns: item.diff_columns ?? [],
    })),
    offset: data.offset,
    limit: data.limit,
    total: data.total,
    columns: data.columns,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toJobStatus(data: any): JobStatus {
  return {
    jobId: data.job_id,
    status: data.status as string,
    phase: data.phase as JobPhase,
    progressLeft:     data.left_progress     ?? 0,
    progressRight:    data.right_progress    ?? 0,
    totalLeft:        data.left_total        ?? 0,
    totalRight:       data.right_total       ?? 0,
    computeProgress:  data.compute_progress  ?? 0,
    computeTotal:     data.compute_total     ?? 0,
    finalizeProgress: data.finalize_progress ?? 0,
    finalizeTotal:    data.finalize_total    ?? 0,
    resultMeta: data.result_meta ? toRecordDiffMeta(data.result_meta) : undefined,
    error: data.error ?? undefined,
    tableExistsLeft:  data.table_exists_left  ?? true,
    tableExistsRight: data.table_exists_right ?? true,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toSchemaDiffResult(data: any): SchemaDiffResult {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    columns: data.columns.map((item: any): ColumnDiffItem => ({
      status: item.status as DiffStatus,
      columnName: item.column_name,
      leftColumn: item.left_column ? toColumnInfo(item.left_column) : null,
      rightColumn: item.right_column ? toColumnInfo(item.right_column) : null,
      changedFields: item.changed_fields ?? [],
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    indexes: data.indexes.map((item: any): IndexDiffItem => ({
      status: item.status as DiffStatus,
      indexName: item.index_name,
      leftIndex: item.left_index ?? null,
      rightIndex: item.right_index ?? null,
    })),
    summary: {
      columnsAdded: data.summary.columns_added,
      columnsDeleted: data.summary.columns_deleted,
      columnsModified: data.summary.columns_modified,
      indexesAdded: data.summary.indexes_added,
      indexesDeleted: data.summary.indexes_deleted,
      indexesModified: data.summary.indexes_modified,
    },
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toColumnInfo(c: any): ColumnInfo {
  return {
    name: c.name,
    type: c.type,
    nullable: c.nullable,
    defaultValue: c.default_value ?? null,
    extra: c.extra ?? '',
    comment: c.comment ?? '',
  }
}

// ============================================================
// API 関数
// ============================================================

export const diffApi = {
  /** テーブル一覧の差分を取得 */
  getTables: async (req: TableDiffRequest): Promise<TableDiffResult> => {
    const data = await apiClient.post('/diff/tables', {
      left_connection_id: req.leftConnectionId,
      right_connection_id: req.rightConnectionId,
    })
    return toTableDiffResult(data)
  },

  /** レコード差分を取得 */
  getRecords: async (req: RecordDiffRequest): Promise<RecordDiffResult> => {
    const data = await apiClient.post('/diff/records', {
      left_connection_id: req.leftConnectionId,
      right_connection_id: req.rightConnectionId,
      table_name: req.tableName,
      primary_keys: req.primaryKeys,
      offset: req.offset ?? 0,
      limit: req.limit ?? 1000,
    })
    return toRecordDiffResult(data)
  },

  /** テーブル構造（スキーマ）差分を取得 */
  getSchema: async (req: SchemaDiffRequest): Promise<SchemaDiffResult> => {
    const data = await apiClient.post('/diff/schema', {
      left_connection_id: req.leftConnectionId,
      right_connection_id: req.rightConnectionId,
      table_name: req.tableName,
    })
    return toSchemaDiffResult(data)
  },

  /** レコード差分ジョブを開始 */
  startRecordDiffJob: async (req: RecordDiffJobRequest): Promise<string> => {
    const data = await apiClient.post<{ job_id: string }>('/diff/records/jobs', {
      left_connection_id: req.leftConnectionId,
      right_connection_id: req.rightConnectionId,
      table_name: req.tableName,
      primary_keys: req.primaryKeys,
      algorithm: req.algorithm ?? 'set_based',
      batch_size: req.batchSize ?? 1000,
    })
    return data.job_id
  },

  /** ジョブ進捗・結果を取得 */
  getJobStatus: async (jobId: string): Promise<JobStatus> => {
    const data = await apiClient.get(`/diff/records/jobs/${jobId}`)
    return toJobStatus(data)
  },

  /** ジョブをキャンセル */
  cancelJob: async (jobId: string): Promise<void> => {
    await apiClient.delete(`/diff/records/jobs/${jobId}`)
  },

  /**
   * 差分レコードをページネーションで取得する
   * @param statuses 取得するステータスの配列（未指定時は全て）
   * @param signal  AbortController のシグナル（キャッシュクリア時にリクエストをキャンセルするため）
   */
  getJobResultPage: async (
    jobId: string,
    offset: number,
    limit: number,
    statuses?: DiffStatus[],
    signal?: AbortSignal,
  ): Promise<RecordDiffPage> => {
    const statusParam = statuses?.join(',') ?? 'modified,added,deleted,equal'
    const data = await apiClient.get(`/diff/records/jobs/${jobId}/result`, {
      params: { offset, limit, statuses: statusParam },
      signal,
    })
    return toRecordDiffPage(data)
  },
}
