import { useEffect, useMemo, useState } from 'react'
import {
  App,
  Breadcrumb,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  type TableColumnsType,
} from 'antd'
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  RobotOutlined,
  SearchOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { workflowsApi } from '@/api/workflows'
import { parseStages } from '@/lib/parseStages'
import { HR_PREFIX, buildHrCode } from '@/lib/strategyCode'
import type {
  WorkflowStagePayload,
  WorkflowTemplate,
  WorkflowTemplateCreate,
  WorkflowTemplateUpdate,
} from '@/types/domain'

const { Title, Text, Paragraph } = Typography

const ROLE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'reviewer', label: '审核员' },
  { value: 'mlr', label: 'MLR 专家' },
  { value: 'admin', label: '管理员' },
]

const MODE_OPTIONS: Array<{ value: 'single' | 'joint'; label: string }> = [
  { value: 'single', label: '单人' },
  { value: 'joint', label: '会签' },
]

function roleLabel(role: string) {
  return ROLE_OPTIONS.find((o) => o.value === role)?.label ?? role
}

function modeLabel(mode: string) {
  return MODE_OPTIONS.find((o) => o.value === mode)?.label ?? mode
}

export default function HumanReviewRulesPage() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const [items, setItems] = useState<WorkflowTemplate[]>([])
  const [loading, setLoading] = useState(false)
  const [keyword, setKeyword] = useState('')

  const fetchList = async () => {
    setLoading(true)
    try {
      const list = await workflowsApi.list({ prefix: HR_PREFIX, include_inactive: true })
      setItems(list)
    } catch {
      message.error('加载审核策略失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchList()
  }, [])

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase()
    if (!k) return items
    return items.filter((t) => t.name.toLowerCase().includes(k))
  }, [items, keyword])

  const [editing, setEditing] = useState<WorkflowTemplate | null>(null)
  const [modalOpen, setModalOpen] = useState(false)

  const openCreate = () => {
    setEditing(null)
    setModalOpen(true)
  }

  const openEdit = (t: WorkflowTemplate) => {
    setEditing(t)
    setModalOpen(true)
  }

  const onDelete = async (t: WorkflowTemplate) => {
    try {
      await workflowsApi.remove(t.id)
      message.success('已删除')
      fetchList()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail ?? '删除失败')
    }
  }

  const columns: TableColumnsType<WorkflowTemplate> = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      width: 220,
      render: (v: string, t) => (
        <Space direction="vertical" size={2} style={{ lineHeight: 1.4 }}>
          <Text strong>{v}</Text>
          {t.description && (
            <Text type="secondary" style={{ fontSize: 12 }} ellipsis={{ tooltip: t.description }}>
              {t.description}
            </Text>
          )}
        </Space>
      ),
    },
    {
      title: '阶段',
      key: 'stageCount',
      width: 80,
      render: (_, t) => (
        <Tooltip
          title={
            <div>
              {(t.definition?.stages ?? []).map((s, i) => (
                <div key={i}>
                  {i + 1}. {s.name}（{roleLabel(s.role)} · {modeLabel(s.mode)}）
                </div>
              ))}
            </div>
          }
        >
          <Tag color="blue">{t.definition?.stages?.length ?? 0} 阶段</Tag>
        </Tooltip>
      ),
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      key: 'is_active',
      width: 80,
      render: (v: boolean) =>
        v ? <Tag color="green">启用</Tag> : <Tag color="default">停用</Tag>,
    },
    {
      title: '更新时间',
      dataIndex: 'updated_at',
      key: 'updated_at',
      width: 160,
      render: (v?: string | null) => (v ? new Date(v).toLocaleString('zh-CN') : '-'),
    },
    {
      title: '操作',
      key: 'actions',
      width: 160,
      render: (_, t) => (
        <Space>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(t)}>
            编辑
          </Button>
          <Popconfirm
            title="确认删除？"
            description={`删除「${t.name}」后无法恢复`}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => onDelete(t)}
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div style={{ width: '100%' }}>
      <Breadcrumb
        items={[
          { title: <a onClick={() => navigate('/overview')}>总览</a> },
          { title: '人工审核策略' },
        ]}
        style={{ marginBottom: 16 }}
      />
      <Title level={3} style={{ margin: 0, marginBottom: 8 }}>
        人工审核策略
      </Title>
      <Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 24 }}>
        配置各服务在 AI 审核后使用的人工审核策略，包括审核节点、角色与协作模式
      </Text>

      <Card
        variant="borderless"
        style={{ border: '1px solid #E2E8F0', borderRadius: 6 }}
        styles={{ body: { padding: 16 } }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <Input
            allowClear
            placeholder="搜索名称"
            prefix={<SearchOutlined style={{ color: '#94A3B8' }} />}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            style={{ maxWidth: 320 }}
          />
          <Space>
            <Button
              icon={<ReloadOutlined />}
              onClick={fetchList}
              loading={loading}
            >
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新建审核策略
            </Button>
          </Space>
        </div>

        <Table<WorkflowTemplate>
          rowKey="id"
          size="middle"
          loading={loading}
          columns={columns}
          dataSource={filtered}
          pagination={{ pageSize: 20, showSizeChanger: false, hideOnSinglePage: true }}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="暂无审核策略"
                style={{ padding: '32px 0' }}
              />
            ),
          }}
        />
      </Card>

      {modalOpen && (
        <RuleModal
          open={modalOpen}
          editing={editing}
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            setModalOpen(false)
            fetchList()
          }}
        />
      )}
    </div>
  )
}

