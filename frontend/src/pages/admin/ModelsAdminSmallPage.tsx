// 模型管理 / 小模型（接真实后端 API）
// 布局：左 280px 列表 + 右详情（版本历史、模型标签、推荐风险阈值、配置标签、模型测试）。
// 数据来源：registeredModelsApi / tagsApi；模型测试与接入校验走真实接口（结果仅存本次会话）。
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
  Spin,
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
  FileOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  SearchOutlined,
  ExclamationCircleOutlined,
  UpOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import { useAuthStore } from '@/store'
import { useRiskCategoryStore } from '@/store/riskCategories'
import { registeredModelsApi } from '@/api/registered-models'
import { tagsApi } from '@/api/tags'
import { runModelTest, type ModelTestResponse } from '@/api/modelTest'
import {
  runAccessCheck,
  type AccessCheckResult,
} from '@/api/modelAccessCheck'
import ModelConfigTagModal from '@/pages/admin/ModelConfigTagModal'
import type { ConfiguredTagEntry } from '@/pages/admin/configuredTagTypes'
import type {
  ArtifactUploadResponse,
  RegisteredModelListItem,
  RegisteredModelStatus,
  RegisteredModelVersion,
  TagReferenceItem,
  TagTreeNode,
} from '@/types/domain'
import { SMALL_MODEL_CATEGORY_OPTIONS } from '@/types/domain'

const { Text, Title } = Typography

// ── 模态选项（筛选用,4 类；新增小模型时后端仅支持 text / image） ──
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
// 新增小模型可选模态（后端 ALLOWED_MODALITY = text / image）
const MODALITY_OPTIONS_SMALL = MODALITY_OPTIONS_4.filter(
  (o) => o.value === 'text' || o.value === 'image',
)

// ── 页面展示类型（由真实 DTO 映射而来） ──
type DisplayStatus = 'active' | 'pending' | 'inactive'
interface VersionRow {
  id: number
  versionNo: number
  versionLabel: string
  status: DisplayStatus
  releasedAt: string
  endpointUrl: string | null
}
interface RiskThresholdRange {
  low: [number, number]
  mid: [number, number]
  high: [number, number]
}

// 模型状态映射：active→已发布；draft/validating→未发布；inactive/failed/archived→已下线
function toDisplayStatus(s: RegisteredModelStatus): DisplayStatus {
  if (s === 'active') return 'active'
  if (s === 'draft' || s === 'validating') return 'pending'
  return 'inactive'
}

// 版本状态映射：active→在线；draft/validated→未发布；inactive/failed/archived→已下线
function toVersionDisplayStatus(s: string): DisplayStatus {
  if (s === 'active') return 'active'
  if (s === 'draft' || s === 'validated') return 'pending'
  return 'inactive'
}

function mapVersion(v: RegisteredModelVersion): VersionRow {
  return {
    id: v.id,
    versionNo: v.version_no,
    versionLabel: v.version_label ?? `v${v.version_no}`,
    status: toVersionDisplayStatus(v.status),
    releasedAt: dayjs(v.created_at).format('YYYY-MM-DD'),
    endpointUrl: v.endpoint_url,
  }
}

// 模型标签（discoveredTags）：来自当前版本 config.points
function discoveredFromConfig(
  cfg: Record<string, unknown> | null | undefined,
): string[] {
  if (!cfg) return []
  const rawPoints = (cfg as { points?: unknown }).points
  if (!Array.isArray(rawPoints)) return []
  const out: string[] = []
  for (const p of rawPoints) {
    if (typeof p === 'string') {
      out.push(p)
    } else if (
      p != null &&
      typeof p === 'object' &&
      typeof (p as { label?: unknown }).label === 'string'
    ) {
      out.push((p as { label: string }).label)
    }
  }
  return out
}

function errDetail(err: unknown, fallback: string): string {
  const d = (err as { response?: { data?: { detail?: unknown } } })?.response
    ?.data?.detail
  return typeof d === 'string' ? d : fallback
}

