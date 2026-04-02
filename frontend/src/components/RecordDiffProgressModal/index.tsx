import { Modal, Progress, Space, Typography, Button } from 'antd'
import { StopOutlined, LoadingOutlined } from '@ant-design/icons'
import type { JobStatus, JobPhase } from '@/types'

const { Text, Title } = Typography

interface Props {
  open: boolean
  jobStatus: JobStatus | null
  onCancel: () => void
}

const PHASE_LABELS: Record<JobPhase, string> = {
  pending:        'キューに追加中...',
  queued:         'キューに追加済み',
  counting:       'レコード件数をカウント中...',
  fetching_left:  '◀ 左DBからレコード取得中...',
  fetching_right: '▶ 右DBからレコード取得中...',
  computing:      '⚙ 差分を計算中...',
  finalizing:     '📊 結果を集計中...',
  done:           '✓ 完了',
  error:          '✗ エラー',
  cancelled:      '⚠ キャンセル済み',
}

function pct(done: number, total: number): number {
  if (total <= 0) return 0
  return Math.min(100, Math.round((done / total) * 100))
}

function fmtCount(done: number, total: number): string {
  if (total <= 0) return '---'
  return `${done.toLocaleString()} / ${total.toLocaleString()}`
}

export default function RecordDiffProgressModal({ open, jobStatus, onCancel }: Props) {
  const phase = jobStatus?.phase ?? 'pending'
  const isActive = (
    phase === 'pending' ||
    phase === 'queued' ||
    phase === 'counting' ||
    phase === 'fetching_left' ||
    phase === 'fetching_right' ||
    phase === 'computing' ||
    phase === 'finalizing'
  )

  // 左右それぞれのフェッチ完了フラグ
  // ※ set_based ストリーミング実装では fetching_right フェーズは存在せず、
  //    computing フェーズで右DBのストリーミングと差分計算を同時実行する。
  //    finalizing 以降は全フェーズ完了扱いにする。
  const afterComputing = phase === 'finalizing' || phase === 'done' || phase === 'cancelled' || phase === 'error'
  const leftDone  = phase !== 'fetching_left' && phase !== 'queued' && phase !== 'pending' && phase !== 'counting'
  const rightDone = afterComputing

  const leftPct  = leftDone  ? 100 : pct(jobStatus?.progressLeft  ?? 0, jobStatus?.totalLeft  ?? 0)
  const rightPct = rightDone ? 100 : pct(jobStatus?.progressRight ?? 0, jobStatus?.totalRight ?? 0)
  const computePct = afterComputing ? 100 : pct(jobStatus?.computeProgress ?? 0, jobStatus?.computeTotal ?? 0)
  const finalizePct = pct(jobStatus?.finalizeProgress ?? 0, jobStatus?.finalizeTotal ?? 0)

  // ③ が 100% になったが phase がまだ 'computing' の状態（finalizing 遷移直前）
  // ポーリング間隔（200ms）内に finalizing フェーズが完了すると frontend が見逃すため、
  // compute=100% の時点で④バーを先行表示して「処理中」を伝える。
  const computeJustFinished = phase === 'computing' && computePct >= 100

  const leftStatus:    'active' | 'success' | 'normal' = leftDone  ? 'success' : phase === 'fetching_left'  ? 'active' : 'normal'
  // computing フェーズでは右DBをストリーミング中なので active 表示にする
  const rightStatus:   'active' | 'success' | 'normal' = rightDone ? 'success' : (phase === 'fetching_right' || phase === 'computing') ? 'active' : 'normal'
  const computeStatus: 'active' | 'success' | 'normal' = (afterComputing || computeJustFinished) ? 'success' : phase === 'computing' ? 'active' : 'normal'
  const finalizeStatus: 'active' | 'success' | 'normal' = phase === 'done' ? 'success' : (phase === 'finalizing' || computeJustFinished) ? 'active' : 'normal'

  return (
    <Modal
      title={
        <Space>
          {isActive && <LoadingOutlined spin style={{ color: '#1677ff' }} />}
          <span>レコード差分を取得中</span>
        </Space>
      }
      open={open}
      footer={null}
      closable={false}
      maskClosable={false}
      width={520}
      centered
    >
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        {/* フェーズ表示
            compute=100% の直後はバックエンドが finalizing に移行中だが
            ポーリング間隔で 'finalizing' を見逃す場合に備え
            「結果を集計中...」ラベルを先行表示する */}
        <div style={{ textAlign: 'center', padding: '4px 0' }}>
          <Title level={5} style={{ margin: 0, color: '#595959' }}>
            {PHASE_LABELS[computeJustFinished ? 'finalizing' : phase]}
          </Title>
        </div>

        {/* ① 左DB 取得進捗 */}
        <div>
          <Space style={{ marginBottom: 2 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>① 左DB レコード取得</Text>
            {jobStatus?.totalLeft ? (
              <Text type="secondary" style={{ fontSize: 11 }}>
                {fmtCount(leftDone ? (jobStatus?.totalLeft ?? 0) : (jobStatus?.progressLeft ?? 0), jobStatus?.totalLeft ?? 0)} 件
              </Text>
            ) : null}
          </Space>
          <Progress
            percent={leftPct}
            status={leftStatus}
            strokeColor={leftStatus === 'success' ? '#52c41a' : undefined}
          />
        </div>

        {/* ② 右DB 取得 + 差分計算（set_based では computing フェーズで同時実行） */}
        <div>
          <Space style={{ marginBottom: 2 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {phase === 'computing' ? '② 右DB 取得 + 差分計算' : '② 右DB レコード取得 + 差分計算'}
            </Text>
            {jobStatus?.totalRight ? (
              <Text type="secondary" style={{ fontSize: 11 }}>
                {fmtCount(rightDone ? (jobStatus?.totalRight ?? 0) : (jobStatus?.progressRight ?? 0), jobStatus?.totalRight ?? 0)} 件
              </Text>
            ) : null}
          </Space>
          <Progress
            percent={rightPct}
            status={rightStatus}
            strokeColor={rightStatus === 'success' ? '#52c41a' : undefined}
          />
        </div>

        {/* ③ 差分計算進捗（computeTotal > 0 の場合に表示） */}
        {(phase === 'computing' || afterComputing || (jobStatus?.computeTotal ?? 0) > 0) && (
          <div>
            <Space style={{ marginBottom: 2 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>③ 差分計算</Text>
              {(jobStatus?.computeTotal ?? 0) > 0 && (
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {fmtCount(afterComputing ? (jobStatus?.computeTotal ?? 0) : (jobStatus?.computeProgress ?? 0), jobStatus?.computeTotal ?? 0)} 件
                </Text>
              )}
            </Space>
            <Progress
              percent={computePct}
              status={computeStatus}
              strokeColor={computeStatus === 'success' ? '#52c41a' : '#fa8c16'}
            />
          </div>
        )}

        {/* ④ finalizing（インデックス構築）進捗
            - phase === 'finalizing': 通常の finalizing 表示
            - computeJustFinished: compute=100% だが phase がまだ computing（finalizing 遷移直前）
              ポーリング間隔で finalizing を見逃さないよう、compute 完了時点で先行表示する
            - phase === 'done': 完了後も表示継続
            - finalizeTotal > 0: 過去に progress を受信していた場合 */}
        {(phase === 'finalizing' || phase === 'done' || (jobStatus?.finalizeTotal ?? 0) > 0 || computeJustFinished) && (
          <div>
            <Space style={{ marginBottom: 2 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>④ 結果インデックスを構築中</Text>
              {(jobStatus?.finalizeTotal ?? 0) > 0 && (
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {fmtCount(
                    phase === 'done' ? (jobStatus?.finalizeTotal ?? 0) : (jobStatus?.finalizeProgress ?? 0),
                    jobStatus?.finalizeTotal ?? 0
                  )} 件
                </Text>
              )}
            </Space>
            <Progress
              percent={
                // finalizeTotal が未設定（0）のとき: 不定表示（undefined → antd がデフォルト動作）
                // computeJustFinished / finalizing で total=0 → スピナー的な active バー
                ((phase === 'finalizing' || computeJustFinished) && (jobStatus?.finalizeTotal ?? 0) === 0)
                  ? undefined
                  : finalizePct
              }
              status={finalizeStatus}
              strokeColor={finalizeStatus === 'success' ? '#52c41a' : '#722ed1'}
            />
          </div>
        )}

        {/* エラー表示 */}
        {phase === 'error' && jobStatus?.error && (
          <div style={{ padding: '8px 12px', background: '#fff1f0', borderRadius: 4, border: '1px solid #ffa39e' }}>
            <Text type="danger" style={{ fontSize: 12 }}>{jobStatus.error}</Text>
          </div>
        )}

        {/* キャンセルボタン */}
        {isActive && (
          <div style={{ textAlign: 'center', paddingTop: 4 }}>
            <Button
              danger
              icon={<StopOutlined />}
              onClick={onCancel}
              size="large"
              disabled={phase === 'finalizing'}
            >
              {phase === 'finalizing' ? '集計中（キャンセル不可）' : 'キャンセル（取得済み分で比較）'}
            </Button>
            {phase !== 'finalizing' && (
              <div style={{ marginTop: 6, fontSize: 11, color: '#aaa' }}>
                キャンセルすると取得済みのレコードで差分を表示します
              </div>
            )}
          </div>
        )}
      </Space>
    </Modal>
  )
}
