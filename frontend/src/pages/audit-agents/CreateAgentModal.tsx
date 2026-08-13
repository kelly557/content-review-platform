import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  Input,
  Popconfirm,
  Popover,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import {
  DeleteOutlined,
  EditOutlined,
  InfoCircleOutlined,
  PlusOutlined,
  QuestionCircleOutlined,
} from '@ant-design/icons'
import AiOptimizeDrawer from './AiOptimizeDrawer'
import { registeredModelsApi, type ActiveModelOption } from '@/api/registered-models'

const { Title, Text } = Typography
const { TextArea } = Input

export interface AgentPromptRow {
  id: string
  label: string
  desc: string
}

export interface CreateAgentPayload {
  modality: '文本' | '图片' | '图文'
  name: string
  largeModel: string
  rows: AgentPromptRow[]
}

export interface CreateAgentFormRef {
  getState: () => {
    name: string
    modelId: string
    rows: AgentPromptRow[]
    isValid: boolean
  }
}

export interface CreateAgentFormProps {
  submitting?: boolean
  onCancel: () => void
  onSubmit: (payload: CreateAgentPayload) => void
  aiDrawerOpen: boolean
  onAiDrawerOpenChange: (open: boolean) => void
  onAddOptimizedConfig?: (cfg: { label: string; desc: string }) => void
  initialName?: string
  initialModality?: '文本' | '图片' | '图文'
  initialLargeModel?: string
  initialRows?: AgentPromptRow[]
  draftSavedAt?: string | null
  currentVersion?: string | null
  showTopBar?: boolean
  canPublish?: boolean
  historyDisabled?: boolean
  onHistory?: () => void
  onTest?: () => void
  onPublish?: () => void
}

interface LargeModelOption {
  label: string
  value: string
  largeCategory: 'text' | 'multimodal' | 'other' | null
}

const DEFAULT_ROWS: AgentPromptRow[] = [
  {
    id: 'row-1',
    label: '医药专项',
    desc: 'OTC药物发布需要绑定claims和evidence',
  },
]

const ROW_TEXT_AREA_ROWS = 3
const LABEL_MAX = 50
const DESC_MAX = 1000

const CONFIG_HELP_LINES = [
  '根据您具体的业务检测需求,配置对应的检测规则。',
  '"审核标签"即待检测类别,"审核描述"是对相应审核标签检测标准及规则的解释说明。',
  '系统会将多个审核标签及对应提示词以预设的格式拼接形成完整的提示词,调用大模型获得审核结果,故请尽可能用准确、精简的语言描述大模型的每一项审核标签。',
]

const EXAMPLE_TAGS = [
  {
    key: 'leak',
    label: '站外引流',
    desc: '通过直接引导或隐晦暗示（含变体、隐喻等）等表述将用户引导至站外其他平台或渠道的行为，包括明确提及竞品平台名称或其变体（如常见竞品有xx）、提及站外其他平台或其变体（如常见平台有xx），或包含明确的联系方式等。',
  },
  {
    key: 'badreview',
    label: '品牌恶意差评',
    desc: '针对xx品牌的无依据恶意拉踩、不实负面差评，或针对品牌创始人的虚假诋毁、造谣等刻意损害品牌或创始人形象的评论或表述。如：xx都是虚假宣传，远不如xx品牌。',
  },
]

function genId() {
  return `row-${Math.random().toString(36).slice(2, 9)}`
}

