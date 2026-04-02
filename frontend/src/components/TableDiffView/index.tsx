import { useRef, useCallback, useState, useMemo } from 'react'
import { Card, Tag, Space, Checkbox, Empty, Statistic, Row, Col, Typography, Tooltip } from 'antd'
import { TableOutlined, QuestionCircleOutlined } from '@ant-design/icons'
import { useDiffStore } from '@/store/diffStore'
import { useConnectionStore } from '@/store/connectionStore'
import { useSettingsStore } from '@/store/settingsStore'
import type { TableDiffItem, DiffStatus, DiffFilter } from '@/types'
import DiffMinimap, { type MinimapSegment } from '@/components/DiffMinimap'

const { Text } = Typography

// ── レイアウト定数 ─────────────────────────────────────────
const ROW_H           = 52   // 2行分の情報を収めるため高さを増やす
const DB_BANNER_H     = 30
const SCHEMA_COL_W    = 120  // スキーマ差分列（旧: 状態列）
const RECORD_COL_W    = 140  // レコード差分列（新設）

// ── ステータス設定 ─────────────────────────────────────────
const STATUS_CFG: Record<DiffStatus, { label: string; color: string; bg: string; rowBg: string; tagColor: string }> = {
  equal:    { label: '一致', color: '#389e0d', bg: '#f6ffed', rowBg: 'transparent', tagColor: 'success'  },
  added:    { label: '追加', color: '#096dd9', bg: '#e6f4ff', rowBg: '#e6f4ff',     tagColor: 'blue'     },
  deleted:  { label: '削除', color: '#cf1322', bg: '#fff1f0', rowBg: '#fff1f0',     tagColor: 'error'    },
  modified: { label: '変更', color: '#d46b08', bg: '#fff7e6', rowBg: '#fff7e6',     tagColor: 'warning'  },
}

// ── "このDBには存在しません" ─────────────────────────────────
function NotExistCell() {
  return (
    <div
      style={{
        flex: 1, height: ROW_H,
        display: 'flex', alignItems: 'center',
        padding: '0 12px', fontSize: 12,
        color: '#bbb', fontStyle: 'italic',
        background: 'repeating-linear-gradient(45deg, transparent, transparent 5px, rgba(0,0,0,0.025) 5px, rgba(0,0,0,0.025) 10px)',
      }}
    >
      このDBには存在しません
    </div>
  )
}

// ── テーブル名セル ────────────────────────────────────────
function TableNameCell({
  name, status, isLeft, count, otherCount,
}: {
  name: string; status: DiffStatus; isLeft: boolean
  count?: number; otherCount?: number
}) {
  // 件数が両方あり、かつ異なる場合に強調
  const countsDiffer = count !== undefined && otherCount !== undefined && count !== otherCount
  return (
    <Tooltip title={name} placement={isLeft ? 'right' : 'left'}>
      <div
        style={{
          flex: 1, height: ROW_H,
          display: 'flex', alignItems: 'center',
          padding: '0 12px', gap: 6,
          overflow: 'hidden',
        }}
      >
        <TableOutlined style={{ color: STATUS_CFG[status].color, flexShrink: 0, fontSize: 13 }} />
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', gap: 1 }}>
          <Text
            style={{
              fontSize: 13,
              fontWeight: status !== 'equal' ? 600 : 400,
              color: status !== 'equal' ? STATUS_CFG[status].color : '#333',
              overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
            }}
          >
            {name}
          </Text>
          {count !== undefined && (
            <Text
              style={{
                fontSize: 11,
                // 件数が食い違う場合はオレンジ強調
                color: countsDiffer ? '#d46b08' : '#999',
                fontWeight: countsDiffer ? 700 : 400,
                whiteSpace: 'nowrap',
              }}
            >
              {count.toLocaleString()} 件
              {countsDiffer && ' ⚠'}
            </Text>
          )}
        </div>
      </div>
    </Tooltip>
  )
}

// ── フィルターチェックボックス ──────────────────────────────
function FilterCheckboxes({ filter, onChange }: {
  filter: DiffFilter
  onChange: (f: DiffFilter) => void
}) {
  return (
    <Space size="middle" wrap>
      {(
        [
          { key: 'showEqual',    status: 'equal'    as DiffStatus },
          { key: 'showAdded',    status: 'added'    as DiffStatus },
          { key: 'showDeleted',  status: 'deleted'  as DiffStatus },
          { key: 'showModified', status: 'modified' as DiffStatus },
        ] as { key: keyof DiffFilter; status: DiffStatus }[]
      ).map(({ key, status }) => (
        <Checkbox
          key={key}
          checked={filter[key]}
          onChange={(e) => onChange({ ...filter, [key]: e.target.checked })}
        >
          <Text style={{ color: STATUS_CFG[status].color, fontWeight: 600, fontSize: 12 }}>
            {STATUS_CFG[status].label}
          </Text>
        </Checkbox>
      ))}
    </Space>
  )
}

