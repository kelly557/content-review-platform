import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Empty,
  Grid,
  InputNumber,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import type { TableColumnsType } from 'antd'
import {
  CheckOutlined,
  DeleteOutlined,
  LockOutlined,
  UnlockOutlined,
} from '@ant-design/icons'
import { auditItemsApi } from '@/api/auditItems'
import { auditPointsApi } from '@/api/auditPoints'
import { librariesApi } from '@/api/libraries'
import type {
  AuditItem,
  AuditPoint,
  LibraryListItem,
  LibraryType,
} from '@/types/domain'
import { type CategoryKey } from './constants'
import {
  type MediaPointOverrideMap,
  type PointMap,
} from './pointLevel'

const { Text } = Typography

const TYPE_LABEL: Record<LibraryType, string> = {
  image: '图',
  word: '词',
  reply: '代答',
}
const TYPE_COLOR: Record<LibraryType, string> = {
  image: 'blue',
  word: 'green',
  reply: 'purple',
}

/** 媒体类型允许关联的库类型（文本审核只允许词库/代答库） */
const ALLOWED_LIB_TYPES: Record<CategoryKey, LibraryType[]> = {
  image: ['image', 'word', 'reply'],
  text: ['word', 'reply'],
  audio: ['word', 'reply'],
  doc: ['image', 'word', 'reply'],
  video: ['image', 'word', 'reply'],
}

interface Props {
  packageCode: string | null
  enabledItemIds: number[]
  getPointMap: (itemId: number) => PointMap
  onPointMapChange: (itemId: number, next: PointMap) => void
  pointOverrides: MediaPointOverrideMap
  onPointOverrideChange: (
    itemId: number,
    pointId: number,
    override: {
      medium_threshold?: number
      high_threshold?: number
      linked_library_ids?: number[]
    },
  ) => void
  /** point 勾选时通知父级，便于父级维护 enabledItemIds 集合 */
  onPointToggle: (itemId: number, pointId: number, checked: boolean) => void
}

const PACKAGE_TO_MEDIA: Record<string, CategoryKey> = {
  image_audit_pro: 'image',
  text_audit_pro: 'text',
  audio_audit_pro: 'audio',
  document_audit_pro: 'doc',
  video_audit_pro: 'video',
}

