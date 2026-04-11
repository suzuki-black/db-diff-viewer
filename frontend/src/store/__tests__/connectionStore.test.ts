import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useConnectionStore } from '../connectionStore'
import type { Connection } from '@/types'

// localStorage キー（connectionStore.ts と合わせる）
const PAIR_STORAGE_KEY = 'dbdiff_last_selected_pair'

// API モック
vi.mock('@/api/connections', () => ({
  connectionsApi: {
    list: vi.fn(),
  },
}))

import { connectionsApi } from '@/api/connections'

// ダミー接続データ
function makeConnection(id: number, name = `接続${id}`): Connection {
  return {
    id,
    name,
    dbType: 'mysql',
    host: 'localhost',
    port: 3306,
    username: 'user',
    schemaName: 'db',
    useSsh: false,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  }
}

// ストアと localStorage をリセット
function resetStore() {
  localStorage.clear()
  useConnectionStore.setState({
    connections: [],
    loading: false,
    selectedPair: { leftConnectionId: null, rightConnectionId: null },
  })
}

describe('connectionStore', () => {
  beforeEach(() => {
    resetStore()
    vi.clearAllMocks()
  })

  // ── 初期状態 ────────────────────────────────────────────────
  describe('初期状態', () => {
    it('connections は空配列', () => {
      expect(useConnectionStore.getState().connections).toEqual([])
    })

    it('loading は false', () => {
      expect(useConnectionStore.getState().loading).toBe(false)
    })

    it('selectedPair は null / null', () => {
      const { selectedPair } = useConnectionStore.getState()
      expect(selectedPair.leftConnectionId).toBeNull()
      expect(selectedPair.rightConnectionId).toBeNull()
    })
  })

  // ── addConnection ────────────────────────────────────────────
  describe('addConnection', () => {
    it('接続をリストに追加する', () => {
      useConnectionStore.getState().addConnection(makeConnection(1))
      expect(useConnectionStore.getState().connections).toHaveLength(1)
      expect(useConnectionStore.getState().connections[0].id).toBe(1)
    })

    it('複数回追加すると順番通りにリストへ積まれる', () => {
      useConnectionStore.getState().addConnection(makeConnection(1))
      useConnectionStore.getState().addConnection(makeConnection(2))
      const ids = useConnectionStore.getState().connections.map((c) => c.id)
      expect(ids).toEqual([1, 2])
    })
  })

  // ── updateConnection ─────────────────────────────────────────
  describe('updateConnection', () => {
    it('同じ ID の接続を更新する', () => {
      useConnectionStore.getState().addConnection(makeConnection(1, '旧名'))
      useConnectionStore.getState().updateConnection(makeConnection(1, '新名'))
      expect(useConnectionStore.getState().connections[0].name).toBe('新名')
    })

    it('他の接続は変更されない', () => {
      useConnectionStore.getState().addConnection(makeConnection(1, 'A'))
      useConnectionStore.getState().addConnection(makeConnection(2, 'B'))
      useConnectionStore.getState().updateConnection(makeConnection(1, 'A-updated'))
      expect(useConnectionStore.getState().connections[1].name).toBe('B')
    })
  })

  // ── removeConnection ─────────────────────────────────────────
  describe('removeConnection', () => {
    it('指定した ID の接続を削除する', () => {
      useConnectionStore.getState().addConnection(makeConnection(1))
      useConnectionStore.getState().addConnection(makeConnection(2))
      useConnectionStore.getState().removeConnection(1)
      const ids = useConnectionStore.getState().connections.map((c) => c.id)
      expect(ids).toEqual([2])
    })

    it('left を削除すると leftConnectionId が null になる', () => {
      useConnectionStore.setState({
        selectedPair: { leftConnectionId: 1, rightConnectionId: 2 },
      })
      useConnectionStore.getState().removeConnection(1)
      expect(useConnectionStore.getState().selectedPair.leftConnectionId).toBeNull()
      expect(useConnectionStore.getState().selectedPair.rightConnectionId).toBe(2)
    })

    it('right を削除すると rightConnectionId が null になる', () => {
      useConnectionStore.setState({
        selectedPair: { leftConnectionId: 1, rightConnectionId: 2 },
      })
      useConnectionStore.getState().removeConnection(2)
      expect(useConnectionStore.getState().selectedPair.leftConnectionId).toBe(1)
      expect(useConnectionStore.getState().selectedPair.rightConnectionId).toBeNull()
    })

    it('削除後の selectedPair が localStorage に保存される', () => {
      useConnectionStore.setState({
        selectedPair: { leftConnectionId: 1, rightConnectionId: 2 },
      })
      useConnectionStore.getState().removeConnection(1)
      const saved = JSON.parse(localStorage.getItem(PAIR_STORAGE_KEY) ?? '{}')
      expect(saved.leftConnectionId).toBeNull()
      expect(saved.rightConnectionId).toBe(2)
    })

    it('関係のない接続を削除しても selectedPair は変わらない', () => {
      useConnectionStore.setState({
        selectedPair: { leftConnectionId: 1, rightConnectionId: 2 },
      })
      useConnectionStore.getState().removeConnection(99)
      const { selectedPair } = useConnectionStore.getState()
      expect(selectedPair.leftConnectionId).toBe(1)
      expect(selectedPair.rightConnectionId).toBe(2)
    })
  })

  // ── setSelectedPair ──────────────────────────────────────────
  describe('setSelectedPair', () => {
    it('left を設定する', () => {
      useConnectionStore.getState().setSelectedPair({ leftConnectionId: 3 })
      expect(useConnectionStore.getState().selectedPair.leftConnectionId).toBe(3)
    })

    it('right を設定する', () => {
      useConnectionStore.getState().setSelectedPair({ rightConnectionId: 5 })
      expect(useConnectionStore.getState().selectedPair.rightConnectionId).toBe(5)
    })

    it('部分更新で既存の値を保持する', () => {
      useConnectionStore.setState({
        selectedPair: { leftConnectionId: 1, rightConnectionId: 2 },
      })
      useConnectionStore.getState().setSelectedPair({ leftConnectionId: 10 })
      const { selectedPair } = useConnectionStore.getState()
      expect(selectedPair.leftConnectionId).toBe(10)
      expect(selectedPair.rightConnectionId).toBe(2)
    })

    it('localStorage に保存される', () => {
      useConnectionStore.getState().setSelectedPair({ leftConnectionId: 7, rightConnectionId: 8 })
      const saved = JSON.parse(localStorage.getItem(PAIR_STORAGE_KEY) ?? '{}')
      expect(saved.leftConnectionId).toBe(7)
      expect(saved.rightConnectionId).toBe(8)
    })
  })

  // ── clearSelectedPair ────────────────────────────────────────
  describe('clearSelectedPair', () => {
    it('selectedPair を null / null にリセットする', () => {
      useConnectionStore.setState({
        selectedPair: { leftConnectionId: 1, rightConnectionId: 2 },
      })
      useConnectionStore.getState().clearSelectedPair()
      const { selectedPair } = useConnectionStore.getState()
      expect(selectedPair.leftConnectionId).toBeNull()
      expect(selectedPair.rightConnectionId).toBeNull()
    })

    it('localStorage から削除される', () => {
      localStorage.setItem(PAIR_STORAGE_KEY, JSON.stringify({ leftConnectionId: 1, rightConnectionId: 2 }))
      useConnectionStore.getState().clearSelectedPair()
      expect(localStorage.getItem(PAIR_STORAGE_KEY)).toBeNull()
    })
  })

  // ── fetchConnections ─────────────────────────────────────────
  describe('fetchConnections', () => {
    it('API から接続一覧を取得してストアに反映する', async () => {
      const mockList = [makeConnection(1), makeConnection(2)]
      vi.mocked(connectionsApi.list).mockResolvedValue(mockList)

      await useConnectionStore.getState().fetchConnections()

      const { connections } = useConnectionStore.getState()
      expect(connections).toHaveLength(2)
      expect(connections[0].id).toBe(1)
    })

    it('loading フラグが取得中は true になり完了後 false に戻る', async () => {
      let loadingDuringFetch = false
      vi.mocked(connectionsApi.list).mockImplementation(async () => {
        loadingDuringFetch = useConnectionStore.getState().loading
        return []
      })

      await useConnectionStore.getState().fetchConnections()

      expect(loadingDuringFetch).toBe(true)
      expect(useConnectionStore.getState().loading).toBe(false)
    })

    it('失敗しても loading が false に戻る', async () => {
      vi.mocked(connectionsApi.list).mockRejectedValue(new Error('network error'))

      try {
        await useConnectionStore.getState().fetchConnections()
      } catch {
        // 無視
      }

      expect(useConnectionStore.getState().loading).toBe(false)
    })

    it('存在しない leftConnectionId は null にクリアされる', async () => {
      // ID=99 が selectedPair に設定されているが、API レスポンスには存在しない
      useConnectionStore.setState({
        selectedPair: { leftConnectionId: 99, rightConnectionId: null },
      })
      vi.mocked(connectionsApi.list).mockResolvedValue([makeConnection(1)])

      await useConnectionStore.getState().fetchConnections()

      expect(useConnectionStore.getState().selectedPair.leftConnectionId).toBeNull()
    })

    it('存在しない rightConnectionId は null にクリアされる', async () => {
      useConnectionStore.setState({
        selectedPair: { leftConnectionId: null, rightConnectionId: 99 },
      })
      vi.mocked(connectionsApi.list).mockResolvedValue([makeConnection(1)])

      await useConnectionStore.getState().fetchConnections()

      expect(useConnectionStore.getState().selectedPair.rightConnectionId).toBeNull()
    })

    it('有効な selectedPair はそのまま保持される', async () => {
      useConnectionStore.setState({
        selectedPair: { leftConnectionId: 1, rightConnectionId: 2 },
      })
      vi.mocked(connectionsApi.list).mockResolvedValue([makeConnection(1), makeConnection(2)])

      await useConnectionStore.getState().fetchConnections()

      const { selectedPair } = useConnectionStore.getState()
      expect(selectedPair.leftConnectionId).toBe(1)
      expect(selectedPair.rightConnectionId).toBe(2)
    })

    it('null の selectedPair は有効とみなされクリアされない', async () => {
      useConnectionStore.setState({
        selectedPair: { leftConnectionId: null, rightConnectionId: null },
      })
      vi.mocked(connectionsApi.list).mockResolvedValue([makeConnection(1)])

      await useConnectionStore.getState().fetchConnections()

      const { selectedPair } = useConnectionStore.getState()
      expect(selectedPair.leftConnectionId).toBeNull()
      expect(selectedPair.rightConnectionId).toBeNull()
    })
  })
})
