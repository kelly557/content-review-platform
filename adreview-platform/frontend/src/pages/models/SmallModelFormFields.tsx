import { useState } from 'react'
import {
  Button,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Tag,
  Upload,
  App,
} from 'antd'
import type { UploadRequestOption } from 'rc-upload/lib/interface'
import { DeleteOutlined, FileOutlined, UploadOutlined } from '@ant-design/icons'
import { registeredModelsApi } from '@/api/registered-models'
import type {
  ArtifactUploadResponse,
  SmallModelCategory,
} from '@/types/domain'
import { SMALL_MODEL_CATEGORY_OPTIONS } from '@/types/domain'

export interface SmallModelFormValues {
  small_category: SmallModelCategory
  name: string
  model_name: string
  description?: string
  version?: string
  max_output_tokens: number
  // artifact 隐藏字段 — 用 Form.Item noStyle + 自定义 store
  __artifact?: ArtifactUploadResponse
}

interface Props {
  /** Form 实例，由父组件创建并传入 */
  form: ReturnType<typeof Form.useForm<SmallModelFormValues>>[0]
  /** 上传中的 loading 状态（用于禁用按钮） */
  uploading?: boolean
  setUploading?: (b: boolean) => void
  /** 初始 artifact（详情页"新版本"时带入上一版本文件信息） */
  initialArtifact?: ArtifactUploadResponse | null
}

/**
 * 小模型添加表单字段（不包含 Name/Kind Radio — 由父组件渲染）。
 * - 必填：分类、模型名称、模型标识、文件、max_output_tokens
 * - 可选：版本号、说明
 * - artifact 上传结果通过 form.setFieldValue('__artifact', meta) 存到表单
 */
export default function SmallModelFormFields({
  form,
  uploading,
  setUploading,
  initialArtifact,
}: Props) {
  const { message } = App.useApp()
  const [artifact, setArtifact] = useState<ArtifactUploadResponse | null>(
    initialArtifact ?? null,
  )

  const beforeUpload = (file: File) => {
    const MAX = 512 * 1024 * 1024
    if (file.size > MAX) {
      message.error(`文件超过 512MB 上限`)
      return Upload.LIST_IGNORE
    }
    return true
  }

  const customUpload = async (options: UploadRequestOption) => {
    const { file, onSuccess, onError } = options
    setUploading?.(true)
    try {
      const f = file instanceof File ? file : (file as unknown as Blob & { name?: string })
      const meta = await registeredModelsApi.uploadArtifact(f as File)
      setArtifact(meta)
      form.setFieldValue('__artifact' as keyof SmallModelFormValues, meta)
      onSuccess?.(meta)
      message.success(`上传成功 · ${meta.filename} (${(meta.size / 1024 / 1024).toFixed(2)} MB)`)
    } catch (e) {
      onError?.(e as Error)
    } finally {
      setUploading?.(false)
    }
  }

  const removeArtifact = () => {
    setArtifact(null)
    form.setFieldValue('__artifact' as keyof SmallModelFormValues, undefined)
  }

  return (
    <>
      <Form.Item
        label="分类"
        name="small_category"
        rules={[{ required: true, message: '请选择分类' }]}
      >
        <Select
          options={SMALL_MODEL_CATEGORY_OPTIONS.map((o) => ({
            value: o.value,
            label: (
              <span>
                <Tag color={o.color} style={{ marginRight: 4 }}>
                  {o.label}
                </Tag>
              </span>
            ),
          }))}
          placeholder="选择小模型分类（必选）"
        />
      </Form.Item>

      <Form.Item
        label="模型名称"
        name="name"
        rules={[{ required: true, message: '请填写模型名称' }]}
        tooltip="展示名，如：涉政分类器 v3"
      >
        <Input placeholder="涉政分类器 v3" />
      </Form.Item>

      <Form.Item
        label="模型文件"
        required
        tooltip="传统 ML/深度学习权重文件（.onnx / .pt / .pth / .bin / .zip / .tar.gz），单文件 ≤ 512MB"
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          {!artifact ? (
            <Upload.Dragger
              name="file"
              accept=".onnx,.pt,.pth,.bin,.zip,.tar,.gz,.tgz,.h5,.pb,.safetensors"
              beforeUpload={beforeUpload}
              customRequest={customUpload}
              showUploadList={false}
              disabled={uploading}
            >
              <p className="ant-upload-drag-icon">
                <UploadOutlined />
              </p>
              <p className="ant-upload-text">点击或拖拽文件至此区域上传</p>
              <p
                style={{
                  fontSize: 12,
                  color: '#64748B',
                }}
              >
                支持 .onnx / .pt / .pth / .bin / .zip / .tar.gz
              </p>
            </Upload.Dragger>
          ) : (
            <div
              style={{
                border: '1px solid #d9d9d9',
                borderRadius: 6,
                padding: '8px 12px',
                background: '#fafafa',
              }}
            >
              <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                <Space>
                  <FileOutlined style={{ color: '#1677ff' }} />
                  <span>{artifact.filename}</span>
                  <Tag>{(artifact.size / 1024 / 1024).toFixed(2)} MB</Tag>
                  <span style={{ color: '#94a3b8', fontSize: 12 }}>
                    sha256: {artifact.sha256.slice(0, 12)}…
                  </span>
                </Space>
                <Button
                  type="link"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={removeArtifact}
                >
                  重新上传
                </Button>
              </Space>
            </div>
          )}
        </Space>
      </Form.Item>

      <Form.Item
        label="最大输出长度（tokens）"
        name="max_output_tokens"
        rules={[
          { required: true, message: '请填写最大输出长度' },
          { type: 'integer', min: 1, max: 32768, message: '范围 1 ~ 32768' },
        ]}
        tooltip="业务侧推理时控制单次输出的 token 上限"
      >
        <InputNumber
          style={{ width: '100%' }}
          placeholder="2048"
          min={1}
          max={32768}
          step={64}
        />
      </Form.Item>

      <Form.Item label="版本号" name="version" tooltip="语义版本号，如 1.0.0（可选）">
        <Input placeholder="1.0.0" />
      </Form.Item>

      <Form.Item
        label="模型说明"
        name="description"
        tooltip="用途 / 注意事项"
      >
        <Input.TextArea rows={3} placeholder="如：用于文本涉政分类 / 部署在 GPU 节点" />
      </Form.Item>

      {/* artifact 隐藏字段，不在 UI 显示，但参与 form.values 收集 */}
      <Form.Item name="__artifact" hidden noStyle>
        <Input type="hidden" />
      </Form.Item>
    </>
  )
}