// 标签管理（系统管理 → 标签管理）
// 表格一行 = 一个三级标签：
//   列[一级标签] 列[二级标签] 列[三级标签] — 同一行展示完整路径，cell 视觉分级。
//   列[模态] 列[模型] 列[版本] — 三级专属。
// 一级 / 二级没有"叶子"（没有下挂三级）的，也会单独占一行展示自身。
// 当前为 mock 数据版本。
import { useMemo, useState } from 'react'
import {
  App,
  Button,
  Drawer,
  Empty,
  Form,
  Input,
  Popconfirm,
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

const { Text, Title } = Typography

type Level = 1 | 2 | 3
type Status = 'active' | 'inactive'
type Modality = 'text' | 'image' | 'audio' | 'video'
type ModelKind = 'large' | 'small'

interface MockModel {
  id: number
  name: string
  kind: ModelKind
  version: string
  /** 模型可处理的单一模态 */
  modality: Modality
}

interface MockTag {
  id: string
  level: Level
  name: string
  status: Status
  parentId: string | null
  /** 仅三级标签 */
  modality?: Modality
  boundModelId?: number
}

// ── mock 模型（仅小模型） ──
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

// ── mock 标签树（三级） ──
const INITIAL_MOCK_TAGS: MockTag[] = [
  // 一级
  { id: 'l1-politics', level: 1, name: '涉政', status: 'active', parentId: null },
  { id: 'l1-ads_law', level: 1, name: '广告法', status: 'active', parentId: null },
  { id: 'l1-porn', level: 1, name: '涉黄', status: 'active', parentId: null },
  { id: 'l1-medical', level: 1, name: '医药', status: 'active', parentId: null },
  { id: 'l1-violence', level: 1, name: '涉暴', status: 'active', parentId: null },
  { id: 'l1-custom', level: 1, name: '自定义', status: 'inactive', parentId: null },

  // 二级
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

  // 三级（leaf）
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

interface FormValues {
  level: Level
  name: string
  status: Status
  parent_l1?: string
  parent_l2?: string
  modality?: Modality
  bound_model_id?: number
}

const MODALITY_OPTIONS: { value: Modality; label: string }[] = [
  { value: 'text', label: '文本' },
  { value: 'image', label: '图片' },
  { value: 'audio', label: '音频' },
  { value: 'video', label: '视频' },
]

// 用于表格的扁平行：
// - 所有三级标签独立成行（一级 / 二级 单元格填所属路径）
// - 一级 / 二级没有三级子节点时，单独占一行展示自身（三级列为 —）
interface FlatRow {
  key: string
  /** 当前行的"主体"标签（一级 / 二级 / 三级） */
  rowTag: MockTag
  /** 路径中各级标签（按 level=1/2/3 顺序） */
  l1: MockTag | null
  l2: MockTag | null
  l3: MockTag | null
}

function findById(list: MockTag[], id: string | null | undefined): MockTag | null {
  if (!id) return null
  return list.find((t) => t.id === id) ?? null
}

export default function TagsAdminPage() {
  const { message } = App.useApp()

  const [tags, setTags] = useState<MockTag[]>(INITIAL_MOCK_TAGS)
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | Status>('all')
  const [level1Filter, setLevel1Filter] = useState<string>('')
  const [level2Filter, setLevel2Filter] = useState<string>('')
  const [level3Filter, setLevel3Filter] = useState<string>('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<MockTag | null>(null)
  const [form] = Form.useForm<FormValues>()
  const [saving, setSaving] = useState(false)

  // ── 派生：构建扁平行 ──
  const flatRows = useMemo<FlatRow[]>(() => {
    const rows: FlatRow[] = []
    // 1) 先把所有三级标签展平
    const l3Tags = tags.filter((t) => t.level === 3)
    const l3ChildCount = new Map<string, number>()
    for (const t of l3Tags) {
      if (t.parentId) {
        l3ChildCount.set(t.parentId, (l3ChildCount.get(t.parentId) ?? 0) + 1)
      }
    }

    // 把三级按"一级→二级"分组排序
    const l1Tags = tags.filter((t) => t.level === 1)
    for (const l1 of l1Tags) {
      const l2Children = tags
        .filter((t) => t.level === 2 && t.parentId === l1.id)
        .sort((a, b) => a.name.localeCompare(b.name))
      if (l2Children.length === 0) {
        // 一级标签没有下挂二级 → 单独成行
        rows.push({
          key: `row-${l1.id}`,
          rowTag: l1,
          l1,
          l2: null,
          l3: null,
        })
        continue
      }
      for (const l2 of l2Children) {
        const l3Children = l3Tags
          .filter((t) => t.parentId === l2.id)
          .sort((a, b) => a.name.localeCompare(b.name))
        if (l3Children.length === 0) {
          // 二级没有下挂三级 → 单独成行
          rows.push({
            key: `row-${l2.id}`,
            rowTag: l2,
            l1,
            l2,
            l3: null,
          })
          continue
        }
        for (const l3 of l3Children) {
          rows.push({
            key: `row-${l3.id}`,
            rowTag: l3,
            l1,
            l2,
            l3,
          })
        }
      }
    }
    return rows
  }, [tags])

  // ── Drawer 选项 ──
  const level1Options = useMemo(
    () =>
      tags
        .filter((t) => t.level === 1)
        .map((t) => ({ value: t.id, label: t.name })),
    [tags],
  )
  const level2Options = useMemo(
    () =>
      tags
        .filter((t) => t.level === 2)
        .map((t) => ({ value: t.id, label: t.name })),
    [tags],
  )

  // ── 筛选栏选项（按已选一级/二级自动收窄）──
  const l1FilterOptions = useMemo(
    () =>
      tags
        .filter((t) => t.level === 1)
        .map((t) => ({ value: t.id, label: t.name })),
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

  // ── 过滤 ──
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
  const openCreate = (level: Level = 1) => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ level, name: '', status: 'active' })
    setDrawerOpen(true)
  }

  const openEdit = (row: MockTag) => {
    setEditing(row)
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
      modality: row.modality,
      bound_model_id: row.boundModelId,
    })
    setDrawerOpen(true)
  }

  const closeDrawer = () => {
    setDrawerOpen(false)
    setEditing(null)
    form.resetFields()
  }

  const handleSave = async () => {
    try {
      const v = await form.validateFields()
      setSaving(true)
      const parentId: string | null =
        v.level === 1
          ? null
          : v.level === 2
            ? v.parent_l1 ?? null
            : v.parent_l2 ?? null

      if (editing) {
        setTags((prev) =>
          prev.map((t) =>
            t.id === editing.id
              ? {
                  ...t,
                  name: v.name,
                  status: v.status,
                  parentId:
                    t.level === 1
                      ? null
                      : t.level === 2
                        ? v.parent_l1 ?? null
                        : v.parent_l2 ?? null,
                  modality:
                    t.level === 3 ? v.modality ?? undefined : undefined,
                  boundModelId:
                    t.level === 3 ? v.bound_model_id ?? undefined : undefined,
                }
              : t,
          ),
        )
        message.success('已保存')
      } else {
        const newTag: MockTag = {
          id: `t-${Date.now()}`,
          level: v.level,
          name: v.name,
          status: v.status,
          parentId,
          modality: v.level === 3 ? v.modality : undefined,
          boundModelId:
            v.level === 3 ? v.bound_model_id ?? undefined : undefined,
        }
        setTags((prev) => [newTag, ...prev])
        message.success('已新增')
      }
      closeDrawer()
    } catch {
      // 表单校验失败
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

  const watchLevel = Form.useWatch('level', form) as Level | undefined
  const watchModality = Form.useWatch('modality', form) as Modality | undefined

  // 受前置模态驱动的模型选项列表：编辑模式用 editing.modality，新增模式用 watchModality
  const modelOptionsByModality = useMemo(
    () => {
      const currentModality = editing?.modality ?? watchModality
      if (!currentModality) return MOCK_MODELS
      return MOCK_MODELS.filter((m) => m.modality === currentModality)
    },
    [editing, watchModality],
  )

  // ── 列定义 ──
  const columns: ColumnsType<FlatRow> = [
    {
      title: '标签',
      minWidth: 260,
      render: (_, row) => {
        const segments: { name: string; isSubject: boolean; isL3: boolean }[] = []
        if (row.l1) segments.push({ name: row.l1.name, isSubject: row.rowTag.id === row.l1.id, isL3: false })
        if (row.l2) segments.push({ name: row.l2.name, isSubject: row.rowTag.id === row.l2.id, isL3: false })
        if (row.l3) segments.push({ name: row.l3.name, isSubject: row.rowTag.id === row.l3.id, isL3: true })
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
            {m && subjectL3 && (
              <Text type="secondary" style={{ fontSize: 11 }}>
                {m.name} · {m.version}
              </Text>
            )}
          </Space>
        )
      },
    },
    {
      title: '模态',
      minWidth: 88,
      render: (_, row) => {
        const m = row.l3?.modality
        if (!m) return <Text type="secondary">—</Text>
        const label = MODALITY_OPTIONS.find((o) => o.value === m)?.label
        return <AntdTag color="cyan">{label ?? m}</AntdTag>
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
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openCreate(1)}>
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

      {/* 新增/编辑 Drawer（右侧） */}
      <Drawer
        title={editing ? `编辑标签 · ${editing.name}` : '新增标签'}
        placement="right"
        width={560}
        open={drawerOpen}
        onClose={closeDrawer}
        destroyOnClose
        footer={
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
        }
      >
        <Form<FormValues>
          form={form}
          layout="vertical"
          requiredMark={false}
        >
          {editing && (() => {
            const subject = editing
            const parent = subject.parentId
              ? findById(tags, subject.parentId)
              : null
            const grand = parent?.parentId
              ? findById(tags, parent.parentId)
              : null
            const l1 = subject.level === 1 ? subject : grand
            const l2 =
              subject.level === 1
                ? null
                : subject.level === 2
                  ? subject
                  : parent
            const l3 = subject.level === 3 ? subject : null
            return (
              <>
                {l1 && (
                  <Form.Item label="一级">
                    <Input value={l1.name} disabled />
                  </Form.Item>
                )}
                {l2 && (
                  <Form.Item label="二级">
                    <Input value={l2.name} disabled />
                  </Form.Item>
                )}
                {l3 && (
                  <Form.Item label="三级">
                    <Input value={l3.name} disabled />
                  </Form.Item>
                )}
              </>
            )
          })()}

          {!editing && (
            <>
              <Form.Item
                label="层级"
                name="level"
                rules={[{ required: true, message: '请选择层级' }]}
              >
                <Radio.Group>
                  <Radio.Button value={1}>一级</Radio.Button>
                  <Radio.Button value={2}>二级</Radio.Button>
                  <Radio.Button value={3}>三级</Radio.Button>
                </Radio.Group>
              </Form.Item>

              {watchLevel === 2 && (
                <Form.Item
                  label="一级"
                  name="parent_l1"
                  rules={[{ required: true, message: '请选择一级标签' }]}
                >
                  <Select
                    placeholder="请选择"
                    options={level1Options}
                    showSearch
                    optionFilterProp="label"
                  />
                </Form.Item>
              )}

              {watchLevel === 3 && (
                <>
                  <Form.Item
                    label="一级"
                    name="parent_l1"
                    rules={[{ required: true, message: '请选择一级标签' }]}
                  >
                    <Select
                      placeholder="请选择"
                      options={level1Options}
                      showSearch
                      optionFilterProp="label"
                    />
                  </Form.Item>
                  <Form.Item
                    label="二级"
                    name="parent_l2"
                    rules={[{ required: true, message: '请选择二级标签' }]}
                  >
                    <Select
                      placeholder="请选择"
                      options={level2Options}
                      showSearch
                      optionFilterProp="label"
                    />
                  </Form.Item>
                </>
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
            </>
          )}

          {((editing && editing.level === 3) ||
            (!editing && watchLevel === 3)) && (
            <Form.Item
              label="模态"
              name="modality"
              rules={[{ required: true, message: '请选择模态' }]}
            >
              <Select
                placeholder="请选择"
                disabled={!!editing}
                options={MODALITY_OPTIONS.map((o) => ({
                  value: o.value,
                  label: o.label,
                }))}
              />
            </Form.Item>
          )}

          {((editing && editing.level === 3) ||
            (!editing && watchLevel === 3)) && (
            <Form.Item
              label="模型"
              name="bound_model_id"
              rules={[{ required: true, message: '请选择模型' }]}
            >
              <Select
                placeholder="搜索模型名称"
                showSearch
                optionFilterProp="label"
                filterOption={(input, option) =>
                  ((option?.label ?? '') as string)
                    .toLowerCase()
                    .includes(input.trim().toLowerCase())
                }
                notFoundContent={
                  (editing?.modality ?? watchModality)
                    ? '当前模态下无可用模型'
                    : '暂无匹配模型'
                }
                options={modelOptionsByModality.map((m) => ({
                  value: m.id,
                  label: m.name,
                }))}
              />
            </Form.Item>
          )}

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
      </Drawer>
    </div>
  )
}