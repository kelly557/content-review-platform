import { useEffect, useState } from 'react'
import {
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
} from 'antd'
import {
  CheckCircleFilled,
  CloseCircleFilled,
  ExclamationCircleOutlined,
} from '@ant-design/icons'
import { getPresetSamples, runTest, type TestResult, type TestSample } from '@/api/agentTestRun'

const { Text, Title } = Typography
const { TextArea } = Input

export interface AgentTestRunDrawerProps {
  open: boolean
  onClose: () => void
  modality: '文本' | '图像' | '图文'
  agentName: string
  points: { id: string; label: string }[]
  ready: boolean
}

export default function AgentTestRunDrawer({
  open,
  onClose,
  modality,
  agentName,
  points,
  ready,
}: AgentTestRunDrawerProps) {
  const [mode, setMode] = useState<'single' | 'multi'>('single')
  const [text, setText] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<TestResult | null>(null)
  const presets = getPresetSamples()

  useEffect(() => {
    if (open) {
      setText('')
      setResult(null)
      setRunning(false)
      setMode('single')
    }
  }, [open])

  const charCount = text.length
  const maxLen = 600

  const handleRun = async () => {
    if (!text.trim()) return
    setRunning(true)
    setResult(null)
    try {
      const r = await runTest({ modality, text, mode, points })
      setResult(r)
    } finally {
      setRunning(false)
    }
  }

  const handleReset = () => {
    setText('')
    setResult(null)
  }

  const handlePreset = (s: TestSample) => {
    setText(s.content)
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

        <Space style={{ marginTop: 16 }}>
          {!ready ? (
            <Tooltip title="请先选择大模型并填写至少一条审核点后再测试">
              <Button type="primary" disabled icon={<ExclamationCircleOutlined />}>
                测试
              </Button>
            </Tooltip>
          ) : (
            <Button type="primary" loading={running} disabled={!text.trim()} onClick={handleRun}>
              测试
            </Button>
          )}
          <Button onClick={handleReset} disabled={running}>
            重置
          </Button>
          <Text type="secondary">字符数：{charCount}/{maxLen}</Text>
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

function ResultPanel({ result, modality }: { result: TestResult; modality: '文本' | '图像' | '图文' }) {
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