// ── メインコンポーネント ──────────────────────────────────
export default function TableDiffView() {
  const {
    tableDiffResult, tableDiffLoading,
    focusedRowIndex, setFocusedRowIndex,
    setSelectedTableName,
    recordDiffSummaryCache,
  } = useDiffStore()
  const { connections, selectedPair } = useConnectionStore()
  const { settings } = useSettingsStore()

  const [filter, setFilter] = useState<DiffFilter>(() => ({ ...settings.defaultFilter }))

  const leftConn  = connections.find(c => c.id === selectedPair.leftConnectionId)
  const rightConn = connections.find(c => c.id === selectedPair.rightConnectionId)
  const leftLabel  = leftConn  ? `◀ ${leftConn.name}  (${leftConn.schemaName})` : '◀ 左DB'
  const rightLabel = rightConn ? `▶ ${rightConn.name}  (${rightConn.schemaName})` : '▶ 右DB'

  // スクロール連動 ref
  const leftListRef   = useRef<HTMLDivElement>(null)
  const rightListRef  = useRef<HTMLDivElement>(null)
  const statusListRef = useRef<HTMLDivElement>(null)
  const recordListRef = useRef<HTMLDivElement>(null)
  const isSyncing     = useRef(false)

  const allRows: TableDiffItem[] = tableDiffResult?.tables ?? []

  const displayRows = allRows.filter(row => {
    if (row.status === 'equal'    && !filter.showEqual)    return false
    if (row.status === 'added'    && !filter.showAdded)    return false
    if (row.status === 'deleted'  && !filter.showDeleted)  return false
    if (row.status === 'modified' && !filter.showModified) return false
    return true
  })

  const summary = tableDiffResult?.summary ?? { total: 0, equal: 0, added: 0, deleted: 0, modified: 0 }

  const minimapSegments = useMemo((): MinimapSegment[] => {
    const segs: MinimapSegment[] = []
    for (const row of displayRows) {
      const last = segs[segs.length - 1]
      if (last?.status === row.status) last.count++
      else segs.push({ status: row.status as DiffStatus, count: 1 })
    }
    return segs
  }, [displayRows])

  // ── スクロール連動 ────────────────────────────────────────
  const syncFrom = useCallback((source: HTMLDivElement, others: (HTMLDivElement | null)[]) => {
    if (isSyncing.current) return
    isSyncing.current = true
    for (const el of others) {
      if (el) { el.scrollTop = source.scrollTop; el.scrollLeft = source.scrollLeft }
    }
    requestAnimationFrame(() => { isSyncing.current = false })
  }, [])

  const onLeftScroll   = useCallback((e: React.UIEvent<HTMLDivElement>) =>
    syncFrom(e.currentTarget, [rightListRef.current, statusListRef.current, recordListRef.current]), [syncFrom])
  const onRightScroll  = useCallback((e: React.UIEvent<HTMLDivElement>) =>
    syncFrom(e.currentTarget, [leftListRef.current,  statusListRef.current, recordListRef.current]), [syncFrom])
  const onStatusScroll = useCallback((e: React.UIEvent<HTMLDivElement>) =>
    syncFrom(e.currentTarget, [leftListRef.current,  rightListRef.current,  recordListRef.current]), [syncFrom])
  const onRecordScroll = useCallback((e: React.UIEvent<HTMLDivElement>) =>
    syncFrom(e.currentTarget, [leftListRef.current,  rightListRef.current,  statusListRef.current]), [syncFrom])

  if (!tableDiffResult && !tableDiffLoading) {
    return (
      <Card>
        <Empty description="左右のDBを選択して「比較開始」を押してください" />
      </Card>
    )
  }

  const listH = 'calc(100vh - 420px)'

  return (
    <Card
      title="テーブル差分一覧"
      loading={tableDiffLoading}
      extra={<FilterCheckboxes filter={filter} onChange={setFilter} />}
      styles={{ body: { paddingTop: 8 } }}
    >
      {/* DB ペア情報 */}
      {(leftConn || rightConn) && (
        <Row gutter={16} style={{ marginBottom: 8 }}>
          {leftConn && (
            <Col>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px', background: '#e6f4ff', borderRadius: 6, border: '1px solid #91caff' }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#1677ff', flexShrink: 0 }} />
                <Text style={{ fontSize: 12, fontWeight: 700, color: '#003eb3' }}>{leftConn.name}</Text>
                <Text style={{ fontSize: 12, color: '#555' }}>スキーマ: <strong>{leftConn.schemaName}</strong></Text>
                <Text style={{ fontSize: 12, color: '#555' }}>テーブル数: <strong>{allRows.filter(r => r.leftTable).length}</strong></Text>
              </div>
            </Col>
          )}
          {rightConn && (
            <Col>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px', background: '#f6ffed', borderRadius: 6, border: '1px solid #b7eb8f' }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#389e0d', flexShrink: 0 }} />
                <Text style={{ fontSize: 12, fontWeight: 700, color: '#135200' }}>{rightConn.name}</Text>
                <Text style={{ fontSize: 12, color: '#555' }}>スキーマ: <strong>{rightConn.schemaName}</strong></Text>
                <Text style={{ fontSize: 12, color: '#555' }}>テーブル数: <strong>{allRows.filter(r => r.rightTable).length}</strong></Text>
              </div>
            </Col>
          )}
        </Row>
      )}

      {/* サマリ統計 — スキーマ構造ベースであることを明記 */}
      <div style={{ marginBottom: 10, padding: '8px 12px', background: '#fafafa', borderRadius: 6, border: '1px solid #f0f0f0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <Text style={{ fontSize: 11, color: '#888', fontWeight: 600 }}>
            スキーマ（テーブル構造）比較結果
          </Text>
          <Tooltip title="「一致/変更」はカラム定義・型・制約などのテーブル構造を比較した結果です。レコード（データ）の差分ではありません。レコード差分は各テーブルをクリックして確認してください。">
            <QuestionCircleOutlined style={{ fontSize: 12, color: '#bbb', cursor: 'help' }} />
          </Tooltip>
        </div>
        <Row gutter={24}>
          <Col><Statistic title="合計テーブル" value={summary.total} valueStyle={{ fontSize: 18 }} /></Col>
          <Col>
            <Statistic
              title={<span style={{ color: STATUS_CFG.equal.color }}>構造一致</span>}
              value={summary.equal}
              valueStyle={{ color: STATUS_CFG.equal.color, fontSize: 18 }}
            />
          </Col>
          <Col>
            <Statistic
              title={<span style={{ color: STATUS_CFG.added.color }}>右DBのみ</span>}
              value={summary.added}
              valueStyle={{ color: STATUS_CFG.added.color, fontSize: 18 }}
            />
          </Col>
          <Col>
            <Statistic
              title={<span style={{ color: STATUS_CFG.deleted.color }}>左DBのみ</span>}
              value={summary.deleted}
              valueStyle={{ color: STATUS_CFG.deleted.color, fontSize: 18 }}
            />
          </Col>
          <Col>
            <Statistic
              title={<span style={{ color: STATUS_CFG.modified.color }}>構造変更</span>}
              value={summary.modified}
              valueStyle={{ color: STATUS_CFG.modified.color, fontSize: 18 }}
            />
          </Col>
        </Row>
      </div>

      {/* WinMerge スタイル 2 ペイン */}
      <div style={{ display: 'flex', border: '1px solid #d9d9d9', borderRadius: 4, overflow: 'hidden' }}>

        {/* ═══ 左ペイン ══════════════════════════════════════════ */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '2px solid #d9d9d9', minWidth: 0 }}>
          <div style={{ height: DB_BANNER_H, background: '#1677ff', color: '#fff', display: 'flex', alignItems: 'center', padding: '0 12px', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
            {leftLabel}
          </div>
          <div ref={leftListRef} onScroll={onLeftScroll}
            style={{ overflowY: 'scroll', overflowX: 'auto', height: listH, flexShrink: 0 }}>
            <div style={{ minWidth: 200 }}>
              {displayRows.map((row, index) => {
                const isFocused = focusedRowIndex === index
                return (
                  <div key={`left-${index}`}
                    style={{ height: ROW_H, display: 'flex', alignItems: 'stretch', background: isFocused ? 'rgba(22,119,255,0.10)' : STATUS_CFG[row.status].rowBg, borderBottom: '1px solid #f0f0f0', cursor: 'pointer' }}
                    onMouseEnter={() => setFocusedRowIndex(index)}
                    onMouseLeave={() => setFocusedRowIndex(null)}
                    onClick={() => setSelectedTableName(row.leftTable ?? row.rightTable ?? '')}
                  >
                    {row.status === 'added'
                      ? <NotExistCell />
                      : <TableNameCell name={row.leftTable ?? ''} status={row.status} isLeft count={row.leftCount} otherCount={row.rightCount} />}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* ═══ スキーマ差分列 ═══════════════════════════════════ */}
        <div style={{ width: SCHEMA_COL_W, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#fafafa', borderRight: '1px solid #e8e8e8' }}>
          <div style={{ height: DB_BANNER_H, background: '#595959', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0, gap: 4 }}>
            スキーマ構造
            <Tooltip title="カラム定義・型・制約などテーブル構造の比較。レコード内容は含みません。">
              <QuestionCircleOutlined style={{ fontSize: 11, color: '#ccc', cursor: 'help' }} />
            </Tooltip>
          </div>
          <div ref={statusListRef} onScroll={onStatusScroll}
            style={{ overflowY: 'hidden', overflowX: 'hidden', height: listH, flexShrink: 0 }}>
            {displayRows.map((row, index) => {
              const isFocused = focusedRowIndex === index
              const cfg = STATUS_CFG[row.status]
              // 件数差分の計算
              const countDiff = (row.leftCount !== undefined && row.rightCount !== undefined)
                ? row.rightCount - row.leftCount
                : null
              const countsDiffer = countDiff !== null && countDiff !== 0
              return (
                <div key={`status-${index}`}
                  style={{ height: ROW_H, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid #f0f0f0', background: isFocused ? 'rgba(22,119,255,0.10)' : cfg.rowBg, gap: 3, cursor: 'pointer', padding: '4px 4px' }}
                  onMouseEnter={() => setFocusedRowIndex(index)}
                  onMouseLeave={() => setFocusedRowIndex(null)}
                  onClick={() => setSelectedTableName(row.leftTable ?? row.rightTable ?? '')}
                >
                  {/* スキーマステータスバッジ */}
                  <Tag color={cfg.tagColor} style={{ margin: 0, fontSize: 11, lineHeight: '16px', padding: '0 5px' }}>
                    {cfg.label}
                  </Tag>
                  {/* カラム差分 バッジ */}
                  {row.diffSummary && row.status !== 'equal' && (
                    <Space size={2} style={{ flexWrap: 'nowrap' }}>
                      {row.diffSummary.columnsAdded   > 0 && <Tag color="success" style={{ margin: 0, fontSize: 10, padding: '0 3px', lineHeight: '14px' }}>+{row.diffSummary.columnsAdded}</Tag>}
                      {row.diffSummary.columnsDeleted > 0 && <Tag color="error"   style={{ margin: 0, fontSize: 10, padding: '0 3px', lineHeight: '14px' }}>-{row.diffSummary.columnsDeleted}</Tag>}
                      {row.diffSummary.columnsModified > 0 && <Tag color="warning" style={{ margin: 0, fontSize: 10, padding: '0 3px', lineHeight: '14px' }}>~{row.diffSummary.columnsModified}</Tag>}
                    </Space>
                  )}
                  {/* 件数差分インジケーター（構造一致テーブルのみ — 件数で違いを視覚化） */}
                  {row.status === 'equal' && countsDiffer && (
                    <Tooltip title={`左: ${row.leftCount?.toLocaleString()}件 / 右: ${row.rightCount?.toLocaleString()}件`}>
                      <Tag color="orange" style={{ margin: 0, fontSize: 10, padding: '0 3px', lineHeight: '14px', cursor: 'help' }}>
                        件数差異
                      </Tag>
                    </Tooltip>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* ═══ レコード差分列（新設） ════════════════════════════ */}
        <div style={{ width: RECORD_COL_W, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#fafafa', borderRight: '2px solid #d9d9d9' }}>
          <div style={{ height: DB_BANNER_H, background: '#434343', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0, gap: 4 }}>
            レコード差分
            <Tooltip title="テーブルをクリックして差分を確認すると、ここに結果が表示されます。">
              <QuestionCircleOutlined style={{ fontSize: 11, color: '#ccc', cursor: 'help' }} />
            </Tooltip>
          </div>
          <div ref={recordListRef} onScroll={onRecordScroll}
            style={{ overflowY: 'hidden', overflowX: 'hidden', height: listH, flexShrink: 0 }}>
            {displayRows.map((row, index) => {
              const isFocused = focusedRowIndex === index
              const tableName = row.leftTable ?? row.rightTable ?? ''
              const cached = recordDiffSummaryCache[tableName]
              const hasAnyDiff = cached && (cached.added + cached.deleted + cached.modified) > 0
              const isClean    = cached && (cached.added + cached.deleted + cached.modified) === 0
              return (
                <div key={`rec-${index}`}
                  style={{ height: ROW_H, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid #f0f0f0', background: isFocused ? 'rgba(22,119,255,0.10)' : 'transparent', gap: 3, cursor: 'pointer', padding: '4px 6px' }}
                  onMouseEnter={() => setFocusedRowIndex(index)}
                  onMouseLeave={() => setFocusedRowIndex(null)}
                  onClick={() => setSelectedTableName(tableName)}
                >
                  {cached == null ? (
                    // まだスキャンしていない
                    <Tooltip title="クリックしてレコード差分を確認">
                      <Text style={{ fontSize: 11, color: '#bbb', display: 'flex', alignItems: 'center', gap: 3 }}>
                        <QuestionCircleOutlined />
                        未確認
                      </Text>
                    </Tooltip>
                  ) : isClean ? (
                    // 差分ゼロ（完全一致）
                    <Tag color="success" style={{ margin: 0, fontSize: 11, padding: '0 6px', lineHeight: '18px' }}>
                      ✓ 完全一致
                    </Tag>
                  ) : (
                    // 差分あり
                    <Space size={2} direction="vertical" style={{ alignItems: 'center', gap: 2 }}>
                      {hasAnyDiff && (
                        <Space size={2} style={{ flexWrap: 'nowrap' }}>
                          {cached.modified > 0 && (
                            <Tooltip title={`変更: ${cached.modified.toLocaleString()}件`}>
                              <Tag color="warning" style={{ margin: 0, fontSize: 10, padding: '0 3px', lineHeight: '14px' }}>
                                ~{cached.modified.toLocaleString()}
                              </Tag>
                            </Tooltip>
                          )}
                          {cached.added > 0 && (
                            <Tooltip title={`追加: ${cached.added.toLocaleString()}件`}>
                              <Tag color="blue" style={{ margin: 0, fontSize: 10, padding: '0 3px', lineHeight: '14px' }}>
                                +{cached.added.toLocaleString()}
                              </Tag>
                            </Tooltip>
                          )}
                          {cached.deleted > 0 && (
                            <Tooltip title={`削除: ${cached.deleted.toLocaleString()}件`}>
                              <Tag color="error" style={{ margin: 0, fontSize: 10, padding: '0 3px', lineHeight: '14px' }}>
                                -{cached.deleted.toLocaleString()}
                              </Tag>
                            </Tooltip>
                          )}
                        </Space>
                      )}
                      <Text style={{ fontSize: 10, color: '#999' }}>
                        計 {cached.total.toLocaleString()}件
                      </Text>
                    </Space>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* ═══ 右ペイン ══════════════════════════════════════════ */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          <div style={{ height: DB_BANNER_H, background: '#389e0d', color: '#fff', display: 'flex', alignItems: 'center', padding: '0 12px', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
            {rightLabel}
          </div>
          <div ref={rightListRef} onScroll={onRightScroll}
            style={{ overflowY: 'scroll', overflowX: 'auto', height: listH, flexShrink: 0 }}>
            <div style={{ minWidth: 200 }}>
              {displayRows.map((row, index) => {
                const isFocused = focusedRowIndex === index
                return (
                  <div key={`right-${index}`}
                    style={{ height: ROW_H, display: 'flex', alignItems: 'stretch', background: isFocused ? 'rgba(22,119,255,0.10)' : STATUS_CFG[row.status].rowBg, borderBottom: '1px solid #f0f0f0', cursor: 'pointer' }}
                    onMouseEnter={() => setFocusedRowIndex(index)}
                    onMouseLeave={() => setFocusedRowIndex(null)}
                    onClick={() => setSelectedTableName(row.leftTable ?? row.rightTable ?? '')}
                  >
                    {row.status === 'deleted'
                      ? <NotExistCell />
                      : <TableNameCell name={row.rightTable ?? ''} status={row.status} isLeft={false} count={row.rightCount} otherCount={row.leftCount} />}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* ═══ ミニマップ ════════════════════════════════════════ */}
        <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0, borderLeft: '1px solid #e8e8e8' }}>
          <div style={{ height: DB_BANNER_H, background: '#fafafa', borderBottom: '1px solid #e8e8e8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#aaa' }}>
            MAP
          </div>
          <DiffMinimap
            segments={minimapSegments}
            totalCount={displayRows.length}
            focusedIndex={focusedRowIndex}
            onFocus={idx => setFocusedRowIndex(idx)}
            height={listH}
          />
        </div>
      </div>

      {displayRows.length === 0 && !tableDiffLoading && (
        <div style={{ textAlign: 'center', padding: '16px 0', color: '#aaa', fontSize: 12 }}>
          {allRows.length > 0 ? '現在のフィルタ条件に一致するテーブルはありません' : 'テーブルがありません'}
        </div>
      )}
    </Card>
  )
}
