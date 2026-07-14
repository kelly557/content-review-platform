import { useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  App,
} from 'antd'
import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  KeyOutlined,
  PlusOutlined,
  StopOutlined,
} from '@ant-design/icons'
import { Link, useParams } from 'react-router-dom'
import dayjs from 'dayjs'
import { providersApi, registeredModelsApi } from '@/api/registered-models'
import { useAuthStore } from '@/store'
import {
  LARGE_MODEL_CATEGORY_OPTIONS,
  REGISTERED_MODEL_PROVIDER_PRESETS,
  type LargeModelCategory,
  type RegisteredModelCreate,
  type RegisteredProviderDetail,
  type RegisteredProviderUpdate,
} from '@/types/domain'

const { Title } = Typography

const PRESET_COLOR: Record<string, string> = {
  active: 'green',
  archived: 'default',
}

export default function ProviderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const providerId = Number(id)
  const { message } = App.useApp()
  const { user } = useAuthStore()
  const canWrite = user?.role === 'admin' || user?.role === 'superadmin'

  const [data, setData] = useState<RegisteredProviderDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [validating, setValidating] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editForm] = Form.useForm<RegisteredProviderUpdate>()
  const [rotateOpen, setRotateOpen] = useState(false)
  const [rotateForm] = Form.useForm<{ api_key: string }>()
  const [appendOpen, setAppendOpen] = useState(false)
  const [appending, setAppending] = useState(false)
  const [appendForm] = Form.useForm<{
    name?: string
    model_name: string
    large_category: LargeModelCategory
    version?: string
    description?: string
  }>()

  const fetchAll = async () => {
    setLoading(true)
    try {
      const pd = await providersApi.get(providerId)
      setData(pd)
    } catch {
      // handled
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (Number.isFinite(providerId)) void fetchAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId])

  const handleValidate = async () => {
    setValidating(true)
    try {
      const r = await providersApi.validate(providerId)
      if (r.ok) {
        message.success(`连通性 OK（HTTP ${r.http_status}, ${r.latency_ms ?? '-'}ms）`)
      } else {
        message.error(`校验失败：${r.message}`)
      }
    } catch {
      // handled
    } finally {
      setValidating(false)
    }
  }

  const handleEditSubmit = async () => {
    const v = await editForm.validateFields().catch(() => null)
    if (!v) return
    try {
      await providersApi.update(providerId, v)
      message.success('已更新')
      setEditing(false)
      await fetchAll()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      const text = typeof detail === 'string' ? detail : '更新失败'
      message.error(text)
    }
  }

  const handleRotate = async () => {
    const v = await rotateForm.validateFields().catch(() => null)
    if (!v) return
    try {
      await providersApi.rotateApiKey(providerId, { api_key: v.api_key })
      message.success('API Key 已替换')
      rotateForm.resetFields()
      setRotateOpen(false)
      await fetchAll()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      const text = typeof detail === 'string' ? detail : '替换失败'
      message.error(text)
    }
  }

  const handleArchive = async () => {
    try {
      await providersApi.archive(providerId)
      message.success('已归档')
      await fetchAll()
    } catch {
      // handled
    }
  }

  const handleDelete = async () => {
    try {
      await providersApi.delete(providerId)
      message.success('已删除')
      window.history.back()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      const text = typeof detail === 'string' ? detail : '删除失败'
      message.error(text)
    }
  }

  const handleAppendModel = async () => {
    const v = await appendForm.validateFields().catch(() => null)
    if (!v) return
    if (!v.model_name || !v.model_name.trim()) {
      message.error('请填写 model_id')
      return
    }
    if (!v.large_category) {
      message.error('请选择大模型分类')
      return
    }
    setAppending(true)
    try {
      const payload: RegisteredModelCreate = {
        name: (v.name ?? v.model_name).trim(),
        description: v.description,
        kind: 'large',
        small_category: null,
        large_category: v.large_category,
        provider_id: providerId,
        model_name: v.model_name.trim(),
        version: v.version,
      }
      await registeredModelsApi.create(payload)
      message.success('模型已追加到该 Provider')
      appendForm.resetFields()
      setAppendOpen(false)
      await fetchAll()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      const text = typeof detail === 'string' ? detail : '追加失败'
      message.error(text)
    } finally {
      setAppending(false)
    }
  }

  if (loading && !data) {
    return <Spin style={{ display: 'block', margin: '20vh auto' }} />
  }

  if (!data) {
    return <Empty description="Provider 不存在或已删除" />
  }

  const presetLabel = data.provider_preset
    ? REGISTERED_MODEL_PROVIDER_PRESETS.find((p) => p.value === data.provider_preset)?.label ?? data.provider_preset
    : '自定义'

  return (
    <div style={{ width: '100%' }}>
      {!canWrite && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="您当前为只读用户。"
        />
      )}
      <Space style={{ marginBottom: 12 }}>
        <Link to="/resources/models" style={{ color: '#0369A1' }}>
          <Space size={4} align="center">
            <ArrowLeftOutlined />
            模型库
          </Space>
        </Link>
      </Space>
      <Card
        title={
          <Space>
            <Title level={4} style={{ margin: 0 }}>
              {data.display_name}
            </Title>
            <Tag color="blue">{presetLabel}</Tag>
            {data.provider_preset && (
              <Tag color={PRESET_COLOR[data.status] ?? 'default'}>{data.status}</Tag>
            )}
          </Space>
        }
        extra={
          <Space>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setAppendOpen(true)}
              disabled={!canWrite || data.status === 'archived'}
            >
              添加模型
            </Button>
            <Tooltip title={data.status === 'archived' ? '归档态不可校验' : ''}>
              <Button
                icon={<CheckCircleOutlined />}
                loading={validating}
                onClick={handleValidate}
                disabled={!canWrite || data.status === 'archived'}
              >
                校验连通性
              </Button>
            </Tooltip>
            <Button onClick={() => setEditing(true)} disabled={!canWrite}>
              编辑
            </Button>
            <Button
              icon={<KeyOutlined />}
              onClick={() => setRotateOpen(true)}
              disabled={!canWrite}
            >
              替换 API Key
            </Button>
            <Popconfirm
              title="归档该 Provider？"
              okText="归档"
              cancelText="取消"
              onConfirm={handleArchive}
              disabled={data.status === 'archived'}
            >
              <Button icon={<StopOutlined />} disabled={!canWrite || data.status === 'archived'}>
                归档
              </Button>
            </Popconfirm>
            <Popconfirm
              title="删除该 Provider？"
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={handleDelete}
              disabled={data.model_count > 0}
            >
              <Tooltip
                title={
                  data.model_count > 0
                    ? '该 Provider 下仍有模型，无法删除（请先迁移模型）'
                    : ''
                }
              >
                <Button danger disabled={!canWrite || data.model_count > 0}>
                  删除
                </Button>
              </Tooltip>
            </Popconfirm>
          </Space>
        }
      >
        <Tabs
          items={[
            {
              key: 'overview',
              label: '概览',
              children: (
                <Descriptions bordered column={2} size="small">
                  <Descriptions.Item label="Display name" span={2}>
                    {data.display_name}
                  </Descriptions.Item>
                  <Descriptions.Item label="Provider 类型">{presetLabel}</Descriptions.Item>
                  <Descriptions.Item label="状态">
                    <Tag color={PRESET_COLOR[data.status] ?? 'default'}>{data.status}</Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="Base URL" span={2}>
                    <code>{data.endpoint_url}</code>
                  </Descriptions.Item>
                  <Descriptions.Item label="API Key（凭证）" span={2}>
                    {data.masked_token ?? '-'}
                  </Descriptions.Item>
                  <Descriptions.Item label="模型数">{data.model_count}</Descriptions.Item>
                  <Descriptions.Item label="Protocol">
                    {(data.config as Record<string, unknown>)?.protocol?.toString() ?? '-'}
                  </Descriptions.Item>
                  <Descriptions.Item label="说明" span={2}>
                    {data.description || '-'}
                  </Descriptions.Item>
                  <Descriptions.Item label="创建时间">
                    {dayjs(data.created_at).format('YYYY-MM-DD HH:mm:ss')}
                  </Descriptions.Item>
                  <Descriptions.Item label="更新时间">
                    {data.updated_at
                      ? dayjs(data.updated_at).format('YYYY-MM-DD HH:mm:ss')
                      : '-'}
                  </Descriptions.Item>
                </Descriptions>
              ),
            },
            {
              key: 'models',
              label: `模型 (${data.model_count})`,
              children:
                data.models.length === 0 ? (
                  <Empty description="该 Provider 下暂无模型" />
                ) : (
                  <Table
                    rowKey="id"
                    size="small"
                    pagination={false}
                    dataSource={data.models}
                    columns={[
                      { title: '名称', dataIndex: 'name', width: 220 },
                      {
                        title: '类型',
                        dataIndex: 'kind',
                        width: 80,
                        render: (v: string) => <Tag color={v === 'large' ? 'magenta' : 'blue'}>{v === 'large' ? '大模型' : '小模型'}</Tag>,
                      },
                      {
                        title: '分类',
                        dataIndex: 'large_category',
                        width: 110,
                        render: (v: string | null, row) => {
                          if (row.kind === 'large' && v) {
                            const opt = LARGE_MODEL_CATEGORY_OPTIONS.find((o) => o.value === v)
                            return opt ? <Tag color={opt.color}>{opt.label}</Tag> : v
                          }
                          if (row.kind === 'small' && row.small_category) {
                            return <Tag color="purple">{row.small_category}</Tag>
                          }
                          return '-'
                        },
                      },
                      { title: 'Model ID', dataIndex: 'model_name', width: 200 },
                      {
                        title: '状态',
                        dataIndex: 'status',
                        width: 100,
                        render: (v: string) => <Tag>{v}</Tag>,
                      },
                      {
                        title: '操作',
                        width: 120,
                        render: (_v, row) => (
                          <Link to={`/resources/models/${row.id}`}>
                            <Button type="link" size="small">
                              查看
                            </Button>
                          </Link>
                        ),
                      },
                    ]}
                  />
                ),
            },
          ]}
        />
      </Card>

      <Modal
        title="编辑 Provider"
        open={editing}
        onCancel={() => setEditing(false)}
        onOk={handleEditSubmit}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form<RegisteredProviderUpdate>
          form={editForm}
          layout="vertical"
          initialValues={{
            display_name: data.display_name,
            description: data.description ?? undefined,
            endpoint_url: data.endpoint_url,
            provider_preset: data.provider_preset ?? undefined,
          }}
        >
          <Form.Item label="Display name" name="display_name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="Provider 类型" name="provider_preset">
            <Input disabled />
          </Form.Item>
          <Form.Item
            label="Base URL"
            name="endpoint_url"
            rules={[{ required: true, type: 'url', message: '请填写有效 URL' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="替换 API Key"
        open={rotateOpen}
        onCancel={() => setRotateOpen(false)}
        onOk={handleRotate}
        okText="替换"
        cancelText="取消"
        destroyOnClose
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="替换后所有引用该凭证的 model 调用将立即使用新 key；旧 token 不再有效。"
        />
        <Form<{ api_key: string }> form={rotateForm} layout="vertical">
          <Form.Item
            label="新的 API Key"
            name="api_key"
            rules={[{ required: true, message: '请填写新的 API key' }]}
          >
            <Input.Password visibilityToggle placeholder="sk-..." />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`添加模型到「${data.display_name}」`}
        open={appendOpen}
        onCancel={() => setAppendOpen(false)}
        onOk={handleAppendModel}
        okText="保存"
        cancelText="取消"
        confirmLoading={appending}
        destroyOnClose
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="该模型将立即挂载到当前 Provider，凭证与 Base URL 继承自 Provider。"
        />
        <Form
          form={appendForm}
          layout="vertical"
          initialValues={{ large_category: 'text' as LargeModelCategory }}
        >
          <Form.Item
            label="Model ID"
            name="model_name"
            rules={[{ required: true, message: '请填写 Model ID' }]}
            tooltip="厂商返回的模型标识，如 gpt-4o-mini / claude-3-5-sonnet-latest"
          >
            <Input placeholder="gpt-4o-mini / claude-3-5-sonnet-latest" />
          </Form.Item>
          <Form.Item label="模型名称" name="name">
            <Input placeholder="留空则使用 Model ID 作为展示名" />
          </Form.Item>
          <Form.Item
            label="大模型分类"
            name="large_category"
            rules={[{ required: true, message: '请选择大模型分类' }]}
          >
            <Select
              options={LARGE_MODEL_CATEGORY_OPTIONS.map((o) => ({
                value: o.value,
                label: o.label,
              }))}
            />
          </Form.Item>
          <Form.Item label="Version" name="version" tooltip="语义版本号，如 1.0.0（可选）">
            <Input placeholder="1.0.0" />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={2} placeholder="该模型的用途 / 注意事项" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
