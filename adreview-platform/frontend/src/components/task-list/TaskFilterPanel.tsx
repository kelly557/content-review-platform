import { Card, Select, DatePicker, Space, Row, Col, Button } from 'antd'
import type { MaterialType, ReviewType, ReviewDecision, WorkflowMode } from '@/types/domain'
import { TYPE_LABELS, WORKFLOW_MODE_LABELS } from '@/types/domain'

const { RangePicker } = DatePicker

export interface TaskFilters {
  material_type?: MaterialType
  review_type?: ReviewType
  workflow_mode?: WorkflowMode
  status?: ReviewDecision
  sort_by?: string
  sort_order?: 'asc' | 'desc'
  created_after?: string
  created_before?: string
}

interface TaskFilterPanelProps {
  filters: TaskFilters
  onChange: (filters: TaskFilters) => void
  visible: boolean
}

const MATERIAL_TYPE_OPTIONS = [
  { value: '', label: '全部类型' },
  { value: 'image', label: TYPE_LABELS.image },
  { value: 'video', label: TYPE_LABELS.video },
  { value: 'pdf', label: TYPE_LABELS.pdf },
  { value: 'text', label: TYPE_LABELS.text },
]

const REVIEW_TYPE_OPTIONS = [
  { value: '', label: '全部' },
  { value: 'machine', label: '机审' },
  { value: 'human', label: '人审' },
]

const WORKFLOW_MODE_OPTIONS = [
  { value: '', label: '全部流程' },
  { value: 'machine_only', label: WORKFLOW_MODE_LABELS.machine_only },
  { value: 'machine_then_human', label: WORKFLOW_MODE_LABELS.machine_then_human },
]

const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'pending', label: '待处理' },
  { value: 'approved', label: '已通过' },
  { value: 'rejected', label: '已驳回' },
  { value: 'returned', label: '已退回' },
  { value: 'canceled', label: '已取消' },
]

const SORT_OPTIONS = [
  { value: 'created_at', label: '创建时间' },
  { value: 'completed_at', label: '完成时间' },
  { value: 'title', label: '标题' },
]

export default function TaskFilterPanel({ filters, onChange, visible }: TaskFilterPanelProps) {
  if (!visible) return null

  const handleReset = () => {
    onChange({})
  }

  return (
    <Card size="small" style={{ marginBottom: 16 }}>
      <Row gutter={[16, 16]}>
        <Col span={6}>
          <div style={{ marginBottom: 8, fontSize: 12, color: '#666' }}>素材类型</div>
          <Select
            value={filters.material_type || ''}
            onChange={(v) => onChange({ ...filters, material_type: (v || undefined) as MaterialType | undefined })}
            options={MATERIAL_TYPE_OPTIONS}
            style={{ width: '100%' }}
          />
        </Col>
        <Col span={6}>
          <div style={{ marginBottom: 8, fontSize: 12, color: '#666' }}>审核类型</div>
          <Select
            value={filters.review_type || ''}
            onChange={(v) => onChange({ ...filters, review_type: (v || undefined) as ReviewType | undefined })}
            options={REVIEW_TYPE_OPTIONS}
            style={{ width: '100%' }}
          />
        </Col>
        <Col span={6}>
          <div style={{ marginBottom: 8, fontSize: 12, color: '#666' }}>状态</div>
          <Select
            value={filters.status || ''}
            onChange={(v) => onChange({ ...filters, status: (v || undefined) as ReviewDecision | undefined })}
            options={STATUS_OPTIONS}
            style={{ width: '100%' }}
          />
        </Col>
        <Col span={6}>
          <div style={{ marginBottom: 8, fontSize: 12, color: '#666' }}>流程</div>
          <Select
            value={filters.workflow_mode || ''}
            onChange={(v) => onChange({ ...filters, workflow_mode: (v || undefined) as WorkflowMode | undefined })}
            options={WORKFLOW_MODE_OPTIONS}
            style={{ width: '100%' }}
          />
        </Col>
        <Col span={6}>
          <div style={{ marginBottom: 8, fontSize: 12, color: '#666' }}>排序</div>
          <Space>
            <Select
              value={filters.sort_by || 'created_at'}
              onChange={(v) => onChange({ ...filters, sort_by: v })}
              options={SORT_OPTIONS}
              style={{ width: 120 }}
            />
            <Select
              value={filters.sort_order || 'desc'}
              onChange={(v) => onChange({ ...filters, sort_order: v })}
              style={{ width: 80 }}
              options={[
                { value: 'desc', label: '降序' },
                { value: 'asc', label: '升序' },
              ]}
            />
          </Space>
        </Col>
      </Row>
      <Row style={{ marginTop: 16 }}>
        <Col span={24}>
          <div style={{ marginBottom: 8, fontSize: 12, color: '#666' }}>创建时间范围</div>
          <RangePicker
            style={{ width: '100%' }}
            onChange={(dates) => {
              if (dates && dates[0] && dates[1]) {
                onChange({
                  ...filters,
                  created_after: dates[0].startOf('day').toISOString(),
                  created_before: dates[1].endOf('day').toISOString(),
                })
              } else {
                onChange({
                  ...filters,
                  created_after: undefined,
                  created_before: undefined,
                })
              }
            }}
          />
        </Col>
      </Row>
      <Row style={{ marginTop: 16 }}>
        <Col span={24} style={{ textAlign: 'right' }}>
          <Button onClick={handleReset}>重置</Button>
        </Col>
      </Row>
    </Card>
  )
}
