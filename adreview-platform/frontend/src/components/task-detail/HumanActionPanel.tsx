import { useState } from 'react'
import { Alert, Button, Form, Input, Modal, Select, Space, Typography } from 'antd'
import {
  CheckOutlined,
  CloseOutlined,
  SwapOutlined,
  UndoOutlined,
  UsergroupAddOutlined,
} from '@ant-design/icons'
import type { ReviewDecision, User } from '@/types/domain'

const { Text } = Typography

export interface DecisionFormValues {
  note?: string
  comment_body?: string
}

interface Props {
  canDecide: boolean
  decisionForm: import('antd').FormInstance<DecisionFormValues>
  users: User[]
  currentUserId?: number
  /** Open transfer dialog */
  onTransfer: (toUserId: number) => Promise<void> | void
  /** Open add-reviewer dialog */
  onAddReviewer: (toUserId: number) => Promise<void> | void
  /** Submit a decision */
  onDecide: (decision: ReviewDecision) => Promise<void> | void
  /** Indicates form has dirty values (used by parent to warn on task switch). */
  onDirtyChange?: (dirty: boolean) => void
}

export default function HumanActionPanel({
  canDecide,
  decisionForm,
  users,
  currentUserId,
  onTransfer,
  onAddReviewer,
  onDecide,
  onDirtyChange,
}: Props) {
  const [transferOpen, setTransferOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [transferTarget, setTransferTarget] = useState<number | null>(null)
  const [addTarget, setAddTarget] = useState<number | null>(null)

  const userOptions = users
    .filter((u) => u.id !== currentUserId)
    .map((u) => ({ value: u.id, label: `${u.full_name} (${u.email}) · ${u.role}` }))

  return (
    <div style={{ padding: 16 }}>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Text strong>人工处理动作</Text>

        {!canDecide && (
          <Alert
            type="info"
            showIcon
            message="当前阶段没有您的待办"
            description="下方按钮已禁用。可继续查看内容并添加批注。"
          />
        )}

        <Form
          form={decisionForm}
          layout="vertical"
          disabled={!canDecide}
          onValuesChange={() => onDirtyChange?.(true)}
        >
          <Form.Item label="备注" name="note">
            <Input.TextArea
              rows={2}
              placeholder="审核意见（保存到决定记录）"
              onChange={() => onDirtyChange?.(true)}
            />
          </Form.Item>
          <Form.Item label="评论（可选）" name="comment_body">
            <Input.TextArea
              rows={2}
              placeholder="附加说明（保存到评论）"
              onChange={() => onDirtyChange?.(true)}
            />
          </Form.Item>

          <Space wrap>
            <Button
              type="primary"
              icon={<CheckOutlined />}
              disabled={!canDecide}
              onClick={() => onDecide('approved')}
            >
              通过
            </Button>
            <Button
              danger
              icon={<CloseOutlined />}
              disabled={!canDecide}
              onClick={() => onDecide('rejected')}
            >
              驳回
            </Button>
            <Button
              icon={<UndoOutlined />}
              disabled={!canDecide}
              onClick={() => onDecide('returned')}
            >
              退回
            </Button>
            <Button
              icon={<SwapOutlined />}
              disabled={!canDecide}
              onClick={() => setTransferOpen(true)}
            >
              转交
            </Button>
            <Button
              icon={<UsergroupAddOutlined />}
              disabled={!canDecide || users.length === 0}
              onClick={() => setAddOpen(true)}
            >
              加签
            </Button>
          </Space>
        </Form>
      </Space>

      <Modal
        title="转交给其他审核人"
        open={transferOpen}
        onCancel={() => setTransferOpen(false)}
        onOk={async () => {
          if (!transferTarget) return
          await onTransfer(transferTarget)
          setTransferTarget(null)
          setTransferOpen(false)
        }}
        okButtonProps={{ disabled: !transferTarget }}
      >
        <Select
          showSearch
          style={{ width: '100%' }}
          placeholder="选择目标审核人"
          optionFilterProp="label"
          value={transferTarget ?? undefined}
          onChange={(v) => setTransferTarget(v)}
          options={userOptions}
        />
      </Modal>

      <Modal
        title="加签 / 会签"
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onOk={async () => {
          if (!addTarget) return
          await onAddReviewer(addTarget)
          setAddTarget(null)
          setAddOpen(false)
        }}
        okButtonProps={{ disabled: !addTarget }}
      >
        <Select
          showSearch
          style={{ width: '100%' }}
          placeholder="选择审核人"
          optionFilterProp="label"
          value={addTarget ?? undefined}
          onChange={(v) => setAddTarget(v)}
          options={userOptions}
        />
      </Modal>
    </div>
  )
}