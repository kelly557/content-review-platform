import { useState } from 'react'
import {
  Alert,
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
  type LargeModelCategory,
  type ProviderInitialModel,
  type RegisteredModelProvider,
  type RegisteredModelKind,
  type SmallModelCategory,
} from '@/types/domain'
import SmallModelFormFields, {
  type SmallModelFormValues,
} from './SmallModelFormFields'

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
}

export default function CreateModelModal({ open, mode, onClose, onCreated }: Props) {
  const { message } = App.useApp()
  const [form] = Form.useForm<CreateFormValues>()
  const [submitting, setSubmitting] = useState(false)
  const [uploading, setUploading] = useState(false)
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
    setSubmitting(true)
    try {
      if (mode === 'large') {
        const initial = (v.initial_models || []).map((m) => ({
          name: m.name?.trim() || undefined,
          model_name: m.model_name.trim(),
          large_category: m.large_category as LargeModelCategory,
          description: m.description?.trim() || undefined,
          version: m.version?.trim() || undefined,
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
          message.error('请选择模态')
          return
        }
        if (!v.small_category) {
          message.error('请选择审核场景')
          return
        }
        if (!v.model_name || !v.model_name.trim()) {
          message.error('请填写业务标识')
          return
        }
        const created = await registeredModelsApi.create({
          name: v.name ?? v.model_name.trim(),
          description: v.description,
          kind: 'small',
          small_category: v.small_category as SmallModelCategory,
          modality: v.modality,
          large_category: null,
          provider_id: null,
          model_name: v.model_name.trim(),
          version: v.version,
          config: v.__auditPoints?.length ? { points: v.__auditPoints } : undefined,
          registration_method: 'uploaded_file',
          artifact,
        })
        message.success('小模型创建成功')
        onCreated?.({ modelId: created.id })
      }
      form.resetFields()
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

  return (
    <Drawer
      title={title}
      open={open}
      onClose={onClose}
      width={mode === 'large' ? 640 : 560}
      destroyOnClose
      extra={
        <Space>
          <Button onClick={onClose}>取消</Button>
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
          form={form}
          uploading={uploading}
          setUploading={setUploading}
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
          initial_models: [],
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
        <Alert
          type={currentPreset ? 'success' : 'info'}
          showIcon
          style={{ marginBottom: 12 }}
          message={
            currentPreset === 'self-hosted' || currentPreset === 'custom'
              ? '自建 / 自定义 Provider：Base URL 与 API Key 必须手动填写'
              : `已自动预填 ${currentPreset ?? ''} 的默认 Base URL，可按需调整`
          }
        />
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
                  <Form.Item name={[field.name, 'version']} noStyle>
                    <Input
                      style={{ marginTop: 8, width: '100%' }}
                      placeholder="起始版本号（可选）：1.0.0"
                    />
                  </Form.Item>
                </div>
              ))}
              <Button
                type="dashed"
                block
                icon={<PlusOutlined />}
                onClick={() => add({ large_category: 'text' })}
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
}

function SmallForm({ form, uploading, setUploading }: SmallFormProps) {
  return (
    <Form<CreateFormValues>
      form={form}
      layout="vertical"
      initialValues={{
        modality: 'text',
        small_category: 'politics' as SmallModelCategory,
      }}
    >
      <SmallModelFormFields
        form={form as never}
        uploading={uploading}
        setUploading={setUploading}
      />
    </Form>
  )
}

export { SMALL_MODEL_CATEGORY_OPTIONS }