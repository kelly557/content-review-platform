import { useState } from 'react'
import { InputNumber, Space, Switch, Typography, message as antMessage } from 'antd'
import { RobotOutlined } from '@ant-design/icons'
import type { AuditItem } from '@/types/domain'
import { auditItemsApi } from '@/api/auditItems'

const { Text } = Typography

interface Props {
  packageCode: string | null
  items: AuditItem[]
}

/**
 * 审核 Agent 卡片列(2026-07-29 视觉强化 v2)。
 *
 * - 顶部深色横幅(icon + 大字 + 计数),由外层 .module-box 包裹
 * - 每张卡片左侧 4px 蓝色色块锚点
 * - 卡片字段(item 名 + 启用 Switch + 3 档阈值)横版并排 3 列
 *   (2026-07-29 用户反馈:去掉「审核内容」列)
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
          在此直接定义 Agent 共享阈值(适用于上千条审核点)
        </Text>
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
          marginBottom: 14,
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

      {/* 3 列横版:低/中/高阈值(2026-07-29 去掉审核内容列) */}
      <div
        style={{
          display: 'flex',
          gap: 24,
          flexWrap: 'wrap',
          alignItems: 'flex-start',
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