import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Drawer,
  Form,
  Input,
  Popconfirm,
  Radio,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  App,
} from 'antd'
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { Link } from 'react-router-dom'
import dayjs from 'dayjs'
import { registeredModelsApi, credentialsApi } from '@/api/registered-models'
import type {
  RegisteredModelCreate,
  RegisteredModelKind,
  RegisteredModelListItem,
  RegisteredModelProvider,
  RegisteredModelStatus,
  ResourceCredential,
  SmallModelCategory,
} from '@/types/domain'
import {
  REGISTERED_MODEL_KIND_OPTIONS,
  REGISTERED_MODEL_PROVIDER_PRESETS,
  REGISTERED_MODEL_STATUS_OPTIONS,
  SMALL_MODEL_CATEGORY_OPTIONS,
} from '@/types/domain'
import { useAuthStore } from '@/store'
import SmallModelFormFields, {
  type SmallModelFormValues,
} from './SmallModelFormFields'

const { Text } = Typography

interface LargeModelFormValues {
  provider?: RegisteredModelProvider
  model_name: string
  endpoint_url?: string
  credential_id?: number
  version?: string
}

interface CreateFormValues extends SmallModelFormValues, LargeModelFormValues {
  kind: RegisteredModelKind
}

export default function ModelListPage() {
  const { message } = App.useApp()
  const { user } = useAuthStore()
  const canWrite = user?.role === 'admin' || user?.role === 'superadmin'

  const [q, setQ] = useState('')
  const [kind, setKind] = useState<RegisteredModelKind | null>(null)
  const [smallCategory, setSmallCategory] = useState<SmallModelCategory | null>(null)
  const [status, setStatus] = useState<RegisteredModelStatus | null>(null)
  const [providerFilter, setProviderFilter] = useState<string | null>(null)

  const [items, setItems] = useState<RegisteredModelListItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)

  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [createForm] = Form.useForm<CreateFormValues>()
  const [credentials, setCredentials] = useState<ResourceCredential[]>([])

  const fetchList = async () => {
    setLoading(true)
    try {
      const data = await registeredModelsApi.list({
        q: q || undefined,
        kind: kind ?? undefined,
        small_category: smallCategory ?? undefined,
        status: status ?? undefined,
        provider: providerFilter ?? undefined,
        size: 50,
      })
      setItems(data.items)
      setTotal(data.total)
    } catch {
      // handled
    } finally {
      setLoading(false)
    }
  }

  const fetchCredentials = async () => {
    try {
      const list = await credentialsApi.list()
      setCredentials(list)
    } catch {
      setCredentials([])
    }
  }

  useEffect(() => {
    void fetchList()
    void fetchCredentials()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openCreate = () => {
    if (!canWrite) {
      message.warning('仅管理员可添加模型')
      return
    }
    createForm.resetFields()
    createForm.setFieldsValue({
      kind: 'large',
      provider: 'openai',
    })
    setCreateOpen(true)
  }

  const onKindChange = (next?: RegisteredModelKind) => {
    if (next === 'large') {
      createForm.setFieldValue('small_category', undefined)
    } else if (next === 'small') {
      createForm.setFieldValue('provider', undefined)
      createForm.setFieldValue('endpoint_url', undefined)
      createForm.setFieldValue('credential_id', undefined)
    }
  }

  const onProviderChange = (next?: RegisteredModelProvider) => {
    if (!next) {
      createForm.setFieldValue('endpoint_url', '')
      return
    }
    const preset = REGISTERED_MODEL_PROVIDER_PRESETS.find((p) => p.value === next)
    createForm.setFieldValue('endpoint_url', preset?.defaultEndpoint ?? '')
  }

  const submitCreate = async () => {
    const v = await createForm.validateFields().catch(() => null)
    if (!v) return
    if (!v.model_name || !v.model_name.trim()) {
      message.error('请填写模型标识')
      return
    }
    if (v.kind === 'large') {
      if (!v.credential_id) {
        message.error('请选择凭证（API key）')
        return
      }
      if (!v.endpoint_url) {
        message.error('请填写 Base URL')
        return
      }
    } else {
      if (!v.small_category) {
        message.error('小模型必须选择分类')
        return
      }
      const artifact = (v as CreateFormValues & { __artifact?: unknown }).__artifact as
        | import('@/types/domain').ArtifactUploadResponse
        | undefined
      if (!artifact) {
        message.error('请上传小模型文件')
        return
      }
    }
    setCreating(true)
    try {
      if (v.kind === 'small') {
        const artifact = (v as CreateFormValues & { __artifact?: unknown }).__artifact as
          | import('@/types/domain').ArtifactUploadResponse
          | undefined
        const payload: RegisteredModelCreate = {
          name: v.name,
          description: v.description,
          kind: 'small',
          small_category: v.small_category,
          model_name: v.model_name.trim(),
          version: v.version,
          max_output_tokens: v.max_output_tokens,
          registration_method: 'uploaded_file',
          artifact: artifact ?? null,
        }
        await registeredModelsApi.create(payload)
      } else {
        const preset = v.provider
          ? REGISTERED_MODEL_PROVIDER_PRESETS.find((p) => p.value === v.provider)
          : undefined
        const payload: RegisteredModelCreate = {
          name: v.name,
          description: v.description,
          kind: 'large',
          small_category: undefined,
          provider: v.provider,
          model_name: v.model_name.trim(),
          endpoint_url: v.endpoint_url,
          version: v.version,
          config: { protocol: preset?.protocol ?? 'custom' },
          credential_id: v.credential_id ?? null,
          registration_method: 'remote_api',
        }
        await registeredModelsApi.create(payload)
      }
      message.success('模型添加成功')
      setCreateOpen(false)
      await fetchList()
    } catch {
      // handled
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (row: RegisteredModelListItem) => {
    try {
      await registeredModelsApi.delete(row.id)
      message.success('已删除')
      await fetchList()
    } catch {
      // handled
    }
  }

  const columns = useMemo(
    () => [
      { title: '名称', dataIndex: 'name', width: '20%' },
      {
        title: '类型',
        dataIndex: 'kind',
        width: '8%',
        render: (v: RegisteredModelKind) => {
          const opt = REGISTERED_MODEL_KIND_OPTIONS.find((o) => o.value === v)
          return <Tag color={opt?.color}>{opt?.label ?? v}</Tag>
        },
      },
      {
        title: '分类',
        dataIndex: 'small_category',
        width: '9%',
        render: (v: SmallModelCategory | null) => {
          if (!v) return '-'
          const opt = SMALL_MODEL_CATEGORY_OPTIONS.find((o) => o.value === v)
          return opt ? <Tag color={opt.color}>{opt.label}</Tag> : v
        },
      },
      {
        title: 'Provider',
        dataIndex: 'provider',
        width: '10%',
        render: (v: string | null) => {
          if (!v) return '-'
          const opt = REGISTERED_MODEL_PROVIDER_PRESETS.find((p) => p.value === v)
          return opt?.label ?? v
        },
      },
      {
        title: 'Model ID',
        dataIndex: 'model_name',
        width: '16%',
        render: (v: string | null) => v || '-',
      },
      {
        title: '状态',
        dataIndex: 'status',
        width: '9%',
        render: (v: RegisteredModelStatus) => {
          const opt = REGISTERED_MODEL_STATUS_OPTIONS.find((o) => o.value === v)
          return <Tag color={opt?.color}>{opt?.label ?? v}</Tag>
        },
      },
      {
        title: '更新时间',
        dataIndex: 'updated_at',
        width: '12%',
        render: (v: string | null) =>
          v ? <span style={{ color: '#64748B', fontSize: 12 }}>{dayjs(v).format('YYYY-MM-DD HH:mm')}</span> : '-',
      },
      {
        title: '操作',
        width: '10%',
        render: (_v: unknown, row: RegisteredModelListItem) => (
          <Space size={4}>
            <Link to={`/resources/models/${row.id}`}>
              <Button type="link" size="small" icon={<EditOutlined />}>
                详情
              </Button>
            </Link>
            <Popconfirm
              title="删除该模型？"
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={() => handleDelete(row)}
            >
              <Tooltip title={canWrite ? '' : '仅管理员可删除'}>
                <Button
                  type="link"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  disabled={!canWrite}
                >
                  删除
                </Button>
              </Tooltip>
            </Popconfirm>
          </Space>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canWrite],
  )

  return (
    <div style={{ width: '100%' }}>
      {!canWrite && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="您当前为只读用户。如需添加或编辑模型，请联系管理员。"
        />
      )}
      <Space style={{ marginBottom: 12 }} wrap>
        <Input.Search
          allowClear
          placeholder="搜索名称 / Model ID"
          onSearch={(v) => {
            setQ(v)
            void fetchList()
          }}
          style={{ width: 220 }}
        />
        <Select
          allowClear
          placeholder="类型"
          style={{ width: 110 }}
          value={kind ?? undefined}
          onChange={(v) => setKind(v ?? null)}
          options={REGISTERED_MODEL_KIND_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        />
        <Select
          allowClear
          placeholder="分类"
          style={{ width: 130 }}
          value={smallCategory ?? undefined}
          onChange={(v) => setSmallCategory(v ?? null)}
          options={SMALL_MODEL_CATEGORY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        />
        <Select
          allowClear
          placeholder="Provider"
          style={{ width: 150 }}
          value={providerFilter ?? undefined}
          onChange={(v) => setProviderFilter(v ?? null)}
          options={REGISTERED_MODEL_PROVIDER_PRESETS.map((p) => ({ value: p.value, label: p.label }))}
        />
        <Select
          allowClear
          placeholder="状态"
          style={{ width: 130 }}
          value={status ?? undefined}
          onChange={(v) => setStatus(v ?? null)}
          options={REGISTERED_MODEL_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        />
        <Button icon={<ReloadOutlined />} onClick={() => fetchList()}>
          刷新
        </Button>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={openCreate}
          disabled={!canWrite}
        >
          添加模型
        </Button>
      </Space>
      <Table<RegisteredModelListItem>
        rowKey="id"
        size="middle"
        loading={loading}
        columns={columns}
        dataSource={items}
        pagination={{
          total,
          pageSize: 50,
          showSizeChanger: false,
          onChange: () => {
            /* server paging later */
          },
        }}
        scroll={{ x: 'max-content' }}
        footer={() => (
          <Text type="secondary">共 {total} 条</Text>
        )}
      />

      <Drawer
        title="添加模型"
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        width={600}
        destroyOnClose
        extra={
          <Space>
            <Button onClick={() => setCreateOpen(false)}>取消</Button>
            <Button
              type="primary"
              loading={creating || uploading}
              onClick={submitCreate}
            >
              保存
            </Button>
          </Space>
        }
      >
        <Form<CreateFormValues> form={createForm} layout="vertical">
          <Form.Item label="类型" name="kind" rules={[{ required: true }]}>
            <Radio.Group onChange={(e) => onKindChange(e.target.value)}>
              <Radio.Button value="large">大模型</Radio.Button>
              <Radio.Button value="small">小模型</Radio.Button>
            </Radio.Group>
          </Form.Item>

          <Form.Item noStyle shouldUpdate={(prev, curr) => prev.kind !== curr.kind}>
            {({ getFieldValue }) =>
              getFieldValue('kind') === 'small' ? (
                <SmallModelFormFields
                  form={createForm as never}
                  uploading={uploading}
                  setUploading={setUploading}
                />
              ) : (
                <>
                  <Form.Item
                    label="模型名称"
                    name="name"
                    rules={[{ required: true, message: '请填写模型名称' }]}
                  >
                    <Input placeholder="如：GPT-4o 文本审核" />
                  </Form.Item>
                  <Form.Item label="Provider" name="provider">
                    <Select
                      options={REGISTERED_MODEL_PROVIDER_PRESETS.map((p) => ({
                        value: p.value,
                        label: p.label,
                      }))}
                      placeholder="选择厂商"
                      onChange={(v) => onProviderChange(v as RegisteredModelProvider)}
                    />
                  </Form.Item>
                  <Form.Item
                    label="Model ID"
                    name="model_name"
                    rules={[{ required: true, message: '请填写 Model ID' }]}
                    tooltip="厂商返回的模型标识，如 gpt-4o-mini / claude-3-5-sonnet-latest"
                  >
                    <Input placeholder="gpt-4o-mini / claude-3-5-sonnet-latest" />
                  </Form.Item>
                  <Form.Item
                    label="Base URL"
                    name="endpoint_url"
                    rules={[{ required: true, type: 'url', message: '请填写有效的 URL' }]}
                  >
                    <Input placeholder="https://api.openai.com/v1" />
                  </Form.Item>
                  <Form.Item
                    label="API Key（凭证）"
                    name="credential_id"
                    rules={[{ required: true, message: '请选择凭证' }]}
                    tooltip="可在「凭证管理」中创建；必填，上线后无凭证直接 401"
                  >
                    <Select
                      allowClear
                      placeholder="选择已保存的凭证"
                      options={credentials.map((c) => ({
                        value: c.id,
                        label: `${c.name} · ${c.masked_token}`,
                      }))}
                      notFoundContent={
                        <Text type="secondary">尚无可用凭证</Text>
                      }
                    />
                  </Form.Item>
                  <Form.Item
                    label="Version"
                    name="version"
                    tooltip="语义版本号，如 1.0.0"
                  >
                    <Input placeholder="1.0.0" />
                  </Form.Item>
                  <Form.Item
                    label="模型说明（Description）"
                    name="description"
                    tooltip="这个模型用在什么审核场景 / 注意事项"
                  >
                    <Input.TextArea
                      rows={3}
                      placeholder="如：用于广宣品文本审核"
                    />
                  </Form.Item>
                </>
              )
            }
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  )
}