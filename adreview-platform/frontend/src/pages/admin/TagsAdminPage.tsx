// 标签管理（系统管理 → 标签管理）
// 设计要点（v2）：
//   - 所有新增标签均为三级（叶子）；一级 / 二级仅作历史数据展示
//   - Drawer 字段平铺展示（无多步向导）：
//       基础信息 + 模态选择 + 模型绑定配置 + 状态
//   - 三级标签可"绑定模型 / 不绑定模型"开关：
//       · 关闭 → 保存后该标签无 bound_model_id / bound_model_kind
//       · 开启 → 按所选模态渲染卡片，每张卡片可独立决定是否绑定模型
//   - 未绑定模型的三级标签没有阈值入口（后续审核规则页提供阈值，本页不渲染）
//   - 列表行为：每个 {模态, 模型} 组合占一行（一级 / 二级无三级子节点时单独成行）
import { useEffect, useMemo, useState } from 'react'
import {
  App,
  Alert,
  Button,
  Card,
  Checkbox,
  Drawer,
  Empty,
  Form,
  Input,
  Popconfirm,
  Radio,
  Select,
  Space,
  Switch,
  Table,
  Tag as AntdTag,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  PlusOutlined,
  SearchOutlined,
  EditOutlined,
  DeleteOutlined,
  TagsOutlined,
  CheckOutlined,
  CloseOutlined,
} from '@ant-design/icons'

const { Text, Title } = Typography

type Level = 1 | 2 | 3
type Status = 'active' | 'inactive'
type Modality = 'text' | 'image' | 'audio' | 'video'
type ModelKind = 'large' | 'small'

const MODALITY_META: Record<Modality, { label: string }> = {
  text: { label: '文本' },
  image: { label: '图像' },
  audio: { label: '音频' },
  video: { label: '视频' },
}

const MODALITY_ORDER: Modality[] = ['text', 'image', 'audio', 'video']

interface MockModel {
  id: number
  name: string
  kind: ModelKind
  version: string
  modality: Modality
}

interface MockTag {
  id: string
  level: Level
  name: string
  status: Status
  parentId: string | null
  modality?: Modality
  boundModelId?: number
}

const MOCK_MODELS: MockModel[] = [
  { id: 1, name: 'gpt-4o-mini', kind: 'small', version: 'v2', modality: 'text' },
  { id: 2, name: 'claude-3-haiku', kind: 'small', version: 'v1', modality: 'text' },
  { id: 3, name: 'qwen-vl-max', kind: 'small', version: 'v3', modality: 'image' },
  { id: 4, name: 'leader_v1', kind: 'small', version: 'v1', modality: 'image' },
  { id: 5, name: 'cartoon_model', kind: 'small', version: 'v3', modality: 'image' },
  { id: 6, name: 'flag_model', kind: 'small', version: 'v2', modality: 'image' },
  { id: 7, name: 'ocr_model', kind: 'small', version: 'v5', modality: 'image' },
  { id: 8, name: 'face_model', kind: 'small', version: 'v4', modality: 'image' },
  { id: 9, name: 'nsfw_detector', kind: 'small', version: 'v6', modality: 'image' },
  { id: 10, name: 'speech_to_text', kind: 'small', version: 'v2', modality: 'audio' },
]

