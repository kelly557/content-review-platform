import { useState } from 'react'
import {
  Button,
  Space,
  Tooltip,
  Typography,
} from 'antd'
import {
  CheckOutlined,
  CloseOutlined,
  EditOutlined,
} from '@ant-design/icons'

const { Text } = Typography

export type InlineEditableField = 'api_key' | 'token_expires_at' | 'endpoint_url'

interface InlineEditableCellProps {
  /** 字段标识 */
  field: InlineEditableField
  /** 当前显示值（string | null） */
  value: string | null
  /** 是否可编辑（角色判断） */
  canWrite: boolean
  /** 是否处于 editing 状态（外部控制：单一 cell 一时刻只允许 1 个 editing） */
  isEditing: boolean
  /** 进入编辑回调 */
  onStartEdit: () => void
  /** 取消编辑回调 */
  onCancelEdit: () => void
  /**
   * 保存回调：返回字符串视为错误（inline 红字提示），返回 undefined 视为成功。
   * 抛错也视为失败。
   */
  onSave: () => Promise<string | void> | string | void
  /** 当前 cell 的渲染（view 模式） */
  renderDisplay: () => React.ReactNode
  /** 当前 cell 的 input（editing 模式） */
  renderInput: () => React.ReactNode
  /** input 测试连接按钮（可选）：点击即调 onSave */
  showTestButton?: boolean
}

/**
 * 列表行内可编辑 cell。
 *
 * 状态机：
 *   view     → 点 ✏️ → editing（draft 值）
 *   editing  → 点 ✓ → saving（precheck + 真实 API）
 *   editing  → 点 ✗ 或按 Esc → view
 *   saving   → 失败 → editing（保留输入 + 显示 errorMsg）
 *   saving   → 成功 → view（外部 fetchList 刷新）
 *
 * 外部约束：
 *   - 一行一格：isEditing 由父组件集中管理（同一时刻只允许一个 editing）
 *   - 编辑失败时**不自动退出**，让用户改完再提交
 */
export default function InlineEditableCell({
  isEditing,
  onStartEdit,
  onCancelEdit,
  onSave,
  renderDisplay,
  renderInput,
  canWrite,
}: InlineEditableCellProps) {
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const handleSave = async () => {
    setSaving(true)
    try {
      const result = await onSave()
      if (typeof result === 'string' && result) {
        setErrorMsg(result)
      } else {
        setErrorMsg(null)
        onCancelEdit()
      }
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      const msg =
        typeof detail === 'string'
          ? detail
          : typeof detail === 'object' && detail && 'message' in detail
            ? String((detail as { message?: unknown }).message)
            : (e as Error)?.message ?? '保存失败'
      setErrorMsg(msg)
    } finally {
      setSaving(false)
    }
  }

  if (!canWrite) {
    return <>{renderDisplay()}</>
  }

  if (!isEditing) {
    return (
      <Space size={4} style={{ width: '100%' }}>
        {renderDisplay()}
        <Tooltip title="编辑">
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={onStartEdit}
          />
        </Tooltip>
      </Space>
    )
  }

  return (
    <div>
      <Space.Compact style={{ width: '100%' }}>
        <div style={{ flex: 1 }}>{renderInput()}</div>
        <Button
          type="primary"
          size="small"
          icon={<CheckOutlined />}
          loading={saving}
          onClick={handleSave}
        />
        <Button
          size="small"
          icon={<CloseOutlined />}
          onClick={() => {
            setErrorMsg(null)
            onCancelEdit()
          }}
          disabled={saving}
        />
      </Space.Compact>
      {errorMsg && (
        <Text type="danger" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
          {errorMsg}
        </Text>
      )}
    </div>
  )
}