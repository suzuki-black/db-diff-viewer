import type { ReactNode } from 'react'
import { Table, Tag, Space, Typography, Empty } from 'antd'
import type { ColumnType } from 'antd/es/table'
import type { SchemaDiffResult, ColumnDiffItem, IndexDiffItem, ColumnDiffStatus } from '@/types'

const { Text } = Typography

// ── ステータス設定 ────────────────────────────────────────
const STATUS_CFG: Record<ColumnDiffStatus, { label: string; color: string; bg: string; tagColor: string }> = {
  equal:    { label: '一致', color: '#389e0d', bg: 'transparent',  tagColor: 'success' },
  added:    { label: '追加', color: '#096dd9', bg: '#e6f4ff',      tagColor: 'processing' },
  deleted:  { label: '削除', color: '#cf1322', bg: '#fff1f0',      tagColor: 'error' },
  modified: { label: '変更', color: '#d46b08', bg: '#fff7e6',      tagColor: 'warning' },
}

function StatusTag({ status }: { status: ColumnDiffStatus }) {
  const cfg = STATUS_CFG[status]
  return (
    <Tag
      color={cfg.tagColor}
      style={{ fontWeight: 700, fontSize: 11, minWidth: 40, textAlign: 'center' }}
    >
      {cfg.label}
    </Tag>
  )
}

// ── セル値表示（null の場合は "-"）────────────────────────
function Val({ v, changed = false }: { v: string | boolean | null | undefined; changed?: boolean }) {
  if (v === null || v === undefined || v === '') {
    return <span style={{ color: '#bbb', fontStyle: 'italic', fontSize: 11 }}>—</span>
  }
  const text = typeof v === 'boolean' ? (v ? 'YES' : 'NO') : String(v)
  return (
    <span style={{ fontWeight: changed ? 700 : 400, color: changed ? '#d46b08' : undefined }}>
      {text}
    </span>
  )
}

// ── カラム差分テーブル ────────────────────────────────────
function ColumnDiffTable({
  columns,
  leftName,
  rightName,
}: {
  columns: ColumnDiffItem[]
  leftName: string
  rightName: string
}) {
  const tableColumns: ColumnType<ColumnDiffItem>[] = [
    {
      title: '状態',
      key: 'status',
      width: 70,
      render: (_, row) => <StatusTag status={row.status} />,
    },
    {
      title: 'カラム名',
      key: 'columnName',
      width: 160,
      render: (_, row) => (
        <Text strong style={{ fontSize: 12 }}>{row.columnName}</Text>
      ),
    },
    {
      title: `型 (${leftName})`,
      key: 'leftType',
      width: 140,
      render: (_, row) => (
        <Val v={row.leftColumn?.type ?? null} changed={row.changedFields?.includes('type')} />
      ),
    },
    {
      title: `型 (${rightName})`,
      key: 'rightType',
      width: 140,
      render: (_, row) => (
        <Val v={row.rightColumn?.type ?? null} changed={row.changedFields?.includes('type')} />
      ),
    },
    {
      title: `NULL許可 (${leftName})`,
      key: 'leftNullable',
      width: 110,
      render: (_, row) => (
        <Val v={row.leftColumn?.nullable ?? null} changed={row.changedFields?.includes('nullable')} />
      ),
    },
    {
      title: `NULL許可 (${rightName})`,
      key: 'rightNullable',
      width: 110,
      render: (_, row) => (
        <Val v={row.rightColumn?.nullable ?? null} changed={row.changedFields?.includes('nullable')} />
      ),
    },
    {
      title: `デフォルト値 (${leftName})`,
      key: 'leftDefault',
      width: 140,
      render: (_, row) => (
        <Val v={row.leftColumn?.defaultValue ?? null} changed={row.changedFields?.includes('default_value')} />
      ),
    },
    {
      title: `デフォルト値 (${rightName})`,
      key: 'rightDefault',
      width: 140,
      render: (_, row) => (
        <Val v={row.rightColumn?.defaultValue ?? null} changed={row.changedFields?.includes('default_value')} />
      ),
    },
    {
      title: `Extra (${leftName})`,
      key: 'leftExtra',
      width: 120,
      render: (_, row) => (
        <Val v={row.leftColumn?.extra ?? null} changed={row.changedFields?.includes('extra')} />
      ),
    },
    {
      title: `Extra (${rightName})`,
      key: 'rightExtra',
      width: 120,
      render: (_, row) => (
        <Val v={row.rightColumn?.extra ?? null} changed={row.changedFields?.includes('extra')} />
      ),
    },
  ]

  return (
    <Table<ColumnDiffItem>
      size="small"
      columns={tableColumns}
      dataSource={columns}
      rowKey="columnName"
      pagination={false}
      scroll={{ x: 'max-content' }}
      rowClassName={(row) => `schema-row-${row.status}`}
      onRow={(row) => ({
        style: {
          background: STATUS_CFG[row.status].bg,
        },
      })}
    />
  )
}

