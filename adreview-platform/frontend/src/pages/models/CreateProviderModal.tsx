import { useState } from 'react'
import {
  Alert,
  Button,
  Drawer,
  Form,
  Input,
  Select,
  Space,
  App,
} from 'antd'
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons'
import { providersApi } from '@/api/registered-models'
import {
  LARGE_MODEL_CATEGORY_OPTIONS,
  REGISTERED_MODEL_PROVIDER_PRESETS,
  type LargeModelCategory,
  type ProviderInitialModel,
  type RegisteredModelProvider,
} from '@/types/domain'

interface FormValues {
  display_name: string
  provider_preset?: RegisteredModelProvider
  endpoint_url: string
  api_key: string
  description?: string
  initial_models: Array<ProviderInitialModel & { _key?: string }>
}

interface Props {
  open: boolean
  onClose: () => void
  onCreated?: (providerId: number) => void
}

export default function CreateProviderModal({ open, onClose, onCreated }: Props) {
  const { message } = App.useApp()
  const [form] = Form.useForm<FormValues>()
  const [submitting, setSubmitting] = useState(false)
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
          ? `Provider 创建成功，并同时建好 ${initial.length} 个模型`
          : 'Provider 创建成功',
      )
      onCreated?.(created.id)
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

  return (
    <Drawer
      title="添加 Provider"
      open={open}
      onClose={onClose}
      width={640}
      destroyOnClose
      extra={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={submitting} onClick={submit}>
            保存
          </Button>
        </Space>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="一个 Provider = 一个厂商级接入配置（Base URL + API Key + 一组 Model）。同厂商多模型可在下方「模型列表」一次性建好。"
      />
      <Form<FormValues>
        form={form}
        layout="vertical"
        initialValues={{
          provider_preset: 'openai',
          endpoint_url: REGISTERED_MODEL_PROVIDER_PRESETS.find((p) => p.value === 'openai')
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
        <Form.Item label="描述（可选）" name="description">
          <Input.TextArea
            rows={2}
            placeholder="该 Provider 的用途 / 注意事项 / 环境说明"
          />
        </Form.Item>

        <div style={{ marginTop: 8, marginBottom: 8, fontWeight: 500 }}>
          模型列表
        </div>
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
                    <Form.Item
                      name={[field.name, 'name']}
                      noStyle
                    >
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
                    rules={[{ required: true, message: '请选择大模型分类' }]}
                  >
                    <Select
                      style={{ width: '100%' }}
                      placeholder="大模型分类"
                      options={LARGE_MODEL_CATEGORY_OPTIONS.map((o) => ({
                        value: o.value,
                        label: o.label,
                      }))}
                    />
                  </Form.Item>
                  <Form.Item
                    name={[field.name, 'version']}
                    noStyle
                  >
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
    </Drawer>
  )
}
