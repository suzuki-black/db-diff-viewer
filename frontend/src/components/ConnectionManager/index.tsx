import { useState } from 'react'
import {
  Card, Table, Button, Space, Popconfirm, Tag, message, Tooltip, Modal,
} from 'antd'
import {
  PlusOutlined, EditOutlined, DeleteOutlined, ApiOutlined, CheckCircleOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons'
import { useConnectionStore } from '@/store/connectionStore'
import { connectionsApi } from '@/api/connections'
import type { Connection } from '@/types'
import ConnectionForm from './ConnectionForm'

export default function ConnectionManager() {
  const { connections, loading, fetchConnections, removeConnection } = useConnectionStore()
  const [formOpen, setFormOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Connection | null>(null)
  const [testingId, setTestingId] = useState<number | null>(null)

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
      <Card
        title="DB接続設定一覧"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            新規追加
          </Button>
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
