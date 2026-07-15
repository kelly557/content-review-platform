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
  CloseCircleOutlined,
  CloudDownloadOutlined,
  PlusOutlined,
  RocketOutlined,
} from '@ant-design/icons'
import { Link, useParams } from 'react-router-dom'
import dayjs from 'dayjs'
import { registeredModelsApi } from '@/api/registered-models'
import type {
  ArtifactUploadResponse,
  LargeModelCategory,
  RegisteredModel,
  RegisteredModelRegistrationMethod,
  RegisteredModelVersion,
  RegisteredModelVersionCreate,
  SmallModelCategory,
  SmallModelModality,
} from '@/types/domain'
import {
  LARGE_MODEL_CATEGORY_LABEL,
  REGISTERED_MODEL_KIND_OPTIONS,
  REGISTERED_MODEL_PROVIDER_PRESETS,
  REGISTERED_MODEL_STATUS_OPTIONS,
  SMALL_MODEL_CATEGORY_LABEL,
  SMALL_MODEL_MODALITY_LABEL,
} from '@/types/domain'
import { useAuthStore } from '@/store'
import SmallModelFormFields from './SmallModelFormFields'

const { Title, Text } = Typography

const VERSION_STATUS_COLORS: Record<string, string> = {
  draft: 'default',
  validated: 'cyan',
  active: 'green',
  inactive: 'default',
  failed: 'red',
  archived: 'default',
}

interface NewVersionValues {
  // 小模型分支（沿用 SmallModelFormValues 字段，全部可选 — 详情页「发布新版本」时复用）
  name?: string
  small_category?: SmallModelCategory
  modality?: SmallModelModality
  model_name?: string
  description?: string
  version?: string
  max_output_tokens?: number
  __artifact?: ArtifactUploadResponse
  // 大模型分支（endpoint / credential 继承 Provider；此处可调 model_name / 分类）
  version_label?: string
  notes?: string
  large_category?: LargeModelCategory
}

