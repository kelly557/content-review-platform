import { useEffect, useRef, useState } from 'react'
import {
  Button,
  Drawer,
  Form,
  Input,
  Select,
  Space,
  Tag,
  App,
} from 'antd'
import { ApiOutlined, MinusCircleOutlined, PlusOutlined } from '@ant-design/icons'
import { providersApi, registeredModelsApi } from '@/api/registered-models'
import {
  LARGE_MODEL_CATEGORY_OPTIONS,
  REGISTERED_MODEL_PROVIDER_PRESETS,
  SMALL_MODEL_CATEGORY_OPTIONS,
  SMALL_MODEL_CATEGORY_LABEL,
  type LargeModelCategory,
  type ProviderInitialModel,
  type RegisteredModelProvider,
  type RegisteredModelKind,
  type SmallModelCategory,
  type SmallModelModality,
} from '@/types/domain'
import SmallModelFormFields, {
  type SmallFormHandle,
  type SmallModelFormValues,
} from './SmallModelFormFields'
import ModelTestDrawer from './ModelTestDrawer'

interface LargeFormValues {
  display_name: string
  provider_preset?: RegisteredModelProvider
  endpoint_url: string
  api_key: string
  description?: string
  initial_models: Array<ProviderInitialModel & { _key?: string }>
}

interface CreateFormValues extends SmallModelFormValues, LargeFormValues {
  kind: RegisteredModelKind
}

interface Props {
  open: boolean
  /** 'large' = 建 Provider + 一组 model；'small' = 仅建一个小模型（无 Provider 字段） */
  mode: 'large' | 'small'
  onClose: () => void
  onCreated?: (info: { providerId?: number; modelId?: number }) => void
  /** mode=small 时：Drawer 打开时预填"识别风险类型"（用于 [+添加风险类型] 流程回跳） */
  initialSmallCategory?: string | null
  /** 清除 initialSmallCategory（成功预填一次后清空，避免下次打开仍残留） */
  onInitialSmallCategoryConsumed?: () => void
}

