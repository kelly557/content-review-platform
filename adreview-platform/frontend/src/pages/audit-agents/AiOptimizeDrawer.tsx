import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  Collapse,
  Drawer,
  Input,
  Radio,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import {
  CloseOutlined,
  CopyOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import AgentParsePanel from './AgentParsePanel'
import AgentFileViewerModal from './AgentFileViewerModal'
import {
  downloadFile,
  genDocId,
  runMockParse,
  validateFile,
  type AgentParseDocument,
} from '@/api/agentParseDocs'

const { Title, Text } = Typography
const { TextArea } = Input

export interface AiOptimizeResult {
  original: string
  issues: { label: string; text: string }[]
  checklist: string[]
  scenarioNote: string
  cases: { note: string; examples: { kind: 'compliant' | 'violation'; text: string }[] }
  direction: string
  finalTag: { name: string; description: string }
}

interface AiOptimizeDrawerProps {
  open: boolean
  onClose: () => void
  onAddConfig: (cfg: { label: string; desc: string }) => void
  initialOriginal?: string
  rowsCount: number
}

const MAX_DIRECTION_LEN = 200
const MAX_RULE_TEXT_LEN = 10000
const MAX_SAMPLES_PER_KIND = 50
const MAX_SAMPLE_LINE_LEN = 600
const DIRECTION_PLACEHOLDER =
  '请简要概括待检测业务场景、检测目标以及检测范围。如:检测信贷营销场景中,AI客服/机器人对申请中用户做出的利率预估、额度承诺、征信误导等违规内容'

function buildMockResult(
  direction: string,
  original: string,
  docsContext: string,
): AiOptimizeResult {
  void direction
  void docsContext
  return {
    original,
    issues: [
      {
        label: '模糊且不合规',
        text:
          '未锚定《药品管理法》具体条款,尤其是第八章"药品价格和广告"——这是广告合规的核心依据。法条明确要求药品广告必须显著标明"请按药品说明书或者在药师指导下购买和使用"(第82条),且不得含有表示功效、安全性的断言或保证(第87条)。',
      },
      {
        label: '混淆概念',
        text:
          '"claims and evidence"是科研/循证医学术语,非法使用语境;《药品管理法》中对应的是"适应症、功能主治、用法用量"等核准内容(第49条),以及禁止"暗示、示疗效""利用患者形象作证明"等行为(第87条)。OTC广告无需"绑定证据",但必须严格限定于注册说明书范围,且须标注忠告语。',
      },
    ],
    checklist: [
      '是否为OTC药品(需查验"OTC"标识或国药准字Z/H后续+非处方药标识)',
      '是否出现未经批准的适应症、功效宣称(如"根治""速效""无副作用")',
      '是否缺失法定忠告语(第82条强制要求)',
      '是否使用患者/专家形象、比较性用语、绝对化用语(第87条禁止情形)',
    ],
    scenarioNote:
      '任务背景是"医药广告引流检测",即识别以广告形式诱导用户跳转购买的行为。违规本质是"通过违规话术促成交易转化",而非单纯内容不完整。因此描述必须聚焦引流动作中的违法要素:如夸大功效诱导点击、隐瞒禁忌诱导购买、未标忠告语即引导下单等。',
    cases: {
      note: '案例为空("违规样本:\n正常样本:"),但结合任务背景可推知典型违规模式:',
      examples: [
        {
          kind: 'compliant',
          text: '"xx牌蚊虫抑颗粒(OTC),用于风热感冒引起的发热、咽喉肿痛。请按说明书或药师指导使用。"',
        },
        {
          kind: 'violation',
          text: '"三天退烧!儿童服用零副作用!点击立即抢购→"(含绝对化用语+安全性断言+无禁忌语+诱导性CTA)',
        },
      ],
    },
    direction:
      '将标签重定义为明确指向OTC药品广告中违反《药品管理法》第八章第82、87条的具体引流违规行为,强调"法定忠告语缺失""功效断言""诱导性话术"三大硬性红线,剔除"evidence"等无关术语,紧扣"引流"这一动作场景。',
    finalTag: {
      name: '医药_OTC引流违规',
      description:
        'OTC药品广告中存在功效/安全性断言(如"根治""无副作用")、绝对化用语(如"第一""唯一"),且未显著标注"请按说明书或在药师指导下购买和使用"忠告语,并含"点击抢购""立即领取"等引流词',
    },
  }
}

function resultToPlainText(r: AiOptimizeResult): string {
  const lines: string[] = []
  lines.push(`原始标签描述:${r.original}存在严重问题:`)
  r.issues.forEach((it) => {
    lines.push(`${it.label}:${it.text}`)
  })
  lines.push('遗漏关键判断维度:')
  r.checklist.forEach((c) => lines.push(`· ${c}`))
  lines.push(r.scenarioNote)
  lines.push(r.cases.note)
  r.cases.examples.forEach((e) => {
    const prefix = e.kind === 'compliant' ? '合规' : '违规'
    lines.push(`${prefix}:${e.text}`)
  })
  lines.push(r.direction)
  lines.push('最终标签需满足:')
  lines.push(`· 名称精简(≤15字符):"${r.finalTag.name}"`)
  lines.push(`· 描述严格限定在法律条文+可观察文本特征:${r.finalTag.description}`)
  return lines.join('\n')
}

export default function AiOptimizeDrawer({
  open,
  onClose,
  onAddConfig,
  initialOriginal,
  rowsCount,
}: AiOptimizeDrawerProps) {
  const { message } = App.useApp()
  const [direction, setDirection] = useState('')
  const [ruleSource, setRuleSource] = useState<'file' | 'text'>('file')
  const [ruleText, setRuleText] = useState('')
  const [normalSamples, setNormalSamples] = useState('')
  const [violationSamples, setViolationSamples] = useState('')
  const [documents, setDocuments] = useState<AgentParseDocument[]>([])
  const [viewingDoc, setViewingDoc] = useState<AgentParseDocument | null>(null)
  const [result, setResult] = useState<AiOptimizeResult | null>(null)
  const [generating, setGenerating] = useState(false)

  const originalLabel =
    initialOriginal?.trim() || '医药专项:OTC药物发布需要绑定claims和evidence'

  useEffect(() => {
    if (!open) {
      setDirection('')
      setRuleSource('file')
      setRuleText('')
      setNormalSamples('')
      setViolationSamples('')
      setDocuments([])
      setViewingDoc(null)
      setResult(null)
      setGenerating(false)
    }
  }, [open])

  const updateDoc = (id: string, patch: Partial<AgentParseDocument>) => {
    setDocuments((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)))
  }

  const handleAddFiles = (files: File[]) => {
    const valid: AgentParseDocument[] = []
    for (const file of files) {
      const err = validateFile(file)
      if (err) {
        message.error(`${file.name}:${err}`)
        continue
      }
      valid.push({
        id: genDocId(),
        file,
        name: file.name,
        size: file.size,
        status: 'parsing',
        progress: 0,
        startedAt: Date.now(),
      })
    }
    if (valid.length === 0) return
    setDocuments((prev) => [...valid, ...prev])

    valid.forEach((doc) => {
      runMockParse(doc, {
        onProgress: (p) => updateDoc(doc.id, { progress: p }),
      })
        .then(async (r) => {
          if (r.status === 'success' && r.preview != null) {
            updateDoc(doc.id, {
              status: 'success',
              progress: 100,
              preview: r.preview,
              charCount: r.charCount,
              durationMs: r.durationMs,
            })
          } else if (r.status === 'failed') {
            updateDoc(doc.id, {
              status: 'failed',
              progress: 100,
              message: r.message,
              durationMs: r.durationMs,
            })
            message.error(`${doc.name} 解析失败:${r.message}`)
          }
        })
        .catch((e) => {
          updateDoc(doc.id, { status: 'failed', message: String(e) })
          message.error(`${doc.name} 解析异常`)
        })
    })
  }

  const handleRetry = (docId: string) => {
    const doc = documents.find((d) => d.id === docId)
    if (!doc) return
    updateDoc(docId, { status: 'parsing', progress: 0, message: undefined, startedAt: Date.now() })
    runMockParse(doc, {
      onProgress: (p) => updateDoc(docId, { progress: p }),
    })
      .then(async (r) => {
        if (r.status === 'success' && r.preview != null) {
          updateDoc(docId, {
            status: 'success',
            progress: 100,
            preview: r.preview,
            charCount: r.charCount,
            durationMs: r.durationMs,
          })
          message.success(`${doc.name} 解析成功`)
        } else if (r.status === 'failed') {
          updateDoc(docId, {
            status: 'failed',
            progress: 100,
            message: r.message,
            durationMs: r.durationMs,
          })
          message.error(`${doc.name} 解析失败:${r.message}`)
        }
      })
      .catch((e) => {
        updateDoc(docId, { status: 'failed', message: String(e) })
        message.error(`${doc.name} 解析异常`)
      })
  }

  const handleRemoveDoc = (docId: string) => {
    setDocuments((prev) => prev.filter((d) => d.id !== docId))
  }

  const handleDownloadDoc = (doc: AgentParseDocument) => {
    downloadFile(doc)
    message.success(`已下载 ${doc.name}`)
  }

  const handleReset = () => {
    setDirection('')
    setRuleText('')
    setNormalSamples('')
    setViolationSamples('')
    setDocuments([])
    setResult(null)
    message.info('已重置(原型)')
  }

  const handleOptimize = () => {
    if (!direction.trim()) {
      message.warning('请填写「补充优化方向」')
      return
    }
    setGenerating(true)
    const successDocs = documents.filter((d) => d.status === 'success')
    const docsContext = successDocs
      .map((d) => `[${d.name}]\n${(d.preview ?? '').slice(0, 1000)}`)
      .join('\n\n')
    window.setTimeout(() => {
      const next = buildMockResult(direction.trim(), originalLabel, docsContext)
      setResult(next)
      setGenerating(false)
      message.success(
        successDocs.length > 0
          ? `已生成 AI 优化结果(原型,引用 ${successDocs.length} 份解析文档)`
          : '已生成 AI 优化结果(原型)',
      )
    }, 800)
  }

  const handleCopy = async () => {
    if (!result) return
    const text = resultToPlainText(result)
    try {
      await navigator.clipboard.writeText(text)
      message.success('已复制到剪贴板')
    } catch {
      message.error('复制失败,请手动复制')
    }
  }

  const handleAddConfig = () => {
    if (!result) {
      message.warning('请先点击「AI 优化」生成结果')
      return
    }
    if (rowsCount <= 0) {
      message.warning('请先添加至少一个审核点')
      return
    }
    onAddConfig({ label: result.finalTag.name, desc: result.finalTag.description })
  }

  const samplesLineCount = useMemo(() => (s: string) => s.split('\n').filter(Boolean).length, [])
  const normalCount = samplesLineCount(normalSamples)
  const violationCount = samplesLineCount(violationSamples)

  return (
    <Drawer
      open={open}
      onClose={onClose}
      placement="right"
      width="50vw"
      mask={false}
      destroyOnHidden
      closeIcon={<CloseOutlined aria-label="关闭 AI 优化抽屉" />}
      title="AI优化提示词"
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" onClick={handleAddConfig} disabled={!result}>
            添加配置
          </Button>
        </div>
      }
    >
<div style={{ padding: '4px 4px 8px' }}>
        <Space size={6} align="center" style={{ marginBottom: 12 }}>
          <Title level={5} style={{ margin: 0 }}>
            AI优化提示词
          </Title>
          <Tag color="purple">公测</Tag>
          <Tooltip title="名称（仅展示）">
            <Button size="small" type="text" icon={<ThunderboltOutlined />} aria-label="名称" />
          </Tooltip>
        </Space>

        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={
            <div>
              <div>1. 在此处可以补充相应业务信息，通过AI进行提示词的生成或优化。补充信息越详细，通常会有越好的效果。</div>
              <div>2. 此页面功能公测期间暂不计费，单个账号每天最多支持请求20次。</div>
            </div>
          }
        />

        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 6 }}>
            <Text type="danger">*</Text> <Text strong>补充优化方向(必填)</Text>
          </div>
          <TextArea
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
            placeholder={DIRECTION_PLACEHOLDER}
            maxLength={MAX_DIRECTION_LEN}
            showCount
            autoSize={{ minRows: 3, maxRows: 6 }}
          />
        </div>

        <Collapse
          ghost
          style={{ marginBottom: 12 }}
          items={[
            {
              key: 'rules',
              label: '补充审核规则(可选)',
              children: (
                <div>
                  <Radio.Group
                    value={ruleSource}
                    onChange={(e) => setRuleSource(e.target.value)}
                    style={{ marginBottom: 12 }}
                  >
                    <Radio value="file">上传本地文件</Radio>
                    <Radio value="text">输入文本内容</Radio>
                  </Radio.Group>

                  {ruleSource === 'file' ? (
                    <AgentParsePanel
                      documents={documents}
                      onAdd={handleAddFiles}
                      onRetry={handleRetry}
                      onRemove={handleRemoveDoc}
                      onDownload={handleDownloadDoc}
                      onView={(doc) => setViewingDoc(doc)}
                    />
                  ) : (
                    <TextArea
                      value={ruleText}
                      onChange={(e) => setRuleText(e.target.value.slice(0, MAX_RULE_TEXT_LEN))}
                      placeholder="请输入审核规则文本内容"
                      maxLength={MAX_RULE_TEXT_LEN}
                      showCount
                      autoSize={{ minRows: 4, maxRows: 10 }}
                    />
                  )}
                </div>
              ),
            },
            {
              key: 'samples',
              label: '补充样本示例(可选)',
              children: (
                <div>
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ marginBottom: 6 }}>
                      <Text strong>正常样本</Text>
                    </div>
                    <TextArea
                      value={normalSamples}
                      onChange={(e) => {
                        const lines = e.target.value.split('\n')
                        const capped = lines
                          .map((l) => l.slice(0, MAX_SAMPLE_LINE_LEN))
                          .slice(0, MAX_SAMPLES_PER_KIND)
                          .join('\n')
                        setNormalSamples(capped)
                      }}
                      placeholder="请输入正常样本,多个文本可以以换行分割,每行文本不超过600字,最多可输入50行文本内容。"
                      maxLength={MAX_SAMPLES_PER_KIND * MAX_SAMPLE_LINE_LEN}
                      showCount
                      autoSize={{ minRows: 4, maxRows: 8 }}
                    />
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {normalCount} / {MAX_SAMPLES_PER_KIND}
                    </Text>
                  </div>

                  <div>
                    <div style={{ marginBottom: 6 }}>
                      <Text strong>违规样本</Text>
                    </div>
                    <TextArea
                      value={violationSamples}
                      onChange={(e) => {
                        const lines = e.target.value.split('\n')
                        const capped = lines
                          .map((l) => l.slice(0, MAX_SAMPLE_LINE_LEN))
                          .slice(0, MAX_SAMPLES_PER_KIND)
                          .join('\n')
                        setViolationSamples(capped)
                      }}
                      placeholder="请输入违规样本,多个文本可以以换行分割,每行文本不超过600字,最多可输入50行文本内容。"
                      maxLength={MAX_SAMPLES_PER_KIND * MAX_SAMPLE_LINE_LEN}
                      showCount
                      autoSize={{ minRows: 4, maxRows: 8 }}
                    />
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {violationCount} / {MAX_SAMPLES_PER_KIND}
                    </Text>
                  </div>
                </div>
              ),
            },
          ]}
        />

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            marginBottom: 16,
          }}
        >
          <Button icon={<ReloadOutlined />} onClick={handleReset}>
            重置
          </Button>
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            loading={generating}
            onClick={handleOptimize}
          >
            AI 优化
          </Button>
        </div>

        {result && (
          <div style={{ marginBottom: 16 }}>
            <Card
              size="small"
              title={
                <Space size={6} align="center">
                  <Text strong>AI优化结果</Text>
                  <Tooltip title="复制全文">
                    <Button
                      size="small"
                      type="text"
                      icon={<CopyOutlined />}
                      onClick={handleCopy}
                      aria-label="复制结果"
                    />
                  </Tooltip>
                </Space>
              }
              extra={
                <Button size="small" type="primary" onClick={handleAddConfig}>
                  + 添加配置
                </Button>
              }
              styles={{ body: { padding: 16, maxHeight: 360, overflowY: 'auto' } }}
            >
              <ResultContent result={result} />
            </Card>

            <Table
              size="small"
              pagination={false}
              rowKey="label"
              style={{ marginTop: 12 }}
              dataSource={[{ label: result.finalTag.name, desc: result.finalTag.description }]}
              columns={[
                { title: '审核点', dataIndex: 'label', width: '28%' },
                { title: '审核描述', dataIndex: 'desc' },
              ]}
            />
          </div>
        )}
      </div>

      <AgentFileViewerModal
        open={!!viewingDoc}
        doc={viewingDoc}
        onClose={() => setViewingDoc(null)}
        onDownload={handleDownloadDoc}
      />
    </Drawer>
  )
}

