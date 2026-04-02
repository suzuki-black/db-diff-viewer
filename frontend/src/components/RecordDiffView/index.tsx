/**
 * RecordDiffView: ページネーション + 仮想スクロール版
 *
 * 旧実装は全レコードを一度に受け取り state に保持していたため
 * 数百万件で JSON パース中にブラウザがフリーズしていた。
 *
 * 改善点:
 *  - サーバーサイドで status_index を使ってページネーション
 *  - フロントエンドは表示に必要なページのみ遅延フェッチ
 *  - 仮想スクロールのカウント = resultMeta.summary から計算（レコード本体不要）
 *  - DiffMinimap は Canvas ベースのセグメント描画（DOM 要素数 O(1)）
 */
import { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import {
  Card, Button, Space, Tag, Empty, Alert, Checkbox, Tabs, Typography, Spin, Progress,
} from 'antd'
import { ArrowLeftOutlined } from '@ant-design/icons'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useDiffStore } from '@/store/diffStore'
import { useConnectionStore } from '@/store/connectionStore'
import { useSettingsStore } from '@/store/settingsStore'
import { diffApi } from '@/api/diff'
import type {
  DiffStatus, DiffFilter, JobStatus, SchemaDiffResult,
  RecordDiffItem, RecordDiffMeta,
} from '@/types'
import DiffMinimap, { type MinimapSegment } from '@/components/DiffMinimap'
import RecordDiffProgressModal from '@/components/RecordDiffProgressModal'
import SchemaDiffView from '@/components/SchemaDiffView'

const { Text } = Typography

// ── レイアウト定数 ────────────────────────────────────────────
const CELL_HEIGHT    = 32
const HEADER_HEIGHT  = 36
const DB_BANNER_H    = 30
const STATUS_COL_W   = 76
const PK_COL_W       = 100
const DATA_COL_W     = 150
const PAGE_SIZE      = 200   // ページネーション1ページあたりのレコード数

// ── 仮想スクロール表示上限 ───────────────────────────────────
// ブラウザは要素高さに上限がある（Chrome: ~33M px、Firefox: ~18M px）。
// count × CELL_HEIGHT がこれを超えると DOM レイアウトでフリーズする。
// 500,000 件 × 32px = 16M px → 全ブラウザで安全な上限値。
const VIRTUAL_ROW_LIMIT = 500_000

// ── ページフェッチ同時実行上限 ───────────────────────────────
// ブラウザは 1 ドメインあたり同時接続数が ~6-10 本に制限されている。
// これを大幅に超えるリクエストを発行するとブラウザ UI スレッドがフリーズする。
// virtualizer のビューポート計算が誤っていた場合の安全策として上限を設ける。
const MAX_IN_FLIGHT = 8

// ── デバッグログ（ブラウザクラッシュ前に Docker ログへ退避） ──
// fire-and-forget: fetch 失敗は無視する。ブラウザが落ちても uvicorn ログには残る。
function debugLog(event: string, data: Record<string, unknown>): void {
  // スタックトレースの先頭 4 フレームを 1 行で収める
  const stack = new Error().stack?.split('\n').slice(2, 6).join(' | ') ?? ''
  void fetch('/api/diff/debug/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, ts: new Date().toISOString(), stack, ...data }),
  }).catch(() => {})
}

// ── ステータスカラー定義 ──────────────────────────────────────
const STATUS_CFG: Record<DiffStatus, { label: string; color: string; bg: string; rowBg: string }> = {
  equal:    { label: '一致', color: '#389e0d', bg: '#f6ffed', rowBg: 'transparent' },
  added:    { label: '追加', color: '#096dd9', bg: '#e6f4ff', rowBg: '#e6f4ff'     },
  deleted:  { label: '削除', color: '#cf1322', bg: '#fff1f0', rowBg: '#fff1f0'     },
  modified: { label: '変更', color: '#d46b08', bg: '#fff7e6', rowBg: '#fff7e6'     },
}

// ── ステータスバッジ ─────────────────────────────────────────
function StatusBadge({ status }: { status: DiffStatus }) {
  const cfg = STATUS_CFG[status]
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 7px',
        borderRadius: 3,
        fontSize: 11,
        fontWeight: 700,
        color: cfg.color,
        background: cfg.bg,
        border: `1px solid ${cfg.color}`,
        whiteSpace: 'nowrap',
        letterSpacing: '0.02em',
      }}
    >
      {cfg.label}
    </span>
  )
}

// ── ヘッダセル ───────────────────────────────────────────────
function HeaderCell({ label, width, isPK = false }: { label: string; width: number; isPK?: boolean }) {
  return (
    <div
      style={{
        width, minWidth: width, flexShrink: 0,
        height: HEADER_HEIGHT, display: 'flex', alignItems: 'center',
        padding: '0 8px', background: '#f0f0f0',
        borderRight: `${isPK ? 2 : 1}px solid ${isPK ? '#aaa' : '#d9d9d9'}`,
        fontWeight: isPK ? 700 : 600, fontSize: 12, color: '#333',
        overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
      }}
      title={label}
    >
      {label}
    </div>
  )
}

