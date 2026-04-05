import apiClient from './client'
import type { Connection, ConnectionExport, ConnectionExportItem, ConnectionFormValues, ConnectionImportResult, ConnectionTestResult, DbType } from '@/types'

// バックエンドのスネークケース ↔ フロントエンドのキャメルケース変換
function toSnakeCase(data: ConnectionFormValues) {
  return {
    name: data.name,
    db_type: data.dbType,
    host: data.host,
    port: data.port,
    username: data.username,
    password: data.password,
    schema_name: data.schemaName,
    use_ssh: data.useSsh,
    ssh_host: data.sshHost,
    ssh_port: data.sshPort,
    ssh_username: data.sshUsername,
    ssh_auth_type: data.sshAuthType,
    ssh_password: data.sshPassword,
    ssh_key_path: data.sshKeyPath,
    local_bind_port: data.localBindPort,
  }
}

function toCamelCase(data: Record<string, unknown>): Connection {
  return {
    id: data.id as number,
    name: data.name as string,
    dbType: (data.db_type as DbType) ?? 'mysql',
    host: data.host as string,
    port: data.port as number,
    username: data.username as string,
    schemaName: data.schema_name as string,
    useSsh: data.use_ssh as boolean,
    ssh: data.use_ssh ? {
      host: data.ssh_host as string,
      port: data.ssh_port as number,
      username: data.ssh_username as string,
      authType: data.ssh_auth_type as 'password' | 'key',
      keyPath: data.ssh_key_path as string | undefined,
      localBindPort: data.local_bind_port as number | undefined,
    } : undefined,
    createdAt: data.created_at as string,
    updatedAt: data.updated_at as string,
  }
}

export const connectionsApi = {
  /** 接続設定一覧を取得 */
  list: async (): Promise<Connection[]> => {
    const data = await apiClient.get<Record<string, unknown>[]>('/connections')
    return data.map(toCamelCase)
  },

  /** 接続設定を取得 */
  get: async (id: number): Promise<Connection> => {
    const data = await apiClient.get<Record<string, unknown>>(`/connections/${id}`)
    return toCamelCase(data)
  },

  /** 接続設定を新規作成 */
  create: async (values: ConnectionFormValues): Promise<Connection> => {
    const data = await apiClient.post<Record<string, unknown>>('/connections', toSnakeCase(values))
    return toCamelCase(data)
  },

  /** 接続設定を更新 */
  update: async (id: number, values: ConnectionFormValues): Promise<Connection> => {
    const data = await apiClient.put<Record<string, unknown>>(`/connections/${id}`, toSnakeCase(values))
    return toCamelCase(data)
  },

  /** 接続設定を削除 */
  delete: async (id: number): Promise<void> => {
    await apiClient.delete(`/connections/${id}`)
  },

  /** 接続テスト */
  test: async (id: number): Promise<ConnectionTestResult> => {
    return apiClient.post<ConnectionTestResult>(`/connections/${id}/test`)
  },

  /** 接続設定をエクスポート（パスワードを除く JSON を返す） */
  export: async (): Promise<ConnectionExport> => {
    return apiClient.get<ConnectionExport>('/connections/export')
  },

  /** 接続設定をインポート */
  import: async (connections: ConnectionExportItem[]): Promise<ConnectionImportResult> => {
    return apiClient.post<ConnectionImportResult>('/connections/import', { connections })
  },
}