function statusTag(status: DisplayStatus) {
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

function versionStatusTag(status: DisplayStatus): React.ReactNode {
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

// ── 模型文件上传（小模型 artifact，真实接口 uploadArtifact） ──
function ArtifactUploadButton({
  value,
  onChange,
}: {
  value: ArtifactUploadResponse | null
  onChange: (a: ArtifactUploadResponse | null) => void
}) {
  const { message } = App.useApp()
  const [uploading, setUploading] = useState(false)

  if (value) {
    return (
      <div
        style={{
          border: '1px solid #d9d9d9',
          borderRadius: 6,
          padding: '6px 12px',
          background: '#fafafa',
        }}
      >
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space>
            <FileOutlined style={{ color: '#1677ff' }} />
            <span>{value.filename}</span>
            <Tag>{(value.size / 1024 / 1024).toFixed(2)} MB</Tag>
          </Space>
          <Button
            type="link"
            size="small"
            danger
            onClick={() => onChange(null)}
          >
            重新上传
          </Button>
        </Space>
      </div>
    )
  }

  return (
    <Upload
      accept=".onnx,.pt,.pth,.bin,.zip,.tar,.gz,.tgz,.h5,.pb,.safetensors"
      showUploadList={false}
      customRequest={async ({ file, onSuccess, onError }) => {
        const f = file as File
        if (f.size > 512 * 1024 * 1024) {
          message.error('文件超过 512MB 上限')
          onError?.(new Error('文件超过 512MB 上限'))
          return
        }
        setUploading(true)
        try {
          const meta = await registeredModelsApi.uploadArtifact(f)
          onChange(meta)
          onSuccess?.(meta)
          message.success(
            `上传成功 · ${meta.filename} (${(meta.size / 1024 / 1024).toFixed(2)} MB)`,
          )
        } catch (e) {
          onError?.(e as Error)
          message.error(errDetail(e, '文件上传失败'))
        } finally {
          setUploading(false)
        }
      }}
    >
      <Button icon={<UploadOutlined />} loading={uploading}>
        选择模型文件
      </Button>
    </Upload>
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

  // ── 真实数据：模型列表 / 标签树 / 版本 ──────────────────────
  const [items, setItems] = useState<RegisteredModelListItem[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState(false)
  const [tagTree, setTagTree] = useState<TagTreeNode[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [versions, setVersions] = useState<VersionRow[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)

  // ── 会话级状态（后端无对应持久化字段,刷新后丢失） ──────────────────────
  const [testResults, setTestResults] = useState<
    Record<number, ModelTestResponse>
  >({})
  const [thresholdMap, setThresholdMap] = useState<
    Record<number, RiskThresholdRange>
  >({})
  const [configuredMap, setConfiguredMap] = useState<
    Record<number, ConfiguredTagEntry[]>
  >({})
  const [discoveredOverride, setDiscoveredOverride] = useState<
    Record<number, string[]>
  >({})

  const [q, setQ] = useState('')
  const [modalityFilter, setModalityFilter] = useState<Modality4[]>([])
  const [refTagsFilter, setRefTagsFilter] = useState<string[][]>([])
  const [deactivatePreview, setDeactivatePreview] = useState<{
    open: boolean
    loading: boolean
    tags: TagReferenceItem[]
    target: RegisteredModelListItem | null
  }>({ open: false, loading: false, tags: [], target: null })
  const [deactivating, setDeactivating] = useState(false)
  const [deleteChecking, setDeleteChecking] = useState(false)
  const [newVersionOpen, setNewVersionOpen] = useState(false)
  const [newVerArtifact, setNewVerArtifact] =
    useState<ArtifactUploadResponse | null>(null)
  const [newVerSaving, setNewVerSaving] = useState(false)
  const [publishTarget, setPublishTarget] = useState<VersionRow | null>(null)

  const fetchList = async (keepSelection = true) => {
    setListLoading(true)
    setListError(false)
    try {
      const res = await registeredModelsApi.list({ kind: 'small', size: 100 })
      setItems(res.items)
      setSelectedId((prev) => {
        if (keepSelection && prev != null && res.items.some((i) => i.id === prev))
          return prev
        return res.items[0]?.id ?? null
      })
    } catch {
      setListError(true)
    } finally {
      setListLoading(false)
    }
  }

  const fetchTagTree = async () => {
    try {
      setTagTree(await tagsApi.tree())
    } catch {
      // 保留旧树
    }
  }

  useEffect(() => {
    fetchList()
    fetchTagTree()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 选中模型变化 / 列表刷新后,重新拉取版本历史
  useEffect(() => {
    if (selectedId == null) {
      setVersions([])
      return
    }
    let cancelled = false
    setVersionsLoading(true)
    registeredModelsApi
      .listVersions(selectedId)
      .then((vs) => {
        if (cancelled) return
        setVersions(
          [...vs]
            .sort((a, b) => b.version_no - a.version_no)
            .map(mapVersion),
        )
      })
      .catch(() => {
        if (!cancelled) setVersions([])
      })
      .finally(() => {
        if (!cancelled) setVersionsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedId, reloadToken])

  const refreshAll = () => {
    fetchList()
    setReloadToken((t) => t + 1)
  }

  // ── 模型测试 ──────────────────────
  const [testImage, setTestImage] = useState<UploadFile | null>(null)
  const [testText, setTestText] = useState('')
  const [testRunning, setTestRunning] = useState(false)
  const [testCardOpen, setTestCardOpen] = useState(false)

  const selected = useMemo(
    () => items.find((m) => m.id === selectedId) ?? null,
    [items, selectedId],
  )

  const selectedDiscoveredTags = useMemo(
    () =>
      selected
        ? (discoveredOverride[selected.id] ??
          discoveredFromConfig(selected.current_version_config))
        : [],
    [selected, discoveredOverride],
  )
  const selectedConfiguredTags = selected
    ? (configuredMap[selected.id] ?? [])
    : []
  const selectedThreshold = selected ? thresholdMap[selected.id] : undefined

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
      const auditPoints = selectedDiscoveredTags.map((label) => ({ label }))
      const configuredTags = selectedConfiguredTags.map((c) => ({
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
              modelId: selected.id,
            })
          : await runModelTest({
              modality: 'image',
              imageFile:
                (testImage?.originFileObj as File | undefined) ??
                new File([new Blob()], testImage?.name ?? 'upload.png'),
              auditPoints,
              configuredTags,
              modelId: selected.id,
            })
      // 测试结果仅记录到本次会话（后端无测试历史持久化接口）
      setTestResults((prev) => ({ ...prev, [selected.id]: r }))
    } catch {
      message.error('测试失败')
    } finally {
      setTestRunning(false)
    }
  }

  // ── 推荐风险阈值（行内编辑,会话级保存）──────────────────────
  type ThresholdKey = 'low' | 'mid' | 'high'
  const [editingKey, setEditingKey] = useState<ThresholdKey | null>(null)
  const [draftLow, setDraftLow] = useState<[number, number]>([0, 0])
  const [draftMid, setDraftMid] = useState<[number, number]>([0, 0])
  const [draftHigh, setDraftHigh] = useState<[number, number]>([0, 1])

  const startEdit = (key: ThresholdKey) => {
    if (!selected) return
    if (!selectedThreshold) return
    if (key === 'low') setDraftLow([...selectedThreshold.low] as [number, number])
    if (key === 'mid') setDraftMid([...selectedThreshold.mid] as [number, number])
    if (key === 'high') setDraftHigh([...selectedThreshold.high] as [number, number])
    setEditingKey(key)
  }

  const commitEdit = (key: ThresholdKey) => {
    if (!selected) return
    const current = selectedThreshold
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
    setThresholdMap((prev) => ({ ...prev, [selected.id]: next }))
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

  // 切换模型时,丢弃未保存的阈值草稿
  useEffect(() => {
    return () => {
      setEditingKey(null)
    }
  }, [selectedId])

  // ── 新增模型 ──────────────────────
  const [addOpen, setAddOpen] = useState(false)
  const [addSubmitting, setAddSubmitting] = useState(false)
  const [addArtifact, setAddArtifact] = useState<ArtifactUploadResponse | null>(
    null,
  )
  const [addForm] = Form.useForm<{
    name: string
    small_category: string
    modality: 'text' | 'image'
    endpoint_url: string
  }>()
  const [accessRunning, setAccessRunning] = useState(false)
  const [accessChecked, setAccessChecked] = useState(false)
  const [accessResult, setAccessResult] = useState<AccessCheckResult | null>(
    null,
  )
  const riskItems = useRiskCategoryStore((s) => s.items)
  const ensureRiskLoaded = useRiskCategoryStore((s) => s.ensureLoaded)
  useEffect(() => {
    void ensureRiskLoaded()
  }, [ensureRiskLoaded])

  // 左侧筛选：标签 Cascader 选项（真实标签树,仅启用节点）
  const refTagTree = useMemo(() => {
    interface TreeNode {
      value: string
      label: string
      children?: TreeNode[]
    }
    const active = (nodes: TagTreeNode[]) =>
      nodes.filter((n) => n.status === 'active')
    return active(tagTree).map((l1) => {
      const l2Nodes: TreeNode[] = active(l1.children ?? []).map((l2) => {
        const l2Path = `${l1.name} / ${l2.name}`
        const l3Nodes: TreeNode[] = active(l2.children ?? []).map((l3) => ({
          value: `${l2Path} / ${l3.name}`,
          label: l3.name,
        }))
        return l3Nodes.length > 0
          ? { value: l2Path, label: l2.name, children: l3Nodes }
          : { value: l2Path, label: l2.name }
      })
      return { value: l1.name, label: l1.name, children: l2Nodes }
    })
  }, [tagTree])

  // 每个模型被哪些三级标签绑定（tag.bound_model_id,真实数据）
  const boundTagPathsByModel = useMemo(() => {
    const map = new Map<number, string[]>()
    const walk = (nodes: TagTreeNode[], trail: string[]) => {
      for (const n of nodes) {
        const path = [...trail, n.name]
        if (n.level === 3 && n.bound_model_id != null) {
          const arr = map.get(n.bound_model_id) ?? []
          arr.push(path.join(' / '))
          map.set(n.bound_model_id, arr)
        }
        if (n.children?.length) walk(n.children, path)
      }
    }
    walk(tagTree, [])
    return map
  }, [tagTree])

  const filtered = useMemo(
    () =>
      items.filter((m) => {
        if (
          q.trim() &&
          !m.name.toLowerCase().includes(q.toLowerCase().trim())
        )
          return false
        if (
          modalityFilter.length > 0 &&
          (!m.modality || !modalityFilter.includes(m.modality))
        )
          return false
        if (refTagsFilter.length > 0) {
          const paths = boundTagPathsByModel.get(m.id) ?? []
          const leafTags = refTagsFilter.map((arr) =>
            arr[arr.length - 1],
          )
          const hit = leafTags.some((tag) => paths.includes(tag))
          if (!hit) return false
        }
        return true
      }),
    [items, q, modalityFilter, refTagsFilter, boundTagPathsByModel],
  )

  // 测试结果：本次会话内,每个模型独立持有最近一次结果
  const testResult: ModelTestResponse | null = selected
    ? (testResults[selected.id] ?? null)
    : null

  // 测试门控：发布前需先在本次会话中通过测试（后端无测试历史持久化）
  const isCurrentModelTested = testResult !== null
  const isCurrentModelTestedPass =
    isCurrentModelTested && testResult.decision === 'pass'

  const currentVersionLabel = selected
    ? (selected.current_version_label ??
      (selected.current_version_no != null
        ? `v${selected.current_version_no}`
        : '—'))
    : '—'

  const nextVersionNo = useMemo(() => {
    if (versions.length === 0) return 1
    return Math.max(...versions.map((v) => v.versionNo)) + 1
  }, [versions])

  // ── 操作：发布 / 取消发布 ──────────────────────
  const handleActivate = async () => {
    if (!selected) return
    try {
      await registeredModelsApi.activate(selected.id)
      message.success('已发布')
      refreshAll()
    } catch (err) {
      message.error(errDetail(err, '发布失败'))
    }
  }

  const openDeactivatePreview = async () => {
    if (!selected) return
    const target = selected
    setDeactivatePreview({ open: true, loading: true, tags: [], target })
    try {
      const res = await tagsApi.referencesByModel(target.id)
      setDeactivatePreview((p) =>
        p.target?.id === target.id ? { ...p, loading: false, tags: res.items } : p,
      )
    } catch {
      setDeactivatePreview((p) => ({ ...p, loading: false }))
      message.error('查询引用标签失败')
    }
  }

  const confirmDeactivate = async () => {
    const target = deactivatePreview.target
    if (!target) return
    setDeactivating(true)
    try {
      await registeredModelsApi.deactivate(target.id)
      message.success('已取消发布')
      setDeactivatePreview({ open: false, loading: false, tags: [], target: null })
      refreshAll()
    } catch (err) {
      message.error(errDetail(err, '取消发布失败'))
    } finally {
      setDeactivating(false)
    }
  }

  // ── 操作：删除模型 ──────────────────────
  const handleDeleteModel = async () => {
    if (!selected) return
    const target = selected
    setDeleteChecking(true)
    try {
      const refs = await registeredModelsApi.references(target.id)
      if (refs.is_blocked) {
        Modal.warning({
          title: '无法删除 — 存在以下引用',
          width: 520,
          centered: true,
          okText: '关闭',
          content: (
            <ul style={{ marginTop: 8, paddingLeft: 20 }}>
              {refs.items.map((r) => (
                <li key={`${r.kind}-${r.id}`}>
                  <Tag color={r.kind === 'strategy' ? 'purple' : 'cyan'}>
                    {r.kind === 'strategy' ? '策略' : '审核项'}
                  </Tag>
                  <Text strong>{r.name}</Text>
                  {r.detail && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {` ${r.detail}`}
                    </Text>
                  )}
                </li>
              ))}
            </ul>
          ),
        })
        return
      }
      Modal.confirm({
        title: `确认删除模型「${target.name}」？`,
        content: '删除后该模型将从列表移除（软删除）,此操作不可撤销。',
        okText: '确认删除',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: async () => {
          try {
            await registeredModelsApi.delete(target.id)
            message.success('已删除')
            fetchList(false)
          } catch (err) {
            message.error(errDetail(err, '删除失败'))
          }
        },
      })
    } catch (err) {
      message.error(errDetail(err, '查询引用失败'))
    } finally {
      setDeleteChecking(false)
    }
  }

  // ── 操作：上传新版本 ──────────────────────
  const handleUploadNewVersion = () => {
    if (!selected) return
    setNewVerArtifact(null)
    setNewVersionOpen(true)
  }

  const confirmUploadNewVersion = async () => {
    if (!selected) return
    setNewVerSaving(true)
    try {
      const v = await registeredModelsApi.createVersion(selected.id, {
        artifact: newVerArtifact ?? undefined,
      })
      message.success(
        `已保存新版本 ${v.version_label ?? `v${v.version_no}`}，状态：未发布`,
      )
      setNewVersionOpen(false)
      setNewVerArtifact(null)
      refreshAll()
    } catch (err) {
      message.error(errDetail(err, '保存新版本失败'))
    } finally {
      setNewVerSaving(false)
    }
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
    if (!addArtifact) {
      message.warning('请上传模型文件')
      return
    }
    setAddSubmitting(true)
    try {
      const created = await registeredModelsApi.create({
        name: v.name.trim(),
        kind: 'small',
        small_category: v.small_category,
        modality: v.modality,
        registration_method: 'uploaded_file',
        artifact: addArtifact,
        status: 'draft',
      })
      // 接入校验发现的模型标签后端暂不持久化,本会话内展示
      if (accessResult && accessResult.discoveredTags.length > 0) {
        setDiscoveredOverride((prev) => ({
          ...prev,
          [created.id]: accessResult.discoveredTags,
        }))
      }
      addForm.resetFields()
      resetAccessState()
      setAddArtifact(null)
      setAddOpen(false)
      message.success('已新增模型')
      await fetchList(false)
      setSelectedId(created.id)
    } catch (err) {
      message.error(errDetail(err, '新增模型失败'))
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
    setAddArtifact(null)
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
  const handleSaveConfigTag = async (
    entry: ConfiguredTagEntry,
  ): Promise<boolean> => {
    if (!selected) return false
    try {
      await tagsApi.update(entry.tagId, {
        bound_model_id: selected.id,
        bound_model_kind: 'small',
      })
    } catch (err) {
      message.error(errDetail(err, '配置标签绑定失败'))
      return false
    }
    setConfiguredMap((prev) => ({
      ...prev,
      [selected.id]: [...(prev[selected.id] ?? []), entry],
    }))
    fetchTagTree()
    message.success(`已配置:${entry.discoveredTag} → ${entry.tagPath}`)
    return true
  }
  const handleRemoveConfigTag = async (tagId: string) => {
    if (!selected) return
    const target = selectedConfiguredTags.find((e) => e.tagId === tagId)
    if (!target) return

    // 策略引用反查（真实 references 接口,含 strategy 引用）
    let refStrategies: string[] = []
    try {
      const refs = await registeredModelsApi.references(selected.id)
      refStrategies = refs.items
        .filter((i) => i.kind === 'strategy')
        .map((i) => i.name)
    } catch {
      // 查询失败按无策略引用处理,不阻断移除
    }
    const isPublished = selected.status === 'active'
    const isRefByStrategy = refStrategies.length > 0

    const performRemove = async () => {
      try {
        await tagsApi.update(tagId, {
          bound_model_id: null,
          bound_model_kind: null,
        })
      } catch (err) {
        message.error(errDetail(err, '移除失败'))
        return
      }
      setConfiguredMap((prev) => ({
        ...prev,
        [selected.id]: (prev[selected.id] ?? []).filter(
          (e) => e.tagId !== tagId,
        ),
      }))
      fetchTagTree()
      message.success('已移除配置')
    }

    // 无任何阻塞项 → 直接移除
    if (!isPublished && !isRefByStrategy) {
      await performRemove()
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
  const handlePublishVersion = async (version: VersionRow) => {
    if (!selected) return
    try {
      await registeredModelsApi.activateVersion(selected.id, version.id)
      message.success(
        version.status === 'pending'
          ? `已发布 ${version.versionLabel}`
          : `已切换到 ${version.versionLabel}`,
      )
      refreshAll()
    } catch (err) {
      message.error(errDetail(err, '切换版本失败'))
    }
  }

  // ── 版本历史表 ──────────────────────
  const versionColumns: ColumnsType<VersionRow> = [
    {
      title: '版本',
      dataIndex: 'versionLabel',
      width: '20%',
      render: (v: string, row) => (
        <Space direction="vertical" size={0}>
          <Text strong>{v}</Text>
          {row.id === selected?.current_version_id && (
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
      render: (s: DisplayStatus) => versionStatusTag(s),
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
      dataIndex: 'endpointUrl',
      width: '24%',
      render: (url: string | null) => (
        <Text
          copyable={!!url}
          type={url ? undefined : 'secondary'}
          ellipsis={{ tooltip: url }}
          style={{ maxWidth: 280 }}
        >
          {url || '—'}
        </Text>
      ),
    },
    {
      title: '操作',
      width: '20%',
      render: (_, row) => {
        const isCurrent =
          selected && row.id === selected.current_version_id
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
            {listLoading ? (
              <div style={{ textAlign: 'center', padding: 24 }}>
                <Spin size="small" />
              </div>
            ) : listError ? (
              <Alert
                type="error"
                showIcon
                message="模型列表加载失败"
                action={
                  <Button size="small" onClick={() => fetchList(false)}>
                    重试
                  </Button>
                }
              />
            ) : filtered.length === 0 ? (
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
          {!selected && !listLoading && (
            <Empty description="请从左侧选择一个模型查看详情" />
          )}
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
                  <Space size={8}>
                    <Button
                      danger
                      type="text"
                      size="small"
                      disabled={!canWrite}
                      loading={deleteChecking}
                      onClick={handleDeleteModel}
                    >
                      删除
                    </Button>
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
                  </Space>
                </div>

                <Space
                  size={0}
                  wrap
                  align="center"
                  style={{ paddingRight: 200 }}
                >
                  <Text type="secondary">当前版本：</Text>
                  <Text strong style={{ marginRight: 16 }}>
                    {currentVersionLabel}
                  </Text>
                  <Divider type="vertical" />
                  <Text type="secondary" style={{ marginRight: 8 }}>
                    状态：
                  </Text>
                  {statusTag(toDisplayStatus(selected.status))}
                  <Divider type="vertical" />
                  <Text type="secondary">模态：</Text>
                  <Text strong style={{ marginRight: 16 }}>
                    {selected.modality
                      ? MODALITY_LABEL_4[selected.modality]
                      : '—'}
                  </Text>
                  <Divider type="vertical" />
                  <Text type="secondary">创建时间：</Text>
                  <Text strong>
                    {dayjs(selected.created_at).format('YYYY-MM-DD')}
                  </Text>
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
                      {versions.length} 个版本
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
                  <Table<VersionRow>
                    rowKey="id"
                    size="middle"
                    loading={versionsLoading}
                    dataSource={versions}
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
                      ({selectedDiscoveredTags.length})
                    </Text>
                  </Space>
                </div>

                {selectedDiscoveredTags.length > 0 ? (
                  <Space size={6} wrap>
                    {selectedDiscoveredTags.map((tag) => (
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

                {selectedThreshold || editingKey !== null ? (
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
                          : (selectedThreshold?.[key] ?? draft)
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
                    {selectedThreshold && (
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
                      ({selectedConfiguredTags.length})
                    </Text>
                  </Space>
                  <Button
                    size="small"
                    type="primary"
                    icon={<PlusOutlined />}
                    disabled={
                      !canWrite ||
                      selectedDiscoveredTags.length === 0 ||
                      selectedDiscoveredTags.every((t) =>
                        selectedConfiguredTags.some(
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
                  configuredTags={selectedConfiguredTags}
                  discoveredTags={selectedDiscoveredTags}
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
                        {selected.name} {currentVersionLabel}
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
                            {currentVersionLabel}
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
        onClose={() => setDeactivatePreview({ open: false, loading: false, tags: [], target: null })}
        destroyOnClose
        extra={
          <Tag color="orange">
            <ExclamationCircleOutlined /> 影响 {deactivatePreview.tags.length} 个三级标签
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
              {deactivatePreview.loading ? (
                <div style={{ textAlign: 'center', padding: 12 }}>
                  <Spin size="small" />
                </div>
              ) : deactivatePreview.tags.length === 0 ? (
                <Text type="secondary">无引用</Text>
              ) : (
                deactivatePreview.tags.map((t) => (
                  <div key={t.id} style={{ padding: '4px 0' }}>
                    <Tag color="blue">{t.path}</Tag>
                  </div>
                ))
              )}
            </div>
            <div style={{ marginTop: 24, textAlign: 'right' }}>
              <Space>
                <Button onClick={() => setDeactivatePreview({ open: false, loading: false, tags: [], target: null })}>
                  返回
                </Button>
                <Button
                  danger
                  type="primary"
                  loading={deactivating}
                  onClick={confirmDeactivate}
                >
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
        okButtonProps={{ disabled: !canWrite }}
        confirmLoading={newVerSaving}
        width={520}
        destroyOnClose
      >
        {selected && (
          <Form layout="vertical" style={{ marginTop: 8 }}>
            <Form.Item label="模型名称">
              <Input value={selected.name} disabled />
            </Form.Item>

            <Form.Item label="当前版本">
              <Space size={8}>
                <Tag>{currentVersionLabel}</Tag>
                <Text type="secondary">→</Text>
                <Tag color="blue">v{nextVersionNo}</Tag>
              </Space>
            </Form.Item>

            <Form.Item label="模型文件（可选,不上传则沿用当前版本文件）">
              <ArtifactUploadButton
                value={newVerArtifact}
                onChange={setNewVerArtifact}
              />
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
              <Text strong>{currentVersionLabel}</Text>{' '}
              切换到 <Text strong>{publishTarget.versionLabel}</Text>。
            </p>
            <Alert
              type="warning"
              showIcon
              message={
                <>
                  切换后将启用{' '}
                  <Text strong>{publishTarget.versionLabel}</Text> 作为当前版本
                  （已发布/在线），<Text strong>{currentVersionLabel}</Text>{' '}
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
            label="识别风险类型"
            name="small_category"
            rules={[{ required: true, message: '请选择识别风险类型' }]}
          >
            <Select
              placeholder="请选择识别风险类型"
              disabled={accessRunning}
              options={
                riskItems.length > 0
                  ? riskItems.map((o) => ({
                      value: o.code,
                      label: o.label,
                    }))
                  : SMALL_MODEL_CATEGORY_OPTIONS.map((o) => ({
                      value: o.value,
                      label: o.label,
                    }))
              }
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
              options={MODALITY_OPTIONS_SMALL.map((o) => ({
                value: o.value,
                label: o.label,
              }))}
            />
          </Form.Item>

          <Form.Item label="模型文件" required>
            <ArtifactUploadButton
              value={addArtifact}
              onChange={setAddArtifact}
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
        model={
          selected
            ? {
                id: selected.id,
                name: selected.name,
                discoveredTags: selectedDiscoveredTags,
                configuredTags: selectedConfiguredTags,
              }
            : null
        }
        allModels={items.map((m) => ({
          id: m.id,
          name: m.name,
          discoveredTags:
            discoveredOverride[m.id] ??
            discoveredFromConfig(m.current_version_config),
          configuredTags: configuredMap[m.id] ?? [],
        }))}
        tagTree={tagTree}
        onSave={handleSaveConfigTag}
      />
    </div>
  )
}
