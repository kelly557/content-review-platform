import { useEffect, useState } from 'react'
import { Space, Switch, Typography, message as antMessage } from 'antd'
import type { AuditItem } from '@/types/domain'
import { auditItemsApi } from '@/api/auditItems'

const { Text } = Typography

interface Props {
  packageCode: string | null
  items: AuditItem[]
}

/**
 * 审核 Agent 卡片列(2026-07-30 进一步去视觉)。
 *
 * - 顶部 banner 仅保留「审核 Agent」标题 + 计数,无 icon、无副标题
 * - 每张 Agent 行去所有卡片样式(border/底色/圆角/左色块),只保留 padding + 内容
 * - 布局:Switch 在左、item 名在右
 */
export default function AgentCardsColumn({ packageCode, items }: Props) {
  const [savingByItemId, setSavingByItemId] = useState<Record<number, boolean>>({})

  if (items.length === 0) return null

  const onPatch = async (item: AuditItem, payload: { is_enabled?: boolean }) => {
    if (!packageCode) return
    if (item.is_builtin) return
    setSavingByItemId((m) => ({ ...m, [item.id]: true }))
    try {
      await auditItemsApi.update(packageCode, item.id, payload)
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      antMessage.error(detail || '保存失败')
    } finally {
      setSavingByItemId((m) => ({ ...m, [item.id]: false }))
    }
  }

  return (
    <div>
      {/* 顶部 banner：2026-07-30 去 icon 与副标题，仅保留标题 + 计数 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 16,
        }}
      >
        <Text style={{ fontSize: 14, fontWeight: 600, color: '#0F172A' }}>
          审核 Agent
        </Text>
        <span
          style={{
            fontSize: 11,
            padding: '2px 8px',
            color: '#94A3B8',
            lineHeight: 1.6,
            fontWeight: 500,
          }}
        >
          {items.length}
        </span>
      </div>

      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        {items.map((item) => {
          const saving = savingByItemId[item.id] ?? false
          return (
            <AgentCard key={item.id} item={item} saving={saving} onPatch={onPatch} />
          )
        })}
      </Space>
    </div>
  )
}

interface CardProps {
  item: AuditItem
  saving: boolean
  onPatch: (item: AuditItem, payload: { is_enabled?: boolean }) => Promise<void>
}

function AgentCard({ item, saving, onPatch }: CardProps) {
  // 2026-07-30 fix: 启动开关不能切换的问题
  // - 之前 checked={item.is_enabled} 直接绑 props,后端 PATCH 后 props 不刷新,
  //   用户视觉上「点了没反应」。改为本地 state 乐观更新 + 失败回滚。
  const [localEnabled, setLocalEnabled] = useState(item.is_enabled)

  // props 变化(父组件刷新 items)时同步本地 state
  useEffect(() => {
    setLocalEnabled(item.is_enabled)
  }, [item.is_enabled])

  const onToggle = async (checked: boolean) => {
    const prev = localEnabled
    setLocalEnabled(checked)
    try {
      await onPatch(item, { is_enabled: checked })
    } catch {
      setLocalEnabled(prev)
    }
  }

  return (
    <div
      style={{
        padding: '8px 16px',
        opacity: saving ? 0.7 : 1,
        transition: 'opacity 200ms',
      }}
    >
      {/* 2026-07-30：去卡片样式 (border/底色/圆角/左色块) + Switch 移到左侧 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <Switch
          checked={localEnabled}
          loading={saving}
          onChange={onToggle}
          aria-label={`启用 ${item.name_cn}`}
        />
        <Text strong style={{ fontSize: 15, color: '#0F172A' }}>
          {item.name_cn}
        </Text>
      </div>
    </div>
  )
}