const CreateAgentForm = forwardRef<CreateAgentFormRef, CreateAgentFormProps>(function CreateAgentForm({
  submitting,
  onCancel,
  onSubmit,
  aiDrawerOpen,
  onAiDrawerOpenChange,
  onAddOptimizedConfig,
  initialName,
  initialModality,
  initialLargeModel,
  initialRows,
  draftSavedAt,
  currentVersion,
  showTopBar,
  canPublish,
  historyDisabled,
  onHistory,
  onTest,
  onPublish,
}, ref) {
  const { message } = App.useApp()
  const [largeModelOptions, setLargeModelOptions] = useState<LargeModelOption[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setModelsLoading(true)
    registeredModelsApi
      .listActiveModels({ kind: 'large' })
      .then((rows: ActiveModelOption[]) => {
        if (cancelled) return
        setLargeModelOptions(
          rows.map((m) => ({
            label: m.name + (m.model_name ? `（${m.model_name}）` : ''),
            value: String(m.id),
            largeCategory: m.large_category,
          })),
        )
      })
      .catch(() => {
        if (!cancelled) setLargeModelOptions([])
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 按模态过滤: 文本 → 仅 text; 图片 → 仅 multimodal; 图文 → text + multimodal; 其他 → 全部
  const modality = initialModality ?? '文本'
  const filteredLargeModels = largeModelOptions.filter((o) => {
    if (modality === '文本') return o.largeCategory === 'text'
    if (modality === '图片') return o.largeCategory === 'multimodal'
    if (modality === '图文') return o.largeCategory === 'text' || o.largeCategory === 'multimodal'
    return true
  })
  const defaultLargeModel = filteredLargeModels[0]?.value ?? ''
  const [name, setName] = useState(initialName || '未命名审核智能体')
  const [editingName, setEditingName] = useState(false)
  const [largeModel, setLargeModel] = useState<string>(initialLargeModel ?? defaultLargeModel)
  const [rows, setRows] = useState<AgentPromptRow[]>(initialRows ?? DEFAULT_ROWS)

  // 选项加载完成或模态切换后, 若当前 largeModel 不在可选列表里, 自动选第一个
  useEffect(() => {
    if (filteredLargeModels.length === 0) return
    const exists = filteredLargeModels.some((o) => o.value === largeModel)
    if (!exists) {
      setLargeModel(filteredLargeModels[0].value)
    }
  }, [filteredLargeModels, largeModel])

  useImperativeHandle(
    ref,
    () => ({
      getState: () => {
        const validRows = rows.filter((r) => r.label.trim() && r.desc.trim())
        return {
          name: name.trim(),
          modelId: largeModel,
          rows,
          isValid:
            !!name.trim() &&
            !!largeModel &&
            validRows.length > 0,
        }
      },
    }),
    [name, largeModel, rows],
  )

  useEffect(() => {
    setName(initialName || '未命名审核智能体')
    setEditingName(false)
    setLargeModel(initialLargeModel ?? (filteredLargeModels[0]?.value ?? ''))
    setRows(initialRows ?? DEFAULT_ROWS)
  }, [initialName, initialModality, initialLargeModel, initialRows])

  const totalCharLen = rows.reduce(
    (sum, r) => sum + r.label.length + r.desc.length,
    0,
  )

  const handleAddRow = () => {
    setRows((prev) => [...prev, { id: genId(), label: '', desc: '' }])
  }

  const handleRemoveRow = (id: string) => {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.id !== id)))
  }

  const handleRowChange = (id: string, patch: Partial<AgentPromptRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  const handleAiOptimizeAll = () => {
    onAiDrawerOpenChange(true)
  }

  const handleAddOptimizedConfig = (
    cfg: { label: string; desc: string },
    points?: { label: string; desc: string }[],
  ) => {
    setRows((prev) => {
      let next = prev
      // 有 AI 优化结果时替换首条; 否则不动已有行
      if (cfg.label.trim() || cfg.desc.trim()) {
        if (prev.length === 0) {
          next = [{ id: genId(), label: cfg.label, desc: cfg.desc }]
        } else {
          next = prev.map((r, i) => (i === 0 ? { ...r, label: cfg.label, desc: cfg.desc } : r))
        }
      }
      // 追加解析出的审核点为新行; 按 (label+desc) 去重, 已存在的不重复加
      if (points && points.length > 0) {
        const existing = new Set(next.map((r) => `${r.label.trim()}|${(r.desc ?? '').trim()}`))
        const deduped = points
          .filter((p) => p.label.trim())
          .filter((p) => {
            const key = `${p.label.trim()}|${(p.desc ?? '').trim()}`
            if (existing.has(key)) return false
            existing.add(key)
            return true
          })
          .map((p) => ({ id: genId(), label: p.label.trim(), desc: p.desc ?? '' }))
        next = [...next, ...deduped]
      }
      return next
    })
    onAiDrawerOpenChange(false)
    const parts: string[] = []
    if (cfg.label.trim() || cfg.desc.trim()) parts.push('已替换首条审核标签')
    if (points && points.length > 0) parts.push('已加入解析审核点（重复已跳过）')
    message.success(parts.join('，') || '已添加配置')
    onAddOptimizedConfig?.(cfg)
  }

  const handleOk = () => {
    if (!name.trim()) {
      message.warning('请输入智能体名称')
      return
    }
    if (!largeModel) {
      message.warning('请选择大模型')
      return
    }
    const validRows = rows.filter((r) => r.label.trim() && r.desc.trim())
    if (validRows.length === 0) {
      message.warning('请至少填写一行审核标签与审核描述')
      return
    }
    onSubmit({
      modality: initialModality ?? '文本',
      name: name.trim(),
      largeModel,
      rows: validRows,
    })
  }

  return (
    <div style={{ padding: '4px 4px 8px' }}>
      {showTopBar && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
            padding: '8px 12px',
            background: '#F5F7FA',
            borderRadius: 6,
          }}
        >
          <Space size={6}>
            {currentVersion && (
              <Tag color="blue" style={{ margin: 0 }}>
                {currentVersion}
              </Tag>
            )}
            <InfoCircleOutlined style={{ color: '#1677FF' }} />
            <Text type="secondary">
              {draftSavedAt
                ? `草稿保存于：${draftSavedAt}`
                : '尚未保存草稿，编辑后请点击保存草稿'}
            </Text>
          </Space>
          <Space size={8}>
            <Tooltip title={historyDisabled ? '保存草稿后可查看历史版本' : ''}>
              <Button onClick={onHistory} disabled={!onHistory || historyDisabled}>
                历史版本
              </Button>
            </Tooltip>
            <Button onClick={onTest} disabled={!onTest}>
              测试
            </Button>
            <Button type="primary" onClick={onPublish} disabled={!onPublish || !canPublish}>
              发布
            </Button>
          </Space>
        </div>
      )}
      <div style={{ marginBottom: 12 }}>
        {editingName ? (
          <Input
            value={name}
            autoFocus
            maxLength={64}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setEditingName(false)}
            onPressEnter={() => setEditingName(false)}
            style={{ fontSize: 16, fontWeight: 600, maxWidth: 360 }}
          />
        ) : (
          <Space size={6} align="center">
            <Title level={5} style={{ margin: 0 }}>
{name || '未命名审核智能体'}
          </Title>
          <Button
            size="small"
            type="text"
            icon={<EditOutlined />}
            aria-label="编辑智能体名称"
            onClick={() => setEditingName(true)}
          />
          </Space>
        )}
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="在此处您可以自定义配置检测描述,实现与大模型的灵活交互。系统会通过拼接自定义配置内容,调用所选的大模型获得检测结果。"
      />

      <Card
        size="small"
        title={<span style={{ borderLeft: '3px solid #1677FF', paddingLeft: 8 }}>选择大模型</span>}
        styles={{ body: { padding: 16 } }}
        style={{ marginBottom: 16 }}
      >
        <div style={{ marginBottom: 12 }}>
          <Text type="secondary">
            模态：<Text strong>{initialModality ?? '文本'}</Text>
          </Text>
        </div>
        <Select
          value={largeModel || undefined}
          onChange={setLargeModel}
          options={filteredLargeModels.map((o) => ({ label: o.label, value: o.value }))}
          style={{ width: '100%' }}
          placeholder="请选择大模型"
          loading={modelsLoading}
          notFoundContent={modelsLoading ? '加载中…' : '暂无可用大模型，请先在「模型管理」注册并激活大模型'}
        />
      </Card>

      <Card
        size="small"
        title={<span style={{ borderLeft: '3px solid #1677FF', paddingLeft: 8 }}>配置自定义提示词</span>}
        styles={{ body: { padding: 16 } }}
      >
        <div style={{ marginBottom: 12 }}>
          <Space size={8} align="center">
            <Text strong>配置审核标签</Text>
            <Tooltip
              title={
                <div style={{ maxWidth: 360, lineHeight: 1.6 }}>
                  {CONFIG_HELP_LINES.map((line, i) => (
                    <div key={i}>{line}</div>
                  ))}
                </div>
              }
            >
              <InfoCircleOutlined style={{ color: '#94A3B8', cursor: 'help' }} aria-label="审核标签说明" />
            </Tooltip>
            <Text strong>自定义部分字符长度共计：{totalCharLen}</Text>
          </Space>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '160px minmax(0, 1fr) auto',
            columnGap: 12,
            rowGap: 12,
            alignItems: 'start',
          }}
        >
          <div style={{ fontWeight: 600 }}>审核标签</div>
          <div
            style={{
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <span>审核描述</span>
            <Space size={8}>
              <Button
                size="small"
                type="primary"
                ghost
                onClick={handleAiOptimizeAll}
                aria-label="AI 优化提示词"
              >
                AI 优化提示词
              </Button>
              <Popover
                content={<ExampleContent />}
                title="示例"
                trigger="hover"
                placement="bottomRight"
                overlayInnerStyle={{ width: 560, maxHeight: 480, overflow: 'auto' }}
              >
                <Button size="small" icon={<QuestionCircleOutlined />} aria-label="示例">
                  示例
                </Button>
              </Popover>
            </Space>
          </div>
          <div />{' '}

{rows.map((row) => (
            <FragmentRow
              key={row.id}
              row={row}
              onChange={(patch) => handleRowChange(row.id, patch)}
              onDelete={() => handleRemoveRow(row.id)}
            />
          ))}
        </div>

        <div style={{ marginTop: 12 }}>
          <Button
            type="link"
            icon={<PlusOutlined />}
            onClick={handleAddRow}
            style={{ paddingLeft: 0 }}
          >
            添加自定义审核标签
          </Button>
        </div>
      </Card>

      <div
        style={{
          position: 'sticky',
          bottom: 0,
          background: '#fff',
          marginTop: 16,
          paddingTop: 12,
          borderTop: '1px solid #F0F0F0',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 8,
        }}
      >
        <Button onClick={submitting ? undefined : onCancel} disabled={submitting}>
          取消
        </Button>
        <Button type="primary" loading={submitting} onClick={handleOk}>
          确定
        </Button>
      </div>

      <AiOptimizeDrawer
        open={aiDrawerOpen}
        onClose={() => onAiDrawerOpenChange(false)}
        onAddConfig={handleAddOptimizedConfig}
        rowsCount={rows.length}
        initialOriginal={
          rows[0]?.label && rows[0]?.desc ? `${rows[0].label}:${rows[0].desc}` : undefined
        }
      />
    </div>
  )
})

