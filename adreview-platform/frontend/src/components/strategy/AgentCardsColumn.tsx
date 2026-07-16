import { useState } from 'react'
import { InputNumber, Space, Switch, Typography, message as antMessage } from 'antd'
import type { AuditItem } from '@/types/domain'
import { auditItemsApi } from '@/api/auditItems'

const { Text } = Typography

interface Props {
  packageCode: string | null
  items: AuditItem[]
}

/**
 * 审核 Agent 卡片列。
 *
 * - 每张卡片对应一个自定义 item(is_builtin=false)
 * - 卡片横版布局:标题 + 启用 + 3 档阈值(低/中/高 min, max 自动反推)
 * - 不展开具体审核点(item 级共享阈值,适用上千条 point)
 * - 不展示「共用阈值」提示文案(用户决策 2026-07-29)
 * - 「审核内容」展示 item.description;为空时显示「—」
 *
 * 阈值变化触发 PATCH /audit_items/{id} 单点更新。
 */
export default function AgentCardsColumn({ packageCode, items }: Props) {
  const [savingByItemId, setSavingByItemId] = useState<Record<number, boolean>>({})

  if (items.length === 0) return null

  const onPatch = async (
    item: AuditItem,
    payload: {
      low_threshold_min?: number
      medium_threshold_min?: number
      high_threshold_min?: number
      is_enabled?: boolean
    },
  ) => {
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
    <div style={{ marginTop: 32 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          paddingBottom: 10,
          borderBottom: '1px solid var(--color-border)',
          marginBottom: 16,
        }}
      >
        <Text strong style={{ fontSize: 14, color: '#0F172A' }}>
          审核 Agent
        </Text>
        <span
          style={{
            fontSize: 11,
            padding: '1px 8px',
            borderRadius: 10,
            background: '#F1F5F9',
            color: '#64748B',
            lineHeight: 1.6,
          }}
        >
          {items.length}
        </span>
      </div>

      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        {items.map((item) => {
          const saving = savingByItemId[item.id] ?? false
          return (
            <AgentCard
              key={item.id}
              item={item}
              saving={saving}
              onPatch={onPatch}
            />
          )
        })}
      </Space>
    </div>
  )
}

interface CardProps {
  item: AuditItem
  saving: boolean
  onPatch: (
    item: AuditItem,
    payload: {
      low_threshold_min?: number
      medium_threshold_min?: number
      high_threshold_min?: number
      is_enabled?: boolean
    },
  ) => Promise<void>
}

function AgentCard({ item, saving, onPatch }: CardProps) {
  const lowMin = item.low_threshold_min ?? 0
  const medMin = item.medium_threshold_min ?? 60
  const highMin = item.high_threshold_min ?? 90

  const lowMaxDisplay = Math.max(0, medMin - 0.01)
  const lowMaxConstraint = lowMaxDisplay
  const medMaxDisplay = Math.max(0, highMin - 0.01)
  const medMaxConstraint = medMaxDisplay

  return (
    <div
      style={{
        background: '#FFFFFF',
        border: '1px solid var(--color-border)',
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
          marginBottom: 12,
        }}
      >
        <Text strong style={{ fontSize: 14, color: '#0F172A' }}>
          {item.name_cn}
        </Text>
        <Switch
          checked={item.is_enabled}
          disabled={saving}
          onChange={(checked) => onPatch(item, { is_enabled: checked })}
          aria-label={`启用 ${item.name_cn}`}
        />
      </div>

      {/* 阈值横版并排 */}
      <div
        style={{
          display: 'flex',
          gap: 20,
          flexWrap: 'wrap',
        }}
      >
        <ThresholdField
          label="低风险分"
          minValue={lowMin}
          maxDisplay={lowMaxDisplay}
          maxConstraint={lowMaxConstraint}
          disabled={saving}
          onChange={(v) => onPatch(item, { low_threshold_min: v ?? 0 })}
        />
        <ThresholdField
          label="中风险分"
          minValue={medMin}
          maxDisplay={medMaxDisplay}
          maxConstraint={medMaxConstraint}
          disabled={saving}
          onChange={(v) => onPatch(item, { medium_threshold_min: v ?? 60 })}
        />
        <ThresholdField
          label="高风险分"
          minValue={highMin}
          maxDisplay={100}
          maxConstraint={100}
          disabled={saving}
          onChange={(v) => onPatch(item, { high_threshold_min: v ?? 90 })}
        />
      </div>

      {/* 审核内容(item.description) */}
      <div style={{ marginTop: 12 }}>
        {item.description ? (
          <Text type="secondary" style={{ fontSize: 12, lineHeight: 1.6 }}>
            审核内容:{item.description}
          </Text>
        ) : (
          <Text type="secondary" style={{ fontSize: 12, color: '#CBD5E1' }}>
            审核内容:—
          </Text>
        )}
      </div>
    </div>
  )
}

interface FieldProps {
  label: string
  minValue: number
  maxDisplay: number
  maxConstraint: number
  disabled: boolean
  onChange: (v: number | null) => void
}

function ThresholdField({
  label,
  minValue,
  maxDisplay,
  maxConstraint,
  disabled,
  onChange,
}: FieldProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <Text type="secondary" style={{ fontSize: 12 }}>
        {label}
      </Text>
      <Space size={6} align="center">
        <InputNumber
          size="small"
          min={0}
          max={maxConstraint}
          step={0.01}
          precision={2}
          value={minValue}
          disabled={disabled}
          onChange={(v) => onChange(typeof v === 'number' ? v : null)}
          style={{ width: 80 }}
        />
        <Text type="secondary" style={{ fontSize: 12 }}>
          ~
        </Text>
        <div
          style={{
            width: 80,
            fontSize: 12,
            color: '#64748B',
            padding: '0 11px',
            lineHeight: '24px',
            background: '#F8FAFC',
            border: '1px solid #E2E8F0',
            borderRadius: 6,
            textAlign: 'center',
          }}
        >
          {maxDisplay.toFixed(2)}
        </div>
      </Space>
    </div>
  )
}