function ResultContent({ result }: { result: AiOptimizeResult }) {
  return (
    <div style={{ fontSize: 13, lineHeight: 1.8 }}>
      <p style={{ margin: '0 0 12px' }}>
        <Text type="secondary">
          原始标签描述:<Text strong>{result.original}</Text>存在严重问题:
        </Text>
      </p>
      {result.issues.map((it, i) => (
        <p key={i} style={{ margin: '0 0 12px' }}>
          <Text strong>{it.label}:</Text>
          <span>{it.text}</span>
        </p>
      ))}
      <p style={{ margin: '0 0 4px' }}>
        <Text strong>遗漏关键判断维度:</Text>
      </p>
      <ul style={{ paddingLeft: 20, margin: '0 0 12px' }}>
        {result.checklist.map((c, i) => (
          <li key={i}>{c}</li>
        ))}
      </ul>
      <p style={{ margin: '0 0 12px' }}>{result.scenarioNote}</p>
      <p style={{ margin: '0 0 8px' }}>
        <Text strong>{result.cases.note}</Text>
      </p>
      <ul style={{ listStyle: 'none', paddingLeft: 0, margin: '0 0 12px' }}>
        {result.cases.examples.map((e, i) => (
          <li key={i} style={{ marginBottom: 6 }}>
            {e.kind === 'compliant' ? (
              <CheckCircleIcon />
            ) : (
              <CloseCircleIcon />
            )}
            <Text strong>{e.kind === 'compliant' ? '合规' : '违规'}:</Text>
            <span>{e.text}</span>
          </li>
        ))}
      </ul>
      <p style={{ margin: '0 0 12px' }}>
        <Text strong>优化方向:</Text>
        <span>{result.direction}</span>
      </p>
      <p style={{ margin: '0 0 4px' }}>
        <Text strong>最终标签需满足:</Text>
      </p>
      <ul style={{ paddingLeft: 20, margin: 0 }}>
        <li>
          名称精简(≤15字符):<Text strong>"{result.finalTag.name}"</Text>
        </li>
        <li>
          描述严格限定在法律条文+可观察文本特征:{result.finalTag.description}
        </li>
      </ul>
    </div>
  )
}

function CheckCircleIcon() {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        width: 14,
        height: 14,
        borderRadius: '50%',
        background: '#52c41a',
        color: '#fff',
        textAlign: 'center',
        lineHeight: '14px',
        marginRight: 6,
        fontSize: 11,
      }}
    >
      ✓
    </span>
  )
}

function CloseCircleIcon() {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        width: 14,
        height: 14,
        borderRadius: '50%',
        background: '#ff4d4f',
        color: '#fff',
        textAlign: 'center',
        lineHeight: '14px',
        marginRight: 6,
        fontSize: 11,
      }}
    >
      ✕
    </span>
  )
}