const INITIAL_MOCK_TAGS: MockTag[] = [
  { id: 'l1-politics', level: 1, name: '涉政', status: 'active', parentId: null },
  { id: 'l1-ads_law', level: 1, name: '广告法', status: 'active', parentId: null },
  { id: 'l1-porn', level: 1, name: '涉黄', status: 'active', parentId: null },
  { id: 'l1-medical', level: 1, name: '医药', status: 'active', parentId: null },
  { id: 'l1-violence', level: 1, name: '涉暴', status: 'active', parentId: null },
  { id: 'l1-custom', level: 1, name: '自定义', status: 'inactive', parentId: null },

  { id: 'l2-leader1', level: 2, name: '一号领导', status: 'active', parentId: 'l1-politics' },
  { id: 'l2-leader2', level: 2, name: '二号领导', status: 'active', parentId: 'l1-politics' },
  { id: 'l2-flag', level: 2, name: '国旗国徽', status: 'active', parentId: 'l1-politics' },
  { id: 'l2-cartoon_pol', level: 2, name: '政治讽刺', status: 'active', parentId: 'l1-politics' },
  { id: 'l2-absolute', level: 2, name: '极限词', status: 'active', parentId: 'l1-ads_law' },
  { id: 'l2-fake_claim', level: 2, name: '虚假宣传', status: 'active', parentId: 'l1-ads_law' },
  { id: 'l2-nude', level: 2, name: '成人内容', status: 'active', parentId: 'l1-porn' },
  { id: 'l2-cartoon_porn', level: 2, name: '色情漫画', status: 'inactive', parentId: 'l1-porn' },
  { id: 'l2-medical_claim', level: 2, name: '医药宣传', status: 'active', parentId: 'l1-medical' },
  { id: 'l2-weapon', level: 2, name: '武器', status: 'active', parentId: 'l1-violence' },

  { id: 'l3-leader1-write', level: 3, name: '写实', status: 'active', parentId: 'l2-leader1', modality: 'image', boundModelId: 4 },
  { id: 'l3-leader1-cartoon', level: 3, name: '漫画', status: 'active', parentId: 'l2-leader1', modality: 'image', boundModelId: 5 },
  { id: 'l3-leader2-cartoon', level: 3, name: '漫画', status: 'active', parentId: 'l2-leader2', modality: 'image', boundModelId: 5 },
  { id: 'l3-leader2-text', level: 3, name: '文本描述', status: 'active', parentId: 'l2-leader2', modality: 'text', boundModelId: 1 },
  { id: 'l3-flag-vandalize', level: 3, name: '篡改', status: 'active', parentId: 'l2-flag', modality: 'image', boundModelId: 6 },
  { id: 'l3-flag-graffiti', level: 3, name: '涂鸦', status: 'active', parentId: 'l2-flag', modality: 'image', boundModelId: 6 },
  { id: 'l3-cartoon_pol-latest', level: 3, name: '时政讽刺', status: 'active', parentId: 'l2-cartoon_pol', modality: 'image', boundModelId: 5 },
  { id: 'l3-cartoon_pol-history', level: 3, name: '历史讽刺', status: 'active', parentId: 'l2-cartoon_pol', modality: 'image', boundModelId: 5 },
  { id: 'l3-absolute-text', level: 3, name: '极限用语', status: 'active', parentId: 'l2-absolute', modality: 'text', boundModelId: 7 },
  { id: 'l3-absolute-image', level: 3, name: '极限标语', status: 'active', parentId: 'l2-absolute', modality: 'image', boundModelId: 7 },
  { id: 'l3-fake_claim-text', level: 3, name: '夸大疗效', status: 'active', parentId: 'l2-fake_claim', modality: 'text', boundModelId: 1 },
  { id: 'l3-nude-face', level: 3, name: '成人面部', status: 'active', parentId: 'l2-nude', modality: 'image', boundModelId: 8 },
  { id: 'l3-nude-body', level: 3, name: '成人裸露', status: 'active', parentId: 'l2-nude', modality: 'image', boundModelId: 9 },
  { id: 'l3-nude-voice', level: 3, name: '音频呻吟', status: 'active', parentId: 'l2-nude', modality: 'audio', boundModelId: 10 },
  { id: 'l3-cartoon_porn-anime', level: 3, name: '动漫色情', status: 'inactive', parentId: 'l2-cartoon_porn', modality: 'image', boundModelId: 5 },
  { id: 'l3-medical_claim-text', level: 3, name: '包治百病', status: 'active', parentId: 'l2-medical_claim', modality: 'text', boundModelId: 1 },
  { id: 'l3-weapon-real', level: 3, name: '真实武器', status: 'active', parentId: 'l2-weapon', modality: 'image', boundModelId: 3 },
  { id: 'l3-weapon-toy', level: 3, name: '仿真玩具', status: 'active', parentId: 'l2-weapon', modality: 'image', boundModelId: 3 },
]