interface RuleModalProps {
  open: boolean
  editing: WorkflowTemplate | null
  onClose: () => void
  onSaved: () => void
}

function RuleModal({ open, editing, onClose, onSaved }: RuleModalProps) {
  const { message } = App.useApp()
  const [form] = Form.useForm<{
    name: string
    description?: string
    is_active: boolean
    stages: WorkflowStagePayload[]
  }>()
  const [tab, setTab] = useState<'nl' | 'struct'>('nl')
  const [nlText, setNlText] = useState('')
  const [parsedStages, setParsedStages] = useState<WorkflowStagePayload[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    if (editing) {
      const stages = (editing.definition?.stages ?? []).map((s) => ({
        name: s.name,
        role: s.role,
        mode: s.mode as 'single' | 'joint',
      }))
      form.setFieldsValue({
        name: editing.name,
        description: editing.description ?? '',
        is_active: editing.is_active,
        stages,
      })
      setNlText(editing.description ?? '')
      setParsedStages(stages)
      setTab('struct')
    } else {
      form.resetFields()
      form.setFieldsValue({
        is_active: true,
        stages: [{ name: '初审', role: 'reviewer', mode: 'single' }],
      })
      setNlText('')
      setParsedStages([])
      setTab('nl')
    }
  }, [open, editing, form])

  const onParsePreview = () => {
    const parsed = parseStages(nlText)
    if (parsed.length === 0) {
      message.warning('未识别到任何阶段，请补充描述或切换到结构化编辑')
      return
    }
    setParsedStages(parsed)
  }

  const onApplyParsed = () => {
    form.setFieldValue('stages', parsedStages)
    setTab('struct')
  }

  const onSubmit = async () => {
    try {
      const values = await form.validateFields()
      const payload: WorkflowTemplateCreate | WorkflowTemplateUpdate = {
        name: values.name,
        description: values.description || undefined,
        is_active: values.is_active,
        stages: values.stages,
      }
      setSaving(true)
      if (editing) {
        await workflowsApi.update(editing.id, payload)
        message.success('已保存')
      } else {
        const existingCodes = await workflowsApi.list({ prefix: HR_PREFIX, include_inactive: true }).then(
          (list) => list.map((t) => t.code),
        )
        const code = buildHrCode(values.name, existingCodes)
        await workflowsApi.create({ ...payload, code } as WorkflowTemplateCreate)
        message.success('已创建')
      }
      onSaved()
    } catch (e: unknown) {
      if (e && typeof e === 'object' && 'errorFields' in e) {
        return
      }
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail ?? (editing ? '保存失败' : '创建失败'))
    } finally {
      setSaving(false)
    }
  }

  const isCreate = !editing

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={680}
      title={isCreate ? '新建人工审核策略' : '编辑人工审核策略'}
      okText={isCreate ? '创建' : '保存'}
      cancelText="取消"
      confirmLoading={saving}
      onOk={onSubmit}
      destroyOnHidden
    >
      <Tabs
        activeKey={tab}
        onChange={(k) => setTab(k as 'nl' | 'struct')}
        items={[
          {
            key: 'nl',
            label: (
              <span>
                <RobotOutlined /> 自然语言
              </span>
            ),
            disabled: !isCreate,
            children: (
              <div>
                <Paragraph type="secondary" style={{ marginTop: 0 }}>
                  用一段中文描述人工审核策略，系统会识别审核节点、角色与协作模式。
                </Paragraph>
                <Form layout="vertical">
                  <Form.Item label="名称" required>
                    <Input
                      placeholder="例如：敏感内容多级审核"
                      value={form.getFieldValue('name') as string | undefined}
                      onChange={(e) => form.setFieldValue('name', e.target.value)}
                    />
                  </Form.Item>
                  <Form.Item label="描述（自然语言）" required>
                    <Input.TextArea
                      rows={4}
                      placeholder="例如：先由审核员初审，敏感内容升级到 MLR 联合复审，最后由终审确认"
                      value={nlText}
                      onChange={(e) => setNlText(e.target.value)}
                    />
                  </Form.Item>
                </Form>
                <Space style={{ marginBottom: 8 }}>
                  <Button icon={<ThunderboltOutlined />} onClick={onParsePreview}>
                    解析预览
                  </Button>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    提示：关键词「初审 / 终审 → 单人」；「MLR / 合规 / 联合 / 会签 → 多人」
                  </Text>
                </Space>
                {parsedStages.length > 0 && (
                  <div
                    style={{
                      border: '1px dashed #BAE6FD',
                      background: '#F0F9FF',
                      borderRadius: 6,
                      padding: 12,
                      marginTop: 8,
                    }}
                  >
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      识别到 {parsedStages.length} 个阶段：
                    </Text>
                    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {parsedStages.map((s, i) => (
                        <div
                          key={i}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '6px 10px',
                            background: '#fff',
                            border: '1px solid #E2E8F0',
                            borderRadius: 4,
                          }}
                        >
                          <Tag color="blue" style={{ margin: 0 }}>
                            {i + 1}
                          </Tag>
                          <Text strong>{s.name}</Text>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {roleLabel(s.role)} · {modeLabel(s.mode)}
                          </Text>
                        </div>
                      ))}
                    </div>
                    <Button
                      type="primary"
                      size="small"
                      style={{ marginTop: 12 }}
                      onClick={onApplyParsed}
                    >
                      套用并切换到结构化继续编辑
                    </Button>
                  </div>
                )}
              </div>
            ),
          },
          {
            key: 'struct',
            label: (
              <span>
                <ThunderboltOutlined /> 结构化
              </span>
            ),
            children: (
              <Form form={form} layout="vertical">
                <Form.Item
                  label="名称"
                  name="name"
                  rules={[{ required: true, message: '请输入名称' }]}
                >
                  <Input placeholder="例如：敏感内容多级审核" />
                </Form.Item>
                {isCreate && (
                  <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                    编码由系统基于名称自动生成，已存在时会自动追加序号
                  </Text>
                )}
                <Form.Item label="描述" name="description">
                  <Input.TextArea
                    rows={2}
                    placeholder="可选，描述审核策略的用途"
                  />
                </Form.Item>
                <Form.Item label="启用" name="is_active" valuePropName="checked">
                  <Switch />
                </Form.Item>
                <Form.List
                  name="stages"
                  rules={[
                    {
                      validator: async (_, value) => {
                        if (!value || value.length < 1) {
                          return Promise.reject(new Error('至少需要 1 个阶段'))
                        }
                      },
                    },
                  ]}
                >
                  {(fields, { add, remove }, { errors }) => (
                    <div>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginBottom: 8,
                        }}
                      >
                        <Text strong>审核节点规则</Text>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          至少 1 个阶段
                        </Text>
                      </div>
                      <div
                        style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
                      >
                        {fields.map((field) => (
                          <div
                            key={field.key}
                            style={{
                              display: 'grid',
                              gridTemplateColumns: '40px 1fr 120px 100px 40px',
                              gap: 8,
                              alignItems: 'center',
                              padding: 8,
                              background: '#F8FAFC',
                              borderRadius: 4,
                              border: '1px solid #E2E8F0',
                            }}
                          >
                            <Tag color="blue" style={{ margin: 0, textAlign: 'center' }}>
                              {field.name + 1}
                            </Tag>
                            <Form.Item
                              {...field}
                              name={[field.name, 'name']}
                              noStyle
                              rules={[{ required: true, message: '请输入阶段名称' }]}
                            >
                              <Input placeholder="阶段名称，如初审" />
                            </Form.Item>
                            <Form.Item
                              {...field}
                              name={[field.name, 'role']}
                              noStyle
                              rules={[{ required: true, message: '请选择角色' }]}
                            >
                              <Select options={ROLE_OPTIONS} placeholder="角色" />
                            </Form.Item>
                            <Form.Item
                              {...field}
                              name={[field.name, 'mode']}
                              noStyle
                              rules={[{ required: true, message: '请选择模式' }]}
                            >
                              <Select options={MODE_OPTIONS} placeholder="模式" />
                            </Form.Item>
                            <Tooltip title={fields.length <= 1 ? '至少保留 1 个阶段' : '删除'}>
                              <Button
                                type="text"
                                danger
                                icon={<DeleteOutlined />}
                                disabled={fields.length <= 1}
                                onClick={() => remove(field.name)}
                              />
                            </Tooltip>
                          </div>
                        ))}
                      </div>
                      <Button
                        type="dashed"
                        onClick={() => add({ name: '', role: 'reviewer', mode: 'single' })}
                        style={{ width: '100%', marginTop: 8 }}
                      >
                        + 添加阶段
                      </Button>
                      <Form.ErrorList errors={errors} />
                    </div>
                  )}
                </Form.List>
              </Form>
            ),
          },
        ]}
      />
    </Modal>
  )
}
