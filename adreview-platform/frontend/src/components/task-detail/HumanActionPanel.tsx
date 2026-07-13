import { useEffect, useRef, useState } from 'react'
import { Alert, Form, Input, Space, Typography } from 'antd'
import { ThunderboltOutlined } from '@ant-design/icons'
import type { AgentHit, AuditItem, MaterialType } from '@/types/domain'
import { auditItemsApi } from '@/api/auditItems'
import { colors } from '@/styles/theme'
import AuditItemChecklist from './AuditItemChecklist'

const { Text } = Typography

export interface DecisionFormValues {
  note?: string
}

interface Props {
  canDecide: boolean
  /** Detection hits used to drive pre-selection in the checklist. */
  hits: AgentHit[]
  materialType: MaterialType
  /** Audit item id list is owned by the parent so the StickyDecisionBar can
   *  read it on submit. */
  auditItemIds: number[]
  onAuditItemsChange: (ids: number[]) => void
  onNoteChange: (note: string) => void
  /** Optional: preset ids to highlight (e.g. from a previously decided run). */
  existingAuditItemIds?: number[]
  onDirtyChange?: (dirty: boolean) => void
}

const MAX_AUDIT_ITEM_SELECT = 20

const MATERIAL_TYPE_TO_MEDIA_KEY: Record<MaterialType, string> = {
  text: 'text',
  image: 'image',
  pdf: 'doc',
  video: 'video',
}

export default function HumanActionPanel({
  canDecide,
  hits,
  materialType,
  auditItemIds,
  onAuditItemsChange,
  onNoteChange,
  existingAuditItemIds = [],
  onDirtyChange,
}: Props) {
  const [decisionForm] = Form.useForm<DecisionFormValues>()
  const [auditItems, setAuditItems] = useState<AuditItem[]>([])
  const [loading, setLoading] = useState(false)
  // Note text is owned by the parent so StickyDecisionBar can submit it.
  const noteWatch = Form.useWatch('note', decisionForm)
  const onNoteChangeRef = useRef(onNoteChange)
  onNoteChangeRef.current = onNoteChange

  useEffect(() => {
    if (noteWatch !== undefined) onNoteChangeRef.current(noteWatch ?? '')
  }, [noteWatch])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const mediaKey = MATERIAL_TYPE_TO_MEDIA_KEY[materialType]
    auditItemsApi
      .listByMediaType(mediaKey as any)
      .then((items) => {
        if (cancelled) return
        setAuditItems(items)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [materialType])

  // Note + audit-item ids are owned by the parent (TaskDetailPage reads
  // them when the StickyDecisionBar invokes decide()). The form fields below
  // are controlled by mount-once effects; we don't keep a copy here.
  useEffect(() => {
    decisionForm.setFieldsValue({ note: '' })
    if (existingAuditItemIds.length) {
      onAuditItemsChange(existingAuditItemIds)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div style={{ padding: 16 }}>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Text strong>
          <ThunderboltOutlined /> 人工处理动作
        </Text>

        {!canDecide && (
          <Alert
            type="info"
            showIcon
            message="当前阶段没有您的待办"
            description="下方按钮已禁用。可继续查看内容并添加批注。"
            style={{ background: colors.surface2 }}
          />
        )}

        <Form
          form={decisionForm}
          layout="vertical"
          disabled={!canDecide}
          onValuesChange={() => onDirtyChange?.(true)}
        >
          <Form.Item label="审核意见" name="note">
            <Input.TextArea
              rows={2}
              placeholder="审核意见（保存到决定记录）"
              onChange={() => onDirtyChange?.(true)}
            />
          </Form.Item>

          <div style={{ marginBottom: 12 }}>
            <AuditItemChecklist
              items={auditItems}
              hits={hits}
              selectedIds={auditItemIds}
              onChange={(ids) => {
                onAuditItemsChange(ids)
                onDirtyChange?.(true)
              }}
              readOnly={!canDecide || loading}
            />
          </div>

          {auditItemIds.length > MAX_AUDIT_ITEM_SELECT && (
            <Text type="warning" style={{ fontSize: 12 }}>
              已选 {auditItemIds.length} 个审核项，超过上限 {MAX_AUDIT_ITEM_SELECT}。
            </Text>
          )}
        </Form>

        {auditItems.length === 0 && !loading && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            暂无可选审核项，请在策略管理 → 审核项 中维护。
          </Text>
        )}
      </Space>
    </div>
  )
}