export default function ModelDetailPage() {
  const { id } = useParams<{ id: string }>()
  const modelId = Number(id)
  const { message } = App.useApp()
  const { user } = useAuthStore()
  const canWrite = user?.role === 'admin' || user?.role === 'superadmin'

  const [model, setModel] = useState<RegisteredModel | null>(null)
  const [versions, setVersions] = useState<RegisteredModelVersion[]>([])
  const [loading, setLoading] = useState(false)
  const [validating, setValidating] = useState(false)
  const [toggling, setToggling] = useState(false)
  const [activating, setActivating] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [createForm] = Form.useForm<NewVersionValues>()

  const fetchAll = async () => {
    setLoading(true)
    try {
      const m = await registeredModelsApi.get(modelId)
      setModel(m)
      const v = await registeredModelsApi.listVersions(modelId)
      setVersions(v)
    } catch {
      // handled
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (Number.isFinite(modelId)) void fetchAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId])

  const handleValidate = async () => {
    if (!model) return
    if (model.registration_method === ('uploaded_file' as RegisteredModelRegistrationMethod)) {
      message.warning('小模型（上传文件）不支持远程连通性校验')
      return
    }
    setValidating(true)
    try {
      const r = await registeredModelsApi.validate(modelId)
      if (r.ok) message.success(`校验成功（${r.log.http_status ?? '-'} ${r.log.latency_ms ?? '-'}ms）`)
      else message.error(`校验失败：${r.log.message || r.log.http_status}`)
      await fetchAll()
    } catch {
      // handled
    } finally {
      setValidating(false)
    }
  }

  const handleArchive = async () => {
    setToggling(true)
    try {
      await registeredModelsApi.archive(modelId)
      message.success('已归档')
      await fetchAll()
    } catch {
      // handled
    } finally {
      setToggling(false)
    }
  }

  const handleDeactivate = async () => {
    setToggling(true)
    try {
      await registeredModelsApi.deactivate(modelId)
      message.success('已停用')
      await fetchAll()
    } catch {
      // handled
    } finally {
      setToggling(false)
    }
  }

  const handleDelete = async () => {
    try {
      await registeredModelsApi.delete(modelId)
      message.success('已删除')
      window.history.back()
    } catch {
      // handled
    }
  }

  const openCreateVersion = () => {
    if (!model) return
    createForm.resetFields()
    if (model.kind === 'small') {
      createForm.setFieldsValue({
        modality: (model.modality as SmallModelModality | undefined) ?? 'text',
        name: model.name,
        small_category: model.small_category as never,
        model_name: model.model_name ?? undefined,
        max_output_tokens: model.max_output_tokens ?? 2048,
      })
    } else {
      createForm.setFieldsValue({
        model_name: model.model_name ?? undefined,
        large_category: (model.large_category as LargeModelCategory | undefined) ?? undefined,
      })
    }
    setCreateOpen(true)
  }

  const submitCreateVersion = async () => {
    if (!model) return
    const v = await createForm.validateFields().catch(() => null)
    if (!v) return
    setCreating(true)
    try {
      if (model.kind === 'small') {
        const artifact = (v as NewVersionValues & { __artifact?: unknown }).__artifact as
          | ArtifactUploadResponse
          | undefined
        // 不传 artifact 时表示沿用上一版本文件
        const body: RegisteredModelVersionCreate = {
          version_label: v.version,
          notes: v.notes ?? null,
          model_name: v.model_name,
          modality: (v as NewVersionValues & { modality?: SmallModelModality }).modality ?? null,
          artifact: artifact ?? null,
        }
        await registeredModelsApi.createVersion(modelId, body)
      } else {
        const body: RegisteredModelVersionCreate = {
          version_label: v.version_label ?? null,
          notes: v.notes ?? null,
          model_name: v.model_name ?? null,
          large_category: v.large_category ?? null,
        }
        await registeredModelsApi.createVersion(modelId, body)
      }
      message.success('新版本已发布')
      setCreateOpen(false)
      await fetchAll()
    } catch {
      // handled
    } finally {
      setCreating(false)
    }
  }

  const handleActivateVersion = async (versionId: number) => {
    try {
      await registeredModelsApi.activateVersion(modelId, versionId)
      message.success('已切换到该版本')
      await fetchAll()
    } catch {
      // handled
    }
  }

  const handleActivate = async () => {
    if (!model || !model.current_version_id) {
      message.warning('当前没有可激活的版本，请先发布新版本')
      return
    }
    setActivating(true)
    try {
      await registeredModelsApi.activateVersion(modelId, model.current_version_id)
      message.success('已激活当前版本')
      await fetchAll()
    } catch {
      // handled
    } finally {
      setActivating(false)
    }
  }

  if (loading && !model) {
    return <Spin style={{ display: 'block', margin: '20vh auto' }} />
  }

  if (!model) {
    return <Empty description="未找到模型" />
  }

  const statusOption = REGISTERED_MODEL_STATUS_OPTIONS.find((o) => o.value === model.status)
  const kindOption = REGISTERED_MODEL_KIND_OPTIONS.find((o) => o.value === model.kind)
  const categoryLabel = model.small_category
    ? SMALL_MODEL_CATEGORY_LABEL[model.small_category as keyof typeof SMALL_MODEL_CATEGORY_LABEL] ?? model.small_category
    : null
  const modalityLabel = model.modality
    ? SMALL_MODEL_MODALITY_LABEL[model.modality as SmallModelModality] ?? model.modality
    : null
  const isSmall = model.kind === 'small'
  const initialArtifact: ArtifactUploadResponse | null =
    isSmall && model.current_version?.artifact_storage_key
      ? {
          storage_key: model.current_version.artifact_storage_key,
          filename: model.current_version.artifact_filename ?? '',
          mime_type: model.current_version.artifact_mime_type ?? null,
          size: model.current_version.artifact_size ?? 0,
          sha256: model.current_version.artifact_sha256 ?? '',
        }
      : null

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
              {model.name}
            </Title>
            {kindOption && <Tag color={kindOption.color}>{kindOption.label}</Tag>}
            {categoryLabel && <Tag>{categoryLabel}</Tag>}
            {statusOption && <Tag color={statusOption.color}>{statusOption.label}</Tag>}
          </Space>
        }
        extra={
          <Space>
            <Button
              type="primary"
              icon={<RocketOutlined />}
              loading={activating}
              onClick={handleActivate}
              disabled={
                !canWrite ||
                !model.current_version_id ||
                model.status === 'archived' ||
                model.status === 'active'
              }
              title={model.status === 'active' ? '当前已是激活态' : ''}
            >
              激活
            </Button>
            <Tooltip title={isSmall ? '小模型不支持远程校验' : ''}>
              <Button
                icon={<CheckCircleOutlined />}
                loading={validating}
                onClick={handleValidate}
                disabled={!canWrite || isSmall}
              >
                校验连通性
              </Button>
            </Tooltip>
            <Popconfirm
              title="停用该模型？"
              okText="停用"
              cancelText="取消"
              onConfirm={handleDeactivate}
            >
              <Button
                icon={<CloseCircleOutlined />}
                loading={toggling}
                disabled={!canWrite}
              >
                停用
              </Button>
            </Popconfirm>
            <Popconfirm
              title="归档该模型？"
              okText="归档"
              cancelText="取消"
              onConfirm={handleArchive}
            >
              <Button loading={toggling} disabled={!canWrite}>
                归档
              </Button>
            </Popconfirm>
            <Popconfirm
              title="删除该模型？"
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={handleDelete}
            >
              <Button danger icon={<CloseCircleOutlined />} disabled={!canWrite}>
                删除
              </Button>
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
                  <Descriptions.Item label="类型">{kindOption?.label ?? model.kind}</Descriptions.Item>
                  <Descriptions.Item label="分类">{categoryLabel ?? '-'}</Descriptions.Item>
                  {isSmall ? (
                    <>
                      <Descriptions.Item label="最大输出 tokens">
                        {model.max_output_tokens ?? '-'}
                      </Descriptions.Item>
                      <Descriptions.Item label="模态">
                        {modalityLabel ?? '-'}
                      </Descriptions.Item>
                      <Descriptions.Item label="当前模型版本">
                        {model.current_version_no
                          ? model.current_version_label
                            ? `v${model.current_version_no} · ${model.current_version_label}`
                            : `v${model.current_version_no}`
                          : '-'}
                      </Descriptions.Item>
                      <Descriptions.Item label="SHA-256" span={2}>
                        <Text code style={{ fontSize: 12 }}>
                          {initialArtifact?.sha256 ?? '-'}
                        </Text>
                      </Descriptions.Item>
                    </>
                  ) : (
                    <>
                      <Descriptions.Item label="Provider" span={2}>
                        {model.provider ? (
                          <Link to={`/resources/providers/${model.provider.id}`}>
                            <span style={{ color: '#0369A1' }}>
                              {model.provider.display_name}
                              {' · '}
                              {REGISTERED_MODEL_PROVIDER_PRESETS.find(
                                (p) => p.value === model.provider?.provider_preset,
                              )?.label ?? model.provider.provider_preset}
                            </span>
                          </Link>
                        ) : (
                          <Text type="secondary">未挂载</Text>
                        )}
                      </Descriptions.Item>
                      <Descriptions.Item label="Model ID">{model.model_name || '-'}</Descriptions.Item>
                      <Descriptions.Item label="Version">{model.version || '-'}</Descriptions.Item>
                      <Descriptions.Item label="大模型分类" span={2}>
                        {model.large_category
                          ? (LARGE_MODEL_CATEGORY_LABEL as Record<string, string>)[model.large_category] ?? model.large_category
                          : '-'}
                      </Descriptions.Item>
                    </>
                  )}
                  <Descriptions.Item label="说明" span={2}>
                    {model.description || '-'}
                  </Descriptions.Item>
                </Descriptions>
              ),
            },
            {
              key: 'versions',
              label: `版本 (${versions.length})`,
              children: (
                <div>
                  <Space style={{ marginBottom: 12 }}>
                    <Button
                      type="primary"
                      icon={<PlusOutlined />}
                      onClick={openCreateVersion}
                      disabled={!canWrite}
                    >
                      发布新版本
                    </Button>
                    <Text type="secondary">
                      同一模型可保存多个版本；点击「切换到此版本」将 current_version 指向该版本
                    </Text>
                  </Space>
                  <Table<RegisteredModelVersion>
                    rowKey="id"
                    size="small"
                    pagination={false}
                    dataSource={versions}
                    columns={
                      isSmall
                        ? [
                            {
                              title: '版本',
                              dataIndex: 'version_label',
                              width: 110,
                              render: (v: string | null, row) => v || `v${row.version_no}`,
                            },
                            {
                              title: '状态',
                              dataIndex: 'status',
                              width: 110,
                              render: (v: string) => (
                                <Tag color={VERSION_STATUS_COLORS[v] ?? 'default'}>{v}</Tag>
                              ),
                            },
                            {
                              title: '文件',
                              dataIndex: 'artifact_filename',
                              width: 220,
                              render: (v: string | null) => v || '-',
                            },
                            {
                              title: '大小',
                              dataIndex: 'artifact_size',
                              width: 100,
                              render: (v: number | null) =>
                                v ? `${(v / 1024 / 1024).toFixed(2)} MB` : '-',
                            },
                            {
                              title: 'SHA-256',
                              dataIndex: 'artifact_sha256',
                              width: 120,
                              render: (v: string | null) =>
                                v ? (
                                  <Text code style={{ fontSize: 12 }}>
                                    {v.slice(0, 12)}…
                                  </Text>
                                ) : (
                                  '-'
                                ),
                            },
                            {
                              title: '生效时间',
                              dataIndex: 'created_at',
                              width: 160,
                              render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm'),
                            },
                            {
                              title: '操作',
                              width: 220,
                              render: (_v, row) => (
                                <Space size={4}>
                                  <Button
                                    size="small"
                                    icon={<CloudDownloadOutlined />}
                                    onClick={() => {
                                      const url = registeredModelsApi.artifactDownloadUrl(
                                        model.id,
                                        row.id,
                                      )
                                      window.open(url, '_blank')
                                    }}
                                  >
                                    下载
                                  </Button>
                                  {row.id === model.current_version_id ? (
                                    <Tag color="green">当前版本</Tag>
                                  ) : (
                                    <Tooltip title={canWrite ? '切到此版本' : '只读'}>
                                      <Button
                                        size="small"
                                        icon={<RocketOutlined />}
                                        onClick={() => handleActivateVersion(row.id)}
                                        disabled={!canWrite}
                                      >
                                        切换到此版本
                                      </Button>
                                    </Tooltip>
                                  )}
                                </Space>
                              ),
                            },
                          ]
                        : [
                            {
                              title: '版本',
                              dataIndex: 'version_label',
                              width: 110,
                              render: (v: string | null, row) => v || `v${row.version_no}`,
                            },
                            {
                              title: '状态',
                              dataIndex: 'status',
                              width: 110,
                              render: (v: string) => (
                                <Tag color={VERSION_STATUS_COLORS[v] ?? 'default'}>{v}</Tag>
                              ),
                            },
                            {
                              title: 'Provider',
                              dataIndex: 'provider',
                              width: 120,
                              render: (v: string | null) =>
                                v
                                  ? REGISTERED_MODEL_PROVIDER_PRESETS.find((p) => p.value === v)?.label ?? v
                                  : '-',
                            },
                            { title: 'Model ID', dataIndex: 'model_name', width: 160 },
                            {
                              title: 'Base URL',
                              dataIndex: 'endpoint_url',
                              render: (v: string | null) => v || '-',
                            },
                            {
                              title: '生效时间',
                              dataIndex: 'created_at',
                              width: 160,
                              render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm'),
                            },
                            {
                              title: '操作',
                              width: 200,
                              render: (_v, row) => (
                                <Space size={4}>
                                  {row.id === model.current_version_id ? (
                                    <Tag color="green">当前版本</Tag>
                                  ) : (
                                    <Tooltip title={canWrite ? '切到此版本' : '只读'}>
                                      <Button
                                        size="small"
                                        icon={<RocketOutlined />}
                                        onClick={() => handleActivateVersion(row.id)}
                                        disabled={!canWrite}
                                      >
                                        切换到此版本
                                      </Button>
                                    </Tooltip>
                                  )}
                                </Space>
                              ),
                            },
                          ]
                    }
                    expandable={{
                      expandedRowRender: (row) => (
                        <div style={{ paddingLeft: 8 }}>
                          {row.notes && (
                            <p>
                              <strong>变更说明：</strong>
                              {row.notes}
                            </p>
                          )}
                        </div>
                      ),
                      rowExpandable: (row) => Boolean(row.notes),
                    }}
                  />
                </div>
              ),
            },
            {
              key: 'validation',
              label: '验证记录',
              children: isSmall ? (
                <Empty description="小模型（上传文件）不支持远程校验" />
              ) : (
                <Table
                  rowKey="checked_at"
                  size="small"
                  pagination={false}
                  dataSource={model.current_version?.validation_log || []}
                  columns={[
                    {
                      title: '时间',
                      dataIndex: 'checked_at',
                      width: 170,
                      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm:ss'),
                    },
                    {
                      title: '结果',
                      dataIndex: 'ok',
                      width: 90,
                      render: (v: boolean) =>
                        v ? <Tag color="green">通过</Tag> : <Tag color="red">失败</Tag>,
                    },
                    { title: 'HTTP', dataIndex: 'http_status', width: 90 },
                    { title: '耗时 (ms)', dataIndex: 'latency_ms', width: 100 },
                    { title: '消息', dataIndex: 'message' },
                  ]}
                />
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title={isSmall ? '发布新版本（小模型 · 上传文件）' : '发布新版本'}
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={submitCreateVersion}
        confirmLoading={creating || uploading}
        okText="发布"
        cancelText="取消"
        destroyOnClose
        width={600}
      >
        <Form<NewVersionValues> form={createForm} layout="vertical">
          {isSmall ? (
            <SmallModelFormFields
              form={createForm as never}
              uploading={uploading}
              setUploading={setUploading}
              initialArtifact={initialArtifact}
            />
          ) : (
            <>
              <Form.Item label="版本标签" name="version_label" tooltip="如 1.1.0、2025-Q1">
                <Input placeholder="留空自动为 vN" />
              </Form.Item>
              <Form.Item
                label="变更说明"
                name="notes"
                tooltip="本次发布相对上版本的差异（仅作展示）"
              >
                <Input.TextArea rows={3} placeholder="新增 prompt / 调整超时 / 切换到 gpt-4o ..." />
              </Form.Item>
              <Form.Item
                label="大模型分类"
                name="large_category"
                tooltip="不填则继承当前版本的分类"
              >
                <Select
                  allowClear
                  options={Object.entries(LARGE_MODEL_CATEGORY_LABEL).map(([value, label]) => ({
                    value,
                    label,
                  }))}
                  placeholder="继承当前版本或重新选择"
                />
              </Form.Item>
              <Form.Item label="Model ID" name="model_name">
                <Input placeholder="继承当前版本或重新填写" />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>
    </div>
  )
}