// 标签管理（系统管理 → 标签管理）
// 设计要点（v4）：
//   - 用户可自由选择创建一级 / 二级 / 三级标签（编辑模式层级只读）
//   - 三级标签可设置「适用模态」（仅标签属性，不绑定模型）
//   - 标签页面只做标签 CRUD + 模型绑定展示，不提供绑定 / 解绑模型的操作
//     （绑定关系由其他模块维护；此处只展示已绑定模型与「未绑定 → 无阈值」状态）
//   - 停用 / 删除前先查引用清单：
//     · 停用被 active 策略引用 → 阻止
//     · 删除任何引用 → 阻止
//     阻止时弹出顶层 TagReferenceConfirmModal 展示引用详情
//   - 当前 mock 阶段：引用清单走本地 mockGetReferences（与 backend _MOCK_STRATEGY_REFS 对齐）
//     TODO: 真实接入后改回 tagsApi.getReferences + axios 409 兜底
//   - 列表行：一级 / 二级没有下挂子标签时单独成行；三级按 {模态, 模型} 组合拆行
import { useEffect, useMemo, useState } from 'react'
import {
  App,
  Button,
  Drawer,
  Empty,
  Form,
  Input,
  Radio,
  Select,
  Space,
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
import type {
  TagReferenceModel,
  TagReferences,
  TagReferenceStrategy,
} from '@/types/domain'
import { TagReferenceConfirmModal } from '@/components/TagReferenceConfirmModal'

const { Text, Title } = Typography

type Level = 1 | 2 | 3
type Status = 'active' | 'inactive'
type Modality = 'text' | 'image' | 'audio' | 'video'
type ModelKind = 'large' | 'small'

const MODALITY_LABELS: Record<Modality, string> = {
  text: '文本',
  image: '图像',
  audio: '音频',
  video: '视频',
}

const MODALITY_OPTIONS: { value: Modality; label: string }[] = [
  { value: 'text', label: '文本' },
  { value: 'image', label: '图像' },
  { value: 'audio', label: '音频' },
  { value: 'video', label: '视频' },
]

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
  /** 仅展示用途：标签适用的输入模态(可多选);模型绑定关系由其他模块维护 */
  modalities?: Modality[]
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

  { id: 'l3-leader1-write', level: 3, name: '写实', status: 'active', parentId: 'l2-leader1', modalities: ['image'], boundModelId: 4 },
  // 多模态演示:漫画·一号领导 适用「图像 + 视频」
  { id: 'l3-leader1-cartoon', level: 3, name: '漫画', status: 'active', parentId: 'l2-leader1', modalities: ['image', 'video'], boundModelId: 5 },
  { id: 'l3-leader2-cartoon', level: 3, name: '漫画', status: 'active', parentId: 'l2-leader2', modalities: ['image'], boundModelId: 5 },
  // 多模态演示:文本描述 适用「文本 + 图像」(含配图)
  { id: 'l3-leader2-text', level: 3, name: '文本描述', status: 'active', parentId: 'l2-leader2', modalities: ['text', 'image'], boundModelId: 1 },
  { id: 'l3-flag-vandalize', level: 3, name: '篡改', status: 'active', parentId: 'l2-flag', modalities: ['image'], boundModelId: 6 },
  { id: 'l3-flag-graffiti', level: 3, name: '涂鸦', status: 'active', parentId: 'l2-flag', modalities: ['image'], boundModelId: 6 },
  { id: 'l3-cartoon_pol-latest', level: 3, name: '时政讽刺', status: 'active', parentId: 'l2-cartoon_pol', modalities: ['image'], boundModelId: 5 },
  { id: 'l3-cartoon_pol-history', level: 3, name: '历史讽刺', status: 'active', parentId: 'l2-cartoon_pol', modalities: ['image'], boundModelId: 5 },
  // 多模态演示:极限用语 适用「文本 + 图像」
  { id: 'l3-absolute-text', level: 3, name: '极限用语', status: 'active', parentId: 'l2-absolute', modalities: ['text', 'image'], boundModelId: 7 },
  { id: 'l3-absolute-image', level: 3, name: '极限标语', status: 'active', parentId: 'l2-absolute', modalities: ['image'], boundModelId: 7 },
  { id: 'l3-fake_claim-text', level: 3, name: '夸大疗效', status: 'active', parentId: 'l2-fake_claim', modalities: ['text'], boundModelId: 1 },
  { id: 'l3-nude-face', level: 3, name: '成人面部', status: 'active', parentId: 'l2-nude', modalities: ['image'], boundModelId: 8 },
  { id: 'l3-nude-body', level: 3, name: '成人裸露', status: 'active', parentId: 'l2-nude', modalities: ['image'], boundModelId: 9 },
  // 多模态演示:音频呻吟 适用「音频 + 视频」
  { id: 'l3-nude-voice', level: 3, name: '音频呻吟', status: 'active', parentId: 'l2-nude', modalities: ['audio', 'video'], boundModelId: 10 },
  { id: 'l3-cartoon_porn-anime', level: 3, name: '动漫色情', status: 'inactive', parentId: 'l2-cartoon_porn', modalities: ['image'], boundModelId: 5 },
  { id: 'l3-medical_claim-text', level: 3, name: '包治百病', status: 'active', parentId: 'l2-medical_claim', modalities: ['text'], boundModelId: 1 },
  { id: 'l3-weapon-real', level: 3, name: '真实武器', status: 'active', parentId: 'l2-weapon', modalities: ['image'], boundModelId: 3 },
  { id: 'l3-weapon-toy', level: 3, name: '仿真玩具', status: 'active', parentId: 'l2-weapon', modalities: ['image'], boundModelId: 3 },
]

