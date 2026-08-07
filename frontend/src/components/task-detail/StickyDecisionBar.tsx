import { useState } from 'react'
import { Button, Space, Tag, Typography } from 'antd'
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons'
import { colors } from '@/styles/theme'

const { Text } = Typography

interface Props {
  taskId: number
  taskTitle: string
  isDirty: boolean
  /**
   * If false, both decision buttons are disabled (no pending assignment).
   */
  canDecide: boolean
  onApprove: () => Promise<void> | void
  onReject: () => Promise<void> | void
  /** Optional badge — e.g. role hint or assignment hint shown to user. */
  badge?: string
}

/**
 * Sticky decision bar pinned to the bottom of the page so the two main
 * decision buttons (通过 / 不通过) are always visible, regardless of
 * whether the right panel is collapsed into a drawer or not.
 *
 * The cancel-task action lived here in v6 but was removed in the v8
 * cleanup — cancellation is a workflow concern handled by the lifecycle
 * views (TaskListPage, WorkflowInstance detail), not the reviewer.
 */
export default function StickyDecisionBar({
  taskId,
  taskTitle,
  isDirty,
  canDecide,
  onApprove,
  onReject,
  badge,
}: Props) {
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null)

  const runDecision = async (
    kind: 'approve' | 'reject',
    body: () => Promise<void> | void,
  ) => {
    if (busy) return
    setBusy(kind)
    try {
      await body()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div
      style={{
        position: 'sticky',
        bottom: 0,
        left: 0,
        right: 0,
        height: 56,
        background: '#fff',
        borderTop: `1px solid ${colors.border}`,
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        gap: 12,
        zIndex: 5,
        boxShadow: '0 -1px 4px rgba(15,23,42,0.06)',
      }}
    >
      <Space size={6} wrap style={{ flex: 1, minWidth: 0 }}>
        <Text type="secondary" ellipsis style={{ maxWidth: 320 }}>
          任务 #{taskId} {taskTitle}
        </Text>
        {isDirty && (
          <Tag color="warning" style={{ margin: 0 }}>
            备注未保存
          </Tag>
        )}
        {badge && (
          <Tag color="processing" style={{ margin: 0 }}>
            {badge}
          </Tag>
        )}
      </Space>
      <Space>
        <Button
          type="primary"
          icon={<CheckCircleOutlined />}
          loading={busy === 'approve'}
          disabled={!canDecide || busy === 'reject'}
          onClick={() => runDecision('approve', onApprove)}
        >
          通过
        </Button>
        <Button
          danger
          icon={<CloseCircleOutlined />}
          loading={busy === 'reject'}
          disabled={!canDecide || busy === 'approve'}
          onClick={() => runDecision('reject', onReject)}
        >
          不通过
        </Button>
      </Space>
    </div>
  )
}
