import { useState } from 'react'
import {
  Form, Input, InputNumber, Button, Switch, Select, Space, Divider, message,
} from 'antd'
import { useConnectionStore } from '@/store/connectionStore'
import { connectionsApi } from '@/api/connections'
import type { Connection, ConnectionFormValues, DbType } from '@/types'

const DB_TYPE_OPTIONS = [
  { value: 'mysql', label: 'MySQL' },
  { value: 'postgresql', label: 'PostgreSQL' },
]

const DEFAULT_PORTS: Record<DbType, number> = {
  mysql: 3306,
  postgresql: 5432,
}

interface Props {
  editTarget: Connection | null
  onSuccess: () => void
  onCancel: () => void
}

export default function ConnectionForm({ editTarget, onSuccess, onCancel }: Props) {
  const [form] = Form.useForm<ConnectionFormValues>()
  const [submitting, setSubmitting] = useState(false)
  const [testing, setTesting] = useState(false)
  const useSsh = Form.useWatch('useSsh', form)
  const sshAuthType = Form.useWatch('sshAuthType', form)
  const dbType = Form.useWatch('dbType', form) as DbType | undefined

  const { addConnection, updateConnection } = useConnectionStore()

  // 編集時は初期値をセット
  const initialValues: Partial<ConnectionFormValues> = editTarget
    ? {
        name: editTarget.name,
        dbType: editTarget.dbType ?? 'mysql',
        host: editTarget.host,
        port: editTarget.port,
        username: editTarget.username,
        schemaName: editTarget.schemaName,
        useSsh: editTarget.useSsh,
        sshHost: editTarget.ssh?.host,
        sshPort: editTarget.ssh?.port ?? 22,
        sshUsername: editTarget.ssh?.username,
        sshAuthType: editTarget.ssh?.authType ?? 'key',
        sshKeyPath: editTarget.ssh?.keyPath,
        localBindPort: editTarget.ssh?.localBindPort ?? 0,
      }
    : { dbType: 'mysql', port: 3306, useSsh: false, sshPort: 22, sshAuthType: 'key', localBindPort: 0 }

  const handleDbTypeChange = (value: DbType) => {
    // ポートがデフォルト値のままなら自動更新する（dbType は変更前の値）
    const currentPort = form.getFieldValue('port') as number
    const prevType = dbType ?? 'mysql'
    if (currentPort === DEFAULT_PORTS[prevType]) {
      form.setFieldValue('port', DEFAULT_PORTS[value])
    }
  }

  const handleSubmit = async (values: ConnectionFormValues) => {
    setSubmitting(true)
    try {
      if (editTarget) {
        const updated = await connectionsApi.update(editTarget.id, values)
        updateConnection(updated)
        message.success('接続設定を更新しました')
      } else {
        const created = await connectionsApi.create(values)
        addConnection(created)
        message.success('接続設定を作成しました')
      }
      onSuccess()
    } finally {
      setSubmitting(false)
    }
  }

  const handleTest = async () => {
    if (!editTarget) {
      message.warning('接続テストは保存後に行えます')
      return
    }
    setTesting(true)
    try {
      const result = await connectionsApi.test(editTarget.id)
      if (result.success) {
        message.success(`接続成功 (${result.latencyMs ?? '?'}ms)`)
      } else {
        message.error(`接続失敗: ${result.message}`)
      }
    } finally {
      setTesting(false)
    }
  }

  return (
    <Form
      form={form}
      layout="vertical"
      initialValues={initialValues}
      onFinish={handleSubmit}
      requiredMark="optional"
    >
      {/* ===== 基本設定 ===== */}
      <Form.Item name="name" label="設定名" rules={[{ required: true, message: '設定名を入力してください' }]}>
        <Input placeholder="例: 本番DB" />
      </Form.Item>

      <Form.Item name="dbType" label="DBの種類" rules={[{ required: true }]}>
        <Select options={DB_TYPE_OPTIONS} onChange={handleDbTypeChange} />
      </Form.Item>

      <Form.Item name="host" label="ホスト名" rules={[{ required: true }]}>
        <Input placeholder="例: db.example.com または 192.168.1.10" />
      </Form.Item>

      <Space.Compact style={{ width: '100%', marginBottom: 24 }}>
        <Form.Item name="port" label="ポート番号" style={{ width: 150, marginBottom: 0 }}>
          <InputNumber min={1} max={65535} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="schemaName" label="データベース名" rules={[{ required: true }]} style={{ flex: 1, marginBottom: 0, marginLeft: 8 }}>
          <Input placeholder="例: myapp_production" />
        </Form.Item>
      </Space.Compact>

      <Form.Item name="username" label="ユーザー名" rules={[{ required: true }]}>
        <Input placeholder="例: readonly_user" />
      </Form.Item>

      <Form.Item name="password" label="パスワード" rules={[{ required: !editTarget, message: 'パスワードを入力してください' }]}>
        <Input.Password placeholder={editTarget ? '変更する場合のみ入力' : 'パスワードを入力'} />
      </Form.Item>

      {/* ===== SSH ポートフォワード設定 ===== */}
      <Divider orientation="left" style={{ fontSize: 13 }}>SSHポートフォワード（踏み台サーバー経由の場合）</Divider>

      <Form.Item name="useSsh" label="SSHポートフォワードを使用" valuePropName="checked">
        <Switch />
      </Form.Item>

      {useSsh && (
        <>
          <Form.Item name="sshHost" label="SSHホスト名（踏み台）" rules={[{ required: useSsh }]}>
            <Input placeholder="例: bastion.example.com" />
          </Form.Item>

          <Space.Compact style={{ width: '100%', marginBottom: 24 }}>
            <Form.Item name="sshPort" label="SSHポート" style={{ width: 150, marginBottom: 0 }}>
              <InputNumber min={1} max={65535} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="sshUsername" label="SSHユーザー名" rules={[{ required: useSsh }]} style={{ flex: 1, marginBottom: 0, marginLeft: 8 }}>
              <Input placeholder="例: ec2-user" />
            </Form.Item>
          </Space.Compact>

          <Form.Item name="sshAuthType" label="SSH認証方式">
            <Select options={[{ value: 'key', label: '秘密鍵' }, { value: 'password', label: 'パスワード' }]} />
          </Form.Item>

          {sshAuthType === 'key' ? (
            <Form.Item name="sshKeyPath" label="秘密鍵ファイルパス（コンテナ内）" rules={[{ required: sshAuthType === 'key' && useSsh }]}>
              <Input placeholder="例: /ssh_keys/id_rsa" />
            </Form.Item>
          ) : (
            <Form.Item name="sshPassword" label="SSHパスワード" rules={[{ required: sshAuthType === 'password' && useSsh }]}>
              <Input.Password />
            </Form.Item>
          )}

          <Form.Item name="localBindPort" label="ローカルフォワードポート（0 = 自動）">
            <InputNumber min={0} max={65535} style={{ width: 150 }} />
          </Form.Item>
        </>
      )}

      {/* ===== ボタン ===== */}
      <Form.Item style={{ marginBottom: 0, marginTop: 16 }}>
        <Space>
          <Button type="primary" htmlType="submit" loading={submitting}>
            {editTarget ? '更新' : '作成'}
          </Button>
          {editTarget && (
            <Button onClick={handleTest} loading={testing}>
              接続テスト
            </Button>
          )}
          <Button onClick={onCancel}>キャンセル</Button>
        </Space>
      </Form.Item>
    </Form>
  )
}
