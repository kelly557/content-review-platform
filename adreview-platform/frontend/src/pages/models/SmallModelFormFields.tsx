import { useState } from 'react'
import {
  Button,
  Form,
  Input,
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
  SmallModelModality,
} from '@/types/domain'
import { SMALL_MODEL_CATEGORY_OPTIONS, SMALL_MODEL_MODALITY_OPTIONS } from '@/types/domain'

export interface SmallModelFormValues {
  modality: SmallModelModality
  small_category: SmallModelCategory
  name: string
  model_name: string
  description?: string
  version?: string
  __artifact?: ArtifactUploadResponse
  __auditPoints?: string[]
}

interface Props {
  /** Form 实例，由父组件创建并传入 */
  form: ReturnType<typeof Form.useForm<SmallModelFormValues>>[0]
  /** 上传中的 loading 状态（用于禁用按钮） */
  uploading?: boolean
  setUploading?: (b: boolean) => void
  /** 初始 artifact（详情页"新版本"时带入上一版本文件信息） */
  initialArtifact?: ArtifactUploadResponse | null
  /** 初始审核点（详情页"新版本"时带入当前版本的 points，初始化 JSON 编辑器） */
  initialPoints?: string[] | null
}

/**
 * 小模型添加表单字段（不包含 Name/Kind Radio — 由父组件渲染）。
 * - 必填：模态、审核场景、模型名称、文件
 * - 可选：模型审核点配置、版本号、说明
 * - artifact 上传结果通过 form.setFieldValue('__artifact', meta) 存到表单
 */
export default function SmallModelFormFields({
  form,
  uploading,
  setUploading,
  initialArtifact,
  initialPoints,
}: Props) {
  const { message } = App.useApp()
  const [artifact, setArtifact] = useState<ArtifactUploadResponse | null>(
    initialArtifact ?? null,
  )
  const initialJsonText =
    initialPoints && initialPoints.length > 0
      ? JSON.stringify({ points: initialPoints }, null, 2)
      : ''
  const [auditJsonText, setAuditJsonText] = useState(initialJsonText)
  const [auditPoints, setAuditPoints] = useState<string[] | null>(
    initialPoints ?? null,
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

  const parseJson = (text: string): string[] | null => {
    try {
      const data = JSON.parse(text)
      if (Array.isArray(data.points) && data.points.every((p: unknown) => typeof p === 'string')) {
        return data.points
      }
    } catch {}
    return null
  }

  const handleJsonTextChange = (text: string) => {
    setAuditJsonText(text)
    const points = parseJson(text)
    setAuditPoints(points)
    form.setFieldValue('__auditPoints' as keyof SmallModelFormValues, points ?? undefined)
  }

  const handleJsonUpload = (file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = (e.target?.result as string) ?? ''
      const points = parseJson(text)
      if (points) {
        setAuditJsonText(text)
        setAuditPoints(points)
        form.setFieldValue('__auditPoints' as keyof SmallModelFormValues, points)
        message.success(`已加载 ${points.length} 个审核标签`)
      } else {
        message.error('JSON 格式错误：需要 { "points": ["标签1", "标签2", ...] }')
      }
    }
    reader.readAsText(file)
    return false
  }

  return (
    <>
      <Form.Item
        label="模态"
        name="modality"
        rules={[{ required: true, message: '请选择模态' }]}
      >
        <Select
          options={SMALL_MODEL_MODALITY_OPTIONS.map((o) => ({
            value: o.value,
            label: (
              <span>
                <Tag color={o.color} style={{ marginRight: 4 }}>
                  {o.label}
                </Tag>
              </span>
            ),
          }))}
          placeholder="选择模态（文本 / 图片）"
        />
      </Form.Item>

      <Form.Item
        label="审核场景"
        name="small_category"
        rules={[{ required: true, message: '请选择审核场景' }]}
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
          placeholder="选择审核场景（必选）"
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
        label="模型审核点配置"
        tooltip='JSON 格式：{ "points": ["标签1", "标签2", ...] }'
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Space>
            <Upload
              accept=".json"
              beforeUpload={handleJsonUpload}
              showUploadList={false}
            >
              <Button icon={<UploadOutlined />}>选择 JSON 配置文件</Button>
            </Upload>
            <span style={{ fontSize: 12, color: '#64748B' }}>或直接编辑下方 JSON</span>
          </Space>
          <Input.TextArea
            rows={6}
            value={auditJsonText}
            onChange={(e) => handleJsonTextChange(e.target.value)}
            placeholder='{"points": ["一号领导人", "敏感地名"]}'
            style={{ fontFamily: 'monospace', fontSize: 12 }}
          />
          {auditPoints && auditPoints.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {auditPoints.map((p, i) => (
                <Tag key={i}>{p}</Tag>
              ))}
            </div>
          )}
        </Space>
      </Form.Item>

      <Form.Item
        label="模型说明"
        name="description"
        tooltip="用途 / 注意事项"
      >
        <Input.TextArea rows={3} placeholder="如：用于文本涉政分类 / 部署在 GPU 节点" />
      </Form.Item>

      <Form.Item name="__artifact" hidden noStyle>
        <Input type="hidden" />
      </Form.Item>
    </>
  )
}