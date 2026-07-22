import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import {
  Alert,
  Button,
  Form,
  Input,
  Modal,
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
import { useRiskCategoryStore } from '@/store/riskCategories'

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
  /** case 3 警告 Modal 是否打开（由父组件在用户点保存时控制） */
  severeModalOpen?: boolean
  /** case 3 警告 Modal 确认提交回调 */
  onSevereConfirm?: () => void
  /** case 3 警告 Modal 取消回调 */
  onSevereCancel?: () => void
  /** 当前 hint 是否处于 case 3（删除或修改审核点） */
  onCase3Change?: (active: boolean) => void
}

type DiffEntry = { label: string; description: string }
type ModifiedEntry = { label: string; oldDescription: string; newDescription: string }

type DiffResult = {
  onlyInExisting: DiffEntry[]
  modified: ModifiedEntry[]
  onlyInIncoming: DiffEntry[]
}

type HintState =
  | { type: 'loading' }
  | { type: 'info'; text: string }
  | {
      type: 'success'
      text: string
      referenceModelId: number
      referenceModelName: string
      diff: DiffResult
    }
  | {
      type: 'info-added'
      text: string
      referenceModelId: number
      referenceModelName: string
      diff: DiffResult
    }
  | {
      type: 'error-severe'
      text: string
      referenceModelId: number
      referenceModelName: string
      diff: DiffResult
    }
  | null

export type SmallFormHandle = {
  getResolvedAuditPoints: () => AuditPointEntry[] | null
}

