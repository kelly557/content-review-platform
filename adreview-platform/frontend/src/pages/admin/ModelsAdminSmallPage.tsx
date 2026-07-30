// 模型管理 / 小模型（mock 数据版本）
// 按 ASCII 设计稿实现：左 280px 列表 + 右详情（版本历史、引用标签、操作）。
// 数据来源：当前为前端 mock（无后端依赖），后续接 API 时替换 fetchList / fetchVersions / fetchRefs。
import { Fragment, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import {
  App,
  Alert,
  Button,
  Divider,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  PlusOutlined,
  SearchOutlined,
  RollbackOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons'
import { useAuthStore } from '@/store'

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
type MockStatus = 'active' | 'inactive'
interface MockVersion {
  id: number
  versionLabel: string
  status: 'active' | 'inactive'
  releasedAt: string
}
interface MockRef {
  id: string
  path: string
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

function versionStatusTag(status: 'active' | 'inactive'): React.ReactNode {
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

export default function ModelsAdminSmallPage() {
  const { message } = App.useApp()
  const { user } = useAuthStore()
  const canWrite = user?.role === 'superadmin' || user?.role === 'root_admin'

  const [models, setModels] = useState<MockModel[]>(MOCK_MODELS)
  const [q, setQ] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(
    MOCK_MODELS[0]?.id ?? null,
  )
  const [deactivatePreview, setDeactivatePreview] = useState<{
    open: boolean
    refs: MockRef[]
    target: MockModel | null
  }>({ open: false, refs: [], target: null })
  const [newVersionOpen, setNewVersionOpen] = useState(false)
  const [rollbackConfirmOpen, setRollbackConfirmOpen] = useState(false)
  const [rollbackTarget, setRollbackTarget] = useState<{
    from: string
    to: string
  } | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [addSubmitting, setAddSubmitting] = useState(false)
  const [addForm] = Form.useForm<{
    name: string
    modality: Modality4
    endpoint_url: string
  }>()

  const filtered = useMemo(
    () =>
      q.trim()
        ? models.filter((m) =>
            m.name.toLowerCase().includes(q.toLowerCase().trim()),
          )
        : models,
    [models, q],
  )

  const selected = useMemo(
    () => models.find((m) => m.id === selectedId) ?? null,
    [models, selectedId],
  )

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
    setNewVersionOpen(true)
  }

  const confirmUploadNewVersion = () => {
    if (!selected) return
    const nextVersionNo =
      Math.max(
        ...selected.history.map((h) => parseInt(h.versionLabel.replace(/[^0-9]/g, ''), 10) || 0),
        parseInt(selected.currentVersion.versionLabel.replace(/[^0-9]/g, ''), 10) || 0,
      ) + 1
    const newV: MockVersion = {
      id: Math.floor(Math.random() * 1e6),
      versionLabel: `v${nextVersionNo}`,
      status: 'active',
      releasedAt: dayjs().format('YYYY-MM-DD'),
    }
    setModels((prev) =>
      prev.map((m) =>
        m.id === selected.id
          ? {
              ...m,
              status: 'active',
              currentVersion: newV,
              history: [newV, ...m.history],
            }
          : m,
      ),
    )
    message.success(`已上传新版本 ${newV.versionLabel} 并自动启用`)
    setNewVersionOpen(false)
  }

  // ── 操作：回滚版本 ──────────────────────
  const handleRollback = () => {
    if (!selected) return
    const previous = selected.history
      .filter(
        (h) =>
          h.id !== selected.currentVersion.id &&
          parseInt(h.versionLabel.replace(/[^0-9]/g, ''), 10) <
            parseInt(
              selected.currentVersion.versionLabel.replace(/[^0-9]/g, ''),
              10,
            ),
      )
      .sort(
        (a, b) =>
          parseInt(b.versionLabel.replace(/[^0-9]/g, ''), 10) -
          parseInt(a.versionLabel.replace(/[^0-9]/g, ''), 10),
      )[0]
    if (!previous) {
      message.warning('没有可回滚的历史版本')
      return
    }
    setRollbackTarget({
      from: selected.currentVersion.versionLabel,
      to: previous.versionLabel,
    })
    setRollbackConfirmOpen(true)
  }

  const confirmRollback = () => {
    if (!selected || !rollbackTarget) return
    const target = selected.history.find(
      (h) => h.versionLabel === rollbackTarget.to,
    )
    if (!target) {
      setRollbackConfirmOpen(false)
      return
    }
    setModels((prev) =>
      prev.map((m) =>
        m.id === selected.id
          ? {
              ...m,
              status: 'active',
              currentVersion: { ...target, status: 'active' },
              history: m.history.map((h) =>
                h.id === target.id
                  ? { ...h, status: 'active' }
                  : h.id === selected.currentVersion.id
                    ? { ...h, status: 'inactive' }
                    : h,
              ),
            }
          : m,
      ),
    )
    message.success(`已回滚到 ${target.versionLabel}`)
    setRollbackConfirmOpen(false)
    setRollbackTarget(null)
  }

  // ── 操作：新增模型 ──────────────────────
  const handleAddModel = async () => {
    const v = await addForm.validateFields().catch(() => null)
    if (!v) return
    setAddSubmitting(true)
    try {
      const today = dayjs().format('YYYY-MM-DD')
      const newId =
        models.length === 0 ? 1 : Math.max(...models.map((m) => m.id)) + 1
      const v1: MockVersion = {
        id: Date.now(),
        versionLabel: 'v1',
        status: 'inactive',
        releasedAt: today,
      }
      const newModel: MockModel = {
        id: newId,
        name: v.name.trim(),
        smallCategory: '',
        modality: v.modality,
        endpoint_url: v.endpoint_url.trim(),
        status: 'inactive',
        createdAt: today,
        currentVersion: v1,
        history: [v1],
        refs: [],
      }
      setModels((prev) => [...prev, newModel])
      setSelectedId(newId)
      addForm.resetFields()
      setAddOpen(false)
      message.success('已新增模型')
    } finally {
      setAddSubmitting(false)
    }
  }

  const closeAddModal = () => {
    setAddOpen(false)
    addForm.resetFields()
  }

  const handleActivateVersion = (version: MockVersion) => {
    if (!selected) return
    if (version.id === selected.currentVersion.id) return
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
    message.success(`已切换到 ${version.versionLabel}`)
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
        if (row.status === 'inactive') {
          return (
            <Space size={4}>
              <Button
                size="small"
                type="link"
                disabled={!canWrite}
                onClick={() => handleActivateVersion(row)}
              >
                回滚
              </Button>
              <Button size="small" type="link" disabled>
                查看
              </Button>
            </Space>
          )
        }
        return (
          <Button size="small" type="link" disabled>
            查看
          </Button>
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
            小模型（传统 ML/深度学习）注册、版本、上传与回滚管理
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
          <div style={{ marginBottom: 12 }}>
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
                    <Button
                      type="primary"
                      onClick={handleActivate}
                      disabled={!canWrite}
                    >
                      发布
                    </Button>
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
                  }}
                >
                  <Text strong style={{ fontSize: 15 }}>
                    【版本历史】
                  </Text>
                  <Text type="secondary" style={{ marginLeft: 12 }}>
                    {selected.history.length} 个版本
                  </Text>
                </div>
                <div style={{ padding: '0 24px 16px' }}>
                  <Table<MockVersion>
                    rowKey="id"
                    size="middle"
                    dataSource={selected.history}
                    columns={versionColumns}
                    pagination={false}
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
                  <Text strong style={{ fontSize: 15 }}>
                    【引用标签】
                  </Text>
                  <Text type="secondary" style={{ marginLeft: 12 }}>
                    ({selected.refs.length})
                  </Text>
                </div>

                {selected.refs.length === 0 ? (
                  <Empty description="暂无三级标签引用该模型" />
                ) : (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(2, 1fr)',
                      gap: '12px 32px',
                    }}
                  >
                    {selected.refs.map((r) => {
                      const parts = r.path
                        .split('/')
                        .map((s) => s.trim())
                        .filter(Boolean)
                      return (
                        <div
                          key={r.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '4px 0',
                          }}
                        >
                          {parts.map((p, i) => (
                            <Fragment key={i}>
                              {i === 0 ? (
                                <Tag
                                  style={{
                                    background: '#F1F5F9',
                                    borderColor: '#E2E8F0',
                                    color: '#475569',
                                    margin: 0,
                                  }}
                                >
                                  {p}
                                </Tag>
                              ) : (
                                <Text strong={i === parts.length - 1}>
                                  {p}
                                </Text>
                              )}
                              {i < parts.length - 1 && (
                                <Text
                                  type="secondary"
                                  style={{ margin: '0 2px' }}
                                >
                                  /
                                </Text>
                              )}
                            </Fragment>
                          ))}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              <div
                style={{
                  border: '1px solid #E2E8F0',
                  borderRadius: 8,
                  background: '#FFFFFF',
                  padding: '16px 24px',
                }}
              >
                <Space>
                  <Button
                    icon={<PlusOutlined />}
                    disabled={!canWrite}
                    onClick={handleUploadNewVersion}
                  >
                    上传新版本
                  </Button>
                  <Button
                    icon={<RollbackOutlined />}
                    disabled={!canWrite}
                    onClick={handleRollback}
                  >
                    回滚版本
                  </Button>
                </Space>
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

      {/* 上传新版本确认 */}
      <Modal
        title="上传新版本"
        open={newVersionOpen}
        onCancel={() => setNewVersionOpen(false)}
        onOk={confirmUploadNewVersion}
        okText="确认上传"
        cancelText="取消"
      >
        {selected && (
          <>
            <p>
              将为 <Text strong>{selected.name}</Text> 上传新版本。
            </p>
            <Alert
              type="info"
              showIcon
              message="新版本上传后将自动设为当前版本并启用，旧版本转为下线状态。"
            />
          </>
        )}
      </Modal>

      {/* 回滚版本确认 */}
      <Modal
        title="回滚版本确认"
        open={rollbackConfirmOpen}
        onCancel={() => {
          setRollbackConfirmOpen(false)
          setRollbackTarget(null)
        }}
        onOk={confirmRollback}
        okText="确认回滚"
        cancelText="取消"
      >
        {selected && rollbackTarget && (
          <p>
            将 <Text strong>{selected.name}</Text> 从{' '}
            <Text strong>{rollbackTarget.from}</Text> 回滚到{' '}
            <Text strong>{rollbackTarget.to}</Text>。
            <br />
            回滚后将自动启用 {rollbackTarget.to}，并把 {rollbackTarget.from} 转为下线状态。
          </p>
        )}
      </Modal>

      {/* 新增模型 */}
      <Modal
        open={addOpen}
        onCancel={closeAddModal}
        onOk={handleAddModel}
        okText="保存"
        cancelText="取消"
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
        >
          <Form.Item
            label="模型名称"
            name="name"
            rules={[
              { required: true, message: '请输入模型名称' },
              { max: 64, message: '最长 64 个字符' },
            ]}
          >
            <Input placeholder="请输入模型名称" />
          </Form.Item>

          <Form.Item
            label="模态"
            name="modality"
            rules={[{ required: true, message: '请选择模态' }]}
          >
            <Select
              placeholder="请选择模态"
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
            <Input placeholder="请输入 API 地址，例如 https://api.example.com/v1" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}