import { useEffect, useMemo, useState } from 'react'
import {
  App,
  Checkbox,
  Empty,
  Grid,
  InputNumber,
  Popover,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import type { TableColumnsType } from 'antd'
import {
  AppstoreAddOutlined,
  CheckOutlined,
  CloseOutlined,
  DatabaseOutlined,
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

const TYPE_LABEL_BY_LIB: Record<string, string> = {
  image: '图',
  word: '词',
  reply: '代',
}
const TYPE_COLOR_BY_LIB: Record<string, string> = {
  image: 'blue',
  word: 'green',
  reply: 'purple',
}

function libsBadge(item: AuditItem): React.ReactNode {
  const list = item.linked_libraries ?? []
  if (list.length === 0) {
    return null
  }
  const type = list[0]?.library_type
  const label = TYPE_LABEL_BY_LIB[type] ?? '?'
  const color = TYPE_COLOR_BY_LIB[type] ?? 'default'
  const names = list.map((l) => l.name).join('、')
  return (
    <Tooltip title={names}>
      <Tag
        color={color}
        bordered={false}
        style={{ margin: 0, fontSize: 11, padding: '0 6px' }}
      >
        {label}×{list.length}
      </Tag>
    </Tooltip>
  )
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
      medium_threshold?: number | null
      high_threshold?: number | null
      medium_threshold_min?: number | null
      medium_threshold_max?: number | null
      high_threshold_min?: number | null
      high_threshold_max?: number | null
    },
  ) => void
  /** point 勾选时通知父级，便于父级维护 enabledItemIds 集合 */
  onPointToggle: (itemId: number, pointId: number, checked: boolean) => void
  /** 点击 item 行「关联库」入口触发；父级弹出 ItemLibrariesEditor 并立即 PATCH */
  onItemLibraryLink?: (item: AuditItem) => void
  /**
   * 父级在库关联保存后 +1, RulesTreeView 用它做 remount key,
   * 重新拉 items 让左栏 badge 同步刷新。
   */
  refreshKey?: number
}

const PACKAGE_TO_MEDIA: Record<string, CategoryKey> = {
  image_audit_pro: 'image',
  text_audit_pro: 'text',
  audio_audit_pro: 'audio',
  document_audit_pro: 'doc',
  video_audit_pro: 'video',
}

const ALLOWED_LIB_TYPES_BY_MEDIA: Record<CategoryKey, LibraryType[]> = {
  image: ['word', 'reply'],
  text: ['word', 'reply'],
  audio: ['word', 'reply'],
  doc: ['image', 'word', 'reply'],
  video: ['image', 'word', 'reply'],
}

