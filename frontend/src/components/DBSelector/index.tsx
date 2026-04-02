import { useState } from 'react'
import { Card, Select, Button, Space, Typography, Alert, Spin, Tooltip } from 'antd'
import {
  SwapOutlined, PlayCircleOutlined, ClearOutlined,
} from '@ant-design/icons'
import { useConnectionStore } from '@/store/connectionStore'
import { useDiffStore } from '@/store/diffStore'
import { diffApi } from '@/api/diff'

const { Text } = Typography

export default function DBSelector() {
  const { connections, selectedPair, setSelectedPair, clearSelectedPair } = useConnectionStore()
  const {
    setTableDiffResult,
    setTableDiffLoading,
    tableDiffLoading,
    resetDiff,
  } = useDiffStore()
  const [error, setError] = useState<string | null>(null)

  const { leftConnectionId, rightConnectionId } = selectedPair
  const canCompare = leftConnectionId !== null && rightConnectionId !== null && leftConnectionId !== rightConnectionId
  const hasAnySelection = leftConnectionId !== null || rightConnectionId !== null

  const connectionOptions = connections.map((c) => ({
    value: c.id,
    label: `${c.name}  (${c.schemaName}@${c.host})`,
  }))

  const handleCompare = async () => {
    if (!canCompare) return
    setError(null)
    resetDiff()
    setTableDiffLoading(true)
    try {
      const result = await diffApi.getTables({
        leftConnectionId:  leftConnectionId!,
        rightConnectionId: rightConnectionId!,
      })
      setTableDiffResult(result)
    } catch (e) {
      setError(`DB比較に失敗しました: ${String(e)}`)
    } finally {
      setTableDiffLoading(false)
    }
  }

  const handleSwap = () => {
    setSelectedPair({ leftConnectionId: rightConnectionId, rightConnectionId: leftConnectionId })
  }

  const handleClear = () => {
    clearSelectedPair()
    resetDiff()
    setError(null)
  }

  return (
    <Card style={{ marginBottom: 16 }}>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Space wrap size="middle" style={{ width: '100%' }}>
          {/* 左DB */}
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>左DB（比較元）</Text>
            <Select
              style={{ width: 320, display: 'block', marginTop: 4 }}
              placeholder="接続設定を選択"
              value={leftConnectionId}
              options={connectionOptions.filter((o) => o.value !== rightConnectionId)}
              onChange={(val) => { setSelectedPair({ leftConnectionId: val ?? null }); resetDiff() }}
              allowClear
              showSearch
              optionFilterProp="label"
            />
          </div>

          {/* スワップボタン */}
          <Tooltip title="左右を入れ替え">
            <Button
              icon={<SwapOutlined />}
              style={{ marginTop: 20 }}
              onClick={handleSwap}
              disabled={!leftConnectionId && !rightConnectionId}
            />
          </Tooltip>

          {/* 右DB */}
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>右DB（比較先）</Text>
            <Select
              style={{ width: 320, display: 'block', marginTop: 4 }}
              placeholder="接続設定を選択"
              value={rightConnectionId}
              options={connectionOptions.filter((o) => o.value !== leftConnectionId)}
              onChange={(val) => { setSelectedPair({ rightConnectionId: val ?? null }); resetDiff() }}
              allowClear
              showSearch
              optionFilterProp="label"
            />
          </div>

          {/* 比較開始ボタン */}
          <Button
            type="primary"
            icon={tableDiffLoading ? <Spin size="small" /> : <PlayCircleOutlined />}
            disabled={!canCompare || tableDiffLoading}
            onClick={handleCompare}
            style={{ marginTop: 20, minWidth: 120 }}
            size="large"
          >
            {tableDiffLoading ? '比較中...' : '比較開始'}
          </Button>

          {/* 選択クリアボタン */}
          <Tooltip title="左右のDB選択と比較結果をクリア">
            <Button
              icon={<ClearOutlined />}
              danger
              disabled={!hasAnySelection}
              onClick={handleClear}
              style={{ marginTop: 20 }}
            >
              クリア
            </Button>
          </Tooltip>
        </Space>

        {leftConnectionId === rightConnectionId && leftConnectionId !== null && (
          <Alert message="左DBと右DBに同じ接続設定が選択されています" type="warning" showIcon />
        )}
        {error && <Alert message={error} type="error" showIcon />}
      </Space>
    </Card>
  )
}