export default function CreateModelModal({
  open,
  mode,
  onClose,
  onCreated,
  initialSmallCategory,
  onInitialSmallCategoryConsumed,
}: Props) {
  const { message } = App.useApp()
  const [form] = Form.useForm<CreateFormValues>()
  const [submitting, setSubmitting] = useState(false)
  const [uploading, setUploading] = useState(false)
  // case 3 警告拦截：保存时由子组件回调触发打开 Modal
  const [severeModalOpen, setSevereModalOpen] = useState(false)
  const case3ActiveRef = useRef(false)
  const severeAckedRef = useRef(false)
  // 指向子组件的 imperative handle，用于在提交时拿到 resolved 审核点
  const smallFormRef = useRef<SmallFormHandle>(null)
  // 测试子 Drawer
  const [testDrawerOpen, setTestDrawerOpen] = useState(false)
  const [testSnapshot, setTestSnapshot] = useState<{
    modality: SmallModelModality
    name?: string
    category?: string
    points: import('@/types/domain').AuditPointEntry[]
  } | null>(null)

  // 通过 [+添加风险类型] 跳入 Drawer 时，把新建的 risk_category 预填到 small_category 字段
  useEffect(() => {
    if (open && mode === 'small' && initialSmallCategory) {
      form.setFieldValue('small_category' as keyof CreateFormValues, initialSmallCategory)
      onInitialSmallCategoryConsumed?.()
    }
    // 仅在 open 切换瞬间设一次，关闭后清空
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialSmallCategory])

  const currentPreset = Form.useWatch('provider_preset', form) as
    | RegisteredModelProvider
    | undefined

  const handlePresetChange = (value: RegisteredModelProvider) => {
    const preset = REGISTERED_MODEL_PROVIDER_PRESETS.find((p) => p.value === value)
    if (preset?.defaultEndpoint) {
      form.setFieldValue('endpoint_url', preset.defaultEndpoint)
    }
  }

  const submit = async () => {
    const v = await form.validateFields().catch(() => null)
    if (!v) return
    if (mode === 'small') {
      // ── case 3 拦截：JSON 触发了删除/修改审核点 ──
      // 子组件用 onCase3Change 回调告诉父组件当前是否处于 case 3；
      // 用户在 Modal 里点"我已知晓，仍要提交"会把 severeAckedRef.current 置 true。
      if (case3ActiveRef.current && !severeAckedRef.current) {
        setSevereModalOpen(true)
        return
      }
    }
    setSubmitting(true)
    try {
      if (mode === 'large') {
        const initial = (v.initial_models || []).map((m) => ({
          name: m.name?.trim() || undefined,
          model_name: m.model_name.trim(),
          large_category: m.large_category as LargeModelCategory,
          description: m.description?.trim() || undefined,
        }))
        const created = await providersApi.create({
          display_name: v.display_name.trim(),
          provider_preset: v.provider_preset,
          endpoint_url: v.endpoint_url.trim(),
          api_key: v.api_key,
          description: v.description?.trim() || undefined,
          initial_models: initial,
        })
        message.success(
          initial.length
            ? `创建成功，已同时建好 ${initial.length} 个模型`
            : 'Provider 创建成功（暂未添加模型）',
        )
        onCreated?.({ providerId: created.id })
      } else {
        const artifact = (v as CreateFormValues & { __artifact?: unknown })
          .__artifact as
          | import('@/types/domain').ArtifactUploadResponse
          | undefined
        if (!artifact) {
          message.error('请上传小模型文件')
          return
        }
        if (!v.modality) {
          message.error('请选择支持的素材类型')
          return
        }
        if (!v.small_category) {
          message.error('请选择识别风险类型')
          return
        }
        const autoVersion = `${v.modality}-${v.small_category}`
        // 取"最终生效"的审核点：用户已配置优先；未配置时回退到同组合 reference
        const resolvedPoints =
          smallFormRef.current?.getResolvedAuditPoints() ?? null
        const config = resolvedPoints?.length
          ? { points: resolvedPoints }
          : undefined
        const userModelName = (v.model_name ?? '').trim() || undefined
        const created = await registeredModelsApi.create({
          name: (v.name ?? v.model_name ?? '').trim(),
          description: v.description,
          kind: 'small',
          small_category: v.small_category as SmallModelCategory,
          modality: v.modality,
          large_category: null,
          provider_id: null,
          ...(userModelName ? { model_name: userModelName } : {}),
          version: autoVersion,
          config,
          registration_method: 'uploaded_file',
          artifact,
        })
        message.success('小模型创建成功')
        onCreated?.({ modelId: created.id })
      }
      form.resetFields()
      case3ActiveRef.current = false
      severeAckedRef.current = false
      onClose()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      const text = typeof detail === 'string' ? detail : '创建失败'
      message.error(text)
    } finally {
      setSubmitting(false)
    }
  }

  const title = mode === 'large' ? '添加模型' : '添加小模型'

  const handleCloseDrawer = () => {
    case3ActiveRef.current = false
    severeAckedRef.current = false
    onClose()
  }

  const handleOpenTest = () => {
    if (mode !== 'small') return
    const v = form.getFieldsValue() as CreateFormValues
    const modality = v.modality
    if (!modality) {
      message.warning('请先选择支持的素材类型')
      return
    }
    const resolvedPoints =
      smallFormRef.current?.getResolvedAuditPoints() ?? null
    const points = (resolvedPoints ?? []).slice()
    setTestSnapshot({
      modality,
      name: (v.name ?? v.model_name ?? '').trim() || undefined,
      category: v.small_category,
      points,
    })
    setTestDrawerOpen(true)
  }

  return (
    <Drawer
      title={title}
      open={open}
      onClose={handleCloseDrawer}
      width={mode === 'large' ? 640 : 560}
      destroyOnClose
      extra={
        <Space>
          {mode === 'small' && (
            <Button onClick={handleOpenTest}>测试</Button>
          )}
          <Button onClick={handleCloseDrawer}>取消</Button>
          <Button type="primary" loading={submitting || uploading} onClick={submit}>
            保存
          </Button>
        </Space>
      }
    >
      {mode === 'large' ? (
        <LargeForm
          form={form}
          currentPreset={currentPreset}
          handlePresetChange={handlePresetChange}
        />
      ) : (
        <SmallForm
          smallFormRef={smallFormRef}
          form={form}
          uploading={uploading}
          setUploading={setUploading}
          severeModalOpen={severeModalOpen}
          onSevereConfirm={() => {
            severeAckedRef.current = true
            setSevereModalOpen(false)
            void submit()
          }}
          onSevereCancel={() => {
            severeAckedRef.current = false
            setSevereModalOpen(false)
          }}
          onCase3Change={(active) => {
            case3ActiveRef.current = active
          }}
        />
      )}
      {mode === 'small' && testSnapshot && (
        <ModelTestDrawer
          open={testDrawerOpen}
          onClose={() => setTestDrawerOpen(false)}
          modality={testSnapshot.modality}
          modelName={testSnapshot.name}
          categoryLabel={
            testSnapshot.category
              ? SMALL_MODEL_CATEGORY_LABEL[
                  testSnapshot.category as SmallModelCategory
                ] ?? testSnapshot.category
              : undefined
          }
          auditPoints={testSnapshot.points}
        />
      )}
    </Drawer>
  )
}