function ExampleContent() {
  return (
    <Table
      size="small"
      bordered
      pagination={false}
      rowKey="key"
      dataSource={EXAMPLE_TAGS}
      columns={[
        {
          title: '审核标签',
          dataIndex: 'label',
          width: 120,
          render: (v: string) => <strong>{v}</strong>,
        },
        {
          title: '审核描述',
          dataIndex: 'desc',
          render: (v: string) => <div style={{ whiteSpace: 'pre-wrap' }}>{v}</div>,
        },
      ]}
    />
  )
}

export default CreateAgentForm

function FragmentRow({
  row,
  onChange,
  onDelete,
}: {
  row: AgentPromptRow
  onChange: (patch: Partial<AgentPromptRow>) => void
  onDelete: () => void
}) {
  const [editOpen, setEditOpen] = useState(false)
  const [draft, setDraft] = useState({ label: row.label, desc: row.desc })

  useEffect(() => {
    if (!editOpen) {
      setDraft({ label: row.label, desc: row.desc })
    }
  }, [row.label, row.desc, editOpen])

  const handleEditConfirm = () => {
    onChange({ label: draft.label, desc: draft.desc })
    setEditOpen(false)
  }

  const handleEditCancel = () => {
    setDraft({ label: row.label, desc: row.desc })
    setEditOpen(false)
  }

  const editContent = (
    <div style={{ width: 360 }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ marginBottom: 4 }}>审核标签</div>
        <Input
          value={draft.label}
          onChange={(e) => setDraft({ ...draft, label: e.target.value })}
          maxLength={LABEL_MAX}
          placeholder="请输入审核标签"
        />
      </div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ marginBottom: 4 }}>审核描述</div>
        <TextArea
          value={draft.desc}
          onChange={(e) => setDraft({ ...draft, desc: e.target.value })}
          maxLength={DESC_MAX}
          placeholder="请输入审核描述"
          autoSize={{ minRows: 4, maxRows: 8 }}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button size="small" onClick={handleEditCancel}>
          取消
        </Button>
        <Button size="small" type="primary" onClick={handleEditConfirm}>
          确定
        </Button>
      </div>
    </div>
  )

  return (
    <>
      <div style={{ paddingBottom: 8 }}>
        <TextArea
          value={row.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="请输入审核标签"
          maxLength={LABEL_MAX}
          showCount
          autoSize={{ minRows: ROW_TEXT_AREA_ROWS, maxRows: ROW_TEXT_AREA_ROWS }}
          style={{ resize: 'none' }}
        />
      </div>
      <div style={{ paddingBottom: 8 }}>
        <TextArea
          value={row.desc}
          onChange={(e) => onChange({ desc: e.target.value })}
          placeholder="请输入审核描述"
          maxLength={DESC_MAX}
          showCount
          autoSize={{ minRows: ROW_TEXT_AREA_ROWS, maxRows: ROW_TEXT_AREA_ROWS }}
          style={{ resize: 'none' }}
        />
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          alignItems: 'flex-start',
          paddingTop: 4,
          paddingBottom: 8,
        }}
      >
        <Popover
          content={editContent}
title="编辑审核标签"
          trigger="click"
          open={editOpen}
          onOpenChange={(v) => setEditOpen(v)}
          placement="left"
          destroyTooltipOnHide
        >
          <Tooltip title="编辑审核标签" placement="left">
            <Button
              size="small"
              type="text"
              icon={<EditOutlined style={{ fontSize: 13 }} />}
              aria-label={`编辑审核标签 ${row.label || ''}`}
              style={{ color: '#64748B', width: 24, height: 24, padding: 0 }}
            />
          </Tooltip>
        </Popover>
        <Popconfirm
          title="确认删除该审核标签？删除后无法撤销。"
          okText="删除"
          cancelText="取消"
          okButtonProps={{ danger: true }}
          onConfirm={onDelete}
          placement="left"
        >
          <Tooltip title="删除该审核标签" placement="left">
            <Button
              size="small"
              type="text"
              icon={<DeleteOutlined style={{ fontSize: 13 }} />}
              aria-label={`删除审核标签 ${row.label || ''}`}
              style={{ color: '#64748B', width: 24, height: 24, padding: 0 }}
            />
          </Tooltip>
        </Popconfirm>
      </div>
    </>
  )
}