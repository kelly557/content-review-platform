import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Drawer,
  Empty,
  Input,
  Space,
  Spin,
  Tag,
  Typography,
  Upload,
  App,
} from 'antd'
import { PlayCircleOutlined, UploadOutlined } from '@ant-design/icons'
import {
  runModelTest,
  type ModelTestResponse,
} from '@/api/modelTest'
import {
  SMALL_MODEL_MODALITY_LABEL,
  type AuditPointEntry,
  type SmallModelModality,
} from '@/types/domain'

interface Props {
  open: boolean
  onClose: () => void
  modality: SmallModelModality | undefined
  modelName?: string
  categoryLabel?: string
  auditPoints: AuditPointEntry[]
}

export default function ModelTestDrawer({
  open,
  onClose,
  modality,
  modelName,
  categoryLabel,
  auditPoints,
}: Props) {
  const { message } = App.useApp()
  const [inputText, setInputText] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<ModelTestResponse | null>(null)
  const lastRunRef = useRef(0)

  useEffect(() => {
    if (!open) return
    setInputText('')
    setImageFile(null)
    setResult(null)
    lastRunRef.current = 0
  }, [open])

  const handleRun = async () => {
    if (!modality) {
      message.warning('尚未选择支持的素材类型')
      return
    }
    if (modality === 'text' && !inputText.trim()) {
      message.warning('请输入测试文本')
      return
    }
    if (modality === 'image' && !imageFile) {
      message.warning('请上传测试图片')
      return
    }

    const pointsToUse = auditPoints ?? []
    const runId = lastRunRef.current + 1
    lastRunRef.current = runId
    setRunning(true)
    setResult(null)
    try {
      const r = await runModelTest({
        modality,
        inputText: modality === 'text' ? inputText.trim() : undefined,
        imageFile: modality === 'image' ? imageFile ?? undefined : undefined,
        auditPoints: pointsToUse.map((p) => ({ label: p.label })),
      })
      if (runId !== lastRunRef.current) return
      setResult(r)
    } catch (e) {
      if (runId !== lastRunRef.current) return
      const detail = (e as { message?: string })?.message ?? '测试失败'
      message.error(detail)
    } finally {
      if (runId === lastRunRef.current) setRunning(false)
    }
  }

  const headerSubtitle = [
    modelName ? `模型：${modelName}` : null,
    modality ? `素材：${SMALL_MODEL_MODALITY_LABEL[modality]}` : null,
    categoryLabel ? `风险类型：${categoryLabel}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <Drawer
      title="测试模型输出"
      open={open}
      onClose={onClose}
      width={520}
      destroyOnClose
      mask={false}
      rootClassName="model-test-drawer"
      extra={
        <Space>
          <Button onClick={onClose}>关闭</Button>
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            loading={running}
            onClick={handleRun}
          >
            运行测试
          </Button>
        </Space>
      }
    >
      {headerSubtitle && (
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          {headerSubtitle}
        </Typography.Text>
      )}

      {auditPoints.length === 0 && (
        <Alert
          type="warning"
          showIcon
          message="该模型尚未配置审核点，将以无标签模式测试"
          style={{ marginBottom: 12 }}
        />
      )}

      <Typography.Title level={5} style={{ marginTop: 0 }}>
        测试输入
      </Typography.Title>

      {modality === 'text' && (
        <Input.TextArea
          rows={6}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="输入待检测文本…"
          maxLength={64_000}
          showCount
        />
      )}

      {modality === 'image' && (
        <Upload
          beforeUpload={(file) => {
            if (file.size > 10 * 1024 * 1024) {
              message.error('图片大小不能超过 10MB')
              return Upload.LIST_IGNORE
            }
            setImageFile(file)
            return false
          }}
          onRemove={() => {
            setImageFile(null)
            return true
          }}
          fileList={
            imageFile
              ? [
                  {
                    uid: '1',
                    name: imageFile.name,
                    status: 'done',
                  } as never,
                ]
              : []
          }
          maxCount={1}
          accept="image/*"
        >
          <Button icon={<UploadOutlined />} block>
            选择图片
          </Button>
        </Upload>
      )}

      {!modality && (
        <Empty description="父表单尚未选择支持的素材类型" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      )}

      <Typography.Title level={5} style={{ marginTop: 16 }}>
        测试输出
      </Typography.Title>

      {running && (
        <div style={{ padding: '32px 0', textAlign: 'center' }}>
          <Spin tip="正在调用模型…" />
        </div>
      )}

      {!running && !result && (
        <Empty description="点击「运行测试」开始" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      )}

      {!running && result && (
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Space wrap>
            <Tag color={result.decision === 'block' ? 'red' : 'green'}>
              {result.decision === 'block' ? '拦截' : '通过'}
            </Tag>
            <Tag>耗时 {result.latencyMs} ms</Tag>
            <Tag color="blue">平均置信度 {result.confidence}</Tag>
          </Space>

          {result.results.length > 0 && (
            <div>
              <Typography.Text type="secondary">审核点判定</Typography.Text>
              <div style={{ marginTop: 6 }}>
                {result.results.map((r) => (
                  <Tag
                    key={r.point}
                    color={r.triggered ? 'red' : 'default'}
                    style={{ marginBottom: 4 }}
                  >
                    {r.triggered ? '●' : '○'} {r.point}
                    {r.triggered ? ` · ${r.confidence}` : ''}
                  </Tag>
                ))}
              </div>
            </div>
          )}

          <div>
            <Typography.Text type="secondary">原始输出</Typography.Text>
            <Input.TextArea
              readOnly
              rows={8}
              value={result.rawOutput}
              style={{ marginTop: 6, fontFamily: 'monospace' }}
            />
          </div>
        </Space>
      )}
    </Drawer>
  )
}
