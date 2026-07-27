import { useState } from 'react'
import { Space, Switch, Typography, message as antMessage } from 'antd'
import { RobotOutlined } from '@ant-design/icons'
import type { AuditItem } from '@/types/domain'
import { auditItemsApi } from '@/api/auditItems'

const { Text } = Typography

interface Props {
  packageCode: string | null
  items: AuditItem[]
}

/**
 * 审核 Agent 卡片列(2026-07-29 视觉强化 v2;2026-07-29 进一步裁剪为仅保留启动开关)。
 *
 * - 顶部浅色横幅(icon + 计数),由外层 .module-box 包裹
 * - 每张卡片左侧 4px 蓝色色块锚点
 * - 卡片字段收敛为「item 名 + 启用 Switch」一项,风险分档位已下沉到 Box A 审核点表格
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
      {/* 顶部横幅 2026-07-29 改为浅色:取消黑色背景,与 Box 整体风格一致 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 16,
        }}
      >
        <RobotOutlined style={{ fontSize: 18, color: '#2563EB' }} />
        <Text style={{ fontSize: 14, fontWeight: 600, color: '#0F172A' }}>
          审核 Agent
        </Text>
        <span
          style={{
            fontSize: 11,
            padding: '2px 8px',
            borderRadius: 10,
            background: 'var(--color-divider)',
            color: 'var(--color-muted)',
            lineHeight: 1.6,
            fontWeight: 500,
          }}
        >
          {items.length}
        </span>
        <Text
          style={{
            marginLeft: 'auto',
            fontSize: 12,
            color: '#94A3B8',
          }}
        >
          仅启用 Agent,风险分档位请在左侧审核点表格调整
        </Text>
      </div>

      <Space direction="vertical" size={12} style={{ width: '100%' }}>
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
  return (
    <div
      style={{
        background: '#FFFFFF',
        border: '1px solid var(--color-border)',
        borderLeft: '4px solid #2563EB',
        borderRadius: 8,
        padding: '14px 16px',
        opacity: saving ? 0.7 : 1,
        transition: 'opacity 200ms',
      }}
    >
      {/* 标题行:item 名称 + 启用开关 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Text strong style={{ fontSize: 15, color: '#0F172A' }}>
          {item.name_cn}
        </Text>
        <Switch
          checked={item.is_enabled}
          disabled={saving}
          onChange={(checked) => onPatch(item, { is_enabled: checked })}
          aria-label={`启用 ${item.name_cn}`}
        />
      </div>
    </div>
  )
}