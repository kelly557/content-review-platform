import { useEffect, useState } from 'react'
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

const { Title, Text } = Typography
const { TextArea } = Input

export interface AgentPromptRow {
  id: string
  label: string
  desc: string
}

export interface CreateAgentPayload {
  modality: '文本' | '图像' | '图文'
  name: string
  largeModel: string
  rows: AgentPromptRow[]
}

export interface CreateAgentFormProps {
  submitting?: boolean
  onCancel: () => void
  onSubmit: (payload: CreateAgentPayload) => void
  aiDrawerOpen: boolean
  onAiDrawerOpenChange: (open: boolean) => void
  onAddOptimizedConfig?: (cfg: { label: string; desc: string }) => void
  initialName?: string
  initialModality?: '文本' | '图像' | '图文'
  initialLargeModel?: string
  initialRows?: AgentPromptRow[]
  draftSavedAt?: string | null
  showTopBar?: boolean
  canPublish?: boolean
  onHistory?: () => void
  onTest?: () => void
  onPublish?: () => void
}

const LARGE_MODEL_OPTIONS: {
  label: string
  value: string
  modality: ('文本' | '图像' | '图文')[]
}[] = [
  { label: '文本审核大模型', value: 'text_audit_llm', modality: ['文本', '图文'] },
  { label: '图像审核大模型', value: 'image_audit_llm', modality: ['图像', '图文'] },
  { label: '多模态审核大模型', value: 'multimodal_audit_llm', modality: ['图文'] },
]

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
  '"审核点"即待检测类别,"审核描述"是对相应审核点检测标准及规则的解释说明。',
  '系统会将多个审核点及对应提示词以预设的格式拼接形成完整的提示词,调用大模型获得审核结果,故请尽可能用准确、精简的语言描述大模型的每一项审核点。',
]

function genId() {
  return `row-${Math.random().toString(36).slice(2, 9)}`
}

export default function CreateAgentForm({
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
  showTopBar,
  canPublish,
  onHistory,
  onTest,
  onPublish,
}: CreateAgentFormProps) {
  const { message } = App.useApp()
  const filteredLargeModels = LARGE_MODEL_OPTIONS.filter((o) =>
    o.modality.includes(initialModality ?? '图文'),
  )
  const defaultLargeModel = filteredLargeModels[0]?.value ?? LARGE_MODEL_OPTIONS[0].value
  const [name, setName] = useState(initialName || '未命名审核智能体')
  const [editingName, setEditingName] = useState(false)
  const [largeModel, setLargeModel] = useState<string>(initialLargeModel ?? defaultLargeModel)
  const [rows, setRows] = useState<AgentPromptRow[]>(initialRows ?? DEFAULT_ROWS)

  useEffect(() => {
    setName(initialName || '未命名审核智能体')
    setEditingName(false)
    setLargeModel(initialLargeModel ?? (filteredLargeModels[0]?.value ?? LARGE_MODEL_OPTIONS[0].value))
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

  const handleExampleAll = () => {
    setRows((prev) =>
      prev.map((r) => ({
        ...r,
        desc: '示例:' + (r.desc || '医药/金融/广告等场景的违规识别与拦截'),
      })),
    )
    message.info('已填入示例描述（原型）')
  }

  const handleAiOptimizeAll = () => {
    onAiDrawerOpenChange(true)
  }

  const handleAddOptimizedConfig = (cfg: { label: string; desc: string }) => {
    setRows((prev) => {
      if (prev.length === 0) return prev
      return prev.map((r, i) => (i === 0 ? { ...r, label: cfg.label, desc: cfg.desc } : r))
    })
    onAiDrawerOpenChange(false)
    message.success('已替换首条审核点')
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
      message.warning('请至少填写一行审核点与审核描述')
      return
    }
    onSubmit({
      modality: initialModality ?? '图文',
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
            <InfoCircleOutlined style={{ color: '#1677FF' }} />
            <Text type="secondary">
              {draftSavedAt
                ? `草稿保存于：${draftSavedAt}`
                : '尚未保存草稿，编辑后请点击保存草稿'}
            </Text>
          </Space>
          <Space size={8}>
            <Button onClick={onHistory} disabled={!onHistory}>
              历史版本
            </Button>
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
            模态：<Text strong>{initialModality ?? '图文'}</Text>
          </Text>
        </div>
        <Select
          value={largeModel}
          onChange={setLargeModel}
          options={filteredLargeModels.map((o) => ({ label: o.label, value: o.value }))}
          style={{ width: '100%' }}
          placeholder="请选择大模型"
        />
      </Card>

      <Card
        size="small"
        title={<span style={{ borderLeft: '3px solid #1677FF', paddingLeft: 8 }}>配置自定义提示词</span>}
        styles={{ body: { padding: 16 } }}
      >
        <div style={{ marginBottom: 12 }}>
          <Space size={8} align="center">
            <Text strong>配置审核点</Text>
            <Tooltip
              title={
                <div style={{ maxWidth: 360, lineHeight: 1.6 }}>
                  {CONFIG_HELP_LINES.map((line, i) => (
                    <div key={i}>{line}</div>
                  ))}
                </div>
              }
            >
              <InfoCircleOutlined style={{ color: '#94A3B8', cursor: 'help' }} aria-label="审核点说明" />
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
          <div style={{ fontWeight: 600 }}>审核点</div>
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
              <Button
                size="small"
                icon={<QuestionCircleOutlined />}
                onClick={handleExampleAll}
                aria-label="示例"
              >
                示例
              </Button>
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
            添加自定义审核点
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
}

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
        <div style={{ marginBottom: 4 }}>审核点</div>
        <Input
          value={draft.label}
          onChange={(e) => setDraft({ ...draft, label: e.target.value })}
          maxLength={LABEL_MAX}
          placeholder="请输入审核点"
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
          placeholder="请输入审核点"
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
          title="编辑审核点"
          trigger="click"
          open={editOpen}
          onOpenChange={(v) => setEditOpen(v)}
          placement="left"
          destroyTooltipOnHide
        >
          <Tooltip title="编辑审核点" placement="left">
            <Button
              size="small"
              type="text"
              icon={<EditOutlined style={{ fontSize: 13 }} />}
              aria-label={`编辑审核点 ${row.label || ''}`}
              style={{ color: '#64748B', width: 24, height: 24, padding: 0 }}
            />
          </Tooltip>
        </Popover>
        <Popconfirm
          title="确认删除该审核点？删除后无法撤销。"
          okText="删除"
          cancelText="取消"
          okButtonProps={{ danger: true }}
          onConfirm={onDelete}
          placement="left"
        >
          <Tooltip title="删除该审核点" placement="left">
            <Button
              size="small"
              type="text"
              icon={<DeleteOutlined style={{ fontSize: 13 }} />}
              aria-label={`删除审核点 ${row.label || ''}`}
              style={{ color: '#64748B', width: 24, height: 24, padding: 0 }}
            />
          </Tooltip>
        </Popconfirm>
      </div>
    </>
  )
}