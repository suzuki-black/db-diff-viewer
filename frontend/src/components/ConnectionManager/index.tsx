import { useRef, useState } from 'react'
import {
  Card, Table, Button, Space, Popconfirm, Tag, message, Tooltip, Modal,
} from 'antd'
import {
  PlusOutlined, EditOutlined, DeleteOutlined, ApiOutlined, CheckCircleOutlined,
  CloseCircleOutlined, ExportOutlined, ImportOutlined,
} from '@ant-design/icons'
import { useConnectionStore } from '@/store/connectionStore'
import { connectionsApi } from '@/api/connections'
import type { Connection, ConnectionExport } from '@/types'
import ConnectionForm from './ConnectionForm'

export default function ConnectionManager() {
  const { connections, loading, fetchConnections, removeConnection } = useConnectionStore()
  const [formOpen, setFormOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Connection | null>(null)
  const [testingId, setTestingId] = useState<number | null>(null)
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleCreate = () => {
    setEditTarget(null)
    setFormOpen(true)
  }

  const handleEdit = (record: Connection) => {
    setEditTarget(record)
    setFormOpen(true)
  }

  const handleDelete = async (id: number) => {
    try {
      await connectionsApi.delete(id)
      removeConnection(id)
      message.success('接続設定を削除しました')
    } catch {
      // エラーはaxiosインターセプターで処理済み
    }
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      const data = await connectionsApi.export()
      const json = JSON.stringify(data, null, 2)
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      a.href = url
      a.download = `db-connections-${timestamp}.json`
      a.click()
      URL.revokeObjectURL(url)
      message.success(`${data.connections.length} 件の接続設定をエクスポートしました`)
    } catch {
      // エラーはaxiosインターセプターで処理済み
    } finally {
      setExporting(false)
    }
  }

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    // input をリセット（同じファイルを再選択できるように）
    e.target.value = ''

    setImporting(true)
    try {
      const text = await file.text()
      const parsed: ConnectionExport = JSON.parse(text)
      if (!Array.isArray(parsed.connections)) {
        message.error('ファイル形式が正しくありません')
        return
      }
      const result = await connectionsApi.import(parsed.connections)
      if (result.created > 0) {
        await fetchConnections()
      }
      if (result.skipped > 0) {
        message.warning(
          `${result.created} 件インポート、${result.skipped} 件スキップ（重複: ${result.skipped_names.join(', ')}）`
        )
      } else {
        message.success(`${result.created} 件の接続設定をインポートしました`)
      }
    } catch {
      message.error('ファイルの読み込みに失敗しました。JSON 形式を確認してください。')
    } finally {
      setImporting(false)
    }
  }

  const handleTest = async (id: number) => {
    setTestingId(id)
    try {
      const result = await connectionsApi.test(id)
      if (result.success) {
        message.success(`接続成功 (${result.latencyMs ?? '?'}ms)`)
      } else {
        message.error(`接続失敗: ${result.message}`)
      }
    } finally {
      setTestingId(null)
    }
  }

  const columns = [
    {
      title: '設定名',
      dataIndex: 'name',
      key: 'name',
      render: (text: string) => <strong>{text}</strong>,
    },
    {
      title: 'DB種類',
      dataIndex: 'dbType',
      key: 'dbType',
      width: 110,
      render: (dbType: string) =>
        dbType === 'postgresql'
          ? <Tag color="blue">PostgreSQL</Tag>
          : <Tag color="orange">MySQL</Tag>,
    },
    {
      title: 'ホスト',
      dataIndex: 'host',
      key: 'host',
    },
    {
      title: 'ポート',
      dataIndex: 'port',
      key: 'port',
      width: 80,
    },
    {
      title: 'スキーマ',
      dataIndex: 'schemaName',
      key: 'schemaName',
    },
    {
      title: 'ユーザー',
      dataIndex: 'username',
      key: 'username',
    },
    {
      title: 'SSH',
      dataIndex: 'useSsh',
      key: 'useSsh',
      width: 80,
      render: (useSsh: boolean) =>
        useSsh ? (
          <Tag color="blue" icon={<CheckCircleOutlined />}>有効</Tag>
        ) : (
          <Tag color="default" icon={<CloseCircleOutlined />}>なし</Tag>
        ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 180,
      render: (_: unknown, record: Connection) => (
        <Space>
          <Tooltip title="接続テスト">
            <Button
              size="small"
              icon={<ApiOutlined />}
              loading={testingId === record.id}
              onClick={() => handleTest(record.id)}
            />
          </Tooltip>
          <Tooltip title="編集">
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => handleEdit(record)}
            />
          </Tooltip>
          <Popconfirm
            title="削除しますか？"
            onConfirm={() => handleDelete(record.id)}
            okText="削除"
            cancelText="キャンセル"
          >
            <Tooltip title="削除">
              <Button size="small" icon={<DeleteOutlined />} danger />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <>
      {/* hidden file input for import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={handleImportFile}
      />

      <Card
        title="DB接続設定一覧"
        extra={
          <Space>
            <Tooltip title="接続設定を JSON ファイルにエクスポート">
              <Button
                icon={<ExportOutlined />}
                loading={exporting}
                onClick={handleExport}
              >
                エクスポート
              </Button>
            </Tooltip>
            <Tooltip title="JSON ファイルから接続設定をインポート">
              <Button
                icon={<ImportOutlined />}
                loading={importing}
                onClick={() => fileInputRef.current?.click()}
              >
                インポート
              </Button>
            </Tooltip>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
              新規追加
            </Button>
          </Space>
        }
      >
        <Table
          dataSource={connections}
          columns={columns}
          rowKey="id"
          loading={loading}
          size="small"
          pagination={{ pageSize: 20 }}
        />
      </Card>

      {/* 接続設定フォームモーダル */}
      <Modal
        title={editTarget ? '接続設定を編集' : '新規接続設定'}
        open={formOpen}
        onCancel={() => setFormOpen(false)}
        footer={null}
        width={640}
        destroyOnClose
      >
        <ConnectionForm
          editTarget={editTarget}
          onSuccess={() => {
            setFormOpen(false)
            fetchConnections()
          }}
          onCancel={() => setFormOpen(false)}
        />
      </Modal>
    </>
  )
}