// ── インデックス差分テーブル ──────────────────────────────
function IndexDiffTable({
  indexes,
  leftName,
  rightName,
}: {
  indexes: IndexDiffItem[]
  leftName: string
  rightName: string
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function fmtIndex(idx: Record<string, any> | null): ReactNode {
    if (!idx) return <span style={{ color: '#bbb', fontStyle: 'italic', fontSize: 11 }}>—</span>
    const unique = idx.non_unique === 0 || idx.non_unique === false ? 'UNIQUE ' : ''
    const cols: string[] = Array.isArray(idx.columns)
      ? idx.columns
      : typeof idx.columns === 'string'
        ? [idx.columns]
        : []
    return (
      <Space direction="vertical" size={0}>
        <Text style={{ fontSize: 11 }}>
          {unique}INDEX ({cols.join(', ')})
        </Text>
        {idx.index_type && (
          <Text type="secondary" style={{ fontSize: 10 }}>
            {idx.index_type}
          </Text>
        )}
      </Space>
    )
  }

  const tableColumns: ColumnType<IndexDiffItem>[] = [
    {
      title: '状態',
      key: 'status',
      width: 70,
      render: (_, row) => <StatusTag status={row.status} />,
    },
    {
      title: 'インデックス名',
      key: 'indexName',
      width: 180,
      render: (_, row) => (
        <Text strong style={{ fontSize: 12 }}>{row.indexName}</Text>
      ),
    },
    {
      title: `定義 (${leftName})`,
      key: 'leftIndex',
      render: (_, row) => fmtIndex(row.leftIndex),
    },
    {
      title: `定義 (${rightName})`,
      key: 'rightIndex',
      render: (_, row) => fmtIndex(row.rightIndex),
    },
  ]

  return (
    <Table<IndexDiffItem>
      size="small"
      columns={tableColumns}
      dataSource={indexes}
      rowKey="indexName"
      pagination={false}
      scroll={{ x: 'max-content' }}
      onRow={(row) => ({
        style: {
          background: STATUS_CFG[row.status].bg,
        },
      })}
    />
  )
}

// ============================================================
// メインコンポーネント
// ============================================================

interface Props {
  result: SchemaDiffResult
  leftName: string
  rightName: string
  loading?: boolean
}

export default function SchemaDiffView({ result, leftName, rightName, loading }: Props) {
  const { columns, indexes, summary } = result

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 64, color: '#888', fontSize: 13 }}>
        テーブル構造を取得中...
      </div>
    )
  }

  if (!columns.length && !indexes.length) {
    return <Empty description="差分データがありません" style={{ padding: 40 }} />
  }

  const hasDiff =
    summary.columnsAdded + summary.columnsDeleted + summary.columnsModified +
    summary.indexesAdded + summary.indexesDeleted + summary.indexesModified > 0

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="large">
      {/* サマリーバッジ */}
      <Space wrap size="small">
        {hasDiff ? (
          <>
            {summary.columnsAdded   > 0 && <Tag color="processing">カラム追加 {summary.columnsAdded}件</Tag>}
            {summary.columnsDeleted > 0 && <Tag color="error">カラム削除 {summary.columnsDeleted}件</Tag>}
            {summary.columnsModified > 0 && <Tag color="warning">カラム変更 {summary.columnsModified}件</Tag>}
            {summary.indexesAdded   > 0 && <Tag color="processing">インデックス追加 {summary.indexesAdded}件</Tag>}
            {summary.indexesDeleted > 0 && <Tag color="error">インデックス削除 {summary.indexesDeleted}件</Tag>}
            {summary.indexesModified > 0 && <Tag color="warning">インデックス変更 {summary.indexesModified}件</Tag>}
          </>
        ) : (
          <Tag color="success">構造は完全に一致しています</Tag>
        )}
      </Space>

      {/* カラム差分 */}
      {columns.length > 0 && (
        <div>
          <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>
            📋 カラム定義 ({columns.length}件)
          </Text>
          <ColumnDiffTable columns={columns} leftName={leftName} rightName={rightName} />
        </div>
      )}

      {/* インデックス差分 */}
      {indexes.length > 0 && (
        <div>
          <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>
            🗂 インデックス ({indexes.length}件)
          </Text>
          <IndexDiffTable indexes={indexes} leftName={leftName} rightName={rightName} />
        </div>
      )}
    </Space>
  )
}
