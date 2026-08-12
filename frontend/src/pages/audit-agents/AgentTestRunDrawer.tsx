import { useEffect, useState } from 'react'
import {
  App,
  Button,
  Card,
  Drawer,
  Input,
  Progress,
  Radio,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from 'antd'
import {
  CheckCircleFilled,
  CloseCircleFilled,
  ExclamationCircleOutlined,
  InboxOutlined,
} from '@ant-design/icons'
import { getPresetSamples, runTest, type TestResult, type TestSample } from '@/api/agentTestRun'

const { Text, Title } = Typography
const { TextArea } = Input

export interface AgentTestRunDrawerProps {
  open: boolean
  onClose: () => void
  modality: '文本' | '图片' | '图文'
  /** 后端数值 id（字符串形式）。新建草稿态可能为空。 */
  agentId?: string
  agentName: string
  points: { id: string; label: string }[]
  ready: boolean
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '')
      resolve(dataUrl)
    }
    reader.readAsDataURL(file)
  })
}

export default function AgentTestRunDrawer({
  open,
  onClose,
  modality,
  agentId,
  agentName,
  points,
  ready,
}: AgentTestRunDrawerProps) {
  const { message } = App.useApp()
  const [mode, setMode] = useState<'single' | 'multi'>('single')
  const [text, setText] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imageBase64, setImageBase64] = useState<string>('')
  const [imagePreview, setImagePreview] = useState<string>('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<TestResult | null>(null)
  const presets = getPresetSamples()

  const isImage = modality === '图片' || modality === '图文'

  useEffect(() => {
    if (open) {
      setText('')
      setImageFile(null)
      setImageBase64('')
      setImagePreview('')
      setResult(null)
      setRunning(false)
      setMode('single')
    }
  }, [open])

  const charCount = text.length
  const maxLen = 600

  const canRun = isImage ? !!imageBase64 : !!text.trim()

  const handleRun = async () => {
    if (!canRun) return
    if (!agentId) {
      message.warning('请先保存智能体后再测试')
      return
    }
    setRunning(true)
    setResult(null)
    try {
      const r = await runTest({
        agentId,
        modality,
        text,
        imageBase64: imageBase64 || undefined,
        mode,
        points,
      })
      setResult(r)
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail ?? '测试失败')
    } finally {
      setRunning(false)
    }
  }

  const handleReset = () => {
    setText('')
    setImageFile(null)
    setImageBase64('')
    setImagePreview('')
    setResult(null)
  }

  const handlePreset = (s: TestSample) => {
    setText(s.content)
  }

  const handleImageSelect = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      message.error('仅支持图片文件 (jpg/png/webp 等)')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      message.error('图片大小超过 10MB 限制')
      return
    }
    setImageFile(file)
    try {
      const b64 = await fileToBase64(file)
      setImageBase64(b64)
      setImagePreview(b64)
      message.success(`已选择 ${file.name}`)
    } catch {
      message.error('读取图片失败')
    }
  }

  return (
    <Drawer
      title="效果测试"
      placement="right"
      width="50vw"
      open={open}
      onClose={onClose}
      mask={false}
      destroyOnHidden
    >
      <Title level={5} style={{ margin: '0 0 12px' }}>
        {agentName || '未命名智能体'}
      </Title>

      <Card
        size="small"
        title={<span style={{ borderLeft: '3px solid #1677FF', paddingLeft: 8 }}>测试输入</span>}
        style={{ marginBottom: 16 }}
        styles={{ body: { padding: 16 } }}
      >
        {isImage ? (
          <>
            {/* 图片/图文模态: 图片上传 */}
            <Space style={{ marginBottom: 12 }}>
              <Text strong>上传图片：</Text>
            </Space>
            <Upload.Dragger
              accept="image/*"
              multiple={false}
              beforeUpload={(file) => {
                handleImageSelect(file)
                return false
              }}
              showUploadList={false}
              style={{ marginBottom: 8 }}
            >
              <p>
                <InboxOutlined style={{ fontSize: 28, color: '#1677FF' }} />
              </p>
              <p>点击或拖拽图片到此处上传</p>
              <p style={{ fontSize: 12, color: '#999' }}>支持 jpg / png / webp，不超过 10MB</p>
            </Upload.Dragger>

            {imagePreview && (
              <div style={{ marginTop: 12 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {imageFile?.name} ({((imageFile?.size ?? 0) / 1024).toFixed(1)} KB)
                </Text>
                <div
                  style={{
                    marginTop: 8,
                    border: '1px solid #F0F0F0',
                    borderRadius: 6,
                    overflow: 'hidden',
                    maxWidth: 300,
                  }}
                >
                  <img
                    src={imagePreview}
                    alt="预览"
                    style={{ width: '100%', display: 'block' }}
                  />
                </div>
              </div>
            )}

            {/* 图文模态: 补充可选文本 */}
            {modality === '图文' && (
              <div style={{ marginTop: 16 }}>
                <Space style={{ marginBottom: 8 }}>
                  <Text strong>补充文本（可选）：</Text>
                </Space>
                <TextArea
                  rows={4}
                  value={text}
                  onChange={(e) => setText(e.target.value.slice(0, maxLen))}
                  maxLength={maxLen}
                  showCount={{ formatter: ({ count }) => `${count}/${maxLen}` }}
                  placeholder="可选: 输入图片中的文字说明或待审核文案"
                  style={{ resize: 'vertical' }}
                />
              </div>
            )}
          </>
        ) : (
          <>
            {/* 文本模态: 纯文本输入 */}
            <Space style={{ marginBottom: 12 }}>
              <Text strong>审核文本：</Text>
              <Radio.Group value={mode} onChange={(e) => setMode(e.target.value)}>
                <Radio value="single">单条文本</Radio>
                <Radio value="multi">多条文本</Radio>
              </Radio.Group>
            </Space>

            <TextArea
              rows={8}
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, maxLen))}
              maxLength={maxLen}
              showCount={{ formatter: ({ count }) => `${count}/${maxLen}` }}
              placeholder={
                mode === 'single'
                  ? '请输入需要审核的文本内容，单条文本，最多可以输入600字'
                  : '请输入需要审核的文本内容，多条文本请用换行分隔，每行最多 600 字'
              }
              style={{ resize: 'vertical' }}
            />

            <Space wrap style={{ marginTop: 12 }}>
              <Text type="secondary">预置样本：</Text>
              {presets.map((s) => (
                <Button key={s.id} size="small" onClick={() => handlePreset(s)}>
                  {s.label}
                </Button>
              ))}
            </Space>
          </>
        )}

        <Space style={{ marginTop: 16 }}>
          {!ready ? (
            <Tooltip title="请先选择大模型并填写至少一条审核点后再测试">
              <Button type="primary" disabled icon={<ExclamationCircleOutlined />}>
                测试
              </Button>
            </Tooltip>
          ) : (
            <Button type="primary" loading={running} disabled={!canRun} onClick={handleRun}>
              测试
            </Button>
          )}
          <Button onClick={handleReset} disabled={running}>
            重置
          </Button>
          {!isImage && (
            <Text type="secondary">字符数：{charCount}/{maxLen}</Text>
          )}
        </Space>
      </Card>

      <Card
        size="small"
        title={<span style={{ borderLeft: '3px solid #1677FF', paddingLeft: 8 }}>测试结果</span>}
        styles={{ body: { padding: 16 } }}
      >
        {!result && !running && (
          <div style={{ textAlign: 'center', color: '#94A3B8', padding: '24px 0' }}>
            点击「测试」开始效果验证
          </div>
        )}
        {running && (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <Spin tip="模型推理中…" />
          </div>
        )}
        {result && <ResultPanel result={result} modality={modality} />}
      </Card>
    </Drawer>
  )
}

