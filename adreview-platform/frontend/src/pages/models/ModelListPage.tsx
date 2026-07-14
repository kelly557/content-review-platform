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
  CloudDownloadOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { Link } from 'react-router-dom'
import dayjs from 'dayjs'
import { registeredModelsApi, providersApi } from '@/api/registered-models'
import type {
  LargeModelCategory,
  RegisteredModelCreate,
  RegisteredModelKind,
  RegisteredModelListItem,
  RegisteredModelStatus,
  RegisteredProviderOption,
  SmallModelCategory,
} from '@/types/domain'
import {
  LARGE_MODEL_CATEGORY_OPTIONS,
  REGISTERED_MODEL_KIND_OPTIONS,
  REGISTERED_MODEL_STATUS_OPTIONS,
  SMALL_MODEL_CATEGORY_OPTIONS,
} from '@/types/domain'
import { useAuthStore } from '@/store'
import SmallModelFormFields, {
  type SmallModelFormValues,
} from './SmallModelFormFields'
import CreateProviderModal from './CreateProviderModal'

const { Text } = Typography

interface LargeModelFormValues {
  provider_id?: number
  model_name: string
  large_category?: LargeModelCategory
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
  const [largeCategory, setLargeCategory] = useState<LargeModelCategory | null>(null)
  const [status, setStatus] = useState<RegisteredModelStatus | null>(null)
  const [providerFilter, setProviderFilter] = useState<string | null>(null)

