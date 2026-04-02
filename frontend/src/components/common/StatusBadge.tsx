import { Tag } from 'antd'
import type { DiffStatus } from '@/types'

interface Props {
  status: DiffStatus
  showText?: boolean
}

const STATUS_CONFIG: Record<DiffStatus, { color: string; text: string; bg: string }> = {
  equal:    { color: 'default', text: '一致',  bg: '#d9d9d9' },
  added:    { color: 'success', text: '追加',  bg: '#52c41a' },
  deleted:  { color: 'error',   text: '削除',  bg: '#ff4d4f' },
  modified: { color: 'warning', text: '変更',  bg: '#faad14' },
}

export default function StatusBadge({ status, showText = true }: Props) {
  const config = STATUS_CONFIG[status]
  return (
    <Tag color={config.color}>
      {showText ? config.text : ''}
    </Tag>
  )
}