export default forwardRef<SmallFormHandle, Props>(function SmallModelFormFields(
  {
      form,
      uploading,
      setUploading,
      initialArtifact,
      initialPoints,
      severeModalOpen,
      onSevereConfirm,
      onSevereCancel,
      onCase3Change,
    }: Props,
    ref,
  ) {
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

  // ─── case 1：查看 / 下载 ───
  const [viewConfigOpen, setViewConfigOpen] = useState(false)
  const [viewConfigText, setViewConfigText] = useState('')
  const [viewConfigLoading, setViewConfigLoading] = useState(false)

  const onViewReferenceConfig = async (modelId: number) => {
    setViewConfigLoading(true)
    try {
      const cfg = await registeredModelsApi.getCurrentVersionConfig(modelId)
      const text = JSON.stringify(cfg, null, 2)
      setViewConfigText(text)
      setViewConfigOpen(true)
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail || '查看配置失败')
    } finally {
      setViewConfigLoading(false)
    }
  }

  const onDownloadReferenceConfig = async (modelId: number, name: string) => {
    try {
      const cfg = await registeredModelsApi.getCurrentVersionConfig(modelId)
      const blob = new Blob([JSON.stringify(cfg, null, 2)], {
        type: 'application/json',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${name}-audit-points.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      message.success('已下载配置文件')
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail || '下载失败')
    }
  }

  // ─── 监听已选组合 + 审核点 ───
  const watchedModality = Form.useWatch('modality', form) as
    | SmallModelModality
    | undefined
  const watchedCategory = Form.useWatch('small_category', form) as
    | string | undefined
  const ensureRiskLoaded = useRiskCategoryStore((s) => s.ensureLoaded)
  const riskItems = useRiskCategoryStore((s) => s.items)
  useEffect(() => {
    void ensureRiskLoaded()
  }, [ensureRiskLoaded])
  const watchedPoints = Form.useWatch('__auditPoints', form) as
    | AuditPointEntry[]
    | undefined

  // ─── 查询同组合已有模型 ───
  const [comboItems, setComboItems] = useState<RegisteredModelListItem[]>([])
  const [comboLoading, setComboLoading] = useState(false)
  const [comboError, setComboError] = useState(false)
  useEffect(() => {
    if (!watchedModality || !watchedCategory) {
      setComboItems([])
      setComboLoading(false)
      setComboError(false)
      return
    }
    let cancelled = false
    setComboLoading(true)
    setComboError(false)
    registeredModelsApi
      .list({
        kind: 'small',
        modality: watchedModality,
        small_category: watchedCategory,
        size: 50,
      })
      .then((data) => {
        if (cancelled) return
        setComboItems((data?.items ?? []) as RegisteredModelListItem[])
      })
      .catch(() => {
        if (cancelled) return
        setComboError(true)
        setComboItems([])
      })
      .finally(() => {
        if (!cancelled) setComboLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [watchedModality, watchedCategory])

  // ─── 动态提示文案 ───
  const hint: HintState = (() => {
    if (!watchedModality || !watchedCategory) return null
    if (comboLoading) return { type: 'loading' }
    if (comboError)
      return { type: 'info', text: '检查同组合模型失败，建议配置审核点' }
    if (comboItems.length === 0)
      return {
        type: 'info',
        text: '首次接入该支持的素材类型+识别风险类型组合，请配置审核点',
      }

    const reference = pickReference(comboItems)
    if (!reference) {
      return {
        type: 'info',
        text: '该组合已有模型，但暂无可比对配置；请配置审核点',
      }
    }
    const existingPoints = pointsFromConfig(reference.current_version_config)
    const incomingPoints = (watchedPoints ?? []) as AuditPointEntry[]

    // 用户未配置审核点：默认与 reference 当前版本一致，不显示提示
    if (incomingPoints.length === 0) return null

    const diff = diffAuditPoints(existingPoints, incomingPoints)

    const noDiff =
      diff.onlyInExisting.length === 0 &&
      diff.modified.length === 0 &&
      diff.onlyInIncoming.length === 0
    if (noDiff) {
      return {
        type: 'success',
        text: `该组合已有 ${comboItems.length} 个模型复用，无需上传配置文件`,
        referenceModelId: reference.id,
        referenceModelName: reference.name,
        diff,
      }
    }
    const onlyAdded =
      diff.onlyInExisting.length === 0 && diff.modified.length === 0
    if (onlyAdded) {
      return {
        type: 'info-added',
        text: `检测到 ${diff.onlyInIncoming.length} 个新增审核点，将作为新版本审核点`,
        referenceModelId: reference.id,
        referenceModelName: reference.name,
        diff,
      }
    }
    return {
      type: 'error-severe',
      text: '检测到删除或修改审核点，请创建新的风险类型',
      referenceModelId: reference.id,
      referenceModelName: reference.name,
      diff,
    }
  })()

  // 通知父组件当前是否处于 case 3（仅供保存时拦截使用，不再自动开 Modal）
  useEffect(() => {
    onCase3Change?.(hint?.type === 'error-severe')
  }, [hint, onCase3Change])

  // 暴露 imperative handle：让父组件在提交时拿到"最终生效的审核点"
  // - 用户已配置 → 用用户的 __auditPoints
  // - 用户未配置 + 同组合已有模型 → 用 reference 的现有 points
  // - 都没有 → null
  useImperativeHandle(
    ref,
    () => ({
      getResolvedAuditPoints: () => {
        const user = (watchedPoints ?? []) as AuditPointEntry[]
        if (user.length > 0) return user
        const reference = pickReference(comboItems)
        if (!reference) return null
        const refPoints = pointsFromConfig(reference.current_version_config)
        return refPoints.length > 0 ? refPoints : null
      },
    }),
    [watchedPoints, comboItems],
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
      message.error('请先选择支持的素材类型和识别风险类型')
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
        label="支持的素材类型"
        name="modality"
        rules={[{ required: true, message: '请选择支持的素材类型' }]}
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
          placeholder="选择支持的素材类型（文本 / 图片）"
        />
      </Form.Item>

      <Form.Item
        label="识别风险类型"
        name="small_category"
        rules={[{ required: true, message: '请选择识别风险类型' }]}
      >
        <Select
          options={
            riskItems.length > 0
              ? riskItems.map((o) => ({
                  value: o.code,
                  label: (
                    <span>
                      <Tag color={o.color} style={{ marginRight: 4 }}>
                        {o.label}
                      </Tag>
                    </span>
                  ),
                }))
              : SMALL_MODEL_CATEGORY_OPTIONS.map((o) => ({
                  value: o.value,
                  label: (
                    <span>
                      <Tag color={o.color} style={{ marginRight: 4 }}>
                        {o.label}
                      </Tag>
                    </span>
                  ),
                }))
          }
          placeholder="选择识别风险类型（必选）"
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
          type={
            hint.type === 'info-added'
              ? 'info'
              : hint.type === 'error-severe'
                ? 'error'
                : hint.type
          }
          showIcon
          style={{ marginBottom: 12 }}
          message={
            <Space wrap>
              <span>{hint.text}</span>
              {hint.type === 'success' && (
                <Space size={4}>
                  <Button
                    size="small"
                    type="link"
                    style={{ padding: 0 }}
                    loading={viewConfigLoading}
                    onClick={() => onViewReferenceConfig(hint.referenceModelId)}
                  >
                    查看
                  </Button>
                  <Button
                    size="small"
                    type="link"
                    style={{ padding: 0 }}
                    onClick={() =>
                      onDownloadReferenceConfig(hint.referenceModelId, hint.referenceModelName)
                    }
                  >
                    下载
                  </Button>
                </Space>
              )}
              {hint.type === 'info-added' && (
                <Space size={4} wrap>
                  {hint.diff.onlyInIncoming.map((p) => (
                    <Tag color="green" key={`add-${p.label}`}>
                      + {p.label}
                    </Tag>
                  ))}
                </Space>
              )}
              {hint.type === 'error-severe' && (
                <Tag color="red">请创建新风险类型</Tag>
              )}
            </Space>
          }
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

      <Form.Item label="检测模型" tooltip="保存前校验模型文件、JSON 配置与支持的素材类型一致性">
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

      {/* case 1：查看同组参考配置 */}
      <Modal
        open={viewConfigOpen}
        title="查看同组模型审核点配置"
        onCancel={() => setViewConfigOpen(false)}
        footer={[
          <Button key="close" onClick={() => setViewConfigOpen(false)}>
            关闭
          </Button>,
        ]}
        width={640}
      >
        <pre
          style={{
            background: '#fafafa',
            border: '1px solid #e5e7eb',
            borderRadius: 4,
            padding: 12,
            maxHeight: 400,
            overflow: 'auto',
            fontSize: 12,
            lineHeight: 1.6,
            margin: 0,
          }}
        >
          {viewConfigText}
        </pre>
      </Modal>

      {/* case 3：警告 Modal（点保存时由父组件触发，受控） */}
      <Modal
        open={!!severeModalOpen}
        title="检测到删除或修改审核点"
        onCancel={onSevereCancel}
        maskClosable={false}
        closable={false}
        keyboard={false}
        width={600}
        footer={[
          <Button key="cancel" onClick={onSevereCancel}>
            取消修改
          </Button>,
          <Button
            key="confirm"
            type="primary"
            danger
            onClick={onSevereConfirm}
          >
            我已知晓，仍要提交
          </Button>,
        ]}
      >
        {hint && hint.type === 'error-severe' && (
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            <Alert
              type="error"
              showIcon
              message={
                <span>
                  参考模型：<strong>「{hint.referenceModelName}」</strong>（id: {hint.referenceModelId}）
                </span>
              }
              description="该组合已有模型正在使用上述审核点。删除或修改已存在的审核点将影响现有线上策略，请考虑为本次新增创建一个新的风险类型。"
            />
            {hint.diff.onlyInExisting.length > 0 && (
              <div>
                <div style={{ fontWeight: 500, marginBottom: 6 }}>将被删除的审核点：</div>
                <Space wrap>
                  {hint.diff.onlyInExisting.map((p) => (
                    <Tag color="red" key={`del-${p.label}`}>
                      − {p.label}
                      {p.description ? ` · ${p.description}` : ''}
                    </Tag>
                  ))}
                </Space>
              </div>
            )}
            {hint.diff.modified.length > 0 && (
              <div>
                <div style={{ fontWeight: 500, marginBottom: 6 }}>将被修改的审核点：</div>
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  {hint.diff.modified.map((p) => (
                    <div key={`mod-${p.label}`} style={{ fontSize: 13 }}>
                      <Tag color="orange">{p.label}</Tag>
                      <span style={{ color: '#94a3b8', textDecoration: 'line-through', marginLeft: 4 }}>
                        {p.oldDescription || '(无说明)'}
                      </span>
                      <span style={{ margin: '0 6px' }}>→</span>
                      <span style={{ color: '#020617' }}>{p.newDescription || '(无说明)'}</span>
                    </div>
                  ))}
                </Space>
              </div>
            )}
            {hint.diff.onlyInIncoming.length > 0 && (
              <div>
                <div style={{ fontWeight: 500, marginBottom: 6 }}>新增的审核点：</div>
                <Space wrap>
                  {hint.diff.onlyInIncoming.map((p) => (
                    <Tag color="green" key={`add-${p.label}`}>
                      + {p.label}
                    </Tag>
                  ))}
                </Space>
              </div>
            )}
          </Space>
        )}
      </Modal>
    </>
  )
})


function pickReference(
  items: RegisteredModelListItem[],
): RegisteredModelListItem | undefined {
  if (items.length === 0) return undefined
  const active = items.find((m) => m.status === 'active')
  if (active) return active
  const withConfig = items.find((m) => m.current_version_config)
  if (withConfig) return withConfig
  return items[0]
}

function pointsFromConfig(
  raw: Record<string, unknown> | null | undefined,
): AuditPointEntry[] {
  if (!raw) return []
  const rawPoints = (raw as { points?: unknown[] }).points
  if (!Array.isArray(rawPoints)) return []
  const out: AuditPointEntry[] = []
  for (const p of rawPoints) {
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
    }
  }
  return out
}

function diffAuditPoints(
  existing: AuditPointEntry[],
  incoming: AuditPointEntry[],
): DiffResult {
  const norm = (p: AuditPointEntry) => ({
    label: p.label.trim(),
    description: (p.description ?? '').trim(),
  })
  const mapExisting = new Map<string, string>()
  for (const p of existing) {
    const n = norm(p)
    if (!mapExisting.has(n.label)) mapExisting.set(n.label, n.description)
  }
  const mapIncoming = new Map<string, string>()
  for (const p of incoming) {
    const n = norm(p)
    if (!mapIncoming.has(n.label)) mapIncoming.set(n.label, n.description)
  }

  const onlyInExisting: DiffEntry[] = []
  const modified: ModifiedEntry[] = []
  const onlyInIncoming: DiffEntry[] = []

  for (const [label, desc] of mapExisting) {
    if (!mapIncoming.has(label)) {
      onlyInExisting.push({ label, description: desc })
    } else if (mapIncoming.get(label) !== desc) {
      modified.push({
        label,
        oldDescription: desc,
        newDescription: mapIncoming.get(label) ?? '',
      })
    }
  }
  for (const [label, desc] of mapIncoming) {
    if (!mapExisting.has(label)) {
      onlyInIncoming.push({ label, description: desc })
    }
  }
  return { onlyInExisting, modified, onlyInIncoming }
}