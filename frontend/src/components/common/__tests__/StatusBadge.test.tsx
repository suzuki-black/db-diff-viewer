import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import StatusBadge from '../StatusBadge'

describe('StatusBadge', () => {
  // ── 各ステータスのテキスト表示 ────────────────────────────
  describe('status ごとに正しいテキストを表示する', () => {
    it('equal → 「一致」を表示する', () => {
      render(<StatusBadge status="equal" />)
      expect(screen.getByText('一致')).toBeInTheDocument()
    })

    it('added → 「追加」を表示する', () => {
      render(<StatusBadge status="added" />)
      expect(screen.getByText('追加')).toBeInTheDocument()
    })

    it('deleted → 「削除」を表示する', () => {
      render(<StatusBadge status="deleted" />)
      expect(screen.getByText('削除')).toBeInTheDocument()
    })

    it('modified → 「変更」を表示する', () => {
      render(<StatusBadge status="modified" />)
      expect(screen.getByText('変更')).toBeInTheDocument()
    })
  })

  // ── showText=false ───────────────────────────────────────────
  describe('showText=false のとき', () => {
    it('equal でテキストを表示しない', () => {
      render(<StatusBadge status="equal" showText={false} />)
      expect(screen.queryByText('一致')).not.toBeInTheDocument()
    })

    it('added でテキストを表示しない', () => {
      render(<StatusBadge status="added" showText={false} />)
      expect(screen.queryByText('追加')).not.toBeInTheDocument()
    })

    it('deleted でテキストを表示しない', () => {
      render(<StatusBadge status="deleted" showText={false} />)
      expect(screen.queryByText('削除')).not.toBeInTheDocument()
    })

    it('modified でテキストを表示しない', () => {
      render(<StatusBadge status="modified" showText={false} />)
      expect(screen.queryByText('変更')).not.toBeInTheDocument()
    })
  })

  // ── showText デフォルト値 ────────────────────────────────────
  it('showText を省略するとテキストを表示する（デフォルト true）', () => {
    render(<StatusBadge status="modified" />)
    expect(screen.getByText('変更')).toBeInTheDocument()
  })
})