  const [items, setItems] = useState<RegisteredModelListItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)

  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [createForm] = Form.useForm<CreateFormValues>()
  const [providerOptions, setProviderOptions] = useState<RegisteredProviderOption[]>([])
  const [providerOpen, setProviderOpen] = useState(false)

  const fetchList = async () => {
    setLoading(true)
    try {
      const data = await registeredModelsApi.list({
        q: q || undefined,
        kind: kind ?? undefined,
        small_category: smallCategory ?? undefined,
        large_category: largeCategory ?? undefined,
        provider_id: providerFilter ? Number(providerFilter) : undefined,
        status: status ?? undefined,
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

  const fetchProviders = async () => {
    try {
      const list = await providersApi.options()
      setProviderOptions(list)
    } catch {
      setProviderOptions([])
    }
  }

  useEffect(() => {
    void fetchList()
    void fetchProviders()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openCreate = () => {
    if (!canWrite) {
      message.warning('仅管理员可添加模型')
      return
    }
    if (providerOptions.length === 0) {
      message.warning('请先创建一个 Provider，再添加模型')
      setProviderOpen(true)
      return
    }
    createForm.resetFields()
    createForm.setFieldsValue({
      kind: 'large',
      large_category: 'text',
      provider_id: providerOptions[0]?.id,
    })
    setCreateOpen(true)
  }

  const onKindChange = (next?: RegisteredModelKind) => {
    if (next === 'large') {
      createForm.setFieldValue('small_category', undefined)
    } else if (next === 'small') {
      createForm.setFieldValue('large_category', undefined)
      createForm.setFieldValue('provider_id', undefined)
    }
  }

  const submitCreate = async () => {
    const v = await createForm.validateFields().catch(() => null)
    if (!v) return
    if (!v.model_name || !v.model_name.trim()) {
      message.error('请填写模型标识')
      return
    }
    if (v.kind === 'large') {
      if (!v.provider_id) {
        message.error('请选择 Provider')
        return
      }
      if (!v.large_category) {
        message.error('大模型必须选择分类')
        return
      }
    } else {
      if (!v.small_category) {
        message.error('小模型必须选择分类')
        return
      }
      if (!v.provider_id) {
        message.error('小模型也必须挂载到某个 Provider')
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
          large_category: null,
          provider_id: v.provider_id!,
          model_name: v.model_name.trim(),
          version: v.version,
          max_output_tokens: v.max_output_tokens,
          registration_method: 'uploaded_file',
          artifact: artifact ?? null,
        }
        await registeredModelsApi.create(payload)
      } else {
        const payload: RegisteredModelCreate = {
          name: v.name,
          description: v.description,
          kind: 'large',
          small_category: null,
          large_category: v.large_category!,
          provider_id: v.provider_id!,
          model_name: v.model_name.trim(),
          version: v.version,
        }
        await registeredModelsApi.create(payload)
      }
      message.success('模型添加成功')
      setCreateOpen(false)
      await fetchList()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      const text = typeof detail === 'string' ? detail : '添加失败'
      message.error(text)
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
      { title: '名称', dataIndex: 'name', width: '18%' },
      {
        title: '类型',
        dataIndex: 'kind',
        width: '7%',
        render: (v: RegisteredModelKind) => {
          const opt = REGISTERED_MODEL_KIND_OPTIONS.find((o) => o.value === v)
          return <Tag color={opt?.color}>{opt?.label ?? v}</Tag>
        },
      },
      {
        title: '分类',
        dataIndex: 'large_category',
        width: '8%',
        render: (v: LargeModelCategory | null, row: RegisteredModelListItem) => {
          if (row.kind === 'large') {
            if (!v) return '-'
            const opt = LARGE_MODEL_CATEGORY_OPTIONS.find((o) => o.value === v)
            return opt ? <Tag color={opt.color}>{opt.label}</Tag> : v
          }
          if (!row.small_category) return '-'
          const opt = SMALL_MODEL_CATEGORY_OPTIONS.find(
            (o) => o.value === row.small_category,
          )
          return opt ? <Tag color={opt.color}>{opt.label}</Tag> : row.small_category
        },
      },
      {
        title: 'Provider',
        dataIndex: 'provider_label',
        width: '12%',
        render: (v: string | null, row: RegisteredModelListItem) =>
          row.provider_id ? (
            <Link to={`/resources/providers/${row.provider_id}`}>
              <span style={{ color: '#0369A1' }}>{v || `#${row.provider_id}`}</span>
            </Link>
          ) : (
            <Text type="secondary">未挂载</Text>
          ),
      },
      { title: 'Model ID', dataIndex: 'model_name', width: '14%' },
      {
        title: '状态',
        dataIndex: 'status',
        width: '8%',
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
        width: '12%',
        render: (_v: unknown, row: RegisteredModelListItem) => (
          <Space size={4}>
            <Link to={`/resources/models/${row.id}`}>
              <Button type="link" size="small" icon={<CloudDownloadOutlined />}>
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
          onSearch={(val) => {
            setQ(val)
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
          placeholder="大模型分类"
          style={{ width: 130 }}
          value={largeCategory ?? undefined}
          onChange={(v) => setLargeCategory((v as LargeModelCategory) ?? null)}
          options={LARGE_MODEL_CATEGORY_OPTIONS.map((o) => ({
            value: o.value,
            label: o.label,
          }))}
        />
        <Select
          allowClear
          placeholder="小模型分类"
          style={{ width: 130 }}
          value={smallCategory ?? undefined}
          onChange={(v) => setSmallCategory(v ?? null)}
          options={SMALL_MODEL_CATEGORY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        />
        <Select
          allowClear
          placeholder="Provider"
          style={{ width: 180 }}
          value={providerFilter ?? undefined}
          onChange={(v) => setProviderFilter(v ?? null)}
          options={providerOptions.map((p) => ({
            value: String(p.id),
            label: p.display_name,
          }))}
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
          icon={<CloudDownloadOutlined />}
          onClick={() => setProviderOpen(true)}
          disabled={!canWrite}
        >
          添加 Provider
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
        footer={() => <Text type="secondary">共 {total} 条</Text>}
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

          <Form.Item
            noStyle
            shouldUpdate={(prev, curr) => prev.kind !== curr.kind}
          >
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
                  <Form.Item
                    label="Provider"
                    name="provider_id"
                    rules={[{ required: true, message: '请选择 Provider' }]}
                    tooltip="凭证与端点统一继承自 Provider"
                  >
                    <Select
                      options={providerOptions.map((p) => ({
                        value: p.id,
                        label: `${p.display_name}${p.provider_preset ? ` (${p.provider_preset})` : ''}`,
                      }))}
                      placeholder="选择厂商级 Provider"
                    />
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
                      placeholder="文本 / 多模态 / 其他"
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
                    label="Version"
                    name="version"
                    tooltip="语义版本号，如 1.0.0（可选）"
                  >
                    <Input placeholder="1.0.0" />
                  </Form.Item>
                  <Form.Item
                    label="模型说明（Description）"
                    name="description"
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

          {/* 小模型也需要选择 Provider，移到 Form.List 之外仍可显示 */}
          {createForm.getFieldValue('kind') === 'small' && (
            <Form.Item
              label="Provider"
              name="provider_id"
              rules={[{ required: true, message: '请选择 Provider' }]}
              tooltip="凭证与端点统一继承自 Provider（小模型通常选 self-hosted）"
            >
              <Select
                options={providerOptions.map((p) => ({
                  value: p.id,
                  label: `${p.display_name}${p.provider_preset ? ` (${p.provider_preset})` : ''}`,
                }))}
                placeholder="选择 Provider"
              />
            </Form.Item>
          )}
        </Form>
      </Drawer>

      <CreateProviderModal
        open={providerOpen}
        onClose={() => setProviderOpen(false)}
        onCreated={() => {
          void fetchProviders()
        }}
      />
    </div>
  )
}
