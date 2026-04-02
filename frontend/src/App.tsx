import { useEffect, useState } from 'react'
import { Layout, Menu, Typography, Alert } from 'antd'
import {
  DatabaseOutlined,
  SettingOutlined,
  DiffOutlined,
  ToolOutlined,
} from '@ant-design/icons'
import { useConnectionStore } from '@/store/connectionStore'
import { useDiffStore } from '@/store/diffStore'
import ConnectionManager from '@/components/ConnectionManager'
import DBSelector from '@/components/DBSelector'
import TableDiffView from '@/components/TableDiffView'
import RecordDiffView from '@/components/RecordDiffView'
import SettingsPanel from '@/components/SettingsPanel'
import { APP_VERSION } from './version'

const { Header, Sider, Content } = Layout
const { Title, Text } = Typography

type NavKey = 'connections' | 'compare' | 'settings'

export default function App() {
  const [navKey, setNavKey] = useState<NavKey>('connections')
  const [siderCollapsed, setSiderCollapsed] = useState(false)
  const [initError, setInitError] = useState<string | null>(null)

  const { fetchConnections } = useConnectionStore()
  const { selectedTableName } = useDiffStore()

  // アプリ起動時に接続設定を読み込む
  useEffect(() => {
    fetchConnections().catch((e) => {
      setInitError(`バックエンドへの接続に失敗しました: ${String(e)}`)
    })
  }, [fetchConnections])

  // テーブルが選択されたら自動的に比較ビューに切り替え
  useEffect(() => {
    if (selectedTableName) {
      setNavKey('compare')
    }
  }, [selectedTableName])

  const menuItems = [
    {
      key: 'connections',
      icon: <SettingOutlined />,
      label: 'DB接続設定',
    },
    {
      key: 'compare',
      icon: <DiffOutlined />,
      label: 'DB比較',
    },
    {
      key: 'settings',
      icon: <ToolOutlined />,
      label: '一般設定',
    },
  ]

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {/* ===== ヘッダー ===== */}
      <Header
        style={{
          background: '#1F4E79',
          padding: '0 24px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <DatabaseOutlined style={{ fontSize: 22, color: '#fff' }} />
        <Title level={4} style={{ margin: 0, color: '#fff', lineHeight: 1 }}>
          DB Diff Viewer
        </Title>
        {/* バージョン表示 */}
        <Text
          style={{
            color: 'rgba(255,255,255,0.55)',
            fontSize: 12,
            fontWeight: 400,
            marginLeft: 2,
            marginTop: 2,
            letterSpacing: '0.03em',
          }}
        >
          v{APP_VERSION}
        </Text>
      </Header>

      <Layout>
        {/* ===== サイドバー ===== */}
        <Sider
          collapsible
          collapsed={siderCollapsed}
          onCollapse={setSiderCollapsed}
          theme="light"
          width={220}
          style={{ borderRight: '1px solid #e8e8e8' }}
        >
          <Menu
            mode="inline"
            selectedKeys={[navKey]}
            items={menuItems}
            onClick={({ key }) => setNavKey(key as NavKey)}
            style={{ height: '100%', borderRight: 0 }}
          />
        </Sider>

        {/* ===== メインコンテンツ ===== */}
        <Content style={{ padding: 24, overflow: 'auto' }}>
          {initError && (
            <Alert
              message="起動エラー"
              description={initError}
              type="error"
              showIcon
              style={{ marginBottom: 16 }}
            />
          )}

          {navKey === 'connections' && <ConnectionManager />}
          {navKey === 'compare' && (
            <>
              <DBSelector />
              {selectedTableName ? <RecordDiffView /> : <TableDiffView />}
            </>
          )}
          {navKey === 'settings' && <SettingsPanel />}
        </Content>
      </Layout>
    </Layout>
  )
}