function ResultPanel({ result, modality }: { result: TestResult; modality: '文本' | '图片' | '图文' }) {
  const triggered = result.triggered.filter((t) => t.triggered)
  const notTriggered = result.triggered.filter((t) => !t.triggered)
  const passed = result.decision === 'pass'

  return (
    <div>
      <Space size={12} align="center" wrap>
        {passed ? (
          <Tag color="success" icon={<CheckCircleFilled />}>
            通过
          </Tag>
        ) : (
          <Tag color="error" icon={<CloseCircleFilled />}>
            拒绝
          </Tag>
        )}
        <Text type="secondary">总耗时 {(result.latencyMs / 1000).toFixed(1)}s</Text>
        <Text type="secondary">模态：{modality}</Text>
      </Space>

      <div style={{ marginTop: 12, marginBottom: 16 }}>
        <Space size={8} align="center">
          <Text type="secondary">置信度</Text>
          <Progress
            percent={Math.round(result.confidence)}
            size="small"
            style={{ width: 220 }}
            status={passed ? 'success' : 'exception'}
          />
          <Text>{result.confidence}%</Text>
        </Space>
      </div>

      <div style={{ marginBottom: 16 }}>
        <Text strong style={{ display: 'block', marginBottom: 8 }}>
          触发审核点（{triggered.length} / {result.triggered.length}）
        </Text>
        <Space direction="vertical" size={6} style={{ width: '100%' }}>
          {triggered.map((t) => (
            <Space key={t.pointId} size={6}>
              <CheckCircleFilled style={{ color: '#FF4D4F' }} />
              <Text>{t.label}</Text>
              <Tag color="error" style={{ marginLeft: 4 }}>
                命中
              </Tag>
            </Space>
          ))}
          {notTriggered.map((t) => (
            <Space key={t.pointId} size={6}>
              <CloseCircleFilled style={{ color: '#BFBFBF' }} />
              <Text type="secondary">{t.label}</Text>
              <Tag style={{ marginLeft: 4 }}>未命中</Tag>
            </Space>
          ))}
          {result.triggered.length === 0 && (
            <Text type="secondary">未配置审核点</Text>
          )}
        </Space>
      </div>

      <div>
        <Text strong style={{ display: 'block', marginBottom: 8 }}>
          模型原始输出
        </Text>
        <pre
          style={{
            background: '#F5F7FA',
            padding: 12,
            borderRadius: 6,
            fontSize: 12,
            lineHeight: 1.6,
            overflow: 'auto',
            maxHeight: 240,
            margin: 0,
          }}
        >
          {result.rawOutput}
        </pre>
      </div>
    </div>
  )
}