// ── データセル ───────────────────────────────────────────────
function DataCell({ value, width, isDiff = false, isPK = false }: {
  value: unknown; width: number; isDiff?: boolean; isPK?: boolean
}) {
  const displayVal = value === null || value === undefined ? null : String(value)
  return (
    <div
      style={{
        width, minWidth: width, flexShrink: 0,
        height: CELL_HEIGHT, display: 'flex', alignItems: 'center',
        padding: '0 8px',
        borderRight: `${isPK ? 2 : 1}px solid ${isPK ? '#aaa' : '#f0f0f0'}`,
        fontSize: 12, fontWeight: isDiff || isPK ? 700 : 400,
        background: isDiff ? '#ffe58f' : 'transparent',
        overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
      }}
      title={displayVal ?? 'NULL'}
    >
      {displayVal === null
        ? <span style={{ color: '#aaa', fontSize: 11, fontStyle: 'italic' }}>NULL</span>
        : displayVal}
    </div>
  )
}

// ── スケルトンバー（ページロード中のインライン表示）─────────
const SHIMMER_STYLE: React.CSSProperties = {
  display: 'inline-block',
  width: '70%', height: 10, borderRadius: 4,
  background: 'linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)',
  backgroundSize: '200% 100%',
  animation: 'shimmer 1.2s infinite',
}

// ── スケルトンセル（ページロード中・DataCell の代替）───────
function SkeletonCell({ width }: { width: number }) {
  return (
    <div
      style={{
        width, minWidth: width, flexShrink: 0,
        height: CELL_HEIGHT, display: 'flex', alignItems: 'center',
        padding: '0 8px', borderRight: '1px solid #f0f0f0',
      }}
    >
      <div style={SHIMMER_STYLE} />
    </div>
  )
}

