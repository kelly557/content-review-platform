/**
 * 「选择知识」交互集合 — 仅个性化规则使用
 *
 * - <KnowledgeSelectInline />：单元格内联多选下拉（Select mode="multiple"），
 *   内嵌选项含文档标题 / 来源 / 状态，变更即保存。
 * - <SelectKnowledgeDocumentsModal />：保留为 Modal 形式供详情页或其他入口使用。
 *
 * 选中后 PUT /packages/{code}/items/{id} body={knowledge_document_ids: number[]}。
 */
import { useEffect, useMemo, useState } from 'react'
import {
  App,
  Button,
  Checkbox,
  Empty,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { auditItemsApi } from '@/api/auditItems'
import { knowledgeDocumentsApi } from '@/api/knowledge-documents'
import type {
  AuditItem,
  KnowledgeDocumentListItem,
} from '@/types/domain'

const { Text } = Typography

const SOURCE_LABEL: Record<string, string> = {
  upload: '上传',
  url: 'URL',
  manual: '手动',
}

export const SOURCE_TYPE_COLOR: Record<string, string> = {
  upload: 'blue',
  url: 'purple',
  manual: 'default',
}

/* ─────────────────────────── Modal ─────────────────────────── */

interface ModalProps {
  item: AuditItem | null
  onClose: () => void
  onSaved: () => void | Promise<void>
}

export function SelectKnowledgeDocumentsModal({
  item,
  onClose,
  onSaved,
}: ModalProps) {
  const { message } = App.useApp()
  const [docs, setDocs] = useState<KnowledgeDocumentListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [q, setQ] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!item) return
    setPicked(new Set(item.knowledge_document_ids))
    setLoading(true)
    knowledgeDocumentsApi
      .list({ size: 500, status: 'active', include_deleted: false })
      .then((p) => setDocs(p.items))
      .catch(() => message.error('加载知识文档失败'))
      .finally(() => setLoading(false))
  }, [item, message])

  const toggle = (id: number, checked: boolean) => {
    setPicked((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const save = async () => {
    if (!item) return
    setSaving(true)
    try {
      await auditItemsApi.setKnowledgeDocuments(
        item.package_code,
        item.id,
        Array.from(picked),
      )
      message.success('已保存关联知识文档')
      await onSaved()
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail ?? '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const filtered = docs.filter(
    (d) => !q || d.title.toLowerCase().includes(q.toLowerCase()),
  )

  const columns: ColumnsType<KnowledgeDocumentListItem> = [
    {
      title: '选择',
      key: 'pick',
      width: 80,
      render: (_, row) => (
        <Checkbox
          checked={picked.has(row.id)}
          onChange={(e) => toggle(row.id, e.target.checked)}
        />
      ),
    },
    {
      title: '标题',
      dataIndex: 'title',
      width: '46%',
      render: (v: string) => <Text>{v}</Text>,
    },
    {
      title: '来源',
      dataIndex: 'source_type',
      width: '14%',
      render: (v: string) => (
        <Tag color={SOURCE_TYPE_COLOR[v] ?? 'default'}>
          {SOURCE_LABEL[v] ?? v}
        </Tag>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: '12%',
      render: (v: string) => (
        <Tag color={v === 'active' ? 'green' : 'default'}>{v}</Tag>
      ),
    },
  ]

  return (
    <Modal
      title={item ? `选择知识 — ${item.name_cn}` : '选择知识'}
      open={!!item}
      onCancel={onClose}
      width={760}
      footer={[
        <Button key="cancel" onClick={onClose}>
          取消
        </Button>,
        <Button
          key="ok"
          type="primary"
          loading={saving}
          onClick={save}
        >
          确认 ({picked.size} 项)
        </Button>,
      ]}
      destroyOnClose
    >
      <Space direction="vertical" style={{ width: '100%' }} size="small">
        <Text type="secondary">
          仅显示 status=active 的知识文档，支持多选；变更后实时保存。
        </Text>
        <Input.Search
          placeholder="搜索知识文档"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          allowClear
        />
        <Spin spinning={loading}>
          {filtered.length === 0 && !loading ? (
            <Empty description="暂无知识文档" />
          ) : (
            <Table<KnowledgeDocumentListItem>
              rowKey="id"
              dataSource={filtered}
              columns={columns}
              pagination={{ pageSize: 10, size: 'small' }}
              size="small"
            />
          )}
        </Spin>
      </Space>
    </Modal>
  )
}

/* ───────────────────── Inline cell dropdown ───────────────────── */

interface InlineProps {
  item: AuditItem
  onSaved: () => void | Promise<void>
  /** 紧凑样式 (表格内) */
  compact?: boolean
}

/**
 * 单元格内联的多选下拉。变更即保存，避免 Modal 频繁开关。
 * 用 AntD Select(mode="multiple", maxTagCount="responsive") 展示。
 */
export function KnowledgeSelectInline({ item, onSaved, compact }: InlineProps) {
  const { message } = App.useApp()
  const [docs, setDocs] = useState<KnowledgeDocumentListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [value, setValue] = useState<number[]>(item.knowledge_document_ids ?? [])

  useEffect(() => {
    setValue(item.knowledge_document_ids ?? [])
  }, [item.knowledge_document_ids])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    knowledgeDocumentsApi
      .list({ size: 500, status: 'active', include_deleted: false })
      .then((p) => {
        if (!cancelled) setDocs(p.items)
      })
      .catch(() => message.error('加载知识文档失败'))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [message])

  const options = useMemo(
    () =>
      docs.map((d) => ({
        value: d.id,
        label: (
          <Space size={6} wrap>
            <span>{d.title}</span>
            <Tag color={SOURCE_TYPE_COLOR[d.source_type] ?? 'default'} style={{ marginInline: 0 }}>
              {SOURCE_LABEL[d.source_type] ?? d.source_type}
            </Tag>
          </Space>
        ),
        data: d,
      })),
    [docs],
  )

  const handleChange = async (next: number[]) => {
    setValue(next)
    try {
      await auditItemsApi.setKnowledgeDocuments(
        item.package_code,
        item.id,
        next,
      )
      message.success(`已更新关联知识（${next.length} 项）`)
      await onSaved()
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail ?? '保存失败')
      // 回滚
      setValue(item.knowledge_document_ids ?? [])
    }
  }

  return (
    <Select<number[]>
      mode="multiple"
      value={value}
      onChange={handleChange}
      loading={loading}
      placeholder="选择知识"
      options={options}
      optionFilterProp="label"
      allowClear
      maxTagCount={compact ? 1 : 'responsive'}
      maxTagPlaceholder={(omitted) => `+${omitted.length}`}
      style={{ width: '100%', minWidth: 180 }}
      popupMatchSelectWidth={420}
      notFoundContent={loading ? <Spin size="small" /> : <Empty description="暂无知识文档" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
    />
  )
}

/* ───────────────── 兼容旧 default export (PersonalRuleDetailPage 还在引用) ───────────────── */

export default SelectKnowledgeDocumentsModal