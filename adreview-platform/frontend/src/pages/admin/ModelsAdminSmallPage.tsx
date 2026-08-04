// 模型管理 / 小模型（mock 数据版本）
// 按 ASCII 设计稿实现：左 280px 列表 + 右详情（版本历史、模型标签、推荐风险阈值、引用标签、模型测试）。
// 数据来源：当前为前端 mock（无后端依赖），后续接 API 时替换 fetchList / fetchVersions / fetchRefs。
import { useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import {
  App,
  Alert,
  Button,
  Cascader,
  Divider,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { UploadFile } from 'antd/es/upload/interface'
import {
  ApiOutlined,
  DownOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  SearchOutlined,
  ExclamationCircleOutlined,
  UpOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import { useAuthStore } from '@/store'
import { runModelTest, type ModelTestResponse } from '@/api/modelTest'
import {
  runAccessCheck,
  type AccessCheckResult,
} from '@/api/modelAccessCheck'
import ModelConfigTagModal from '@/pages/admin/ModelConfigTagModal'
import type { ConfiguredTagEntry } from '@/pages/admin/configuredTagTypes'
import { findStrategiesByDiscoveredTag } from '@/lib/auditStrategyRefMock'

const { Text, Title } = Typography

// ── 模态选项（4 类） ──
const MODALITY_OPTIONS_4 = [
  { value: 'text', label: '文本' },
  { value: 'image', label: '图片' },
  { value: 'audio', label: '音频' },
  { value: 'video', label: '视频' },
] as const
type Modality4 = (typeof MODALITY_OPTIONS_4)[number]['value']
const MODALITY_LABEL_4: Record<Modality4, string> = MODALITY_OPTIONS_4.reduce(
  (acc, o) => ({ ...acc, [o.value]: o.label }),
  {} as Record<Modality4, string>,
)

// ── mock 数据类型 ──
type MockStatus = 'active' | 'inactive' | 'pending'
interface MockVersion {
  id: number
  versionLabel: string
  status: MockStatus
  releasedAt: string
}
interface MockRef {
  id: string
  path: string
}
interface MockModelTestRecord {
  decision: 'pass' | 'block'
  latencyMs: number
  confidence: number
  rawOutput: string
}
interface RiskThresholdRange {
  low: [number, number]
  mid: [number, number]
  high: [number, number]
}
interface MockModel {
  id: number
  name: string
  smallCategory: string
  modality: Modality4
  endpoint_url: string
  status: MockStatus
  createdAt: string
  currentVersion: MockVersion
  history: MockVersion[]
  refs: MockRef[]
  testHistory?: MockModelTestRecord[]
  riskThreshold?: RiskThresholdRange
  discoveredTags?: string[]
  configuredTags?: ConfiguredTagEntry[]
}

const MOCK_MODELS: MockModel[] = [
  {
    id: 1,
    name: 'leader_v1',
    smallCategory: 'politics',
    modality: 'image',
    endpoint_url: 'https://api.adreview.example.com/v1/leader',
    status: 'inactive',
    createdAt: '2025-03-10',
    currentVersion: {
      id: 100,
      versionLabel: 'v1',
      status: 'inactive',
      releasedAt: '2025-03-10',
    },
    history: [
      {
        id: 100,
        versionLabel: 'v1',
        status: 'inactive',
        releasedAt: '2025-03-10',
      },
    ],
    refs: [
      { id: 'r1', path: '涉政 / 一号领导 / 写实' },
      { id: 'r2', path: '涉政 / 二号领导 / 写实' },
    ],
    discoveredTags: [
      '涉政敏感人物',
      '公众人物',
      '暴恐血腥',
      '违规水印',
    ],
    configuredTags: [
      {
        discoveredTag: '涉政敏感人物',
        tagId: 'mock-l3-politics-top-leader-real',
        tagPath: '涉政 / 一号领导 / 写实',
      },
      {
        discoveredTag: '公众人物',
        tagId: 'mock-l3-politics-former-leader-figure',
        tagPath: '涉政 / 历任领导 / 人像',
      },
      {
        discoveredTag: '暴恐血腥',
        tagId: 'mock-l3-terror-org-image',
        tagPath: '暴恐 / 恐怖组织 / 画面',
      },
    ],
    testHistory: [
      {
        decision: 'block',
        latencyMs: 1832,
        confidence: 78.4,
        rawOutput: JSON.stringify(
          {
            decision: 'block',
            modality: 'image',
            image_provided: true,
            triggered_points: ['涉政 / 一号领导 / 写实'],
            latency_ms: 1832,
          },
          null,
          2,
        ),
      },
    ],
  },
  {
    id: 2,
    name: 'cartoon_model',
    smallCategory: 'politics',
    modality: 'image',
    endpoint_url: 'https://api.adreview.example.com/v1/cartoon',
    status: 'active',
    createdAt: '2025-05-18',
    currentVersion: {
      id: 302,
      versionLabel: 'v3',
      status: 'active',
      releasedAt: '2025-05-18',
    },
    history: [
      {
        id: 302,
        versionLabel: 'v3',
        status: 'active',
        releasedAt: '2025-05-18',
      },
      {
        id: 301,
        versionLabel: 'v2',
        status: 'inactive',
        releasedAt: '2025-04-22',
      },
      {
        id: 300,
        versionLabel: 'v1',
        status: 'inactive',
        releasedAt: '2025-03-10',
      },
    ],
    refs: [
      { id: 'r3', path: '涉政 / 一号领导 / 漫画' },
      { id: 'r4', path: '涉政 / 二号领导 / 漫画' },
      { id: 'r5', path: '涉政 / 领导人恶搞漫画' },
      { id: 'r6', path: '涉政 / 高级领导 / 漫画' },
      { id: 'r7', path: '涉政 / 政治漫画 / 时政' },
      { id: 'r8', path: '涉政 / 政治漫画 / 历史' },
      { id: 'r9', path: '涉政 / 卡通形象 / 领导人' },
      { id: 'r10', path: '涉政 / 卡通形象 / 名人' },
      { id: 'r11', path: '涉政 / 政治讽刺 / 漫画' },
      { id: 'r12', path: '涉政 / 政治讽刺 / 配图' },
    ],
    discoveredTags: ['涉政敏感人物', '色情低俗', '青少年不良', '商标侵权'],
    configuredTags: [
      {
        discoveredTag: '涉政敏感人物',
        tagId: 'mock-l3-politics-top-leader-cartoon',
        tagPath: '涉政 / 一号领导 / 漫画',
      },
      {
        discoveredTag: '色情低俗',
        tagId: 'mock-l3-politics-former-leader-cartoon',
        tagPath: '涉政 / 历任领导 / 漫画',
      },
      {
        discoveredTag: '青少年不良',
        tagId: 'mock-l3-politics-symbol-graffiti',
        tagPath: '涉政 / 政治象征 / 涂鸦',
      },
    ],
    testHistory: [
      {
        decision: 'pass',
        latencyMs: 2158,
        confidence: 87.5,
        rawOutput: JSON.stringify(
          {
            decision: 'pass',
            modality: 'image',
            image_provided: true,
            triggered_points: [],
            latency_ms: 2158,
          },
          null,
          2,
        ),
      },
    ],
    riskThreshold: {
      low: [0.2, 0.35],
      mid: [0.36, 0.74],
      high: [0.75, 1.0],
    },
  },
  {
    id: 3,
    name: 'flag_model',
    smallCategory: 'politics',
    modality: 'image',
    endpoint_url: 'https://api.adreview.example.com/v1/flag',
    status: 'active',
    createdAt: '2025-02-01',
    currentVersion: {
      id: 400,
      versionLabel: 'v2',
      status: 'active',
      releasedAt: '2025-06-30',
    },
    history: [
      {
        id: 400,
        versionLabel: 'v2',
        status: 'active',
        releasedAt: '2025-06-30',
      },
      {
        id: 401,
        versionLabel: 'v1',
        status: 'inactive',
        releasedAt: '2025-02-01',
      },
    ],
    refs: [
      { id: 'r20', path: '涉政 / 国旗国徽 / 篡改' },
      { id: 'r21', path: '涉政 / 国旗国徽 / 涂鸦' },
    ],
    discoveredTags: ['涉政敏感人物', '违规水印', '公众人物'],
    configuredTags: [
      {
        discoveredTag: '涉政敏感人物',
        tagId: 'mock-l3-politics-top-leader-illust',
        tagPath: '涉政 / 一号领导 / 配图',
      },
      {
        discoveredTag: '违规水印',
        tagId: 'mock-l3-politics-symbol-tamper',
        tagPath: '涉政 / 政治象征 / 篡改',
      },
    ],
    testHistory: [
      {
        decision: 'pass',
        latencyMs: 1623,
        confidence: 91.2,
        rawOutput: JSON.stringify(
          {
            decision: 'pass',
            modality: 'image',
            image_provided: true,
            triggered_points: [],
            latency_ms: 1623,
          },
          null,
          2,
        ),
      },
    ],
    riskThreshold: {
      low: [0.0, 0.25],
      mid: [0.26, 0.7],
      high: [0.71, 1.0],
    },
  },
  {
    id: 4,
    name: 'ocr_model',
    smallCategory: 'ad_law',
    modality: 'text',
    endpoint_url: 'https://api.adreview.example.com/v1/ocr',
    status: 'active',
    createdAt: '2025-01-15',
    currentVersion: {
      id: 500,
      versionLabel: 'v5',
      status: 'active',
      releasedAt: '2025-07-01',
    },
    history: [
      {
        id: 500,
        versionLabel: 'v5',
        status: 'active',
        releasedAt: '2025-07-01',
      },
      {
        id: 501,
        versionLabel: 'v4',
        status: 'inactive',
        releasedAt: '2025-05-10',
      },
      {
        id: 502,
        versionLabel: 'v3',
        status: 'inactive',
        releasedAt: '2025-04-05',
      },
      {
        id: 503,
        versionLabel: 'v2',
        status: 'inactive',
        releasedAt: '2025-03-20',
      },
      {
        id: 504,
        versionLabel: 'v1',
        status: 'inactive',
        releasedAt: '2025-01-15',
      },
    ],
    refs: [
      { id: 'r30', path: '广告法 / 极限词 / 识别' },
      { id: 'r31', path: '广告法 / 虚假宣传 / OCR' },
    ],
    discoveredTags: ['广告营销', '虚假宣传', '辱骂攻击', '隐私信息', '涉政敏感'],
    configuredTags: [
      {
        discoveredTag: '广告营销',
        tagId: 'mock-l3-ads-law-misleading-extreme',
        tagPath: '广告法 / 误导性虚假广告 / 极限词',
      },
      {
        discoveredTag: '虚假宣传',
        tagId: 'mock-l3-ads-law-misleading-promise',
        tagPath: '广告法 / 误导性虚假广告 / 虚假承诺',
      },
      {
        discoveredTag: '辱骂攻击',
        tagId: 'mock-l3-insult-regional-text',
        tagPath: '辱骂 / 地域歧视 / 文字',
      },
      {
        discoveredTag: '隐私信息',
        tagId: 'mock-l3-insult-person-text',
        tagPath: '辱骂 / 人格侮辱 / 文字',
      },
    ],
    testHistory: [
      {
        decision: 'pass',
        latencyMs: 945,
        confidence: 93.8,
        rawOutput: JSON.stringify(
          {
            decision: 'pass',
            modality: 'text',
            segments: ['本产品绝对有效，根治各种问题...'],
            image_provided: false,
            triggered_points: ['广告法 / 极限词 / 识别'],
            latency_ms: 945,
          },
          null,
          2,
        ),
      },
    ],
  },
  {
    id: 5,
    name: 'face_model',
    smallCategory: 'porn',
    modality: 'image',
    endpoint_url: 'https://api.adreview.example.com/v1/face',
    status: 'active',
    createdAt: '2024-12-20',
    currentVersion: {
      id: 600,
      versionLabel: 'v4',
      status: 'active',
      releasedAt: '2025-06-12',
    },
    history: [
      {
        id: 600,
        versionLabel: 'v4',
        status: 'active',
        releasedAt: '2025-06-12',
      },
      {
        id: 601,
        versionLabel: 'v3',
        status: 'inactive',
        releasedAt: '2025-04-20',
      },
      {
        id: 602,
        versionLabel: 'v2',
        status: 'inactive',
        releasedAt: '2025-02-10',
      },
      {
        id: 603,
        versionLabel: 'v1',
        status: 'inactive',
        releasedAt: '2024-12-20',
      },
    ],
    refs: [
      { id: 'r40', path: '涉黄 / 成人内容 / 面部' },
      { id: 'r41', path: '涉黄 / 表情包 / 露骨' },
    ],
    discoveredTags: ['色情低俗', '暴恐血腥', '青少年不良', '公众人物'],
    configuredTags: [
      {
        discoveredTag: '色情低俗',
        tagId: 'mock-l3-insult-regional-emoji',
        tagPath: '辱骂 / 地域歧视 / 表情包',
      },
      {
        discoveredTag: '暴恐血腥',
        tagId: 'mock-l3-insult-person-cartoon',
        tagPath: '辱骂 / 人格侮辱 / 卡通',
      },
      {
        discoveredTag: '青少年不良',
        tagId: 'mock-l3-terror-org-figure-avatar',
        tagPath: '暴恐 / 恐怖组织人物 / 头像',
      },
    ],
    testHistory: [
      {
        decision: 'pass',
        latencyMs: 2241,
        confidence: 88.1,
        rawOutput: JSON.stringify(
          {
            decision: 'pass',
            modality: 'image',
            image_provided: true,
            triggered_points: [],
            latency_ms: 2241,
          },
          null,
          2,
        ),
      },
    ],
    riskThreshold: {
      low: [0.15, 0.4],
      mid: [0.41, 0.8],
      high: [0.81, 1.0],
    },
  },
]

function statusTag(status: MockStatus) {
  if (status === 'active')
    return (
      <Tag
        style={{
          background: '#ECFDF5',
          borderColor: '#A7F3D0',
          color: '#047857',
          margin: 0,
        }}
      >
        ● 已发布
      </Tag>
    )
  if (status === 'pending')
    return (
      <Tag
        style={{
          background: '#FFF7ED',
          borderColor: '#FED7AA',
          color: '#C2410C',
          margin: 0,
        }}
      >
        ● 未发布
      </Tag>
    )
  return (
    <Tag
      style={{
        background: '#F1F5F9',
        borderColor: '#E2E8F0',
        color: '#64748B',
        margin: 0,
      }}
    >
      ● 已下线
    </Tag>
  )
}

function versionStatusTag(status: 'active' | 'inactive' | 'pending'): React.ReactNode {
  if (status === 'active')
    return (
      <Tag
        style={{
          background: '#ECFDF5',
          borderColor: '#A7F3D0',
          color: '#047857',
          margin: 0,
        }}
      >
        ● 在线
      </Tag>
    )
  if (status === 'pending')
    return (
      <Tag
        style={{
          background: '#FFF7ED',
          borderColor: '#FED7AA',
          color: '#C2410C',
          margin: 0,
        }}
      >
        ● 未发布
      </Tag>
    )
  return (
    <Tag
      style={{
        background: '#F1F5F9',
        borderColor: '#E2E8F0',
        color: '#64748B',
        margin: 0,
      }}
    >
      ● 已下线
    </Tag>
  )
}

function healthOkTag(time: string) {
  return (
    <Tag
      style={{
        background: '#ECFDF5',
        borderColor: '#A7F3D0',
        color: '#047857',
        margin: 0,
      }}
    >
      ● 服务状态：健康 {time}
    </Tag>
  )
}

function healthErrorTag(time: string) {
  return (
    <Tag
      style={{
        background: '#FEF2F2',
        borderColor: '#FECACA',
        color: '#B91C1C',
        margin: 0,
      }}
    >
      ● 服务状态：异常 {time}
    </Tag>
  )
}

// ── 配置标签表格（行 = discoveredTag → 业务三级标签） ──────────────────────
function ConfigTagTable({
  configuredTags,
  discoveredTags,
  onRemove,
}: {
  configuredTags: ConfiguredTagEntry[]
  discoveredTags: string[]
  onRemove: (tagId: string) => void
}) {
  if (discoveredTags.length === 0) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <Text type="secondary">
            该模型尚未执行接入校验,无模型标签可配置
          </Text>
        }
      />
    )
  }
  const configuredByDiscovered = new Map<string, ConfiguredTagEntry>()
  for (const e of configuredTags) {
    configuredByDiscovered.set(e.discoveredTag, e)
  }

  return (
    <Table<{ discoveredTag: string; entry: ConfiguredTagEntry | null }>
      rowKey="discoveredTag"
      size="middle"
      pagination={false}
      dataSource={discoveredTags.map((dt) => ({
        discoveredTag: dt,
        entry: configuredByDiscovered.get(dt) ?? null,
      }))}
      columns={[
        {
          title: '模型标签',
          dataIndex: 'discoveredTag',
          width: 160,
          render: (v: string) => <Tag color="blue">{v}</Tag>,
        },
        {
          title: '业务标签(三级)',
          dataIndex: 'entry',
          render: (_: unknown, row) =>
            row.entry ? (
              <Tag color="blue">{row.entry.tagPath}</Tag>
            ) : (
              <Text type="secondary">未配置</Text>
            ),
        },
        {
          title: '操作',
          width: 80,
          align: 'center',
          render: (_: unknown, row) =>
            row.entry ? (
              <Button
                size="small"
                type="link"
                danger
                onClick={() => onRemove(row.entry!.tagId)}
              >
                移除
              </Button>
            ) : (
              <Text type="secondary">—</Text>
            ),
        },
      ]}
    />
  )
}