export default function RulesTreeView({
  packageCode,
  enabledItemIds,
  getPointMap,
  onPointMapChange,
  pointOverrides,
  onPointOverrideChange,
  onPointToggle: _onPointToggle,
  onItemLibraryLink,
  refreshKey,
}: Props) {
  const [items, setItems] = useState<AuditItem[]>([])
  const [pointsByItem, setPointsByItem] = useState<Record<number, AuditPoint[]>>(
    {},
  )
  const [loading, setLoading] = useState(false)
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null)

  const mediaKey: CategoryKey =
    (packageCode ? PACKAGE_TO_MEDIA[packageCode] : null) ?? 'image'

  // 拉数据：仅 items。关联自定义库已上移至审核项，不再在审核点表格展示。
  useEffect(() => {
    if (!packageCode) return
    let cancel = false
    setLoading(true)
    auditItemsApi
      .list(packageCode)
      .then(async (itemsRes) => {
        if (cancel) return
        setItems(itemsRes)
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
  }, [packageCode, refreshKey])

  const { builtinItems, customItems } = useMemo(() => {
    const b: AuditItem[] = []
    const c: AuditItem[] = []
    items.forEach((it) => (it.is_builtin ? b.push(it) : c.push(it)))
    return { builtinItems: b, customItems: c }
  }, [items])

  const enabledSet = useMemo(() => new Set(enabledItemIds), [enabledItemIds])

  const allowedLibTypes = ALLOWED_LIB_TYPES_BY_MEDIA[mediaKey]
  const [libsCache, setLibsCache] = useState<LibraryListItem[]>([])
  const [popoverOpenForItemId, setPopoverOpenForItemId] = useState<
    number | null
  >(null)
  const [pendingItems, setPendingItems] = useState<Set<number>>(new Set())
  const { message } = App.useApp()

  useEffect(() => {
    let cancel = false
    Promise.all(
      (['image', 'word', 'reply'] as LibraryType[]).map((t) =>
        librariesApi
          .list({ type: t, size: 200 })
          .then((p) => p.items.filter((l) => !l.is_deleted && l.is_active))
          .catch(() => [] as LibraryListItem[]),
      ),
    )
      .then(([img, word, reply]) => {
        if (cancel) return
        setLibsCache([...img, ...word, ...reply])
      })
      .catch(() => {
        if (!cancel) setLibsCache([])
      })
    return () => {
      cancel = true
    }
  }, [refreshKey])

  const visibleLibs = useMemo(
    () => libsCache.filter((l) => allowedLibTypes.includes(l.library_type)),
    [libsCache, allowedLibTypes],
  )

  const handleItemLibrariesPatched = (updated: AuditItem) => {
    setItems((prev) =>
      prev.map((it) => (it.id === updated.id ? updated : it)),
    )
  }

  const handleToggleLibrary = async (
    item: AuditItem,
    libraryId: number,
    checked: boolean,
  ) => {
    if (!packageCode) return
    const currentIds = (item.linked_libraries ?? []).map((l) => l.library_id)
    const nextIds = checked
      ? Array.from(new Set([...currentIds, libraryId]))
      : currentIds.filter((id) => id !== libraryId)
    setPendingItems((prev) => new Set(prev).add(item.id))
    try {
      const updated = await auditItemsApi.update(packageCode, item.id, {
        linked_library_ids: nextIds,
      })
      handleItemLibrariesPatched(updated)
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response
        ?.data?.detail
      message.error(detail ?? (e as Error).message ?? '关联失败')
    } finally {
      setPendingItems((prev) => {
        const next = new Set(prev)
        next.delete(item.id)
        return next
      })
    }
  }

  const handleRemoveLibrary = async (
    item: AuditItem,
    libraryId: number,
  ) => {
    await handleToggleLibrary(item, libraryId, false)
  }

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
            onItemLibraryLink={onItemLibraryLink}
            visibleLibs={visibleLibs}
            popoverOpenForItemId={popoverOpenForItemId}
            setPopoverOpenForItemId={setPopoverOpenForItemId}
            pendingItems={pendingItems}
            handleToggleLibrary={handleToggleLibrary}
            handleRemoveLibrary={handleRemoveLibrary}
            allowLibraryLink={mediaKey !== 'image'}
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
            onItemLibraryLink={onItemLibraryLink}
            visibleLibs={visibleLibs}
            popoverOpenForItemId={popoverOpenForItemId}
            setPopoverOpenForItemId={setPopoverOpenForItemId}
            pendingItems={pendingItems}
            handleToggleLibrary={handleToggleLibrary}
            handleRemoveLibrary={handleRemoveLibrary}
            allowLibraryLink={mediaKey !== 'image'}
          />
        </div>

        {/* 右栏：所有 item 的审核点摊平 + 共用一个滚动容器 */}
        <div
          style={{
            background: '#F8FAFC',
            borderRadius: 8,
            padding: '4px 8px',
            maxHeight: isStacked ? 'none' : 720,
            minHeight: isStacked ? 'auto' : 540,
            overflowY: isStacked ? 'visible' : 'auto',
          }}
        >
          {items.length > 0 ? (
            <PointsColumn
              items={items}
              pointsByItem={pointsByItem}
              getPointMap={getPointMap}
              pointOverrides={pointOverrides}
              onPointMapChange={onPointMapChange}
              onPointOverrideChange={onPointOverrideChange}
              mediaKey={mediaKey}
            />
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <Text type="secondary">该审核类型暂无审核项</Text>
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
  title: _title,
  icon: _icon,
  items,
  enabledSet,
  enabledPointCountByItem,
  activeItemId,
  onPick,
  loading,
  emptyText,
  onItemLibraryLink,
  visibleLibs,
  popoverOpenForItemId,
  setPopoverOpenForItemId,
  pendingItems,
  handleToggleLibrary,
  handleRemoveLibrary,
  allowLibraryLink,
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
  onItemLibraryLink?: (item: AuditItem) => void
  visibleLibs: LibraryListItem[]
  popoverOpenForItemId: number | null
  setPopoverOpenForItemId: (id: number | null) => void
  pendingItems: Set<number>
  handleToggleLibrary: (
    item: AuditItem,
    libraryId: number,
    checked: boolean,
  ) => Promise<void> | void
  handleRemoveLibrary: (item: AuditItem, libraryId: number) => Promise<void> | void
  allowLibraryLink: boolean
}) {
  return (
    <div style={{ marginBottom: 8 }}>
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
          <>
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
              {libsBadge(it)}
              {allowLibraryLink && visibleLibs.length > 0 && (() => {
                const linkedLibs = it.linked_libraries ?? []
                const open = popoverOpenForItemId === it.id
                return (
                  <Popover
                    trigger="click"
                    open={open}
                    onOpenChange={(next) =>
                      setPopoverOpenForItemId(next ? it.id : null)
                    }
                    destroyTooltipOnHide
                    placement="right"
                    content={
                      <LibraryChoiceList
                        item={it}
                        libOptions={visibleLibs}
                        pending={pendingItems.has(it.id)}
                        onToggle={handleToggleLibrary}
                      />
                    }
                  >
                    <Tooltip
                      title={
                        linkedLibs.length > 0
                          ? `已关联 ${linkedLibs.length} 个自定义库，点击管理`
                          : '为该审核项关联自定义库'
                      }
                    >
                      <span
                        role="button"
                        aria-label={`关联库 ${it.name_cn}`}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '0 6px',
                          height: 22,
                          borderRadius: 4,
                          cursor: 'pointer',
                          color: linkedLibs.length > 0 ? '#0369A1' : '#0EA5E9',
                          background:
                            linkedLibs.length > 0 ? '#E0F2FE' : 'transparent',
                          fontSize: 12,
                        }}
                      >
                        <AppstoreAddOutlined style={{ fontSize: 13 }} />
                        自定义词库
                        <Tag
                          color="blue"
                          bordered={false}
                          style={{
                            margin: 0,
                            fontSize: 10,
                            padding: '0 4px',
                            lineHeight: '14px',
                          }}
                        >
                          {linkedLibs.length}
                        </Tag>
                      </span>
                    </Tooltip>
                  </Popover>
                )
              })()}
              {allowLibraryLink && onItemLibraryLink && visibleLibs.length === 0 && (
                <Tooltip title="为该审核项关联自定义库">
                  <span
                    role="button"
                    aria-label={`关联库 ${it.name_cn}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      onItemLibraryLink(it)
                    }}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 22,
                      height: 22,
                      borderRadius: 4,
                      cursor: 'pointer',
                      color: '#0EA5E9',
                    }}
                  >
                    <AppstoreAddOutlined style={{ fontSize: 14 }} />
                  </span>
                </Tooltip>
              )}
            </div>
            {(it.linked_libraries ?? []).length > 0 && (
              <div
                style={{
                  padding: '0 16px 8px 32px',
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 4,
                  background: active ? '#EFF6FF' : 'transparent',
                }}
              >
                {(it.linked_libraries ?? []).map((l) => {
                  const removing = pendingItems.has(it.id)
                  return (
                    <Tag
                      key={l.library_id}
                      color={TYPE_COLOR_BY_LIB[l.library_type] ?? 'default'}
                      bordered={false}
                      closeIcon={<CloseOutlined />}
                      onClose={(e) => {
                        e.preventDefault()
                        handleRemoveLibrary(it, l.library_id)
                      }}
                      style={{
                        margin: 0,
                        fontSize: 11,
                        padding: '2px 8px',
                        opacity: removing ? 0.6 : 1,
                      }}
                    >
                      {TYPE_LABEL_BY_LIB[l.library_type] ?? '?'}: {l.name}
                    </Tag>
                  )
                })}
              </div>
            )}
          </>
          )
        })
      )}
    </div>
  )
}

type PointRowRecord = {
  kind: 'point'
  key: string
  item: AuditItem
  point: AuditPoint
  checked: boolean
  override: {
    medium_threshold?: number
    high_threshold?: number
    medium_threshold_min?: number
    medium_threshold_max?: number
    high_threshold_min?: number
    high_threshold_max?: number
  }
  isCustom: boolean
  editDisabled: boolean
}

type SectionHeaderRecord = {
  kind: 'section'
  key: string
  item: AuditItem
  pointCount: number
}

type FlatRowRecord = PointRowRecord | SectionHeaderRecord

function PointsColumn({
  items,
  pointsByItem,
  getPointMap,
  pointOverrides,
  onPointMapChange,
  onPointOverrideChange,
  mediaKey,
}: {
  items: AuditItem[]
  pointsByItem: Record<number, AuditPoint[]>
  getPointMap: (itemId: number) => PointMap
  pointOverrides: MediaPointOverrideMap
  onPointMapChange: (itemId: number, next: PointMap) => void
  onPointOverrideChange: (
    itemId: number,
    pointId: number,
    override: {
      medium_threshold?: number | null
      high_threshold?: number | null
      medium_threshold_min?: number | null
      medium_threshold_max?: number | null
      high_threshold_min?: number | null
      high_threshold_max?: number | null
    },
  ) => void
  mediaKey: CategoryKey
}) {
  const dataSource: FlatRowRecord[] = []
  items.forEach((it) => {
    const ps = pointsByItem[it.id] ?? []
    dataSource.push({
      kind: 'section',
      key: `section-${it.id}`,
      item: it,
      pointCount: ps.length,
    })
    const pm = getPointMap(it.id)
    ps.forEach((p) => {
      dataSource.push({
        kind: 'point',
        key: `point-${it.id}-${p.id}`,
        item: it,
        point: p,
        checked: pm[p.id] === true,
        override: pointOverrides[mediaKey]?.[it.id]?.[p.id] ?? {},
        isCustom: !p.is_builtin,
        editDisabled: pm[p.id] !== true,
      })
    })
  })

  const COL_TOTAL = 5
  const columns: TableColumnsType<FlatRowRecord> = [
    {
      title: '',
      dataIndex: 'checked',
      width: 40,
      onCell: (record) =>
        record.kind === 'section' ? { colSpan: COL_TOTAL } : {},
      render: (_, record) => {
        if (record.kind === 'section') {
          return (
            <div
              style={{
                padding: '12px 0 6px',
                borderBottom: '1px dashed var(--color-border)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Text strong style={{ fontSize: 14, color: '#0F172A' }}>
                {record.item.name_cn}
              </Text>
              <Tag
                color={record.item.is_builtin ? 'gold' : 'blue'}
                bordered={false}
                style={{ margin: 0, fontSize: 11 }}
              >
                {record.item.is_builtin ? '通用' : '自定义'}
              </Tag>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {record.pointCount} 个审核点
              </Text>
            </div>
          )
        }
        const pm = getPointMap(record.item.id)
        return (
          <input
            type="checkbox"
            checked={record.checked}
            onChange={(e) =>
              onPointMapChange(record.item.id, {
                ...pm,
                [record.point.id]: e.target.checked,
              })
            }
            aria-label={`启用审核点 ${record.point.label_cn}`}
            style={{ margin: 0 }}
          />
        )
      },
    },
    {
      title: '审核点',
      dataIndex: 'point',
      onCell: (record) =>
        record.kind === 'section' ? { colSpan: 0 } : {},
      render: (_, record) => {
        if (record.kind === 'section') return null
        const name = record.point.label_cn || record.point.label || record.point.code
        return (
          <Space size={6} align="center">
            <Text strong style={{ color: '#0F172A' }} ellipsis={{ tooltip: name }}>
              {name}
            </Text>
          </Space>
        )
      },
    },
    {
      title: '审核说明',
      dataIndex: 'description',
      onCell: (record) =>
        record.kind === 'section' ? { colSpan: 0 } : {},
      render: (_, record) => {
        if (record.kind === 'section') return null
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
      width: 180,
      align: 'left',
      onCell: (record) =>
        record.kind === 'section' ? { colSpan: 0 } : {},
      render: (_, record) => {
        if (record.kind !== 'point') return null
        return (
          <RangeThresholdInput
            disabled={record.editDisabled}
            minValue={
              record.override.medium_threshold_min ??
              (record.override.medium_threshold ?? undefined)
            }
            maxValue={
              record.override.medium_threshold_max ?? record.point.medium_threshold
            }
            onChange={(min, max) =>
              onPointOverrideChange(record.item.id, record.point.id, {
                medium_threshold_min: min,
                medium_threshold_max: max,
                medium_threshold: undefined,
              })
            }
            label="中风险分"
          />
        )
      },
    },
    {
      title: '高风险分',
      dataIndex: 'highThreshold',
      width: 180,
      align: 'left',
      onCell: (record) =>
        record.kind === 'section' ? { colSpan: 0 } : {},
      render: (_, record) => {
        if (record.kind !== 'point') return null
        return (
          <RangeThresholdInput
            disabled={record.editDisabled}
            minValue={
              record.override.high_threshold_min ?? record.point.high_threshold
            }
            maxValue={
              record.override.high_threshold_max ?? 100
            }
            onChange={(min, max) =>
              onPointOverrideChange(record.item.id, record.point.id, {
                high_threshold_min: min,
                high_threshold_max: max,
                high_threshold: undefined,
              })
            }
            label="高风险分"
          />
        )
      },
    },
  ]

  return (
    <div style={{ width: '100%', textAlign: 'left' }}>
      <Table<FlatRowRecord>
        className="rules-tree-table"
        columns={columns}
        dataSource={dataSource}
        pagination={false}
        size="small"
        rowKey="key"
        scroll={{ x: 720 }}
        rowClassName={(record) =>
          record.kind === 'section' ? 'rules-tree-row-section' : ''
        }
        onRow={(record) =>
          record.kind === 'section' ? { id: `rules-section-${record.item.id}` } : {}
        }
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="暂无审核点"
              style={{ padding: '24px 0' }}
            />
          ),
        }}
      />
    </div>
  )
}

function RangeThresholdInput({
  disabled,
  minValue,
  maxValue,
  onChange,
  label,
}: {
  disabled: boolean
  minValue: number | undefined
  maxValue: number | undefined
  onChange: (min: number | null, max: number | null) => void
  label: string
}) {
  return (
    <Space size={4} align="center">
      <Tooltip title={`${label} 下限`}>
        <InputNumber
          size="small"
          min={50}
          max={100}
          step={0.01}
          precision={2}
          value={minValue ?? null}
          disabled={disabled}
          onChange={(v) =>
            onChange(typeof v === 'number' ? v : null, maxValue ?? null)
          }
          style={{ width: 76 }}
        />
      </Tooltip>
      <span style={{ color: '#64748B', fontSize: 12 }}>~</span>
      <Tooltip title={`${label} 上限`}>
        <InputNumber
          size="small"
          min={50}
          max={100}
          step={0.01}
          precision={2}
          value={maxValue ?? null}
          disabled={disabled}
          onChange={(v) =>
            onChange(minValue ?? null, typeof v === 'number' ? v : null)
          }
          style={{ width: 76 }}
        />
      </Tooltip>
    </Space>
  )
}

function LibraryChoiceList({
  item,
  libOptions,
  pending,
  onToggle,
}: {
  item: AuditItem
  libOptions: LibraryListItem[]
  pending: boolean
  onToggle: (item: AuditItem, libraryId: number, checked: boolean) => void
}) {
  const currentIds = (item.linked_libraries ?? []).map((l) => l.library_id)
  if (libOptions.length === 0) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <Text type="secondary" style={{ fontSize: 12 }}>
            暂无可用的自定义库
          </Text>
        }
        style={{ padding: '8px 0' }}
      />
    )
  }
  return (
    <div style={{ width: 280 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 8,
        }}
      >
        <DatabaseOutlined style={{ color: '#2563EB' }} />
        <Text strong style={{ fontSize: 12 }}>
          为「{item.name_cn}」关联自定义库
        </Text>
      </div>
      <Text
        type="secondary"
        style={{ fontSize: 12, display: 'block', marginBottom: 6 }}
      >
        勾选即时生效，可多选
      </Text>
      <Checkbox.Group
        style={{
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
        value={currentIds}
        disabled={pending}
        onChange={(allChecked) => {
          const target = new Set<number>(allChecked as number[])
          const current = new Set(currentIds)
          const toAdd: number[] = []
          const toRemove: number[] = []
          target.forEach((id) => {
            if (!current.has(id)) toAdd.push(id)
          })
          current.forEach((id) => {
            if (!target.has(id)) toRemove.push(id)
          })
          toAdd.forEach((id) => onToggle(item, id, true))
          toRemove.forEach((id) => onToggle(item, id, false))
        }}
      >
        {libOptions.map((l) => (
          <Checkbox key={l.id} value={l.id}>
            <Space size={4} align="center">
              <Tag
                color={TYPE_COLOR_BY_LIB[l.library_type] ?? 'default'}
                bordered={false}
                style={{ margin: 0, fontSize: 11, padding: '0 6px' }}
              >
                {TYPE_LABEL_BY_LIB[l.library_type] ?? '?'}
              </Tag>
              <span style={{ fontSize: 12 }}>{l.name}</span>
            </Space>
          </Checkbox>
        ))}
      </Checkbox.Group>
    </div>
  )
}