interface LargeFormProps {
  form: import('antd').FormInstance<CreateFormValues>
  currentPreset: RegisteredModelProvider | undefined
  handlePresetChange: (v: RegisteredModelProvider) => void
}

function LargeForm({ form, currentPreset, handlePresetChange }: LargeFormProps) {
  const { message } = App.useApp()
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)

  const handleTest = async () => {
    const endpointUrl = form.getFieldValue('endpoint_url')?.trim()
    const apiKey = form.getFieldValue('api_key')
    if (!endpointUrl) {
      message.error('请先填写 Base URL')
      return
    }
    const protocol =
      REGISTERED_MODEL_PROVIDER_PRESETS.find((p) => p.value === currentPreset)?.protocol ?? 'custom'
    const models = form.getFieldValue('initial_models') as
      | Array<{ model_name?: string }>
      | undefined
    const modelName = models?.[0]?.model_name?.trim() || undefined
    setTesting(true)
    setTestResult(null)
    try {
      const r = await registeredModelsApi.precheck({
        endpoint_url: endpointUrl,
        protocol,
        model_name: modelName ?? null,
        api_key: apiKey ?? null,
      })
      setTestResult({
        ok: r.ok,
        msg: `${r.ok ? '连接成功' : '连接失败'} · HTTP ${r.http_status ?? '-'} · ${r.latency_ms ?? '-'}ms`,
      })
    } catch {
      setTestResult({ ok: false, msg: '请求失败，请检查网络或服务端' })
    } finally {
      setTesting(false)
    }
  }

  return (
    <>
      <Form<CreateFormValues>
        form={form}
        layout="vertical"
        initialValues={{
          provider_preset: 'openai',
          endpoint_url:
            REGISTERED_MODEL_PROVIDER_PRESETS.find((p) => p.value === 'openai')
              ?.defaultEndpoint ?? '',
          initial_models: [{}],
        }}
      >
        <Form.Item
          label="显示名称（display_name）"
          name="display_name"
          rules={[{ required: true, message: '请填写显示名称' }]}
        >
          <Input placeholder="如：OpenAI 生产、阿里百炼文本" />
        </Form.Item>
        <Form.Item label="Provider 类型" name="provider_preset">
          <Select
            options={REGISTERED_MODEL_PROVIDER_PRESETS.map((p) => ({
              value: p.value,
              label: p.label,
            }))}
            onChange={(v) => handlePresetChange(v as RegisteredModelProvider)}
            placeholder="选择厂商"
          />
        </Form.Item>
        <Form.Item
          label="Base URL"
          name="endpoint_url"
          rules={[
            { required: true, message: '请填写 Base URL' },
            { type: 'url', message: '请填写有效的 URL' },
          ]}
        >
          <Input placeholder="https://api.openai.com/v1" />
        </Form.Item>
        <Form.Item
          label="API Key"
          name="api_key"
          rules={[{ required: true, message: '请填写 API key' }]}
          tooltip="原始 token；服务端加密入库，列表只返 masked 预览"
        >
          <Input.Password placeholder="sk-..." visibilityToggle />
        </Form.Item>
        <Form.Item label="测试连接" tooltip="保存前验证 Provider 接入地址与 API Key 是否可用">
          <Space direction="vertical" style={{ width: '100%' }}>
            <Space>
              <Button
                icon={<ApiOutlined />}
                loading={testing}
                onClick={handleTest}
              >
                测试连接
              </Button>
              {testResult && (
                <Tag color={testResult.ok ? 'green' : 'red'}>{testResult.msg}</Tag>
              )}
            </Space>
          </Space>
        </Form.Item>
        <Form.Item label="描述（可选）" name="description">
          <Input.TextArea
            rows={2}
            placeholder="该 Provider 的用途 / 注意事项 / 环境说明"
          />
        </Form.Item>

        <div style={{ marginTop: 8, marginBottom: 8, fontWeight: 500 }}>模型列表</div>
        <Form.List name="initial_models">
          {(fields, { add, remove }) => (
            <>
              {fields.map((field) => (
                <div
                  key={field.key}
                  style={{
                    border: '1px dashed #d9d9d9',
                    borderRadius: 6,
                    padding: 12,
                    marginBottom: 12,
                  }}
                >
                  <Space.Compact block style={{ marginBottom: 8 }}>
                    <Form.Item
                      name={[field.name, 'model_name']}
                      noStyle
                      rules={[{ required: true, message: '请填写 model_id' }]}
                    >
                      <Input
                        style={{ width: 'calc(50% - 24px)' }}
                        placeholder="model_id：gpt-4o-mini"
                      />
                    </Form.Item>
                    <Form.Item name={[field.name, 'name']} noStyle>
                      <Input
                        style={{ width: 'calc(50% - 24px)' }}
                        placeholder="显示名（可选）：用于策略下拉展示"
                      />
                    </Form.Item>
                    <Button
                      type="text"
                      danger
                      icon={<MinusCircleOutlined />}
                      onClick={() => remove(field.name)}
                    />
                  </Space.Compact>
                  <Form.Item
                    name={[field.name, 'large_category']}
                    noStyle
                    rules={[{ required: true, message: '请选择能力类型' }]}
                  >
                    <Select
                      style={{ width: '100%' }}
                      placeholder="能力类型"
                      options={LARGE_MODEL_CATEGORY_OPTIONS.map((o) => ({
                        value: o.value,
                        label: o.label,
                      }))}
                    />
                  </Form.Item>
                </div>
              ))}
              <Button
                type="dashed"
                block
                icon={<PlusOutlined />}
                onClick={() => add({})}
              >
                添加模型
              </Button>
            </>
          )}
        </Form.List>
      </Form>
    </>
  )
}

interface SmallFormProps {
  form: import('antd').FormInstance<CreateFormValues>
  uploading: boolean
  setUploading: (b: boolean) => void
  severeModalOpen: boolean
  onSevereConfirm: () => void
  onSevereCancel: () => void
  onCase3Change: (active: boolean) => void
  smallFormRef: import('react').RefObject<SmallFormHandle>
}

function SmallForm({
  form,
  uploading,
  setUploading,
  severeModalOpen,
  onSevereConfirm,
  onSevereCancel,
  onCase3Change,
  smallFormRef,
}: SmallFormProps) {
  return (
    <Form<CreateFormValues>
      form={form}
      layout="vertical"
      initialValues={{}}
    >
      <SmallModelFormFields
        ref={smallFormRef}
        form={form as never}
        uploading={uploading}
        setUploading={setUploading}
        severeModalOpen={severeModalOpen}
        onSevereConfirm={onSevereConfirm}
        onSevereCancel={onSevereCancel}
        onCase3Change={onCase3Change}
      />
    </Form>
  )
}

export { SMALL_MODEL_CATEGORY_OPTIONS }