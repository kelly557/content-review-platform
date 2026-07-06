import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Tag as AntdTag,
  Typography,
} from 'antd'
import {
  CheckOutlined,
  CloseOutlined,
  SwapOutlined,
  TagsOutlined,
  UndoOutlined,
  UsergroupAddOutlined,
} from '@ant-design/icons'
import type { ReviewDecision, TagSummary, User } from '@/types/domain'
import { TAG_DOMAIN_OPTIONS } from '@/types/domain'

const { Text } = Typography

export interface DecisionFormValues {
  note?: string
  comment_body?: string
  tag_ids?: string[]
}

interface Props {
  canDecide: boolean
  users: User[]
  currentUserId?: number
  onTransfer: (toUserId: number) => Promise<void> | void
  onAddReviewer: (toUserId: number) => Promise<void> | void
  onDecide: (
    decision: ReviewDecision,
    tagIds: string[],
    note?: string,
    commentBody?: string,
  ) => Promise<void> | void
  onDirtyChange?: (dirty: boolean) => void
  availableTags?: TagSummary[]
  existingTagIds?: string[]
}

const MAX_TAG_SELECT = 20

export default function HumanActionPanel({
  canDecide,
  users,
  currentUserId,
  onTransfer,
  onAddReviewer,
  onDecide,
  onDirtyChange,
  availableTags = [],
  existingTagIds = [],
}: Props) {
  const [decisionForm] = Form.useForm<DecisionFormValues>()
  const [transferOpen, setTransferOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [transferTarget, setTransferTarget] = useState<number | null>(null)
  const [addTarget, setAddTarget] = useState<number | null>(null)
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [domainFilter, setDomainFilter] = useState<string | undefined>(undefined)

  useEffect(() => {
    setSelectedTagIds(existingTagIds)
    decisionForm.setFieldValue('tag_ids', existingTagIds)
  }, [existingTagIds.join('|'), decisionForm])

  const userOptions = users
    .filter((u) => u.id !== currentUserId)
    .map((u) => ({ value: u.id, label: `${u.full_name} (${u.email}) · ${u.role}` }))

  const tagOptions = useMemo(() => {
    const filtered = domainFilter
      ? availableTags.filter((t) => t.domain === domainFilter)
      : availableTags
    return filtered.map((t) => ({
      value: t.id,
      label: t.name,
      domain: t.domain,
      code: t.code,
    }))
  }, [availableTags, domainFilter])

  const tagOptionsAll = useMemo(
    () =>
      availableTags.map((t) => ({
        value: t.id,
        label: t.name,
        domain: t.domain,
        code: t.code,
      })),
    [availableTags],
  )

  const handleDecide = async (decision: ReviewDecision) => {
    if (selectedTagIds.length > MAX_TAG_SELECT) {
      Modal.error({ title: `最多标注 ${MAX_TAG_SELECT} 个标签`, icon: null })
      return
    }
    const values = await decisionForm.validateFields().catch(() => ({} as DecisionFormValues))
    await onDecide(decision, selectedTagIds, values.note, values.comment_body)
  }

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

          <Form.Item
            label={
              <Space size={6}>
                <TagsOutlined />
                <span>标签标注</span>
                <AntdTag color="blue" style={{ margin: 0 }}>
                  {selectedTagIds.length}/{MAX_TAG_SELECT}
                </AntdTag>
              </Space>
            }
            tooltip="从标签管理中选用；与本任务标签一一对应"
          >
            <Space direction="vertical" size={6} style={{ width: '100%' }}>
              <Space size={4} wrap>
                <AntdTag.CheckableTag
                  checked={!domainFilter}
                  onChange={(checked) => checked && setDomainFilter(undefined)}
                >
                  全部
                </AntdTag.CheckableTag>
                {TAG_DOMAIN_OPTIONS.map((d) => (
                  <AntdTag.CheckableTag
                    key={d.value}
                    checked={domainFilter === d.value}
                    onChange={(checked) =>
                      setDomainFilter(checked ? d.value : undefined)
                    }
                  >
                    {d.cn}
                  </AntdTag.CheckableTag>
                ))}
              </Space>
              <Select
                mode="multiple"
                showSearch
                allowClear
                placeholder="搜索标签名称或 code"
                optionFilterProp="label"
                value={selectedTagIds}
                onChange={(v) => {
                  const next = Array.isArray(v) ? v.slice(0, MAX_TAG_SELECT) : []
                  setSelectedTagIds(next as string[])
                  decisionForm.setFieldValue('tag_ids', next)
                  onDirtyChange?.(true)
                }}
                options={tagOptions}
                style={{ width: '100%' }}
                disabled={!canDecide || availableTags.length === 0}
                tagRender={(props) => {
                  const opt = tagOptionsAll.find((o) => o.value === props.value)
                  return (
                    <AntdTag
                      color="blue"
                      closable={props.closable}
                      onClose={props.onClose}
                      style={{ marginRight: 4 }}
                    >
                      {opt?.label ?? String(props.value)}
                    </AntdTag>
                  )
                }}
                notFoundContent={
                  availableTags.length === 0 ? '暂无可用标签' : '无匹配标签'
                }
              />
              <Text type="secondary" style={{ fontSize: 11 }}>
                数据与「标签管理」页一致；已停用 / 已删除标签不会出现在此处。
              </Text>
            </Space>
          </Form.Item>

          <Space wrap>
            <Button
              type="primary"
              icon={<CheckOutlined />}
              disabled={!canDecide}
              onClick={() => handleDecide('approved')}
            >
              通过
            </Button>
            <Button
              danger
              icon={<CloseOutlined />}
              disabled={!canDecide}
              onClick={() => handleDecide('rejected')}
            >
              驳回
            </Button>
            <Button
              icon={<UndoOutlined />}
              disabled={!canDecide}
              onClick={() => handleDecide('returned')}
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

        {availableTags.length === 0 && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            暂未拉取到可用标签，请在「标签管理」创建标签。
          </Text>
        )}
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