// ── "このDBには存在しません" プレースホルダ ──────────────────
function NotExistCell() {
  return (
    <div
      style={{
        flex: 1, height: CELL_HEIGHT, display: 'flex', alignItems: 'center',
        padding: '0 16px', fontSize: 12, color: '#bbb', fontStyle: 'italic',
        background: 'repeating-linear-gradient(45deg, transparent, transparent 6px, rgba(0,0,0,0.03) 6px, rgba(0,0,0,0.03) 12px)',
      }}
    >
      このDBには存在しません
    </div>
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

// ============================================================
// メインコンポーネント
// ============================================================

export default function RecordDiffView() {
  const {
    selectedTableName,
    setRecordDiffResult,
    setRecordDiffLoading,
    setSelectedTableName,
    focusedRowIndex,
    setFocusedRowIndex,
    storeRecordDiffSummary,
  } = useDiffStore()

  const { selectedPair, connections } = useConnectionStore()
  const { settings } = useSettingsStore()

  // フィルタ
  const [filter, setFilter] = useState<DiffFilter>(() => ({ ...settings.defaultFilter }))

  // ジョブ関連
  const [jobStatus, setJobStatus]       = useState<JobStatus | null>(null)
  const [modalOpen, setModalOpen]       = useState(false)
  const [fetchError, setFetchError]     = useState<string | null>(null)
  const pollTimerRef    = useRef<ReturnType<typeof setInterval> | null>(null)
  const currentJobIdRef = useRef<string | null>(null)

  // 差分結果メタ（レコード本体なし）
  const [resultMeta, setResultMeta]       = useState<RecordDiffMeta | null>(null)
  const [completedJobId, setCompletedJobId] = useState<string | null>(null)
  const [columns, setColumns]             = useState<string[]>([])

  // ページキャッシュ（ref: state 更新不要）
  const pageCacheRef        = useRef<Map<number, RecordDiffItem[]>>(new Map())
  const loadingPagesRef     = useRef<Set<number>>(new Set())
  // フライト中リクエストのキャンセル用 AbortController マップ
  const abortControllersRef = useRef<Map<number, AbortController>>(new Map())
  // ページ到着時に仮想リストを再描画するトリガー
  const [renderTick, setRenderTick] = useState(0)

  // ページ読み込み進捗（差分計算完了後のリスト表示フェーズ）
  const [loadingPageCount, setLoadingPageCount] = useState(0)
  const [loadedPagesCount, setLoadedPagesCount] = useState(0)

  // スキーマ差分関連
  const [activeTab, setActiveTab]             = useState<string>('records')
  const [schemaDiffResult, setSchemaDiffResult] = useState<SchemaDiffResult | null>(null)
  const [schemaLoading, setSchemaLoading]     = useState(false)
  const [schemaError, setSchemaError]         = useState<string | null>(null)
  const schemaLoadedForRef = useRef<string | null>(null)

  // DB名
  const leftConn   = connections.find(c => c.id === selectedPair.leftConnectionId)
  const rightConn  = connections.find(c => c.id === selectedPair.rightConnectionId)
  const leftLabel  = leftConn  ? `◀ ${leftConn.name}  (${leftConn.schemaName})` : '◀ 左DB'
  const rightLabel = rightConn ? `▶ ${rightConn.name}  (${rightConn.schemaName})` : '▶ 右DB'

  // テーブル存在フラグ（ジョブ開始レスポンスから取得）
  const tableExistsLeft  = jobStatus?.tableExistsLeft  ?? true
  const tableExistsRight = jobStatus?.tableExistsRight ?? true
  const missingTableDB   = !tableExistsLeft
    ? (leftConn?.name ?? '左DB')
    : !tableExistsRight
    ? (rightConn?.name ?? '右DB')
    : null

  // スクロール用 Ref
  const leftDataRef  = useRef<HTMLDivElement>(null)
  const rightDataRef = useRef<HTMLDivElement>(null)
  const leftHdrRef   = useRef<HTMLDivElement>(null)
  const rightHdrRef  = useRef<HTMLDivElement>(null)
  const isSyncing    = useRef(false)

  // ── フィルタ → アクティブなステータス一覧 ─────────────────
  const activeStatuses = useMemo((): DiffStatus[] => {
    const result: DiffStatus[] = []
    if (filter.showModified) result.push('modified')
    if (filter.showAdded)    result.push('added')
    if (filter.showDeleted)  result.push('deleted')
    if (filter.showEqual)    result.push('equal')
    return result
  }, [filter])

  const activeStatusesKey = activeStatuses.join(',')

  // ── フィルタ適用後の総件数（実件数・API ステータス集計用） ──
  const totalFilteredCount = useMemo(() => {
    if (!resultMeta) return 0
    let count = 0
    if (filter.showModified) count += resultMeta.summary.modified
    if (filter.showAdded)    count += resultMeta.summary.added
    if (filter.showDeleted)  count += resultMeta.summary.deleted
    if (filter.showEqual)    count += resultMeta.summary.equal
    return count
  }, [resultMeta, filter])

  // ── 仮想スクロールに渡す件数（ブラウザ上限に合わせてキャップ） ──
  // VIRTUAL_ROW_LIMIT を超えると div height が 16M px を超えてブラウザがフリーズする。
  const virtualizerCount = Math.min(totalFilteredCount, VIRTUAL_ROW_LIMIT)

  // ── ミニマップ用セグメント（virtualizerCount 内に収まる範囲で割り当て） ──
  // 実際に表示される件数だけを反映し、ミニマップクリックと virtualizer の
  // インデックスが 1:1 で一致するようにする。
  const minimapSegments = useMemo((): MinimapSegment[] => {
    if (!resultMeta) return []
    const result: MinimapSegment[] = []
    let remaining = virtualizerCount
    const sources: Array<[boolean, DiffStatus, number]> = [
      [filter.showModified, 'modified', resultMeta.summary.modified],
      [filter.showAdded,    'added',    resultMeta.summary.added],
      [filter.showDeleted,  'deleted',  resultMeta.summary.deleted],
      [filter.showEqual,    'equal',    resultMeta.summary.equal],
    ]
    for (const [show, status, total] of sources) {
      if (!show || total === 0 || remaining <= 0) continue
      const allocated = Math.min(total, remaining)
      result.push({ status, count: allocated })
      remaining -= allocated
    }
    return result
  }, [resultMeta, filter, virtualizerCount])

  // 左・右ペインの合計幅
  const leftTotalW  = STATUS_COL_W + PK_COL_W + columns.length * DATA_COL_W
  const rightTotalW = PK_COL_W + columns.length * DATA_COL_W

  // ── デバッグ用: focusedRowIndex の最新値をリアルタイムに保持する ref ──
  // loadPage 内の debugLog でスナップショットとして使う。
  // useCallback の deps には含めず、常に最新値を参照できるようにする。
  const focusedRowIndexRef = useRef(focusedRowIndex)
  useEffect(() => { focusedRowIndexRef.current = focusedRowIndex })

  // 仮想スクロール（左ペイン基準）
  // count は VIRTUAL_ROW_LIMIT でキャップ済みの virtualizerCount を使う。
  // totalFilteredCount を直接渡すと count × 32px が Chrome 上限（~33M px）を
  // 超えてレイアウトフリーズが発生する。
  const virtualizer = useVirtualizer({
    count: virtualizerCount,
    getScrollElement: () => leftDataRef.current,
    estimateSize: () => CELL_HEIGHT,
    overscan: 10,
  })

  // ── フィルタ or ジョブ変更でキャッシュをクリア ──────────
  // フライト中のページリクエストを即座にキャンセルし、ローディング状態をリセットする。
  // キャンセルしないと「レンダー A がリクエスト送信 → エフェクトで loading フラグ削除
  // → レンダー B が同じページを重複リクエスト」という二重送信が起きる。
  useEffect(() => {
    const scrollTopBefore  = leftDataRef.current?.scrollTop  ?? -1
    const scrollLeftBefore = leftDataRef.current?.scrollLeft ?? -1
    debugLog('cache_clear', {
      activeStatusesKey,
      completedJobId,
      scrollTopBefore,
      scrollLeftBefore,
      inFlightCount: abortControllersRef.current.size,
      cachedPages:   pageCacheRef.current.size,
    })

    abortControllersRef.current.forEach(ac => ac.abort())
    abortControllersRef.current.clear()
    pageCacheRef.current.clear()
    loadingPagesRef.current.clear()
    setLoadingPageCount(0)
    setLoadedPagesCount(0)
    // スクロール位置を先頭にリセット（フィルタ変更時も必須）。
    // フィルタ変更でキャッシュをクリアした後、以前の高スクロール位置（例: offset=479800）の
    // まま virtualizer が再描画されると、末尾付近のページリクエストが発生しブラウザが固まる。
    if (leftDataRef.current)  leftDataRef.current.scrollTop  = 0
    if (rightDataRef.current) rightDataRef.current.scrollTop = 0
    if (leftHdrRef.current)   leftHdrRef.current.scrollLeft  = 0
    if (rightHdrRef.current)  rightHdrRef.current.scrollLeft = 0
    setRenderTick(t => t + 1)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStatusesKey, completedJobId])

  // ── ページ遅延ロード ─────────────────────────────────────
  const loadPage = useCallback((pageNum: number) => {
    if (!completedJobId) return
    if (loadingPagesRef.current.has(pageNum)) return
    if (pageCacheRef.current.has(pageNum)) return

    // ── 同時フェッチ上限（安全策） ────────────────────────────
    // virtualizer のビューポート計算が誤って全行を可視と判定した場合でも
    // ブラウザが数千リクエストを同時発行してフリーズしないように上限を設ける。
    // 上限に達したページは「未キャッシュ・未ロード中」のままなので、
    // 次回スクロール時や再レンダー時に自動的に再試行される。
    if (abortControllersRef.current.size >= MAX_IN_FLIGHT) {
      debugLog('loadPage_skipped', {
        pageNum,
        inFlight: abortControllersRef.current.size,
        MAX_IN_FLIGHT,
        offsetHeight: leftDataRef.current?.offsetHeight ?? -1,
      })
      return
    }

    // ── デバッグ計装 ─────────────────────────────────────────
    // offsetHeight が calc(100vh-320px) の期待値（例: 680px）より大幅に大きければ
    // virtualizer がビューポートを誤計測していることが確定する。
    debugLog('loadPage', {
      pageNum,
      offset:          pageNum * PAGE_SIZE,
      scrollTop:       leftDataRef.current?.scrollTop    ?? -1,
      scrollLeft:      leftDataRef.current?.scrollLeft   ?? -1,
      offsetHeight:    leftDataRef.current?.offsetHeight ?? -1,
      clientHeight:    leftDataRef.current?.clientHeight ?? -1,
      focusedRowIndex: focusedRowIndexRef.current,
      inFlight:        abortControllersRef.current.size,
      cachedPages:     pageCacheRef.current.size,
      activeStatusesKey,
    })

    loadingPagesRef.current.add(pageNum)
    setLoadingPageCount(c => c + 1)

    // AbortController でキャンセル可能にする（フィルタ/ジョブ切替時に重複リクエスト防止）
    const controller = new AbortController()
    abortControllersRef.current.set(pageNum, controller)

    const statuses = activeStatuses.length > 0 ? activeStatuses : undefined
    diffApi
      .getJobResultPage(completedJobId, pageNum * PAGE_SIZE, PAGE_SIZE, statuses, controller.signal)
      .then(page => {
        pageCacheRef.current.set(pageNum, page.records)
        setLoadedPagesCount(c => c + 1)
        setRenderTick(t => t + 1)
      })
      .catch((err) => {
        // キャンセル（abort）は正常フロー。それ以外のエラーは次スクロール時に再試行。
        if (err?.code === 'ERR_CANCELED' || err?.name === 'AbortError') return
        // エラーページはキャッシュしない → 次回スクロール時に自動再試行
      })
      .finally(() => {
        abortControllersRef.current.delete(pageNum)
        loadingPagesRef.current.delete(pageNum)
        setLoadingPageCount(c => Math.max(0, c - 1))
      })
  // activeStatuses は activeStatusesKey が変わったときにキャッシュをクリアするので
  // ここでは直接 key を使って安定させる
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completedJobId, activeStatusesKey])

  // ── 仮想インデックス → レコード（未ロードなら null） ──────
  const getRecord = useCallback((absIndex: number): RecordDiffItem | null => {
    const pageNum    = Math.floor(absIndex / PAGE_SIZE)
    const pageOffset = absIndex % PAGE_SIZE
    const page = pageCacheRef.current.get(pageNum)
    if (page) return page[pageOffset] ?? null
    loadPage(pageNum)
    return null
  }, [loadPage])

  // ── ポーリング停止 ────────────────────────────────────────
  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [])

  // ── ジョブ開始＋ポーリング ────────────────────────────────
  useEffect(() => {
    if (!selectedTableName || !selectedPair.leftConnectionId || !selectedPair.rightConnectionId) return

    setFetchError(null)
    setRecordDiffResult(null)   // store のキャッシュもリセット
    setRecordDiffLoading(true)
    setJobStatus(null)
    setResultMeta(null)
    setCompletedJobId(null)
    setColumns([])
    setModalOpen(true)
    currentJobIdRef.current = null
    stopPolling()
    // フォーカス行をリセット（前回ジョブの focusedRowIndex が残ると、新ジョブ完了時に
    // 仮想リストが古い行位置へスクロールしてページリクエストが重複する原因になる）
    setFocusedRowIndex(null)

    // スキーマ差分もリセット
    setSchemaDiffResult(null)
    setSchemaError(null)
    schemaLoadedForRef.current = null
    setActiveTab('records')

    let jobId = ''

    diffApi
      .startRecordDiffJob({
        leftConnectionId:  selectedPair.leftConnectionId,
        rightConnectionId: selectedPair.rightConnectionId,
        tableName:         selectedTableName,
        algorithm:         settings.diffAlgorithm,
        batchSize:         settings.batchSize,
      })
      .then((id) => {
        jobId = id
        currentJobIdRef.current = id

        pollTimerRef.current = setInterval(async () => {
          try {
            const status = await diffApi.getJobStatus(jobId)
            setJobStatus(status)

            if (status.phase === 'done' || status.phase === 'cancelled') {
              stopPolling()
              setRecordDiffLoading(false)
              if (status.resultMeta) {
                setResultMeta(status.resultMeta)
                setColumns(status.resultMeta.columns)
                setCompletedJobId(jobId)
                // テーブル一覧でレコード差分状況を一目で確認できるようキャッシュに保存
                if (selectedTableName && status.phase === 'done') {
                  storeRecordDiffSummary(selectedTableName, status.resultMeta.summary)
                }
              }
              // モーダルを 1 秒間 "✓ 完了" 状態で表示してから閉じる
              // （finalizing → done の遷移をユーザーに見せるため）
              setTimeout(() => setModalOpen(false), 1000)
            } else if (status.phase === 'error') {
              stopPolling()
              setModalOpen(false)
              setRecordDiffLoading(false)
              setFetchError(status.error ?? '不明なエラー')
            }
          } catch (e) {
            stopPolling()
            setModalOpen(false)
            setRecordDiffLoading(false)
            setFetchError(`ジョブ状態の取得に失敗しました: ${String(e)}`)
          }
        }, 200)
      })
      .catch((e) => {
        setModalOpen(false)
        setRecordDiffLoading(false)
        setFetchError(`レコード差分ジョブの開始に失敗しました: ${String(e)}`)
      })

    return () => {
      stopPolling()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTableName, selectedPair])

  // ── スキーマ差分の遅延ロード ──────────────────────────────
  useEffect(() => {
    if (
      activeTab !== 'schema' ||
      !selectedTableName ||
      !selectedPair.leftConnectionId ||
      !selectedPair.rightConnectionId ||
      schemaLoadedForRef.current === selectedTableName
    ) return

    schemaLoadedForRef.current = selectedTableName
    setSchemaLoading(true)
    setSchemaError(null)

    diffApi
      .getSchema({
        leftConnectionId:  selectedPair.leftConnectionId,
        rightConnectionId: selectedPair.rightConnectionId,
        tableName:         selectedTableName,
      })
      .then((result) => { setSchemaDiffResult(result) })
      .catch((e) => {
        setSchemaError(`テーブル構造の取得に失敗しました: ${String(e)}`)
        schemaLoadedForRef.current = null
      })
      .finally(() => { setSchemaLoading(false) })
  }, [activeTab, selectedTableName, selectedPair])

  // ── キャンセル ────────────────────────────────────────────
  const handleCancel = useCallback(async () => {
    const id = currentJobIdRef.current
    if (!id) return
    try { await diffApi.cancelJob(id) } catch { /* ignore */ }
  }, [])

  // ── ミニマップからのジャンプ ──────────────────────────────
  // virtualizer を deps に含めると、virtualizer の参照が毎レンダーで変わる場合に
  // focusedRowIndex が非 null のとき毎レンダーで scrollToIndex が呼ばれ、
  // 同じページへのリクエストが連続して発行されるログ大量出力の原因になる。
  // focusedRowIndex の変化のみをトリガーとし、virtualizer は最新の ref 経由で参照する。
  const virtualizerRef = useRef(virtualizer)
  useEffect(() => {
    virtualizerRef.current = virtualizer
  })
  useEffect(() => {
    if (focusedRowIndex !== null) {
      debugLog('scrollToIndex', {
        focusedRowIndex,
        scrollTopBefore: leftDataRef.current?.scrollTop ?? -1,
        completedJobId,
        activeStatusesKey,
      })
      virtualizerRef.current.scrollToIndex(focusedRowIndex, { align: 'center' })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedRowIndex])

  // ── スクロール連動 ───────────────────────────────────────
  const onLeftDataScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    if (leftHdrRef.current) leftHdrRef.current.scrollLeft = el.scrollLeft
    if (isSyncing.current) return
    isSyncing.current = true
    if (rightDataRef.current) {
      rightDataRef.current.scrollTop  = el.scrollTop
      rightDataRef.current.scrollLeft = el.scrollLeft
    }
    if (rightHdrRef.current) rightHdrRef.current.scrollLeft = el.scrollLeft
    requestAnimationFrame(() => { isSyncing.current = false })
  }, [])

  const onRightDataScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    if (rightHdrRef.current) rightHdrRef.current.scrollLeft = el.scrollLeft
    if (isSyncing.current) return
    isSyncing.current = true
    if (leftDataRef.current) {
      leftDataRef.current.scrollTop  = el.scrollTop
      leftDataRef.current.scrollLeft = el.scrollLeft
    }
    if (leftHdrRef.current) leftHdrRef.current.scrollLeft = el.scrollLeft
    requestAnimationFrame(() => { isSyncing.current = false })
  }, [])

  if (!selectedTableName) return null

  const summary   = resultMeta?.summary
  const isPartial = resultMeta?.isPartial ?? false
  const paneH     = 'calc(100vh - 320px)'

  // renderTick を参照してコンパイラに「使用済み」と認識させる（無駄な再描画なし）
  void renderTick

  return (
    <>
      {/* プログレスモーダル */}
      <RecordDiffProgressModal
        open={modalOpen}
        jobStatus={jobStatus}
        onCancel={handleCancel}
      />

      {/* shimmer アニメーション */}
      <style>{`
        @keyframes shimmer {
          0%   { background-position: -200% 0; }
          100% { background-position:  200% 0; }
        }
      `}</style>

      <Card
        title={
          <Space wrap>
            <Button
              size="small"
              icon={<ArrowLeftOutlined />}
              onClick={() => setSelectedTableName(null)}
            >
              テーブル一覧に戻る
            </Button>
            <Tag color="blue" style={{ fontWeight: 700, fontSize: 13 }}>
              {selectedTableName}
            </Tag>
            {resultMeta && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                左: {resultMeta.totalLeft.toLocaleString()}件 / 右: {resultMeta.totalRight.toLocaleString()}件
                &ensp;｜&ensp;
                <span style={{ color: STATUS_CFG.modified.color }}>変更 {summary?.modified}</span>
                &ensp;
                <span style={{ color: STATUS_CFG.added.color }}>追加 {summary?.added}</span>
                &ensp;
                <span style={{ color: STATUS_CFG.deleted.color }}>削除 {summary?.deleted}</span>
                &ensp;
                <span style={{ color: STATUS_CFG.equal.color }}>一致 {summary?.equal}</span>
              </Text>
            )}
          </Space>
        }
        extra={<FilterCheckboxes filter={filter} onChange={setFilter} />}
        styles={{ body: { padding: '8px 12px' } }}
      >
        {fetchError && (
          <Alert
            message="レコード取得エラー"
            description={fetchError}
            type="error"
            showIcon
            closable
            style={{ marginBottom: 8 }}
          />
        )}

        {missingTableDB && (
          <Alert
            message={`「${missingTableDB}」には テーブル「${selectedTableName}」が存在しません`}
            description={`${missingTableDB} 側のレコードはすべて「${!tableExistsLeft ? '削除' : '追加'}」として表示されます。`}
            type="warning"
            showIcon
            style={{ marginBottom: 8 }}
          />
        )}

        {/* 差分計算完了後のページ読み込み進捗バー
            - loadingPageCount > 0: 現在フライト中のページリクエストがある間表示
            - totalPages: 表示フィルタに応じた全ページ数
            - loadedPagesCount が totalPages に到達したらバーは消える
        */}
        {(() => {
          if (!completedJobId || totalFilteredCount === 0) return null
          const totalPages = Math.ceil(totalFilteredCount / PAGE_SIZE)
          if (loadedPagesCount >= totalPages && loadingPageCount === 0) return null
          if (loadingPageCount === 0 && loadedPagesCount === 0) return null
          const pct = totalPages > 0 ? Math.round((loadedPagesCount / totalPages) * 100) : 0
          return (
            <div
              style={{
                marginBottom: 8,
                padding: '5px 12px',
                background: '#f0f5ff',
                borderRadius: 6,
                border: '1px solid #adc6ff',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}
            >
              {loadingPageCount > 0 && <Spin size="small" />}
              <Text style={{ fontSize: 12, color: '#2f54eb', flexShrink: 0, fontWeight: 600 }}>
                結果ページ読み込み中
              </Text>
              <Progress
                percent={pct}
                size="small"
                style={{ flex: 1, margin: 0 }}
                strokeColor="#2f54eb"
                format={() => (
                  <Text style={{ fontSize: 11, color: '#2f54eb' }}>
                    {loadedPagesCount.toLocaleString()} / {totalPages.toLocaleString()} ページ
                    （{(loadedPagesCount * PAGE_SIZE).toLocaleString()}件 〜）
                  </Text>
                )}
              />
            </div>
          )
        })()}

        {isPartial && resultMeta?.partialNote && (
          <Alert
            message="⚠ 取得が途中でキャンセルされました"
            description={resultMeta.partialNote}
            type="warning"
            showIcon
            style={{ marginBottom: 8 }}
          />
        )}

        <Tabs
          size="small"
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            {
              key: 'records',
              label: 'レコード差分',
              children: !completedJobId ? (
                <div style={{ textAlign: 'center', padding: 64, color: '#888', fontSize: 13 }}>
                  {modalOpen
                    ? 'レコードを取得中... プログレスバーをご確認ください'
                    : <Empty description="テーブルを選択してください" />}
                </div>
              ) : (
                <>
                  {/* 凡例 */}
                  <Space style={{ marginBottom: 6, fontSize: 11 }} size={12}>
                    <span style={{ color: '#888', fontWeight: 600 }}>凡例：</span>
                    {(Object.keys(STATUS_CFG) as DiffStatus[]).map(status => (
                      <span key={status} style={{ color: STATUS_CFG[status].color, fontWeight: 600 }}>
                        ■ {STATUS_CFG[status].label}
                      </span>
                    ))}
                    <span
                      style={{
                        display: 'inline-block',
                        background: '#ffe58f',
                        border: '1px solid #ffc53d',
                        borderRadius: 2,
                        padding: '0 6px',
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                    >
                      変更セル
                    </span>
                    <span style={{ color: '#bbb', fontStyle: 'italic', fontSize: 11 }}>
                      ▨ レコードなし
                    </span>
                  </Space>

                  {/* 2 ペイン */}
                  <div
                    style={{
                      display: 'flex',
                      border: '1px solid #d9d9d9',
                      borderRadius: 4,
                      overflow: 'hidden',
                      background: '#fff',
                    }}
                  >
                    {/* ═══ 左ペイン ═══ */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '3px solid #1677ff', minWidth: 0 }}>
                      {/* DB バナー（左） */}
                      <div style={{ height: DB_BANNER_H, background: '#1677ff', color: '#fff', display: 'flex', alignItems: 'center', padding: '0 12px', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                        {leftLabel}
                      </div>

                      {/* カラムヘッダ（左） */}
                      <div ref={leftHdrRef} style={{ height: HEADER_HEIGHT, overflow: 'hidden', flexShrink: 0, borderBottom: '2px solid #d9d9d9', display: 'flex', background: '#f0f0f0' }}>
                        <div style={{ display: 'flex', minWidth: leftTotalW }}>
                          <HeaderCell label="状態" width={STATUS_COL_W} />
                          <HeaderCell label="🔑 主キー" width={PK_COL_W} isPK />
                          {columns.map(col => <HeaderCell key={col} label={col} width={DATA_COL_W} />)}
                        </div>
                      </div>

                      {/* データエリア（左・仮想スクロール） */}
                      {/* ⚠ flex: 1 を外して height: paneH だけで高さを確定させる。
                          flex: 1 (flex-basis:0) + height:calc() の組み合わせは unconstrained な
                          flex 親の中でビューポート高さを肥大化させ、virtualizer が全行を可視と
                          判定して全ページリクエストを発行してしまうため除去。 */}
                      <div
                        ref={leftDataRef}
                        onScroll={onLeftDataScroll}
                        style={{ overflowX: 'auto', overflowY: 'scroll', height: paneH, flexShrink: 0, position: 'relative' }}
                      >
                        <div style={{ height: virtualizer.getTotalSize(), width: leftTotalW, position: 'relative' }}>
                          {virtualizer.getVirtualItems().map(vItem => {
                            const record    = getRecord(vItem.index)
                            const isFocused = focusedRowIndex === vItem.index
                            const rowBg     = record ? STATUS_CFG[record.status].rowBg : 'transparent'

                            return (
                              <div
                                key={vItem.key}
                                style={{
                                  position: 'absolute', top: vItem.start, left: 0,
                                  width: leftTotalW, height: CELL_HEIGHT,
                                  display: 'flex', alignItems: 'stretch',
                                  background: isFocused ? 'rgba(22,119,255,0.12)' : rowBg,
                                  borderBottom: '1px solid #f0f0f0',
                                  cursor: 'pointer',
                                }}
                                onMouseEnter={() => setFocusedRowIndex(vItem.index)}
                                onMouseLeave={() => setFocusedRowIndex(null)}
                              >
                                {/* ステータスバッジ列（sticky） */}
                                <div
                                  style={{
                                    width: STATUS_COL_W, minWidth: STATUS_COL_W,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    borderRight: '1px solid #e8e8e8', flexShrink: 0,
                                    position: 'sticky', left: 0, zIndex: 3,
                                    background: isFocused ? 'rgba(22,119,255,0.12)' : (rowBg || '#fff'),
                                  }}
                                >
                                  {record ? <StatusBadge status={record.status} /> : null}
                                </div>

                                {/* 主キー列（sticky） */}
                                <div
                                  style={{
                                    width: PK_COL_W, minWidth: PK_COL_W,
                                    display: 'flex', alignItems: 'center',
                                    padding: '0 8px', borderRight: '2px solid #aaa',
                                    fontWeight: 700, fontSize: 12, flexShrink: 0,
                                    position: 'sticky', left: STATUS_COL_W, zIndex: 3,
                                    background: isFocused ? 'rgba(22,119,255,0.12)' : (rowBg || '#fafafa'),
                                    color: '#333',
                                  }}
                                >
                                  {record ? record.primaryKeyValue : <span style={SHIMMER_STYLE} />}
                                </div>

                                {/* 左DB データ */}
                                {!record
                                  ? columns.map(col => <SkeletonCell key={col} width={DATA_COL_W} />)
                                  : record.status === 'added'
                                    ? <NotExistCell />
                                    : columns.map(col => (
                                        <DataCell
                                          key={col}
                                          value={record.leftValues?.[col]}
                                          width={DATA_COL_W}
                                          isDiff={record.diffColumns.includes(col)}
                                        />
                                      ))
                                }
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    </div>

                    {/* ═══ 右ペイン ═══ */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
                      {/* DB バナー（右） */}
                      <div style={{ height: DB_BANNER_H, background: '#389e0d', color: '#fff', display: 'flex', alignItems: 'center', padding: '0 12px', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                        {rightLabel}
                      </div>

                      {/* カラムヘッダ（右） */}
                      <div ref={rightHdrRef} style={{ height: HEADER_HEIGHT, overflow: 'hidden', flexShrink: 0, borderBottom: '2px solid #d9d9d9', display: 'flex', background: '#f0f0f0' }}>
                        <div style={{ display: 'flex', minWidth: rightTotalW }}>
                          <HeaderCell label="🔑 主キー" width={PK_COL_W} isPK />
                          {columns.map(col => <HeaderCell key={col} label={col} width={DATA_COL_W} />)}
                        </div>
                      </div>

                      {/* データエリア（右）— 左ペイン同様 flex:1 を除去 */}
                      <div
                        ref={rightDataRef}
                        onScroll={onRightDataScroll}
                        style={{ overflowX: 'auto', overflowY: 'scroll', height: paneH, flexShrink: 0, position: 'relative' }}
                      >
                        <div style={{ height: virtualizer.getTotalSize(), width: rightTotalW, position: 'relative' }}>
                          {virtualizer.getVirtualItems().map(vItem => {
                            const record    = getRecord(vItem.index)
                            const isFocused = focusedRowIndex === vItem.index
                            const rowBg     = record ? STATUS_CFG[record.status].rowBg : 'transparent'

                            return (
                              <div
                                key={vItem.key}
                                style={{
                                  position: 'absolute', top: vItem.start, left: 0,
                                  width: rightTotalW, height: CELL_HEIGHT,
                                  display: 'flex', alignItems: 'stretch',
                                  background: isFocused ? 'rgba(22,119,255,0.12)' : rowBg,
                                  borderBottom: '1px solid #f0f0f0',
                                  cursor: 'pointer',
                                }}
                                onMouseEnter={() => setFocusedRowIndex(vItem.index)}
                                onMouseLeave={() => setFocusedRowIndex(null)}
                              >
                                {/* 主キー（右、sticky） */}
                                <div
                                  style={{
                                    width: PK_COL_W, minWidth: PK_COL_W,
                                    display: 'flex', alignItems: 'center',
                                    padding: '0 8px', borderRight: '2px solid #aaa',
                                    fontWeight: 700, fontSize: 12, flexShrink: 0,
                                    position: 'sticky', left: 0, zIndex: 3,
                                    background: isFocused ? 'rgba(22,119,255,0.12)' : (rowBg || '#fafafa'),
                                    color: '#333',
                                  }}
                                >
                                  {record ? record.primaryKeyValue : <span style={SHIMMER_STYLE} />}
                                </div>

                                {/* 右DB データ */}
                                {!record
                                  ? columns.map(col => <SkeletonCell key={col} width={DATA_COL_W} />)
                                  : record.status === 'deleted'
                                    ? <NotExistCell />
                                    : columns.map(col => (
                                        <DataCell
                                          key={col}
                                          value={record.rightValues?.[col]}
                                          width={DATA_COL_W}
                                          isDiff={record.diffColumns.includes(col)}
                                        />
                                      ))
                                }
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    </div>

                    {/* ═══ ミニマップ（右端） ═══ */}
                    <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0, borderLeft: '1px solid #e8e8e8' }}>
                      <div
                        style={{
                          height: DB_BANNER_H + HEADER_HEIGHT,
                          background: '#fafafa',
                          borderBottom: '2px solid #d9d9d9',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 10, color: '#aaa', writingMode: 'vertical-rl',
                        }}
                      >
                        MAP
                      </div>
                      <DiffMinimap
                        segments={minimapSegments}
                        totalCount={virtualizerCount}
                        focusedIndex={focusedRowIndex}
                        onFocus={idx => setFocusedRowIndex(Math.min(idx, virtualizerCount - 1))}
                        height={paneH}
                      />
                    </div>
                  </div>

                  {/* 件数フッタ */}
                  {totalFilteredCount === 0 ? (
                    <div style={{ textAlign: 'center', padding: '16px 0', color: '#aaa', fontSize: 12 }}>
                      {resultMeta && (resultMeta.summary.total > 0)
                        ? '現在のフィルタ条件に一致するレコードはありません'
                        : 'レコードがありません'}
                    </div>
                  ) : totalFilteredCount > VIRTUAL_ROW_LIMIT ? (
                    <Alert
                      type="warning"
                      showIcon
                      style={{ marginTop: 6 }}
                      message={
                        `表示件数を ${VIRTUAL_ROW_LIMIT.toLocaleString()} 件に制限しています`
                        + ` （全 ${totalFilteredCount.toLocaleString()} 件中）`
                      }
                      description={
                        'ブラウザの描画制限により全件を同時表示できません。'
                        + 'フィルタ（変更・追加・削除・一致）で表示対象を絞り込むと全件確認できます。'
                      }
                    />
                  ) : null}
                </>
              ),
            },
            {
              key: 'schema',
              label: 'テーブル構造差分',
              children: schemaLoading ? (
                <div style={{ textAlign: 'center', padding: 64 }}>
                  <Spin tip="テーブル構造を取得中..." />
                </div>
              ) : schemaError ? (
                <Alert
                  message="テーブル構造取得エラー"
                  description={schemaError}
                  type="error"
                  showIcon
                  style={{ margin: 16 }}
                />
              ) : schemaDiffResult ? (
                <div style={{ padding: '12px 4px' }}>
                  <SchemaDiffView
                    result={schemaDiffResult}
                    leftName={leftConn?.name ?? '左DB'}
                    rightName={rightConn?.name ?? '右DB'}
                  />
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: 64, color: '#aaa', fontSize: 13 }}>
                  「テーブル構造差分」タブを選択すると自動で取得します
                </div>
              ),
            },
          ]}
        />
      </Card>
    </>
  )
}
