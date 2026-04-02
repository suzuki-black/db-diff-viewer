/**
 * DiffMinimap: Canvas ベースのミニマップ
 *
 * 旧実装はレコード1件に1つの<div>を生成していたため
 * 数百万件で即座にブラウザがフリーズしていた。
 * 新実装はセグメント単位（ステータス連続区間）で受け取り
 * <canvas> に直接描画するため DOM 要素数は常に O(1)。
 */
import { useEffect, useRef, useCallback } from 'react'
import type { DiffStatus } from '@/types'

export interface MinimapSegment {
  status: DiffStatus
  count: number
}

interface Props {
  segments: MinimapSegment[]
  totalCount: number
  /** 現在フォーカスされているレコードの絶対インデックス */
  focusedIndex: number | null
  /** クリック/ドラッグ時に呼ばれる。引数は絶対インデックス */
  onFocus: (index: number) => void
  height?: string | number
}

const STATUS_COLOR: Record<DiffStatus, string> = {
  equal:    '#d9d9d9',
  added:    '#95de64',
  deleted:  '#ff7875',
  modified: '#ffd666',
}
const FOCUSED_COLOR = '#4096ff'
const MINIMAP_WIDTH = 60
const CANVAS_WIDTH  = 52  // padding 分を除いた描画幅

export default function DiffMinimap({
  segments,
  totalCount,
  focusedIndex,
  onFocus,
  height = '100%',
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef    = useRef<HTMLCanvasElement>(null)

  // ─── Canvas 再描画 ───────────────────────────────────────
  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const H = container.clientHeight || 400
    canvas.width  = CANVAS_WIDTH
    canvas.height = H

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, CANVAS_WIDTH, H)

    if (totalCount === 0) return

    let yOffset = 0

    for (const seg of segments) {
      const segHeight = (seg.count / totalCount) * H
      ctx.fillStyle = STATUS_COLOR[seg.status]
      ctx.fillRect(0, yOffset, CANVAS_WIDTH, segHeight)
      yOffset += segHeight
    }

    // フォーカスインジケーター（現在行の位置を細線で表示）
    if (focusedIndex !== null && focusedIndex >= 0 && focusedIndex < totalCount) {
      const y = (focusedIndex / totalCount) * H
      ctx.fillStyle = FOCUSED_COLOR
      ctx.fillRect(0, Math.max(0, y - 1), CANVAS_WIDTH, 3)
    }
  }, [segments, totalCount, focusedIndex])

  useEffect(() => {
    redraw()
  }, [redraw])

  // ResizeObserver でコンテナサイズが変わるたびに再描画
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const ro = new ResizeObserver(() => redraw())
    ro.observe(container)
    return () => ro.disconnect()
  }, [redraw])

  // ─── クリック / ドラッグ ────────────────────────────────
  const getIndexFromY = useCallback(
    (clientY: number) => {
      const container = containerRef.current
      if (!container || totalCount === 0) return 0
      const rect = container.getBoundingClientRect()
      const ratio = (clientY - rect.top) / rect.height
      return Math.max(0, Math.min(totalCount - 1, Math.floor(ratio * totalCount)))
    },
    [totalCount]
  )

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    onFocus(getIndexFromY(e.clientY))
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.buttons !== 1) return
    onFocus(getIndexFromY(e.clientY))
  }

  return (
    <div
      ref={containerRef}
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      style={{
        width: MINIMAP_WIDTH,
        height,
        background: '#fafafa',
        border: '1px solid #e8e8e8',
        borderRadius: 4,
        cursor: totalCount > 0 ? 'pointer' : 'default',
        overflow: 'hidden',
        userSelect: 'none',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'stretch',
        justifyContent: 'center',
        padding: '2px 4px',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ display: 'block', width: CANVAS_WIDTH, flexShrink: 0 }}
      />
    </div>
  )
}