export default function ModelsAdminSmallPage() {
  const { message } = App.useApp()
  const { user } = useAuthStore()
  const canWrite = user?.role === 'superadmin' || user?.role === 'root_admin'

  const [models, setModels] = useState<MockModel[]>(MOCK_MODELS)
  const [q, setQ] = useState('')
  const [modalityFilter, setModalityFilter] = useState<Modality4[]>([])
  const [refTagsFilter, setRefTagsFilter] = useState<string[][]>([])
  const [selectedId, setSelectedId] = useState<number | null>(
    MOCK_MODELS[0]?.id ?? null,
  )
  const [deactivatePreview, setDeactivatePreview] = useState<{
    open: boolean
    refs: MockRef[]
    target: MockModel | null
  }>({ open: false, refs: [], target: null })
  const [newVersionOpen, setNewVersionOpen] = useState(false)
  const [uploadForm] = Form.useForm<{ endpoint_url: string }>()
  const [publishTarget, setPublishTarget] = useState<MockVersion | null>(null)
  const [healthCheckedAt, setHealthCheckedAt] = useState<string>('')

  // ── 模型测试 ──────────────────────
  const [testImage, setTestImage] = useState<UploadFile | null>(null)
  const [testText, setTestText] = useState('')
  const [testRunning, setTestRunning] = useState(false)
  const [testCardOpen, setTestCardOpen] = useState(false)

  const handleRunTest = async () => {
    if (!selected) return
    if (selected.modality === 'text' && !testText.trim()) {
      message.warning('请输入待检测文本')
      return
    }
    if (selected.modality !== 'text' && !testImage) {
      message.warning('请先上传图片')
      return
    }
    setTestRunning(true)
    try {
      const auditPoints = (selected.discoveredTags ?? []).map((label) => ({
        label,
      }))
      const configuredTags = (selected.configuredTags ?? []).map((c) => ({
        discoveredTag: c.discoveredTag,
        tagPath: c.tagPath,
      }))
      const r =
        selected.modality === 'text'
          ? await runModelTest({
              modality: 'text',
              inputText: testText,
              auditPoints,
              configuredTags,
            })
          : await runModelTest({
              modality: 'image',
              imageFile:
                (testImage?.originFileObj as File | undefined) ??
                new File([new Blob()], testImage?.name ?? 'mock.png'),
              auditPoints,
              configuredTags,
            })
      // 将测试结果写入当前模型的 testHistory
      setModels((prev) =>
        prev.map((m) =>
          m.id === selected.id
            ? {
                ...m,
                testHistory: [
                  {
                    decision: r.decision,
                    latencyMs: r.latencyMs,
                    confidence: r.confidence,
                    rawOutput: r.rawOutput,
                  },
                  ...(m.testHistory ?? []),
                ],
              }
            : m,
        ),
      )
    } catch {
      message.error('测试失败')
    } finally {
      setTestRunning(false)
    }
  }

  // ── 推荐风险阈值（行内编辑）──────────────────────
  type ThresholdKey = 'low' | 'mid' | 'high'
  const [editingKey, setEditingKey] = useState<ThresholdKey | null>(null)
  const [draftLow, setDraftLow] = useState<[number, number]>([0, 0])
  const [draftMid, setDraftMid] = useState<[number, number]>([0, 0])
  const [draftHigh, setDraftHigh] = useState<[number, number]>([0, 1])

  // ── 设计说明卡（折叠子节）──────────────────────

  const startEdit = (key: ThresholdKey) => {
    if (!selected) return
    if (!selected.riskThreshold) return
    if (key === 'low') setDraftLow([...selected.riskThreshold.low] as [number, number])
    if (key === 'mid') setDraftMid([...selected.riskThreshold.mid] as [number, number])
    if (key === 'high') setDraftHigh([...selected.riskThreshold.high] as [number, number])
    setEditingKey(key)
  }

  const commitEdit = (key: ThresholdKey) => {
    if (!selected) return
    const current = selected.riskThreshold
    const next: RiskThresholdRange = current
      ? {
          low: key === 'low' ? draftLow : current.low,
          mid: key === 'mid' ? draftMid : current.mid,
          high: key === 'high' ? [draftHigh[0], 1] : current.high,
        }
      : {
          low: draftLow,
          mid: draftMid,
          high: [draftHigh[0], 1],
        }
    setModels((prev) =>
      prev.map((m) =>
        m.id === selected.id ? { ...m, riskThreshold: next } : m,
      ),
    )
    setEditingKey(null)
    message.success('已保存阈值')
  }

  const handleUnconfiguredClick = () => {
    if (!selected) return
    setDraftLow([0, 0.35])
    setDraftMid([0.36, 0.75])
    setDraftHigh([0.76, 1])
    setEditingKey('low')
  }

  const handleCancelDraft = () => {
    setEditingKey(null)
  }

  useEffect(() => {
    const POLL_MS = 60 * 60 * 1000
    const tick = () => setHealthCheckedAt(dayjs().format('HH:mm:ss'))
    tick()
    const id = setInterval(tick, POLL_MS)
    return () => clearInterval(id)
  }, [])

  // 切换模型时,丢弃未保存的阈值草稿
  useEffect(() => {
    return () => {
      setEditingKey(null)
    }
  }, [selectedId])
  const [addOpen, setAddOpen] = useState(false)
  const [addSubmitting, setAddSubmitting] = useState(false)
  const [addForm] = Form.useForm<{
    name: string
    modality: Modality4
    endpoint_url: string
  }>()
  const [accessRunning, setAccessRunning] = useState(false)
  const [accessChecked, setAccessChecked] = useState(false)
  const [accessResult, setAccessResult] = useState<AccessCheckResult | null>(
    null,
  )

  // 从 models[].refs 动态推导三级标签树（Cascader 用）
  const refTagTree = useMemo(() => {
    interface TreeNode {
      value: string
      label: string
      children?: TreeNode[]
    }
    const level1 = new Map<string, Map<string, Set<string>>>()
    for (const m of models) {
      for (const r of m.refs) {
        const parts = r.path
          .split('/')
          .map((s) => s.trim())
          .filter(Boolean)
        if (parts.length < 2) continue
        const [l1, l2, l3] = parts
        if (!level1.has(l1)) level1.set(l1, new Map())
        const l2Map = level1.get(l1)!
        if (!l2Map.has(l2)) l2Map.set(l2, new Set())
        if (l3) l2Map.get(l2)!.add(l3)
      }
    }
    const build = (
      l1Name: string,
      l2Map: Map<string, Set<string>>,
    ): TreeNode => {
      const l2Nodes: TreeNode[] = []
      const l2Keys = [...l2Map.keys()].sort((a, b) => a.localeCompare(b, 'zh'))
      for (const l2Name of l2Keys) {
        const l3Set = l2Map.get(l2Name)!
        const l2Path = `${l1Name} / ${l2Name}`
        if (l3Set.size === 0) {
          l2Nodes.push({ value: l2Path, label: l2Name })
        } else {
          const l3Children: TreeNode[] = []
          const l3Keys = [...l3Set].sort((a, b) => a.localeCompare(b, 'zh'))
          for (const l3Name of l3Keys) {
            const l3Path = `${l2Path} / ${l3Name}`
            l3Children.push({ value: l3Path, label: l3Name })
          }
          l2Nodes.push({ value: l2Path, label: l2Name, children: l3Children })
        }
      }
      return { value: l1Name, label: l1Name, children: l2Nodes }
    }
    return [...level1.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], 'zh'))
      .map(([l1Name, l2Map]) => build(l1Name, l2Map))
  }, [models])

  const filtered = useMemo(
    () =>
      models.filter((m) => {
        if (
          q.trim() &&
          !m.name.toLowerCase().includes(q.toLowerCase().trim())
        )
          return false
        if (modalityFilter.length > 0 && !modalityFilter.includes(m.modality))
          return false
        if (refTagsFilter.length > 0) {
          const paths = m.refs.map((r) => r.path)
          const leafTags = refTagsFilter.map((arr) =>
            arr[arr.length - 1],
          )
          const hit = leafTags.some((tag) => paths.includes(tag))
          if (!hit) return false
        }
        return true
      }),
    [models, q, modalityFilter, refTagsFilter],
  )

  const selected = useMemo(
    () => models.find((m) => m.id === selectedId) ?? null,
    [models, selectedId],
  )

  // 测试结果从当前选中模型派生（每个模型独立持有 testHistory，不再共享）
  const testResult: ModelTestResponse | null = useMemo(() => {
    const r = selected?.testHistory?.[0]
    if (!r) return null
    return {
      decision: r.decision,
      latencyMs: r.latencyMs,
      confidence: r.confidence,
      results: [],
      rawOutput: r.rawOutput,
    }
  }, [selected?.testHistory])

  // mock 健康探测：leader_v1 异常，其他模型健康。
  const healthStatus: 'ok' | 'error' =
    selected?.name === 'leader_v1' ? 'error' : 'ok'

  // 测试门控：testResult 由当前选中模型的 testHistory 派生
  const isCurrentModelTested = testResult !== null
  const isCurrentModelTestedPass =
    isCurrentModelTested && testResult.decision === 'pass'

  const nextVersionNo = useMemo(() => {
    if (!selected) return 1
    return (
      Math.max(
        ...selected.history.map(
          (h) => parseInt(h.versionLabel.replace(/[^0-9]/g, ''), 10) || 0,
        ),
        parseInt(
          selected.currentVersion.versionLabel.replace(/[^0-9]/g, ''),
          10,
        ) || 0,
      ) + 1
    )
  }, [selected])

  // ── 操作：发布 / 取消发布 ──────────────────────
  const handleActivate = () => {
    if (!selected) return
    setModels((prev) =>
      prev.map((m) =>
        m.id === selected.id ? { ...m, status: 'active' } : m,
      ),
    )
    message.success('已发布')
  }

  const openDeactivatePreview = () => {
    if (!selected) return
    setDeactivatePreview({
      open: true,
      refs: selected.refs,
      target: selected,
    })
  }

  const confirmDeactivate = () => {
    if (!selected) return
    setModels((prev) =>
      prev.map((m) =>
        m.id === selected.id ? { ...m, status: 'inactive' } : m,
      ),
    )
    message.success('已取消发布')
    setDeactivatePreview({ open: false, refs: [], target: null })
  }

  // ── 操作：上传新版本 ──────────────────────
  const handleUploadNewVersion = () => {
    if (!selected) return
    uploadForm.resetFields()
    setNewVersionOpen(true)
  }

  const confirmUploadNewVersion = async () => {
    if (!selected) return
    const v = await uploadForm.validateFields().catch(() => null)
    if (!v) return
    const newV: MockVersion = {
      id: Date.now(),
      versionLabel: `v${nextVersionNo}`,
      status: 'pending',
      releasedAt: dayjs().format('YYYY-MM-DD'),
    }
    setModels((prev) =>
      prev.map((m) =>
        m.id === selected.id
          ? {
              ...m,
              history: [newV, ...m.history],
            }
          : m,
      ),
    )
    message.success(`已保存新版本 ${newV.versionLabel}，状态：未发布`)
    setNewVersionOpen(false)
  }

  // ── 操作：接入校验 ──────────────────────
  const handleAccessCheck = async () => {
    const v = await addForm.validateFields().catch(() => null)
    if (!v) return
    setAccessRunning(true)
    setAccessChecked(false)
    setAccessResult(null)
    try {
      const result = await runAccessCheck({
        modality: v.modality,
        endpoint_url: v.endpoint_url.trim(),
        name: v.name?.trim(),
      })
      setAccessResult(result)
      if (result.ok) {
        setAccessChecked(true)
        message.success(`接入校验通过,发现 ${result.discoveredTags.length} 个模型标签`)
      } else {
        setAccessChecked(false)
        message.error(result.message ?? '接入校验失败')
      }
    } finally {
      setAccessRunning(false)
    }
  }

  // ── 操作：新增模型 ──────────────────────
  const handleAddModel = async () => {
    const v = await addForm.validateFields().catch(() => null)
    if (!v) return
    if (!accessChecked) {
      message.warning('请先完成接入校验')
      return
    }
    setAddSubmitting(true)
    try {
      const today = dayjs().format('YYYY-MM-DD')
      const newId =
        models.length === 0 ? 1 : Math.max(...models.map((m) => m.id)) + 1
      const v1: MockVersion = {
        id: Date.now(),
        versionLabel: 'v1',
        status: 'pending',
        releasedAt: today,
      }
      const newModel: MockModel = {
        id: newId,
        name: v.name.trim(),
        smallCategory: '',
        modality: v.modality,
        endpoint_url: v.endpoint_url.trim(),
        status: 'pending',
        createdAt: today,
        currentVersion: v1,
        history: [v1],
        refs: [],
        discoveredTags: accessResult?.discoveredTags ?? [],
      }
      setModels((prev) => [...prev, newModel])
      setSelectedId(newId)
      addForm.resetFields()
      resetAccessState()
      setAddOpen(false)
      message.success('已新增模型')
    } finally {
      setAddSubmitting(false)
    }
  }

  const resetAccessState = () => {
    setAccessRunning(false)
    setAccessChecked(false)
    setAccessResult(null)
  }

  const closeAddModal = () => {
    setAddOpen(false)
    addForm.resetFields()
    resetAccessState()
  }

  // ── 操作：配置标签 ──────────────────────
  const [configModalOpen, setConfigModalOpen] = useState(false)
  const openConfigModal = () => {
    if (!selected) return
    setConfigModalOpen(true)
  }
  const closeConfigModal = () => {
    setConfigModalOpen(false)
  }
  const handleSaveConfigTag = (entry: ConfiguredTagEntry) => {
    if (!selected) return
    setModels((prev) =>
      prev.map((m) =>
        m.id === selected.id
          ? {
              ...m,
              configuredTags: [...(m.configuredTags ?? []), entry],
            }
          : m,
      ),
    )
    message.success(
      `已配置:${entry.discoveredTag} → ${entry.tagPath}`,
    )
  }
  const handleRemoveConfigTag = (tagId: string) => {
    if (!selected) return
    const target = (selected.configuredTags ?? []).find(
      (e) => e.tagId === tagId,
    )
    if (!target) return

    const refStrategies = findStrategiesByDiscoveredTag(
      target.discoveredTag,
    )
    const isPublished = selected.status === 'active'
    const isRefByStrategy = refStrategies.length > 0

    const performRemove = () => {
      setModels((prev) =>
        prev.map((m) =>
          m.id === selected.id
            ? {
                ...m,
                configuredTags: (m.configuredTags ?? []).filter(
                  (e) => e.tagId !== tagId,
                ),
              }
            : m,
        ),
      )
      message.success('已移除配置')
    }

    // 无任何阻塞项 → 直接移除
    if (!isPublished && !isRefByStrategy) {
      performRemove()
      return
    }

    // 有阻塞项 → 弹窗告知,无"确认移除"按钮(必须先解除限制)
    const blockerBullets: React.ReactNode[] = []
    if (isPublished) {
      blockerBullets.push(
        <li key="published">
          模型当前状态为「已发布」,需先取消发布后才能移除。
        </li>,
      )
    }
    if (isRefByStrategy) {
      blockerBullets.push(
        <li key="strategy">
          模型标签「<Text strong>{target.discoveredTag}</Text>」
          当前被 {refStrategies.length} 个审核策略引用,需先解除引用后才能移除:
          <ul style={{ marginTop: 4, marginBottom: 4 }}>
            {refStrategies.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </li>,
      )
    }

    Modal.info({
      title: '无法移除 — 存在以下阻塞项',
      width: 520,
      centered: true,
      okText: '关闭',
      content: (
        <>
          <div>将移除映射:</div>
          <div
            style={{
              marginTop: 8,
              marginBottom: 12,
              padding: 8,
              background: '#F8FAFC',
              borderRadius: 6,
            }}
          >
            <Text strong>{target.discoveredTag}</Text>
            <Text type="secondary"> → </Text>
            <Text strong>{target.tagPath}</Text>
          </div>
          <div>需先解除以下限制:</div>
          <ul style={{ marginTop: 4, paddingLeft: 20, marginBottom: 0 }}>
            {blockerBullets}
          </ul>
          <div style={{ marginTop: 8 }}>
            请在对应页面解除以上限制后,再返回此处移除该配置。
          </div>
        </>
      ),
    })
  }

  // ── 操作：切换版本（pending / inactive → current，带二次确认） ──────────────────────
  const handlePublishVersion = (version: MockVersion) => {
    if (!selected) return
    setModels((prev) =>
      prev.map((m) =>
        m.id === selected.id
          ? {
              ...m,
              status: 'active',
              currentVersion: { ...version, status: 'active' },
              history: m.history.map((h) =>
                h.id === version.id
                  ? { ...h, status: 'active' }
                  : h.id === selected.currentVersion.id
                    ? { ...h, status: 'inactive' }
                    : h,
              ),
            }
          : m,
      ),
    )
    message.success(
      version.status === 'pending'
        ? `已发布 ${version.versionLabel}`
        : `已切换到 ${version.versionLabel}`,
    )
  }

  // ── 版本历史表 ──────────────────────
  const versionColumns: ColumnsType<MockVersion> = [
    {
      title: '版本',
      dataIndex: 'versionLabel',
      width: '20%',
      render: (v: string, row) => (
        <Space direction="vertical" size={0}>
          <Text strong>{v}</Text>
          {row.id === selected?.currentVersion.id && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              当前
            </Text>
          )}
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: '20%',
      render: (s: 'active' | 'inactive') => versionStatusTag(s),
    },
    {
      title: '发布时间',
      dataIndex: 'releasedAt',
      width: '20%',
      render: (v: string) => (
        <Text type="secondary">{v}</Text>
      ),
    },
    {
      title: 'API 地址',
      dataIndex: 'endpoint_url',
      width: '24%',
      render: () => {
        const url = selected?.endpoint_url
        return (
          <Text
            copyable={!!url}
            type={url ? undefined : 'secondary'}
            ellipsis={{ tooltip: url }}
            style={{ maxWidth: 280 }}
          >
            {url || '—'}
          </Text>
        )
      },
    },
    {
      title: '操作',
      width: '20%',
      render: (_, row) => {
        const isCurrent =
          selected && row.id === selected.currentVersion.id
        if (isCurrent) {
          return (
            <Text type="secondary" style={{ fontSize: 12 }}>
              当前版本
            </Text>
          )
        }
        if (row.status === 'pending') {
          return (
            <Tooltip
              title={
                !isCurrentModelTestedPass
                  ? '请先在「模型测试」中通过测试'
                  : ''
              }
            >
              <Button
                size="small"
                type="link"
                disabled={!canWrite || !isCurrentModelTestedPass}
                onClick={() => setPublishTarget(row)}
              >
                发布
              </Button>
            </Tooltip>
          )
        }
        if (row.status === 'inactive') {
          return (
            <Button
              size="small"
              type="link"
              disabled={!canWrite}
              onClick={() => setPublishTarget(row)}
            >
              回滚到此版本
            </Button>
          )
        }
        return (
          <Text type="secondary" style={{ fontSize: 12 }}>
            —
          </Text>
        )
      },
    },
  ]

  return (
    <div style={{ width: '100%' }}>
      <div
        style={{
          marginBottom: 16,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <Title level={3} style={{ margin: 0 }}>模型管理 / 小模型</Title>
          <Text type="secondary">
            小模型 注册、版本与发布管理
          </Text>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          disabled={!canWrite}
          onClick={() => setAddOpen(true)}
        >
          新增模型
        </Button>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 16,
          alignItems: 'stretch',
          background: '#fff',
          borderRadius: 8,
          padding: 16,
          minHeight: 600,
        }}
      >
        {/* 左：模型列表 */}
        <div
          style={{
            flex: '0 0 280px',
            borderRight: '1px solid #E2E8F0',
            paddingRight: 12,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ marginBottom: 8 }}>
            <Input
              prefix={<SearchOutlined />}
              placeholder="搜索小模型名称"
              allowClear
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              marginBottom: 12,
            }}
          >
            <Select
              mode="multiple"
              allowClear
              placeholder="模态"
              style={{ width: '100%' }}
              value={modalityFilter}
              onChange={(v) => setModalityFilter(v as Modality4[])}
              options={MODALITY_OPTIONS_4.map((o) => ({
                value: o.value,
                label: o.label,
              }))}
              maxTagCount="responsive"
              size="middle"
            />
            <Cascader
              multiple
              changeOnSelect
              placeholder="标签"
              style={{ width: '100%' }}
              value={refTagsFilter}
              onChange={(v) => setRefTagsFilter(v as string[][])}
              options={refTagTree}
              showCheckedStrategy={Cascader.SHOW_CHILD}
              maxTagCount="responsive"
              size="middle"
            />
          </div>
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              maxHeight: 720,
            }}
          >
            {filtered.length === 0 ? (
              <Empty description="暂无小模型" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              filtered.map((m) => {
                const active = m.id === selectedId
                return (
                  <div
                    key={m.id}
                    onClick={() => setSelectedId(m.id)}
                    style={{
                      cursor: 'pointer',
                      padding: '8px 12px',
                      borderRadius: 6,
                      marginBottom: 4,
                      background: active ? '#E6F4FF' : 'transparent',
                      borderLeft: active
                        ? '3px solid #1677ff'
                        : '3px solid transparent',
                    }}
                  >
                    <Text strong={active}>{m.name}</Text>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* 右：模型详情 */}
        <div style={{ flex: 1, minWidth: 0, paddingLeft: 8 }}>
          {!selected && <Empty description="请从左侧选择一个模型查看详情" />}
          {selected && (
            <div>
              <Title level={4} style={{ marginTop: 0 }}>
                {selected.name}
              </Title>

              <div
                style={{
                  position: 'relative',
                  border: '1px solid #E2E8F0',
                  borderRadius: 8,
                  background: '#FFFFFF',
                  padding: '20px 24px',
                  marginBottom: 16,
                }}
              >
                <div style={{ position: 'absolute', top: 16, right: 24 }}>
                  {selected.status === 'active' ? (
                    <Popconfirm
                      title="确认取消发布？"
                      description="取消发布后该模型将无法被推理链路调用。"
                      okText="下一步"
                      cancelText="返回"
                      onConfirm={openDeactivatePreview}
                    >
                      <Button danger ghost disabled={!canWrite}>
                        取消发布
                      </Button>
                    </Popconfirm>
                  ) : (
                    <Tooltip
                      title={
                        !isCurrentModelTestedPass
                          ? '请先在「模型测试」中通过测试'
                          : ''
                      }
                    >
                      <Button
                        type="primary"
                        onClick={handleActivate}
                        disabled={!canWrite || !isCurrentModelTestedPass}
                      >
                        发布
                      </Button>
                    </Tooltip>
                  )}
                </div>

                <Space
                  size={0}
                  wrap
                  align="center"
                  style={{ paddingRight: 120 }}
                >
                  <Text type="secondary">当前版本：</Text>
                  <Text strong style={{ marginRight: 16 }}>
                    {selected.currentVersion.versionLabel}
                  </Text>
                  <Divider type="vertical" />
                  <Text type="secondary" style={{ marginRight: 8 }}>
                    状态：
                  </Text>
                  {statusTag(selected.status)}
                  <Divider type="vertical" />
                  <Text type="secondary">模态：</Text>
                  <Text strong style={{ marginRight: 16 }}>
                    {MODALITY_LABEL_4[selected.modality]}
                  </Text>
                  <Divider type="vertical" />
                  <Text type="secondary">创建时间：</Text>
                  <Text strong>{selected.createdAt}</Text>
                  <Divider type="vertical" />
                  {healthStatus === 'ok'
                    ? healthOkTag(healthCheckedAt)
                    : healthErrorTag(healthCheckedAt)}
                </Space>
              </div>

              <div
                style={{
                  border: '1px solid #E2E8F0',
                  borderRadius: 8,
                  background: '#FFFFFF',
                  marginBottom: 16,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    padding: '16px 24px 12px',
                    borderBottom: '1px solid #F0F0F0',
                    borderLeft: '3px solid #1677ff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                  }}
                >
                  <div>
                    <Text strong style={{ fontSize: 15 }}>
                      【版本历史】
                    </Text>
                    <Text type="secondary" style={{ marginLeft: 12 }}>
                      {selected.history.length} 个版本
                    </Text>
                  </div>
                  <Button
                    size="small"
                    type="primary"
                    icon={<PlusOutlined />}
                    disabled={!canWrite}
                    onClick={handleUploadNewVersion}
                  >
                    上传新版本
                  </Button>
                </div>
                <div style={{ padding: '0 24px 16px' }}>
                  <Table<MockVersion>
                    rowKey="id"
                    size="middle"
                    dataSource={selected.history}
                    columns={versionColumns}
                    pagination={{
                      pageSize: 5,
                      showSizeChanger: true,
                      showTotal: (total) => `共 ${total} 个版本`,
                      pageSizeOptions: [5, 10, 20, 50],
                    }}
                  />
                </div>
              </div>

              <div
                style={{
                  border: '1px solid #E2E8F0',
                  borderRadius: 8,
                  background: '#FFFFFF',
                  padding: '16px 24px 20px',
                  marginBottom: 16,
                }}
              >
                <div
                  style={{
                    marginBottom: 16,
                    paddingLeft: 12,
                    borderLeft: '3px solid #1677ff',
                  }}
                >
                  <Space size={8} align="center">
                    <Text strong style={{ fontSize: 15 }}>
                      【模型标签】
                    </Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      ({selected.discoveredTags?.length ?? 0})
                    </Text>
                  </Space>
                </div>

                {selected.discoveredTags &&
                selected.discoveredTags.length > 0 ? (
                  <Space size={6} wrap>
                    {selected.discoveredTags.map((tag) => (
                      <Tag key={tag} color="blue">
                        {tag}
                      </Tag>
                    ))}
                  </Space>
                ) : (
                  <Empty
                    description={
                      <Text type="secondary">
                        未发现任何模型标签
                      </Text>
                    }
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                  />
                )}
              </div>

              {/* 推荐风险阈值 */}
              <div
                style={{
                  border: '1px solid #E2E8F0',
                  borderRadius: 8,
                  background: '#FFFFFF',
                  padding: '16px 24px 20px',
                  marginBottom: 16,
                }}
              >
                <div
                  style={{
                    marginBottom: 16,
                    paddingLeft: 12,
                    borderLeft: '3px solid #1677ff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <Text strong style={{ fontSize: 15 }}>
                    推荐风险阈值
                  </Text>
                </div>

                {selected.riskThreshold || editingKey !== null ? (
                  <div>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr 1fr',
                        gap: 16,
                        marginBottom: 12,
                      }}
                    >
                      {(
                        [
                          { key: 'low', label: '低风险', color: '#2563EB' },
                          { key: 'mid', label: '中风险', color: '#D97706' },
                          { key: 'high', label: '高风险', color: '#DC2626' },
                        ] as const
                      ).map(({ key, label, color }) => {
                        const isEditing = editingKey === key
                        const draft =
                          key === 'low'
                            ? draftLow
                            : key === 'mid'
                              ? draftMid
                              : draftHigh
                        const [a, b] = isEditing
                          ? draft
                          : (selected.riskThreshold?.[key] ?? draft)
                        return (
                          <div key={key}>
                            <div style={{ marginBottom: 8 }}>
                              <Tag
                                style={{
                                  background: `${color}14`,
                                  borderColor: `${color}40`,
                                  color,
                                  margin: 0,
                                  minWidth: 56,
                                  textAlign: 'center',
                                }}
                              >
                                {label}
                              </Tag>
                            </div>
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4,
                                flexWrap: 'wrap',
                              }}
                            >
                              {isEditing ? (
                                <>
                                  <InputNumber
                                    size="small"
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    precision={2}
                                    value={draft[0]}
                                    onChange={(v) => {
                                      const nv =
                                        typeof v === 'number' ? v : 0
                                      if (key === 'low')
                                        setDraftLow([nv, draft[1]])
                                      if (key === 'mid')
                                        setDraftMid([nv, draft[1]])
                                      if (key === 'high')
                                        setDraftHigh([nv, draft[1]])
                                    }}
                                    autoFocus
                                    style={{ width: 64 }}
                                  />
                                  <span
                                    style={{
                                      color: '#94A3B8',
                                      fontSize: 12,
                                    }}
                                  >
                                    ~
                                  </span>
                                  <InputNumber
                                    size="small"
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    precision={2}
                                    value={key === 'high' ? 1 : draft[1]}
                                    disabled={key === 'high'}
                                    onChange={(v) => {
                                      const nv =
                                        typeof v === 'number' ? v : 0
                                      if (key === 'low')
                                        setDraftLow([draft[0], nv])
                                      if (key === 'mid')
                                        setDraftMid([draft[0], nv])
                                    }}
                                    style={{ width: 64 }}
                                  />
                                </>
                              ) : (
                                <span
                                  onClick={() => startEdit(key)}
                                  style={{
                                    cursor: 'pointer',
                                    fontWeight: 500,
                                  }}
                                >
                                  {a.toFixed(2)} ~ {b.toFixed(2)}
                                </span>
                              )}
                            </div>
                          </div>
                        )
                      })}
</div>
                    {editingKey !== null && (
                      <div
                        style={{
                          marginTop: 16,
                          display: 'flex',
                          gap: 8,
                          justifyContent: 'flex-end',
                        }}
                      >
                        <Button
                          size="small"
                          onClick={handleCancelDraft}
                        >
                          取消配置
                        </Button>
                        <Button
                          size="small"
                          type="primary"
                          onClick={() => commitEdit(editingKey)}
                        >
                          保存
                        </Button>
                      </div>
                    )}
                    {selected.riskThreshold && (
                      <Text
                        type="secondary"
                        style={{ fontSize: 12, display: 'block', marginTop: 8 }}
                      >
                        用于策略管理初始化配置
                      </Text>
                    )}
                  </div>
                ) : (
                  <div
                    onClick={handleUnconfiguredClick}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '8px 0',
                      cursor: 'pointer',
                    }}
                  >
                    <Tag
                      style={{
                        background: '#FFF7ED',
                        borderColor: '#FED7AA',
                        color: '#C2410C',
                        margin: 0,
                      }}
                    >
                      未配置
                    </Tag>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      点击「未配置」或此处即可配置推荐风险阈值
                    </Text>
                  </div>
                )}
              </div>

              <div
                style={{
                  border: '1px solid #E2E8F0',
                  borderRadius: 8,
                  background: '#FFFFFF',
                  padding: '16px 24px 20px',
                  marginBottom: 16,
                }}
              >
                <div
                  style={{
                    marginBottom: 16,
                    paddingLeft: 12,
                    borderLeft: '3px solid #1677ff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                  }}
                >
                  <Space size={8} align="center">
                    <Text strong style={{ fontSize: 15 }}>
                      【配置标签】
                    </Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      ({selected.configuredTags?.length ?? 0})
                    </Text>
                  </Space>
                  <Button
                    size="small"
                    type="primary"
                    icon={<PlusOutlined />}
                    disabled={
                      !canWrite ||
                      (selected.discoveredTags?.length ?? 0) === 0 ||
                      (selected.discoveredTags ?? []).every((t) =>
                        (selected.configuredTags ?? []).some(
                          (c) => c.discoveredTag === t,
                        ),
                      )
                    }
                    onClick={openConfigModal}
                  >
                    添加配置
                  </Button>
                </div>

                <ConfigTagTable
                  configuredTags={selected.configuredTags ?? []}
                  discoveredTags={selected.discoveredTags ?? []}
                  onRemove={handleRemoveConfigTag}
                />
              </div>

              {/* 模型测试 */}
              <div
                style={{
                  border: '1px solid #E2E8F0',
                  borderRadius: 8,
                  background: '#FFFFFF',
                  marginBottom: 16,
                  overflow: 'hidden',
                }}
              >
                <div
                  onClick={() => setTestCardOpen((v) => !v)}
                  style={{
                    padding: '16px 24px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    userSelect: 'none',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-block',
                        width: 3,
                        height: 16,
                        background: '#1677ff',
                        borderRadius: 2,
                      }}
                    />
                    <Text strong style={{ fontSize: 15 }}>
                      模型测试
                    </Text>
                    {isCurrentModelTested && testResult && (
                      <Tag
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          background:
                            testResult.decision === 'pass'
                              ? '#ECFDF5'
                              : '#FEF2F2',
                          borderColor:
                            testResult.decision === 'pass'
                              ? '#A7F3D0'
                              : '#FECACA',
                          color:
                            testResult.decision === 'pass'
                              ? '#047857'
                              : '#B91C1C',
                          margin: 0,
                        }}
                      >
                        ●{' '}
                        {testResult.decision === 'pass'
                          ? '测试通过'
                          : '测试失败'}
                      </Tag>
                    )}
                  </div>
                  <Button
                    type="text"
                    size="small"
                    icon={testCardOpen ? <UpOutlined /> : <DownOutlined />}
                  >
                    {testCardOpen ? '收起' : '展开'}
                  </Button>
                </div>

                {testCardOpen && (
                  <div
                    style={{
                      padding: '16px 24px 20px',
                      borderTop: '1px solid #F0F0F0',
                    }}
                  >
                    <Space style={{ marginBottom: 12 }}>
                      <Text type="secondary">模型：</Text>
                      <Text strong>
                        {selected.name} {selected.currentVersion.versionLabel}
                      </Text>
                    </Space>

                    <Text
                      type="secondary"
                      style={{ display: 'block', marginBottom: 6 }}
                    >
                      {selected.modality === 'text'
                        ? '输入测试文本'
                        : '上传测试图片'}
                    </Text>

                    {selected.modality === 'text' ? (
                      <Input.TextArea
                        rows={4}
                        value={testText}
                        onChange={(e) => setTestText(e.target.value)}
                        placeholder="请输入待检测文本…"
                        maxLength={64_000}
                        showCount
                      />
                    ) : (
                      <Upload
                        beforeUpload={(file) => {
                          if (file.size > 10 * 1024 * 1024) {
                            message.error('图片大小不能超过 10MB')
                            return Upload.LIST_IGNORE
                          }
                          setTestImage({
                            uid: String(Date.now()),
                            name: file.name,
                            status: 'done',
                            originFileObj: file,
                          })
                          return false
                        }}
                        onRemove={() => {
                          setTestImage(null)
                          return true
                        }}
                        fileList={testImage ? [testImage] : []}
                        maxCount={1}
                        accept="image/*"
                      >
                        <Button icon={<UploadOutlined />}>上传图片</Button>
                      </Upload>
                    )}

                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'flex-start',
                        marginTop: 16,
                      }}
                    >
                      <Button
                        type="primary"
                        icon={<PlayCircleOutlined />}
                        loading={testRunning}
                        disabled={
                          selected.modality === 'text'
                            ? !testText.trim()
                            : !testImage
                        }
                        onClick={handleRunTest}
                      >
                        开始测试
                      </Button>
                    </div>

                    {testResult && (
                      <>
                        <Divider style={{ margin: '20px 0 12px' }} />
                        <Space
                          size={16}
                          wrap
                          style={{ marginBottom: 12 }}
                        >
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            测试模型：{selected.name}{' '}
                            {selected.currentVersion.versionLabel}
                          </Text>
                        </Space>
                        <Space
                          size={16}
                          wrap
                          style={{ marginBottom: 12 }}
                        >
                          <Tag
                            color={
                              testResult.decision === 'pass'
                                ? 'green'
                                : 'red'
                            }
                            style={{ margin: 0 }}
                          >
                            {testResult.decision === 'pass'
                              ? '● 通过'
                              : '● 拦截'}
                          </Tag>
                          <Text type="secondary">
                            延迟 {testResult.latencyMs}ms
                          </Text>
                          <Text type="secondary">
                            置信度 {testResult.confidence}%
                          </Text>
                        </Space>
                        <Text
                          strong
                          style={{ display: 'block', marginBottom: 8 }}
                        >
                          返回测试结果
                        </Text>
                        <pre
                          style={{
                            background: '#F8FAFC',
                            padding: 12,
                            borderRadius: 6,
                            overflow: 'auto',
                            margin: 0,
                            fontSize: 12,
                          }}
                        >
                          {testResult.rawOutput}
                        </pre>
                      </>
                    )}
                  </div>
                )}
              </div>

            </div>
          )}
        </div>
      </div>

      {/* 取消发布二次确认 + 影响标签列表 */}
      <Drawer
        title="取消发布确认"
        placement="right"
        width={520}
        open={deactivatePreview.open}
        onClose={() => setDeactivatePreview({ open: false, refs: [], target: null })}
        destroyOnClose
        extra={
          <Tag color="orange">
            <ExclamationCircleOutlined /> 影响 {deactivatePreview.refs.length} 个三级标签
          </Tag>
        }
      >
        {deactivatePreview.target && (
          <>
            <Alert
              type="warning"
              showIcon
              message={`即将取消发布「${deactivatePreview.target.name}」`}
              description="取消发布后，该模型将不再被推理链路调用；相关三级标签的绑定关系不会自动解除，但命中时会出现『模型不可用』错误。"
              style={{ marginBottom: 16 }}
            />
            <Text strong>以下三级标签当前引用了该模型：</Text>
            <div
              style={{
                marginTop: 8,
                border: '1px solid #FFE7BA',
                background: '#FFFBE6',
                borderRadius: 6,
                padding: 12,
                maxHeight: 320,
                overflowY: 'auto',
              }}
            >
              {deactivatePreview.refs.length === 0 && (
                <Text type="secondary">无引用</Text>
              )}
              {deactivatePreview.refs.map((r) => (
                <div key={r.id} style={{ padding: '4px 0' }}>
                  <Tag color="blue">{r.path}</Tag>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 24, textAlign: 'right' }}>
              <Space>
                <Button onClick={() => setDeactivatePreview({ open: false, refs: [], target: null })}>
                  返回
                </Button>
                <Button danger type="primary" onClick={confirmDeactivate}>
                  确认取消发布
                </Button>
              </Space>
            </div>
          </>
        )}
      </Drawer>

      {/* 上传新版本 */}
      <Modal
        title="上传新版本"
        open={newVersionOpen}
        onCancel={() => setNewVersionOpen(false)}
        onOk={confirmUploadNewVersion}
        okText="保存"
        cancelText="取消"
        width={520}
        destroyOnClose
      >
        {selected && (
          <Form
            form={uploadForm}
            layout="vertical"
            requiredMark
            style={{ marginTop: 8 }}
          >
            <Form.Item label="模型名称">
              <Input value={selected.name} disabled />
            </Form.Item>

            <Form.Item label="当前版本">
              <Space size={8}>
                <Tag>{selected.currentVersion.versionLabel}</Tag>
                <Text type="secondary">→</Text>
                <Tag color="blue">v{nextVersionNo}</Tag>
              </Space>
            </Form.Item>

            <Form.Item
              label="API 地址"
              name="endpoint_url"
              rules={[
                { required: true, message: '请输入 API 地址' },
                { type: 'url', message: '请输入有效的 URL' },
              ]}
            >
              <Input placeholder="请输入新版本的 API 地址，例如 https://api.example.com/v3" />
            </Form.Item>

            <Alert
              type="warning"
              showIcon
              message="新版本保存后状态为「未发布」，需手动点击「发布」启用。"
            />
          </Form>
        )}
      </Modal>

      {/* 切换版本确认 */}
      <Modal
        title="切换版本确认"
        open={!!publishTarget}
        onCancel={() => setPublishTarget(null)}
        onOk={() => {
          if (publishTarget) handlePublishVersion(publishTarget)
          setPublishTarget(null)
        }}
        okText="确认切换"
        cancelText="取消"
        width={520}
      >
        {selected && publishTarget && (
          <>
            <p>
              将 <Text strong>{selected.name}</Text> 从{' '}
              <Text strong>{selected.currentVersion.versionLabel}</Text>{' '}
              切换到 <Text strong>{publishTarget.versionLabel}</Text>。
            </p>
            <Alert
              type="warning"
              showIcon
              message={
                <>
                  切换后将启用{' '}
                  <Text strong>{publishTarget.versionLabel}</Text> 作为当前版本
                  （已发布/在线），<Text strong>{selected.currentVersion.versionLabel}</Text>{' '}
                  转为下线状态（已下线）。此操作会立即影响线上业务，请谨慎操作。
                </>
              }
            />
          </>
        )}
      </Modal>

      {/* 新增模型 */}
      <Modal
        open={addOpen}
        onCancel={closeAddModal}
        onOk={handleAddModel}
        okText="保存"
        cancelText="取消"
        okButtonProps={{
          disabled: !accessChecked || addSubmitting || !canWrite,
        }}
        confirmLoading={addSubmitting}
        width={520}
        destroyOnClose
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              style={{
                display: 'inline-block',
                width: 3,
                height: 16,
                background: '#1677ff',
                borderRadius: 2,
              }}
            />
            <span>新增模型</span>
          </div>
        }
      >
        <Form
          form={addForm}
          layout="vertical"
          initialValues={{ modality: 'image', name: '', endpoint_url: '' }}
          requiredMark
          style={{ marginTop: 8 }}
          onValuesChange={() => {
            if (accessChecked) {
              setAccessChecked(false)
            }
          }}
        >
          <Form.Item
            label="模型名称"
            name="name"
            rules={[
              { required: true, message: '请输入模型名称' },
              { max: 64, message: '最长 64 个字符' },
            ]}
          >
            <Input
              placeholder="请输入模型名称"
              disabled={accessRunning}
            />
          </Form.Item>

          <Form.Item
            label="模态"
            name="modality"
            rules={[{ required: true, message: '请选择模态' }]}
          >
            <Select
              placeholder="请选择模态"
              disabled={accessRunning}
              options={MODALITY_OPTIONS_4.map((o) => ({
                value: o.value,
                label: o.label,
              }))}
            />
          </Form.Item>

          <Form.Item
            label="API 地址"
            name="endpoint_url"
            rules={[
              { required: true, message: '请输入 API 地址' },
              { type: 'url', message: '请输入有效的 URL' },
            ]}
          >
            <Input
              placeholder="请输入 API 地址，例如 https://api.example.com/v1"
              disabled={accessRunning}
            />
          </Form.Item>

          <Form.Item
            label="接入校验"
            style={{ marginBottom: 12 }}
          >
            <Button
              block
              icon={<ApiOutlined />}
              loading={accessRunning}
              onClick={handleAccessCheck}
              disabled={!canWrite}
            >
              {accessRunning
                ? '校验中…'
                : accessChecked
                  ? '重新校验'
                  : accessResult && !accessResult.ok
                    ? '重新校验 (上次失败,请重试)'
                    : accessResult
                      ? '重新接入校验'
                      : '接入校验'}
            </Button>
          </Form.Item>

          {accessResult?.ok && accessResult.discoveredTags.length > 0 && (
            <Form.Item label="已发现模型标签" style={{ marginBottom: 0 }}>
              <Space size={6} wrap>
                {accessResult.discoveredTags.map((tag) => (
                  <Tag key={tag} color="blue">
                    {tag}
                  </Tag>
                ))}
              </Space>
            </Form.Item>
          )}
        </Form>
      </Modal>

      {/* 配置业务标签 */}
      <ModelConfigTagModal
        open={configModalOpen}
        onClose={closeConfigModal}
        model={selected}
        allModels={models}
        onSave={handleSaveConfigTag}
      />
    </div>
  )
}