interface ModalityBinding {
  enabled: boolean
  modelId?: number
}

interface DrawerState {
  open: boolean
  editing: MockTag | null
  modalities: Modality[]
  bindings: Record<Modality, ModalityBinding>
}

const EMPTY_BINDINGS: Record<Modality, ModalityBinding> = {
  text: { enabled: false },
  image: { enabled: false },
  audio: { enabled: false },
  video: { enabled: false },
}

interface FlatRow {
  key: string
  rowTag: MockTag
  l1: MockTag | null
  l2: MockTag | null
  l3: MockTag | null
}

function findById(list: MockTag[], id: string | null | undefined): MockTag | null {
  if (!id) return null
  return list.find((t) => t.id === id) ?? null
}

function getModelsByModality(modality: Modality): MockModel[] {
  return MOCK_MODELS.filter((m) => m.modality === modality)
}

function buildInitialBindings(
  modalities: Modality[],
  editingModality: Modality | undefined,
  editingModelId: number | undefined,
): Record<Modality, ModalityBinding> {
  const next = { ...EMPTY_BINDINGS }
  for (const mod of modalities) {
    if (editingModality === mod && editingModelId != null) {
      next[mod] = { enabled: true, modelId: editingModelId }
    } else {
      next[mod] = { enabled: false }
    }
  }
  return next
}

