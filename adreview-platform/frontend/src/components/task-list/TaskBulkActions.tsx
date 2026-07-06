import { Button, Space, Modal, Input, message } from 'antd'
import { CheckOutlined, CloseOutlined } from '@ant-design/icons'
import { useState } from 'react'
import { reviewsApi } from '@/api/reviews'
import type { ReviewDecision } from '@/types/domain'

interface TaskBulkActionsProps {
  selectedTaskIds: number[]
  onClearSelection: () => void
  onComplete: () => void
}

export default function TaskBulkActions({
  selectedTaskIds,
  onClearSelection,
  onComplete,
}: TaskBulkActionsProps) {
  const [loading, setLoading] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [pendingDecision, setPendingDecision] = useState<ReviewDecision>('approved')
  const [note, setNote] = useState('')

  if (selectedTaskIds.length === 0) return null

  const handleBulkDecide = async (decision: ReviewDecision) => {
    setPendingDecision(decision)
    setNote('')
    setModalVisible(true)
  }

  const confirmBulkDecide = async () => {
    setLoading(true)
    try {
      const result = await reviewsApi.bulkDecide(selectedTaskIds, pendingDecision, note)
      if (result.failed > 0) {
        message.warning(`成功 ${result.success} 个，失败 ${result.failed} 个（可能没有权限或已处理）`)
      } else {
        message.success(`成功处理 ${result.success} 个任务`)
      }
      setModalVisible(false)
      onClearSelection()
      onComplete()
    } catch {
      message.error('批量操作失败')
    } finally {
      setLoading(false)
    }
  }

  const decisionLabels: Record<ReviewDecision, string> = {
    approved: '通过',
    rejected: '驳回',
    returned: '退回',
    pending: '待处理',
  }

  return (
    <>
      <div
        style={{
          padding: '12px 16px',
          background: '#f0f5ff',
          borderRadius: 6,
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span>已选择 {selectedTaskIds.length} 个任务</span>
        <Space>
          <Button
            type="primary"
            icon={<CheckOutlined />}
            onClick={() => handleBulkDecide('approved')}
          >
            批量通过
          </Button>
          <Button
            danger
            icon={<CloseOutlined />}
            onClick={() => handleBulkDecide('rejected')}
          >
            批量驳回
          </Button>
          <Button onClick={onClearSelection}>取消选择</Button>
        </Space>
      </div>

      <Modal
        title={`批量${decisionLabels[pendingDecision]}确认`}
        open={modalVisible}
        onOk={confirmBulkDecide}
        onCancel={() => setModalVisible(false)}
        confirmLoading={loading}
        okText="确认"
        cancelText="取消"
      >
        <p>
          确定要{decisionLabels[pendingDecision]}选中的 {selectedTaskIds.length} 个任务吗？
        </p>
        <Input.TextArea
          placeholder="备注（可选）"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          style={{ marginTop: 12 }}
        />
      </Modal>
    </>
  )
}
