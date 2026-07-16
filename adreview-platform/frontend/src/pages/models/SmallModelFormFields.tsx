import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Alert,
  Button,
  Form,
  Input,
  Select,
  Skeleton,
  Space,
  Tag,
  Upload,
  App,
} from 'antd'
import type { UploadRequestOption } from 'rc-upload/lib/interface'
import {
  ApiOutlined,
  DeleteOutlined,
  FileOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import CodeMirror from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { EditorView } from '@codemirror/view'
import { registeredModelsApi } from '@/api/registered-models'
import type {
  ArtifactUploadResponse,
  AuditPointEntry,
  RegisteredModelListItem,
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
  __auditPoints?: AuditPointEntry[]
}

interface Props {
  form: ReturnType<typeof Form.useForm<SmallModelFormValues>>[0]
  uploading?: boolean
  setUploading?: (b: boolean) => void
  initialArtifact?: ArtifactUploadResponse | null
  initialPoints?: AuditPointEntry[] | null
}

type HintState =
  | { type: 'loading' }
  | { type: 'info' | 'success' | 'warning' | 'error'; text: string }
  | null

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
  const [auditPoints, setAuditPoints] = useState<AuditPointEntry[] | null>(
    initialPoints ?? null,
  )

  // 「检测模型」按钮状态
  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState<{
    ok: boolean
    msg: string
  } | null>(null)

  // ─── 监听已选组合 + 审核点 ───
  const watchedModality = Form.useWatch('modality', form) as
    | SmallModelModality
    | undefined
  const watchedCategory = Form.useWatch('small_category', form) as
    | SmallModelCategory
    | undefined
  const watchedPoints = Form.useWatch('__auditPoints', form) as
    | AuditPointEntry[]
    | undefined

  // ─── 查询同组合已有模型 ───
  const comboQuery = useQuery({
    queryKey: [
      'small-models',
      'by-combo',
      watchedModality,
      watchedCategory,
    ],
    queryFn: () =>
      registeredModelsApi.list({
        kind: 'small',
        modality: watchedModality,
        small_category: watchedCategory,
        size: 50,
      }),
    enabled: !!watchedModality && !!watchedCategory,
    staleTime: 30_000,
  })

  // ─── 动态提示文案 ───
  const hint: HintState = (() => {
    if (!watchedModality || !watchedCategory) return null
    if (comboQuery.isLoading) return { type: 'loading' }
    if (comboQuery.isError)
      return { type: 'info', text: '检查同组合模型失败，建议配置审核点' }
    const items = (comboQuery.data?.items ?? []) as RegisteredModelListItem[]
    if (items.length === 0)
      return {
        type: 'info',
        text: '首次接入该模态+审核场景组合，请配置审核点',
      }
    const samePoints = items.find((m) =>
      pointsEqual(
        m.current_version_config?.points as AuditPointEntry[] | null | undefined,
        watchedPoints,
      ),
    )
    if (samePoints)
      return {
        type: 'success',
        text: `该组合已有 ${items.length} 个模型复用，可不添加审核点配置`,
      }
    return {
      type: 'warning',
      text: '该模态+审核场景已有模型，检测到审核点存在差异，将作为新版本审核点',
    }
  })()

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

  const parseJson = (text: string): AuditPointEntry[] | null => {
    try {
      const data = JSON.parse(text)
      if (!Array.isArray(data.points)) return null
      const out: AuditPointEntry[] = []
      for (const p of data.points) {
        if (typeof p === 'string') {
          out.push({ label: p, description: '' })
        } else if (
          p != null &&
          typeof p === 'object' &&
          typeof (p as { label?: unknown }).label === 'string'
        ) {
          const obj = p as { label: string; description?: unknown }
          out.push({
            label: obj.label,
            description: typeof obj.description === 'string' ? obj.description : '',
          })
        } else {
          return null
        }
      }
      return out
    } catch {
      return null
    }
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
        message.error('JSON 格式错误：需要 { "points": [{ "label": "标签", "description": "说明" }] }')
      }
    }
    reader.readAsText(file)
    return false
  }

  const handleCheckArtifact = async () => {
    const artifactVal = form.getFieldValue('__artifact') as
      | ArtifactUploadResponse
      | undefined
    if (!artifactVal) {
      message.error('请先上传模型文件')
      return
    }
    if (!watchedModality || !watchedCategory) {
      message.error('请先选择模态和审核场景')
      return
    }
    setChecking(true)
    setCheckResult(null)
    try {
      const r = await registeredModelsApi.precheckArtifact({
        storage_key: artifactVal.storage_key,
        modality: watchedModality,
        small_category: watchedCategory,
        config_points: watchedPoints ?? null,
      })
      setCheckResult({
        ok: r.ok,
        msg: `${r.ok ? '检测通过' : '检测失败'} · HTTP ${r.http_status ?? '-'} · ${r.latency_ms ?? '-'}ms`,
      })
    } catch {
      setCheckResult({ ok: false, msg: '请求失败，请检查网络或服务端' })
    } finally {
      setChecking(false)
    }
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

      {hint && hint.type === 'loading' && (
        <Skeleton.Input active size="small" block style={{ marginBottom: 12 }} />
      )}
      {hint && hint.type !== 'loading' && (
        <Alert
          type={hint.type}
          showIcon
          style={{ marginBottom: 12 }}
          message={hint.text}
        />
      )}

      <Form.Item
        label="模型审核点配置"
        tooltip='JSON 格式：{ "points": [{"label":"标签", "description":"说明"}] }'
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
          <div
            style={{
              border: '1px solid #d9d9d9',
              borderRadius: 6,
              overflow: 'hidden',
            }}
          >
            <CodeMirror
              value={auditJsonText}
              onChange={handleJsonTextChange}
              placeholder='{"points": [{"label":"一号领导人","description":"检测文本中是否出现一号领导人姓名"}]}'
              extensions={[json(), EditorView.lineWrapping]}
              basicSetup={{
                lineNumbers: true,
                highlightActiveLine: true,
                foldGutter: true,
                autocompletion: true,
                bracketMatching: true,
              }}
              height="180px"
              theme="light"
              style={{ fontSize: 12 }}
            />
          </div>
          {auditPoints && auditPoints.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {auditPoints.map((p, i) => (
                <div key={i}>
                  <Tag>{p.label}</Tag>
                  {p.description && (
                    <span style={{ fontSize: 12, color: '#64748b', marginLeft: 8 }}>
                      {p.description}
                    </span>
                  )}
                </div>
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
        <Input.TextArea rows={3} placeholder="如：用于文本涉政分类" />
      </Form.Item>

      <Form.Item label="检测模型" tooltip="保存前校验模型文件、JSON 配置与模态一致性">
        <Space>
          <Button
            icon={<ApiOutlined />}
            loading={checking}
            onClick={handleCheckArtifact}
          >
            检测模型
          </Button>
          {checkResult && (
            <Tag color={checkResult.ok ? 'green' : 'red'}>{checkResult.msg}</Tag>
          )}
        </Space>
      </Form.Item>

      <Form.Item name="__artifact" hidden noStyle>
        <Input type="hidden" />
      </Form.Item>
    </>
  )
}

function pointsEqual(
  a: AuditPointEntry[] | null | undefined,
  b: AuditPointEntry[] | null | undefined,
): boolean {
  const norm = (v: AuditPointEntry[] | null | undefined) =>
    (v ?? [])
      .map((p) => ({ label: p.label.trim(), description: (p.description ?? '').trim() }))
      .sort((x, y) =>
        x.label === y.label ? x.description.localeCompare(y.description) : x.label.localeCompare(y.label),
      )
  const ja = JSON.stringify(norm(a))
  const jb = JSON.stringify(norm(b))
  return ja === jb
}