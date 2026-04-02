import { Card, Checkbox, Radio, InputNumber, Space, Typography, Divider, Button, Tooltip } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { useSettingsStore } from '@/store/settingsStore'
import type { DiffAlgorithm, DiffFilter } from '@/types'

const { Text } = Typography

const ALGORITHM_OPTIONS: { value: DiffAlgorithm; label: string; desc: string }[] = [
  {
    value: 'set_based',
    label: 'Set Based（デフォルト）',
    desc: '主キーでマッチング。順序不問で高速。大量レコードに最適。',
  },
  {
    value: 'ast_based',
    label: 'AST Based',
    desc: '主キーマッチング＋型を考慮した比較（1.0 == 1 など）。',
  },
  {
    value: 'myers',
    label: 'Myers',
    desc: '編集距離最小化。行の追加/削除を最小コストで検出。',
  },
  {
    value: 'patience',
    label: 'Patience',
    desc: '一意な行を基点とした差分。可読性の高い差分結果。',
  },
  {
    value: 'histogram',
    label: 'Histogram',
    desc: '出現頻度の低い行を優先マッチ。大規模差分に強い。',
  },
  {
    value: 'greedy_lcs',
    label: 'Greedy LCS',
    desc: 'ハッシュベースのO(n)近似LCS。超高速だが近似値。',
  },
]

export default function SettingsPanel() {
  const { settings, setDefaultFilter, setDiffAlgorithm, setBatchSize, resetSettings } = useSettingsStore()
  const { defaultFilter, diffAlgorithm, batchSize } = settings

  const handleFilterChange = (key: keyof DiffFilter, checked: boolean) => {
    setDefaultFilter({ ...defaultFilter, [key]: checked })
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="large">
      {/* ── デフォルト抽出条件 ── */}
      <Card
        title="デフォルト抽出条件"
        extra={
          <Tooltip title="全設定をリセット">
            <Button icon={<ReloadOutlined />} size="small" onClick={resetSettings}>
              リセット
            </Button>
          </Tooltip>
        }
      >
        <Text type="secondary" style={{ fontSize: 12 }}>
          テーブル差分・レコード差分画面を開いた際に初期適用されるフィルタです。
        </Text>
        <div style={{ marginTop: 12 }}>
          <Space size="large" wrap>
            <Checkbox
              checked={defaultFilter.showEqual}
              onChange={(e) => handleFilterChange('showEqual', e.target.checked)}
            >
              <Text style={{ color: '#389e0d' }}>一致</Text>
            </Checkbox>
            <Checkbox
              checked={defaultFilter.showAdded}
              onChange={(e) => handleFilterChange('showAdded', e.target.checked)}
            >
              <Text style={{ color: '#096dd9' }}>追加</Text>
            </Checkbox>
            <Checkbox
              checked={defaultFilter.showDeleted}
              onChange={(e) => handleFilterChange('showDeleted', e.target.checked)}
            >
              <Text style={{ color: '#cf1322' }}>削除</Text>
            </Checkbox>
            <Checkbox
              checked={defaultFilter.showModified}
              onChange={(e) => handleFilterChange('showModified', e.target.checked)}
            >
              <Text style={{ color: '#d46b08' }}>変更</Text>
            </Checkbox>
          </Space>
        </div>
      </Card>

      {/* ── 差分アルゴリズム ── */}
      <Card title="差分アルゴリズム">
        <Text type="secondary" style={{ fontSize: 12 }}>
          レコード差分の比較に使用するアルゴリズムです。大量レコードには Set Based または Greedy LCS を推奨します。
        </Text>
        <Divider style={{ margin: '12px 0' }} />
        <Radio.Group
          value={diffAlgorithm}
          onChange={(e) => setDiffAlgorithm(e.target.value as DiffAlgorithm)}
        >
          <Space direction="vertical" size="middle">
            {ALGORITHM_OPTIONS.map((opt) => (
              <Radio key={opt.value} value={opt.value}>
                <Space direction="vertical" size={0}>
                  <Text strong>{opt.label}</Text>
                  <Text type="secondary" style={{ fontSize: 11 }}>{opt.desc}</Text>
                </Space>
              </Radio>
            ))}
          </Space>
        </Radio.Group>
      </Card>

      {/* ── バッチサイズ ── */}
      <Card title="フェッチバッチサイズ">
        <Text type="secondary" style={{ fontSize: 12 }}>
          1回のDBクエリで取得するレコード数です。大きいほど高速ですがメモリを消費します。
        </Text>
        <div style={{ marginTop: 12 }}>
          <Space align="center">
            <InputNumber
              min={100}
              max={50000}
              step={500}
              value={batchSize}
              onChange={(val) => val !== null && setBatchSize(val)}
              style={{ width: 160 }}
            />
            <Text type="secondary">件 / バッチ</Text>
          </Space>
        </div>
      </Card>

      {/* ── バージョン情報 ── */}
      <Card title="バージョン情報" size="small">
        <Space direction="vertical" size={2}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            <b>アプリ名:</b> DB Diff Viewer
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            <b>バージョン:</b> 1.2.0
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            <b>対応DB:</b> MySQL 5.7 / 8.x、PostgreSQL 14+
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            <b>差分アルゴリズム:</b> 6種類（set_based / ast_based / myers / patience / histogram / greedy_lcs）
          </Text>
        </Space>
      </Card>
    </Space>
  )
}