interface DrawerState {
  open: boolean
  editing: MockTag | null
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

// ── mock 阶段:本地引用清单(与 backend _MOCK_STRATEGY_REFS 对齐) ──
// TODO: 后端真实接入后,改回调 tagsApi.getReferences
const MOCK_STRATEGY_REFS: Record<string, TagReferenceStrategy[]> = {
  'l3-leader1-cartoon': [
    {
      strategy_id: 'st-001',
      strategy_name: '图文审核主策略',
      status: 'active',
      services: ['text-image'],
    },
    {
      strategy_id: 'st-002',
      strategy_name: '备用策略·视频',
      status: 'deprecated',
      services: ['video'],
    },
  ],
  'l3-nude-face': [
    {
      strategy_id: 'st-003',
      strategy_name: '人脸审核策略',
      status: 'active',
      services: ['image'],
    },
  ],
  'l3-absolute-text': [
    {
      strategy_id: 'st-004',
      strategy_name: '广告法词库',
      status: 'deprecated',
      services: ['text'],
    },
  ],
}

function mockGetReferences(tagId: string, allTags: MockTag[]): TagReferences {
  const tag = allTags.find((t) => t.id === tagId)
  if (!tag) {
    // mock 阶段不会发生;若发生,直接放行避免阻塞操作
    return {
      tag_id: tagId,
      tag_name: '',
      tag_level: 1,
      tag_path: '',
      strategies: [],
      models: [],
      can_deactivate: true,
      can_delete: true,
      total_references: 0,
    }
  }
  // 构建路径
  const parts = [tag.name]
  let cur = allTags.find((t) => t.id === tag.parentId)
  while (cur) {
    parts.unshift(cur.name)
    cur = allTags.find((t) => t.id === cur?.parentId)
  }
  const path = parts.join(' / ')

  // 模型引用
  const models: TagReferenceModel[] = []
  if (tag.boundModelId) {
    const m = MOCK_MODELS.find((mm) => mm.id === tag.boundModelId)
    if (m) {
      models.push({
        model_id: m.id,
        model_name: m.name,
        model_version: m.version,
      })
    }
  }

  // 策略引用(mock)
  const strategies = MOCK_STRATEGY_REFS[tagId] ?? []

  const total = strategies.length + models.length
  const hasActiveStrategy = strategies.some((s) => s.status === 'active')

  return {
    tag_id: tag.id,
    tag_name: tag.name,
    tag_level: tag.level,
    tag_path: path,
    strategies,
    models,
    can_deactivate: !hasActiveStrategy,
    can_delete: total === 0,
    total_references: total,
  }
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
  })
  const [saving, setSaving] = useState(false)
  const [checkingRefs, setCheckingRefs] = useState(false)
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
        (l3?.modalities ?? []).join(' '),
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(trimmed)
    })
  }, [flatRows, q, statusFilter, level1Filter, level2Filter, level3Filter])

  // ── Drawer 操作 ──
  const openCreate = () => {
    form.resetFields()
    form.setFieldsValue({ level: 1, status: 'active' })
    setDrawer({ open: true, editing: null })
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
      modalities: row.modalities,
    })
    setDrawer({ open: true, editing: row })
  }

  const closeDrawer = () => {
    setDrawer({ open: false, editing: null })
    form.resetFields()
  }

  const handleSave = async () => {
    try {
      const v = await form.validateFields()
      setSaving(true)
      const level = v.level as Level
      const parentId: string | null =
        level === 1
          ? null
          : level === 2
            ? (v.parent_l1 as string | undefined) ?? null
            : (v.parent_l2 as string | undefined) ?? null
      const editing = drawer.editing
      const timestamp = Date.now()

      const buildRecord = (id: string): MockTag => {
        const base: MockTag = {
          id,
          level,
          name: v.name,
          status: v.status,
          parentId,
        }
        // 三级标签:模态来自表单(多选);boundModelId 不在本页修改
        if (level === 3) {
          base.modalities = (v.modalities as Modality[] | undefined) ?? []
          if (editing) {
            base.boundModelId = editing.boundModelId
          }
        }
        return base
      }

      if (editing) {
        setTags((prev) =>
          prev.map((t) => (t.id === editing.id ? buildRecord(editing.id) : t)),
        )
        message.success('已保存')
      } else {
        setTags((prev) => [buildRecord(`t-${timestamp}`), ...prev])
        message.success('已新增')
      }
      closeDrawer()
    } catch {
      // 校验失败
    } finally {
      setSaving(false)
    }
  }

  // ── 引用检查 + 停用 ──
  const handleToggleStatus = async (row: MockTag) => {
    if (row.status === 'active') {
      // mock 阶段:用本地 mockGetReferences;真实接入后改回 tagsApi.getReferences
      setCheckingRefs(true)
      try {
        const refs = mockGetReferences(row.id, tags)
        if (!refs.can_deactivate) {
          await TagReferenceConfirmModal.open({ refs })
          return
        }
      } catch {
        // mock 阶段不应该出错,真接入后改为 409 兜底
      } finally {
        setCheckingRefs(false)
      }
    }
    setTags((prev) =>
      prev.map((t) =>
        t.id === row.id
          ? { ...t, status: t.status === 'active' ? 'inactive' : 'active' }
          : t,
      ),
    )
    message.success(row.status === 'active' ? '已停用' : '已启用')
  }

  // ── 引用检查 + 删除(cascade) ──
  const performCascadeDelete = (id: string): number => {
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
    return toDelete.size
  }

  const handleDelete = async (id: string) => {
    setCheckingRefs(true)
    try {
      // mock 阶段:用本地 mockGetReferences;真实接入后改回 tagsApi.getReferences
      const refs = mockGetReferences(id, tags)
      if (!refs.can_delete) {
        await TagReferenceConfirmModal.open({ refs })
        return
      }
    } finally {
      setCheckingRefs(false)
    }

    const count = performCascadeDelete(id)
    message.success(`已删除（${count} 个）`)
  }

  // 父级联动:一级变更时清空二级
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
      minWidth: 160,
      render: (_, row) => {
        const ms = row.l3?.modalities
        if (!ms || ms.length === 0) return <Text type="secondary">—</Text>
        return (
          <Space size={4} wrap>
            {ms.map((m) => (
              <AntdTag key={m} color="cyan">
                {MODALITY_LABELS[m]}
              </AntdTag>
            ))}
          </Space>
        )
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
          onClick={() => handleToggleStatus(row.rowTag)}
          style={{ cursor: checkingRefs ? 'wait' : 'pointer' }}
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
          <Button
            type="link"
            size="small"
            danger
            icon={<DeleteOutlined />}
            disabled={checkingRefs}
            onClick={() => handleDelete(row.rowTag.id)}
          >
            删除
          </Button>
        </Space>
      ),
    },
  ]

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

      {watchLevel === 3 && (
        <Form.Item
          label="适用模态"
          name="modalities"
          rules={[
            { required: true, message: '请选择适用模态' },
            {
              validator: async (_rule, value) => {
                if (!Array.isArray(value) || value.length === 0) {
                  throw new Error('至少选择 1 个模态')
                }
              },
            },
          ]}
          tooltip="该标签适用的输入模态(可多选);模型绑定由其他模块维护"
        >
          <Select
            mode="multiple"
            placeholder="请选择模态(可多选)"
            options={MODALITY_OPTIONS}
            showSearch
            optionFilterProp="label"
            allowClear
            maxTagCount="responsive"
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
          placeholder="搜索标签 / 模型 / 模态"
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