export default function TagsAdminPage() {
  const { message } = App.useApp()

  const [tags, setTags] = useState<MockTag[]>(INITIAL_MOCK_TAGS)
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | Status>('all')
  const [level1Filter, setLevel1Filter] = useState<string>('')
  const [level2Filter, setLevel2Filter] = useState<string>('')
  const [level3Filter, setLevel3Filter] = useState<string>('')
  const [drawer, setDrawer] = useState<DrawerState>({
    open: false,
    editing: null,
    modalities: [],
    bindings: EMPTY_BINDINGS,
  })
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  // ── 派生：扁平行 ──
  const flatRows = useMemo<FlatRow[]>(() => {
    const rows: FlatRow[] = []
    const l1Tags = tags.filter((t) => t.level === 1)
    for (const l1 of l1Tags) {
      const l2Children = tags
        .filter((t) => t.level === 2 && t.parentId === l1.id)
        .sort((a, b) => a.name.localeCompare(b.name))
      if (l2Children.length === 0) {
        rows.push({ key: `row-${l1.id}`, rowTag: l1, l1, l2: null, l3: null })
        continue
      }
      for (const l2 of l2Children) {
        const l3Children = tags
          .filter((t) => t.level === 3 && t.parentId === l2.id)
          .sort((a, b) => a.name.localeCompare(b.name))
        if (l3Children.length === 0) {
          rows.push({ key: `row-${l2.id}`, rowTag: l2, l1, l2, l3: null })
          continue
        }
        for (const l3 of l3Children) {
          rows.push({ key: `row-${l3.id}`, rowTag: l3, l1, l2, l3 })
        }
      }
    }
    return rows
  }, [tags])

  const level1Options = useMemo(
    () => tags.filter((t) => t.level === 1).map((t) => ({ value: t.id, label: t.name })),
    [tags],
  )
  const level2Options = useMemo(
    () =>
      (() => {
        const l1 = form.getFieldValue('parent_l1') as string | undefined
        return tags
          .filter((t) => t.level === 2 && (!l1 || t.parentId === l1))
          .map((t) => ({ value: t.id, label: t.name }))
      })(),
    [tags, form],
  )

  // 过滤选项
  const l1FilterOptions = useMemo(
    () => tags.filter((t) => t.level === 1).map((t) => ({ value: t.id, label: t.name })),
    [tags],
  )
  const l2FilterOptions = useMemo(
    () =>
      (level1Filter
        ? tags.filter((t) => t.level === 2 && t.parentId === level1Filter)
        : tags.filter((t) => t.level === 2)
      ).map((t) => ({ value: t.id, label: t.name })),
    [tags, level1Filter],
  )
  const l3FilterOptions = useMemo(
    () =>
      (level2Filter
        ? tags.filter((t) => t.level === 3 && t.parentId === level2Filter)
        : tags.filter((t) => t.level === 3)
      ).map((t) => ({ value: t.id, label: t.name })),
    [tags, level2Filter],
  )

  const filteredRows = useMemo(() => {
    const trimmed = q.trim().toLowerCase()
    return flatRows.filter((row) => {
      const { l1, l2, l3, rowTag } = row
      if (statusFilter !== 'all' && rowTag.status !== statusFilter) return false
      if (level1Filter && l1?.id !== level1Filter) return false
      if (level2Filter && l2?.id !== level2Filter) return false
      if (level3Filter && l3?.id !== level3Filter) return false
      if (!trimmed) return true
      const model = MOCK_MODELS.find((m) => m.id === l3?.boundModelId)
      const haystack = [
        l1?.name ?? '',
        l2?.name ?? '',
        l3?.name ?? '',
        model?.name ?? '',
        model?.version ?? '',
        l3?.modality ?? '',
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(trimmed)
    })
  }, [flatRows, q, statusFilter, level1Filter, level2Filter, level3Filter])

  // ── Drawer 操作 ──
  const openCreate = () => {
    form.resetFields()
    form.setFieldsValue({ level: 1, status: 'active', bind_model: true })
    setDrawer({
      open: true,
      editing: null,
      modalities: [],
      bindings: EMPTY_BINDINGS,
    })
  }

  const openEdit = (row: MockTag) => {
    form.resetFields()
    let parent_l1: string | undefined
    let parent_l2: string | undefined
    if (row.parentId) {
      const p = findById(tags, row.parentId)
      if (p) {
        if (p.level === 1) parent_l1 = p.id
        if (p.level === 2) {
          parent_l2 = p.id
          if (p.parentId) parent_l1 = p.parentId
        }
      }
    }
    form.setFieldsValue({
      level: row.level,
      name: row.name,
      status: row.status,
      parent_l1,
      parent_l2,
      bind_model: row.boundModelId != null,
    })
    const modalities = row.level === 3 && row.modality ? [row.modality] : []
    setDrawer({
      open: true,
      editing: row,
      modalities,
      bindings: buildInitialBindings(modalities, row.modality, row.boundModelId),
    })
  }

  const closeDrawer = () => {
    setDrawer({
      open: false,
      editing: null,
      modalities: [],
      bindings: EMPTY_BINDINGS,
    })
    form.resetFields()
  }

  const handleSave = async () => {
    try {
      const v = await form.validateFields()
      const level = v.level as Level
      const bindModel = v.bind_model as boolean | undefined

      if (level === 3) {
        if (drawer.modalities.length === 0) {
          message.warning('请至少选择 1 个模态')
          return
        }
        if (bindModel) {
          const anyEnabled = drawer.modalities.some(
            (m) => drawer.bindings[m].enabled,
          )
          if (!anyEnabled) {
            message.warning('请为至少一个模态启用模型绑定')
            return
          }
          const missing = drawer.modalities.find(
            (m) => drawer.bindings[m].enabled && drawer.bindings[m].modelId == null,
          )
          if (missing) {
            message.warning(`请为「${MODALITY_META[missing].label}」模态选择模型`)
            return
          }
        }
      }

      setSaving(true)

      const parentId: string | null =
        level === 1
          ? null
          : level === 2
            ? (v.parent_l1 as string | undefined) ?? null
            : (v.parent_l2 as string | undefined) ?? null
      const editing = drawer.editing
      const timestamp = Date.now()

      const buildBaseRecord = (id: string, idx: number): MockTag => {
        if (level !== 3) {
          return {
            id,
            level,
            name: v.name,
            status: v.status,
            parentId,
          }
        }
        const mod = drawer.modalities[idx]
        const b = drawer.bindings[mod]
        return {
          id,
          level: 3,
          name: v.name,
          status: v.status,
          parentId,
          modality: mod,
          boundModelId: b.enabled ? b.modelId : undefined,
        }
      }

      if (editing) {
        setTags((prev) => {
          const filtered = prev.filter((t) => t.id !== editing.id)
          if (level === 3 && bindModel) {
            const records = drawer.modalities.map<MockTag>((_mod, idx) =>
              buildBaseRecord(idx === 0 ? editing.id : `${editing.id}-${_mod}`, idx),
            )
            return [...records, ...filtered]
          }
          return [buildBaseRecord(editing.id, 0), ...filtered]
        })
        message.success('已保存')
      } else {
        if (level === 3 && bindModel) {
          const created = drawer.modalities.map<MockTag>((mod, idx) =>
            buildBaseRecord(
              idx === 0 ? `t-${timestamp}` : `t-${timestamp}-${mod}`,
              idx,
            ),
          )
          setTags((prev) => [...created, ...prev])
        } else {
          setTags((prev) => [buildBaseRecord(`t-${timestamp}`, 0), ...prev])
        }
        message.success('已新增')
      }
      closeDrawer()
    } catch {
      // 校验失败
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = (id: string) => {
    const toDelete = new Set<string>([id])
    let frontier: string[] = [id]
    while (frontier.length) {
      const children = tags
        .filter((t) => t.parentId && frontier.includes(t.parentId))
        .map((t) => t.id)
      if (children.length === 0) break
      children.forEach((c) => toDelete.add(c))
      frontier = children
    }
    setTags((prev) => prev.filter((t) => !toDelete.has(t.id)))
    message.success(`已删除（${toDelete.size} 个）`)
  }

  const toggleStatus = (row: MockTag) => {
    setTags((prev) =>
      prev.map((t) =>
        t.id === row.id
          ? { ...t, status: t.status === 'active' ? 'inactive' : 'active' }
          : t,
      ),
    )
    message.success(row.status === 'active' ? '已停用' : '已启用')
  }

  // ── 父级联动:一级变更时清空二级 ──
  const watchL1 = Form.useWatch('parent_l1', form)
  useEffect(() => {
    const currentL2 = form.getFieldValue('parent_l2') as string | undefined
    if (watchL1 && currentL2) {
      const stillValid = tags.some(
        (t) => t.id === currentL2 && t.level === 2 && t.parentId === watchL1,
      )
      if (!stillValid) form.setFieldValue('parent_l2', undefined)
    }
  }, [watchL1, tags, form])

  const setBinding = (mod: Modality, patch: Partial<ModalityBinding>) => {
    setDrawer((s) => ({
      ...s,
      bindings: {
        ...s.bindings,
        [mod]: { ...s.bindings[mod], ...patch },
      },
    }))
  }

  // ── 列定义 ──
  const columns: ColumnsType<FlatRow> = [
    {
      title: '标签',
      minWidth: 280,
      render: (_, row) => {
        const segments: { name: string; isSubject: boolean }[] = []
        if (row.l1) segments.push({ name: row.l1.name, isSubject: row.rowTag.id === row.l1.id })
        if (row.l2) segments.push({ name: row.l2.name, isSubject: row.rowTag.id === row.l2.id })
        if (row.l3) segments.push({ name: row.l3.name, isSubject: row.rowTag.id === row.l3.id })
        if (segments.length === 0) return <Text type="secondary">—</Text>

        const subjectL3 = row.rowTag.level === 3 ? row.rowTag : null
        const m = subjectL3
          ? MOCK_MODELS.find((mm) => mm.id === subjectL3.boundModelId)
          : null

        return (
          <Space direction="vertical" size={0}>
            <Text>
              {segments.map((s, i) => (
                <span key={i}>
                  {i > 0 && <Text type="secondary"> / </Text>}
                  <Text strong={s.isSubject}>{s.name}</Text>
                </span>
              ))}
            </Text>
            {subjectL3 && !m && (
              <Text type="secondary" style={{ fontSize: 11 }}>
                未绑定模型 · 无阈值
              </Text>
            )}
          </Space>
        )
      },
    },
    {
      title: '模态',
      minWidth: 120,
      render: (_, row) => {
        const m = row.l3?.modality
        if (!m) return <Text type="secondary">—</Text>
        const meta = MODALITY_META[m]
        return <AntdTag color="cyan">{meta.label}</AntdTag>
      },
    },
    {
      title: '模型',
      minWidth: 140,
      render: (_, row) => {
        if (!row.l3) return <Text type="secondary">—</Text>
        const m = MOCK_MODELS.find((mm) => mm.id === row.l3?.boundModelId)
        if (!m) return <Text type="danger">未绑定</Text>
        return <Text>{m.name}</Text>
      },
    },
    {
      title: '版本',
      minWidth: 76,
      render: (_, row) => {
        const m = MOCK_MODELS.find((mm) => mm.id === row.l3?.boundModelId)
        if (!m) return <Text type="secondary">—</Text>
        return <AntdTag>{m.version}</AntdTag>
      },
    },
    {
      title: '状态',
      minWidth: 96,
      render: (_, row) => (
        <a
          onClick={() => toggleStatus(row.rowTag)}
          style={{ cursor: 'pointer' }}
        >
          {row.rowTag.status === 'active' ? (
            <AntdTag color="green">已启用</AntdTag>
          ) : (
            <AntdTag>已停用</AntdTag>
          )}
        </a>
      ),
    },
    {
      title: '操作',
      width: 140,
      fixed: 'right',
      render: (_, row) => (
        <Space size={4}>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => openEdit(row.rowTag)}
          >
            编辑
          </Button>
          <Popconfirm
            title={`确认删除「${row.rowTag.name}」？`}
            description={
              row.rowTag.level < 3
                ? '将连同子标签一并删除'
                : '删除后三级标签的模型绑定将解除'
            }
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => handleDelete(row.rowTag.id)}
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const watchBindModel = Form.useWatch('bind_model', form) as boolean | undefined
  const watchLevel = Form.useWatch('level', form) as Level | undefined
  const watchEditing = drawer.editing

  // ── Drawer body ──
  const drawerBody = (
    <Form form={form} layout="vertical" requiredMark={false}>
      <Form.Item
        label="层级"
        name="level"
        rules={[{ required: true, message: '请选择层级' }]}
      >
        <Radio.Group
          disabled={!!watchEditing}
          onChange={() => {
            form.setFieldValue('parent_l1', undefined)
            form.setFieldValue('parent_l2', undefined)
            setDrawer((s) => ({
              ...s,
              modalities: [],
              bindings: { ...EMPTY_BINDINGS },
            }))
          }}
        >
          <Radio.Button value={1}>一级</Radio.Button>
          <Radio.Button value={2}>二级</Radio.Button>
          <Radio.Button value={3}>三级</Radio.Button>
        </Radio.Group>
      </Form.Item>

      {(watchLevel === 2 || watchLevel === 3) && (
        <Form.Item
          label="一级标签"
          name="parent_l1"
          rules={[{ required: true, message: '请选择一级标签' }]}
        >
          <Select
            placeholder="请选择"
            options={level1Options}
            showSearch
            optionFilterProp="label"
            disabled={!!watchEditing}
          />
        </Form.Item>
      )}

      {watchLevel === 3 && (
        <Form.Item
          label="二级标签"
          name="parent_l2"
          rules={[{ required: true, message: '请选择二级标签' }]}
        >
          <Select
            placeholder="请选择"
            options={level2Options}
            showSearch
            optionFilterProp="label"
            disabled={!!watchEditing}
          />
        </Form.Item>
      )}

      <Form.Item
        label="标签名称"
        name="name"
        rules={[
          { required: true, message: '请输入标签名称' },
          { max: 32, message: '标签名称最多 32 字' },
        ]}
      >
        <Input placeholder="请输入标签名称" maxLength={32} showCount />
      </Form.Item>

      <Form.Item
        label="状态"
        name="status"
        rules={[{ required: true, message: '请选择状态' }]}
      >
        <Radio.Group>
          <Radio.Button value="active">已启用</Radio.Button>
          <Radio.Button value="inactive">已停用</Radio.Button>
        </Radio.Group>
      </Form.Item>

      {watchLevel === 3 && (
        <Form.Item
          label="适用模态"
          required
          tooltip="至少选择 1 个模态;选择多个模态时,可分别为每个模态独立决定是否绑定模型"
        >
          <Checkbox.Group
            value={drawer.modalities}
            onChange={(vals) => {
              const next = vals as Modality[]
              setDrawer((s) => {
                const nextBindings = { ...s.bindings }
                MODALITY_ORDER.forEach((m) => {
                  if (!next.includes(m)) {
                    nextBindings[m] = { enabled: false }
                  }
                })
                return { ...s, modalities: next, bindings: nextBindings }
              })
            }}
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}
          >
            {MODALITY_ORDER.map((mod) => {
              const meta = MODALITY_META[mod]
              return (
                <Checkbox key={mod} value={mod} style={{ marginLeft: 0 }}>
                  <span style={{ fontSize: 14 }}>{meta.label}</span>
                </Checkbox>
              )
            })}
          </Checkbox.Group>
          {drawer.modalities.length === 0 && (
            <div style={{ marginTop: 4, color: '#ff4d4f', fontSize: 12 }}>
              请至少选择 1 个模态
            </div>
          )}
        </Form.Item>
      )}

      {watchLevel === 3 && (
        <Form.Item
          label="绑定模型"
          name="bind_model"
          valuePropName="checked"
          tooltip="关闭后,该三级标签不会绑定任何模型,后续也不会出现阈值配置入口"
        >
          <Switch disabled={!!watchEditing} />
        </Form.Item>
      )}

      {watchLevel === 3 && watchBindModel && drawer.modalities.length > 0 && (
        <>
          <div style={{ marginBottom: 16 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              为每个模态独立选择是否绑定模型。关闭开关表示该模态不绑定模型;开启后必须选择具体模型。
            </Text>
          </div>
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            {drawer.modalities.map((mod) => {
              const binding = drawer.bindings[mod]
              const meta = MODALITY_META[mod]
              const candidates = getModelsByModality(mod)
              return (
                <Card
                  key={mod}
                  size="small"
                  title={
                    <Space>
                      <span>{meta.label}模态</span>
                      <AntdTag color="cyan">{candidates.length} 个候选模型</AntdTag>
                    </Space>
                  }
                  extra={
                    <Space>
                      <Text type="secondary">{binding.enabled ? '绑定' : '不绑定'}</Text>
                      <Switch
                        checked={binding.enabled}
                        onChange={(checked) =>
                          setBinding(mod, {
                            enabled: checked,
                            modelId: checked ? binding.modelId : undefined,
                          })
                        }
                      />
                    </Space>
                  }
                >
                  {binding.enabled ? (
                    <Form.Item
                      label="模型"
                      required
                      style={{ marginBottom: 0 }}
                      validateStatus={binding.modelId ? 'success' : 'error'}
                      help={binding.modelId ? undefined : '请选择模型'}
                    >
                      <Select
                        placeholder="搜索并选择模型"
                        value={binding.modelId}
                        onChange={(v) => setBinding(mod, { modelId: v })}
                        showSearch
                        optionFilterProp="label"
                        filterOption={(input, option) =>
                          ((option?.label ?? '') as string)
                            .toLowerCase()
                            .includes(input.trim().toLowerCase())
                        }
                        options={candidates.map((m) => ({
                          value: m.id,
                          label: `${m.name} · ${m.version} (${m.kind === 'large' ? '大模型' : '小模型'})`,
                        }))}
                      />
                    </Form.Item>
                  ) : (
                    <Text type="secondary">该模态暂不绑定模型</Text>
                  )}
                </Card>
              )
            })}
          </Space>
        </>
      )}

      {watchLevel === 3 && !watchBindModel && (
        <Alert
          type="warning"
          showIcon
          message="该标签将不绑定模型"
          description="保存后,该标签在审核规则中不会出现阈值配置选项。"
          style={{ marginBottom: 16 }}
        />
      )}
    </Form>
  )

  // ── Drawer footer ──
  const drawerFooter = (
    <div style={{ textAlign: 'right' }}>
      <Space>
        <Button icon={<CloseOutlined />} onClick={closeDrawer}>
          取消
        </Button>
        <Button
          type="primary"
          icon={<CheckOutlined />}
          loading={saving}
          onClick={handleSave}
        >
          保存
        </Button>
      </Space>
    </div>
  )

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
          <Title level={3} style={{ margin: 0 }}>
            <TagsOutlined style={{ marginRight: 8 }} />
            标签管理
          </Title>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新增标签
        </Button>
      </div>

      {/* 过滤栏 */}
      <div
        style={{
          background: '#fff',
          padding: 16,
          borderRadius: 8,
          marginBottom: 12,
          display: 'flex',
          gap: 12,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <Input
          prefix={<SearchOutlined />}
          placeholder="搜索标签 / 模型 / 版本 / 模态"
          allowClear
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ width: 240 }}
        />
        <Select
          placeholder="全部一级"
          allowClear
          showSearch
          optionFilterProp="label"
          value={level1Filter || undefined}
          onChange={(v) => {
            setLevel1Filter(v ?? '')
            setLevel2Filter('')
            setLevel3Filter('')
          }}
          options={l1FilterOptions}
          style={{ width: 160 }}
        />
        <Select
          placeholder="全部二级"
          allowClear
          showSearch
          optionFilterProp="label"
          value={level2Filter || undefined}
          disabled={l2FilterOptions.length === 0}
          onChange={(v) => {
            setLevel2Filter(v ?? '')
            setLevel3Filter('')
          }}
          options={l2FilterOptions}
          style={{ width: 160 }}
        />
        <Select
          placeholder="全部三级"
          allowClear
          showSearch
          optionFilterProp="label"
          value={level3Filter || undefined}
          disabled={l3FilterOptions.length === 0}
          onChange={(v) => setLevel3Filter(v ?? '')}
          options={l3FilterOptions}
          style={{ width: 160 }}
        />
        <Select
          value={statusFilter}
          onChange={(v) => setStatusFilter(v)}
          style={{ width: 130 }}
          options={[
            { value: 'all', label: '全部状态' },
            { value: 'active', label: '已启用' },
            { value: 'inactive', label: '已停用' },
          ]}
        />
        <div style={{ flex: 1 }} />
        <Text type="secondary">
          命中 {filteredRows.length} / {flatRows.length} 行
        </Text>
      </div>

      <Table<FlatRow>
        rowKey="key"
        columns={columns}
        dataSource={filteredRows}
        tableLayout="auto"
        pagination={{ pageSize: 20, showSizeChanger: true }}
        scroll={{ x: '100%' }}
        locale={{
          emptyText: <Empty description="暂无标签" />,
        }}
      />

      <Drawer
        title={watchEditing ? `编辑标签 · ${watchEditing.name}` : '新增标签'}
        placement="right"
        width={560}
        open={drawer.open}
        onClose={closeDrawer}
        destroyOnClose
        footer={drawerFooter}
      >
        {drawerBody}
      </Drawer>
    </div>
  )
}