export default function RulesTreeView({
  packageCode,
  enabledItemIds,
  getPointMap,
  onPointMapChange,
  pointOverrides,
  onPointOverrideChange,
  onPointToggle: _onPointToggle,
}: Props) {
  const [items, setItems] = useState<AuditItem[]>([])
  const [pointsByItem, setPointsByItem] = useState<Record<number, AuditPoint[]>>(
    {},
  )
  const [loading, setLoading] = useState(false)
  const [libraryOptions, setLibraryOptions] = useState<LibraryListItem[]>([])
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null)

  const mediaKey: CategoryKey =
    (packageCode ? PACKAGE_TO_MEDIA[packageCode] : null) ?? 'image'

  // 拉数据：items + 3 种库
  useEffect(() => {
    if (!packageCode) return
    let cancel = false
    setLoading(true)
    Promise.all([
      auditItemsApi.list(packageCode),
      librariesApi
        .list({ type: 'image', size: 200 })
        .then((p) => p.items)
        .catch(() => [] as LibraryListItem[]),
      librariesApi
        .list({ type: 'word', size: 200 })
        .then((p) => p.items)
        .catch(() => [] as LibraryListItem[]),
      librariesApi
        .list({ type: 'reply', size: 200 })
        .then((p) => p.items)
        .catch(() => [] as LibraryListItem[]),
    ])
      .then(async ([itemsRes, img, word, reply]) => {
        if (cancel) return
        setItems(itemsRes)
        setLibraryOptions([...img, ...word, ...reply])
        const map: Record<number, AuditPoint[]> = {}
        await Promise.all(
          itemsRes.map((it) =>
            auditPointsApi
              .list(packageCode, { item_id: it.id })
              .then((ps) => {
                map[it.id] = ps
              })
              .catch(() => {
                map[it.id] = []
              }),
          ),
        )
        if (!cancel) setPointsByItem(map)
      })
      .catch(() => {
        if (!cancel) {
          setItems([])
          setPointsByItem({})
        }
      })
      .finally(() => {
        if (!cancel) setLoading(false)
      })
    return () => {
      cancel = true
    }
  }, [packageCode])

  const { builtinItems, customItems } = useMemo(() => {
    const b: AuditItem[] = []
    const c: AuditItem[] = []
    items.forEach((it) => (it.is_builtin ? b.push(it) : c.push(it)))
    return { builtinItems: b, customItems: c }
  }, [items])

  const enabledSet = useMemo(() => new Set(enabledItemIds), [enabledItemIds])

  // 计算每个 item 下"已选 point 数"用于左栏视觉标记
  const enabledPointCountByItem = useMemo(() => {
    const out: Record<number, number> = {}
    for (const it of items) {
      const pMap = getPointMap(it.id)
      const points = pointsByItem[it.id] ?? []
      out[it.id] = points.filter((p) => pMap[p.id] === true).length
    }
    return out
  }, [items, pointsByItem, getPointMap])

  if (!packageCode) {
    return (
      <Empty
        description="该审核类型暂无规则包"
        style={{ padding: '24px 0' }}
      />
    )
  }

  const screens = Grid.useBreakpoint()
  const isStacked = !screens.md
  const leftColTemplate = screens.xl
    ? '300px 1fr'
    : screens.md
    ? '260px 1fr'
    : '1fr'

  const currentItem =
    selectedItemId != null
      ? items.find((it) => it.id === selectedItemId)
      : items.find((it) => enabledSet.has(it.id))
  const currentPoints = currentItem ? pointsByItem[currentItem.id] ?? [] : []
  const currentPointMap = currentItem ? getPointMap(currentItem.id) : {}

  return (
    <div style={{ width: '100%' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: leftColTemplate,
          gap: 16,
          alignItems: 'start',
        }}
      >
        {/* 左栏：分组 item 列表 */}
        <div
          style={{
            background: '#fff',
            borderRadius: 8,
            padding: '12px 0',
            maxHeight: isStacked ? 'none' : 540,
            overflowY: isStacked ? 'visible' : 'auto',
          }}
        >
          <ItemGroup
            title="通用"
            icon={<LockOutlined style={{ color: '#D97706' }} />}
            items={builtinItems}
            enabledSet={enabledSet}
            enabledPointCountByItem={enabledPointCountByItem}
            activeItemId={selectedItemId}
            onPick={(id) => setSelectedItemId(id)}
            loading={loading}
            emptyText="暂无通用规则"
          />
          <ItemGroup
            title="自定义"
            icon={<UnlockOutlined style={{ color: '#2563EB' }} />}
            items={customItems}
            enabledSet={enabledSet}
            enabledPointCountByItem={enabledPointCountByItem}
            activeItemId={selectedItemId}
            onPick={(id) => setSelectedItemId(id)}
            loading={loading}
            emptyText="暂无自定义规则"
          />
        </div>

        {/* 右栏：当前选中 item 的 point 列表 */}
        <div
          style={{
            background: '#F8FAFC',
            borderRadius: 8,
            padding: '4px 8px',
            minHeight: isStacked ? 'auto' : 540,
          }}
        >
          {currentItem ? (
            <PointsColumn
              item={currentItem}
              points={currentPoints}
              pointMap={currentPointMap}
              pointOverrides={pointOverrides}
              onPointMapChange={onPointMapChange}
              onPointOverrideChange={onPointOverrideChange}
              libraryOptions={libraryOptions}
              mediaKey={mediaKey}
              onDeletePoint={async (point) => {
                try {
                  await auditPointsApi.remove(packageCode, point.id)
                  setPointsByItem((prev) => ({
                    ...prev,
                    [currentItem.id]: (prev[currentItem.id] ?? []).filter(
                      (p) => p.id !== point.id,
                    ),
                  }))
                } catch (e) {
                  console.error(e)
                }
              }}
            />
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <Space direction="vertical" size={4}>
                  <Text>点击左侧某条审核项以查看其下的审核点</Text>
                </Space>
              }
              style={{ padding: '80px 0' }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function ItemGroup({
  title,
  icon,
  items,
  enabledSet,
  enabledPointCountByItem,
  activeItemId,
  onPick,
  loading,
  emptyText,
}: {
  title: string
  icon: React.ReactNode
  items: AuditItem[]
  enabledSet: Set<number>
  enabledPointCountByItem: Record<number, number>
  activeItemId: number | null
  onPick: (id: number) => void
  loading: boolean
  emptyText: string
}) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div
        style={{
          padding: '4px 16px 8px',
          fontSize: 12,
          color: '#64748B',
          fontWeight: 500,
          letterSpacing: 0.5,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        {icon}
        <span>{title}</span>
        <span style={{ color: '#94A3B8', fontWeight: 400 }}>
          {items.length}
        </span>
      </div>
      {items.length === 0 ? (
        <div
          style={{
            padding: '8px 16px',
            fontSize: 12,
            color: '#94A3B8',
          }}
        >
          {loading ? '加载中…' : emptyText}
        </div>
      ) : (
        items.map((it) => {
          const picked = enabledPointCountByItem[it.id] > 0
          const active = activeItemId === it.id
          return (
            <div
              key={it.id}
              onClick={() => onPick(it.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 16px',
                cursor: 'pointer',
                background: active ? '#EFF6FF' : 'transparent',
                borderLeft: active
                  ? '3px solid #2563EB'
                  : '3px solid transparent',
                transition: 'background 120ms',
              }}
            >
              <Text
                style={{
                  color: active ? '#1D4ED8' : '#0F172A',
                  fontWeight: active ? 600 : 400,
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {it.name_cn}
              </Text>
              {picked && (
                <Tooltip title={`已选 ${enabledPointCountByItem[it.id]} 个审核点`}>
                  <CheckOutlined
                    style={{ color: '#16A34A', fontSize: 13 }}
                  />
                </Tooltip>
              )}
              {picked && enabledSet.has(it.id) && (
                <Tag
                  color="blue"
                  style={{ margin: 0, fontSize: 11, padding: '0 6px' }}
                >
                  启用
                </Tag>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}

type PointRowRecord = {
  key: number
  point: AuditPoint
  checked: boolean
  override: {
    medium_threshold?: number
    high_threshold?: number
    linked_library_ids?: number[]
  }
  isCustom: boolean
  editDisabled: boolean
}

function PointsColumn({
  item,
  points,
  pointMap,
  pointOverrides,
  onPointMapChange,
  onPointOverrideChange,
  libraryOptions,
  mediaKey,
  onDeletePoint,
}: {
  item: AuditItem
  points: AuditPoint[]
  pointMap: PointMap
  pointOverrides: MediaPointOverrideMap
  onPointMapChange: (itemId: number, next: PointMap) => void
  onPointOverrideChange: (
    itemId: number,
    pointId: number,
    override: {
      medium_threshold?: number
      high_threshold?: number
      linked_library_ids?: number[]
    },
  ) => void
  libraryOptions: LibraryListItem[]
  mediaKey: CategoryKey
  onDeletePoint: (point: AuditPoint) => void
}) {
  const dataSource: PointRowRecord[] = points.map((p) => ({
    key: p.id,
    point: p,
    checked: pointMap[p.id] === true,
    override: pointOverrides[mediaKey]?.[item.id]?.[p.id] ?? {},
    isCustom: !p.is_builtin,
    editDisabled: pointMap[p.id] !== true,
  }))

  const columns: TableColumnsType<PointRowRecord> = [
    {
      title: '',
      dataIndex: 'checked',
      width: 40,
      render: (_, record) => (
        <input
          type="checkbox"
          checked={record.checked}
          onChange={(e) =>
            onPointMapChange(item.id, {
              ...pointMap,
              [record.point.id]: e.target.checked,
            })
          }
          aria-label={`启用审核点 ${record.point.label_cn}`}
          style={{ margin: 0 }}
        />
      ),
    },
    {
      title: '审核点',
      dataIndex: 'point',
      render: (_, record) => {
        const name = record.point.label_cn || record.point.label || record.point.code
        return (
          <Space size={6} align="center">
            <Text strong style={{ color: '#0F172A' }} ellipsis={{ tooltip: name }}>
              {name}
            </Text>
            {record.isCustom && (
              <Popconfirm
                title={`确认删除「${record.point.label_cn || record.point.code}」？`}
                okText="删除"
                cancelText="取消"
                okButtonProps={{ danger: true }}
                onConfirm={() => onDeletePoint(record.point)}
              >
                <Button
                  size="small"
                  type="link"
                  danger
                  icon={<DeleteOutlined />}
                  style={{ padding: 0 }}
                >
                  删除
                </Button>
              </Popconfirm>
            )}
          </Space>
        )
      },
    },
    {
      title: '审核说明',
      dataIndex: 'description',
      render: (_, record) => {
        if (record.point.description) {
          return (
            <Text
              type="secondary"
              style={{ fontSize: 12, lineHeight: 1.5 }}
              ellipsis={{ tooltip: record.point.description }}
            >
              {record.point.description}
            </Text>
          )
        }
        return (
          <Space size={6} align="center">
            <Text type="secondary" style={{ fontSize: 12 }}>
              暂无审核说明
            </Text>
            <Tag style={{ margin: 0, fontSize: 11, padding: '0 6px' }}>
              后期导入
            </Tag>
          </Space>
        )
      },
    },
    {
      title: '中风险分',
      dataIndex: 'mediumThreshold',
      width: 110,
      align: 'left',
      render: (_, record) => (
        <ThresholdInput
          disabled={record.editDisabled}
          value={
            record.override.medium_threshold ?? record.point.medium_threshold
          }
          onChange={(v) =>
            onPointOverrideChange(item.id, record.point.id, {
              medium_threshold: v ?? undefined,
            })
          }
          label="中风险分"
        />
      ),
    },
    {
      title: '高风险分',
      dataIndex: 'highThreshold',
      width: 110,
      align: 'left',
      render: (_, record) => (
        <ThresholdInput
          disabled={record.editDisabled}
          value={
            record.override.high_threshold ?? record.point.high_threshold
          }
          onChange={(v) =>
            onPointOverrideChange(item.id, record.point.id, {
              high_threshold: v ?? undefined,
            })
          }
          label="高风险分"
        />
      ),
    },
    {
      title: '关联库',
      dataIndex: 'libraries',
      width: 240,
      render: (_, record) => (
        <LibrarySelectInline
          disabled={record.editDisabled}
          mediaKey={mediaKey}
          overrideIds={record.override.linked_library_ids}
          libraryOptions={libraryOptions}
          onChange={(ids) =>
            onPointOverrideChange(item.id, record.point.id, {
              linked_library_ids: ids,
            })
          }
        />
      ),
    },
  ]

  return (
    <div style={{ width: '100%', textAlign: 'left' }}>
      <Table<PointRowRecord>
        columns={columns}
        dataSource={dataSource}
        pagination={false}
        size="small"
        rowKey="key"
        scroll={{ x: 720 }}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="该审核项下暂无审核点"
              style={{ padding: '24px 0' }}
            />
          ),
        }}
      />
    </div>
  )
}

function ThresholdInput({
  disabled,
  value,
  onChange,
  label,
}: {
  disabled: boolean
  value: number
  onChange: (v: number | null) => void
  label: string
}) {
  return (
    <Tooltip title={label}>
      <InputNumber
        size="small"
        min={50}
        max={100}
        step={0.01}
        precision={2}
        value={value}
        disabled={disabled}
        onChange={(v) => onChange(typeof v === 'number' ? v : null)}
        style={{ width: 90 }}
      />
    </Tooltip>
  )
}

function LibrarySelectInline({
  disabled,
  mediaKey,
  overrideIds,
  libraryOptions,
  onChange,
}: {
  disabled: boolean
  mediaKey: CategoryKey
  overrideIds: number[] | undefined
  libraryOptions: LibraryListItem[]
  onChange: (ids: number[]) => void
}) {
  const currentIds = overrideIds ?? []
  const libraryById = useMemo(() => {
    const m = new Map<number, LibraryListItem>()
    for (const l of libraryOptions) m.set(l.id, l)
    return m
  }, [libraryOptions])

  const allowedTypes = ALLOWED_LIB_TYPES[mediaKey] ?? []
  const allowedLibs = useMemo(
    () =>
      libraryOptions.filter((l) =>
        allowedTypes.includes(l.library_type as LibraryType),
      ),
    [libraryOptions, allowedTypes],
  )

  const lockedType: LibraryType | undefined = currentIds.length
    ? (libraryById.get(currentIds[0])?.library_type as LibraryType | undefined)
    : undefined

  const options = useMemo(() => {
    return allowedLibs
      .filter(
        (l) =>
          !lockedType || (l.library_type as LibraryType) === lockedType,
      )
      .map((l) => {
        const t = l.library_type as LibraryType
        return {
          value: l.id,
          label: (
            <Space size={4} align="center">
              <Tag color={TYPE_COLOR[t]} style={{ margin: 0 }}>
                {TYPE_LABEL[t]}
              </Tag>
              {l.kind && (
                <Tag
                  color={l.kind === '黑名单' ? 'red' : 'green'}
                  style={{ margin: 0 }}
                >
                  {l.kind}
                </Tag>
              )}
              <span>{l.name}</span>
            </Space>
          ),
        }
      })
  }, [allowedLibs, lockedType])

  const handleChange = (ids: number[]) => {
    if (lockedType) {
      const filtered = ids.filter((id) => {
        const lib = libraryById.get(id)
        return lib ? (lib.library_type as LibraryType) === lockedType : false
      })
      onChange(filtered)
    } else {
      onChange(ids)
    }
  }

  if (allowedLibs.length === 0) {
    return (
      <Text type="secondary" style={{ fontSize: 12 }}>
        当前媒体类型无可用关联库
      </Text>
    )
  }

  return (
    <Select
      mode="multiple"
      size="small"
      placeholder={lockedType ? `选择自定义${TYPE_LABEL[lockedType]}库` : '选择自定义库'}
      value={currentIds}
      onChange={handleChange}
      allowClear
      style={{ minWidth: 180, maxWidth: 280 }}
      disabled={disabled || options.length === 0}
      options={options}
      maxTagCount="responsive"
      notFoundContent={
        lockedType ? `已锁定为${TYPE_LABEL[lockedType]}库` : '暂无可用'
      }
    />
  )
}