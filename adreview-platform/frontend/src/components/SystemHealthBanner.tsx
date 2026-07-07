import { Alert } from 'antd'
import { useEffect, useState } from 'react'
import { api } from '@/api/client'

interface DbHealth {
  ok: boolean
  latency_ms?: number
  error?: string
}

const POLL_MS = 30_000

export function SystemHealthBanner() {
  const [db, setDb] = useState<DbHealth | null>(null)

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const start = Date.now()
        const res = await api.get<DbHealth>('/health/db')
        if (!cancelled) {
          setDb({ ...res.data, latency_ms: res.data.latency_ms ?? Date.now() - start })
        }
      } catch (e: unknown) {
        const err = e as { message?: string; response?: { status?: number } }
        if (!cancelled) {
          setDb({ ok: false, error: err.response?.status ? `HTTP ${err.response.status}` : (err.message ?? 'unreachable') })
        }
      }
    }
    poll()
    const id = setInterval(poll, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  if (db === null || db.ok) return null

  return (
    <Alert
      type="error"
      showIcon
      banner
      message="后端数据连接异常"
      description={
        <span>
          无法访问后端数据库（{db.error ?? 'timeout'}）。最近的查询可能失败且不会写入保存。
          请检查 PostgreSQL 服务状态；修复后此横幅会在 30 秒内自动消失。
          {db.latency_ms !== undefined && (
            <span style={{ marginLeft: 8, opacity: 0.6 }}>
              上一次延迟：{db.latency_ms}ms
            </span>
          )}
        </span>
      }
      style={{ marginBottom: 16 }}
    />
  )
}
