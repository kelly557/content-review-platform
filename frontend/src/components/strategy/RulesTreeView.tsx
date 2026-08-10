import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Alert,
  Button,
  Empty,
  Grid,
  InputNumber,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import type { TableColumnsType } from 'antd'
import type { Reference as TableRef } from 'rc-table'
import { CheckOutlined } from '@ant-design/icons'
import { auditItemsApi } from '@/api/auditItems'
import { auditPointsApi } from '@/api/auditPoints'
import type {
  AuditItem,
  AuditPoint,
  SubAuditPoint,
} from '@/types/domain'
import { getIntensityFallback, DEFAULT_INTENSITY, type Intensity } from '@/lib/threshold'
import type { ImageTextMode } from '@/types/domain'
import { type CategoryKey } from './constants'
import {
  EMPTY_MEDIA_OVERRIDES,
  type ItemPointMap,
  type MediaPointOverrideMap,
  type PointMap,
} from './pointLevel'
import AgentCardsColumn from './AgentCardsColumn'

const { Text } = Typography

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
      low_threshold_min?: number | null
      low_threshold_max?: number | null
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
  // ---- 2026-07-30 「图文」开关 bar ----
  /** 父级传入的「图文」bar(右栏顶部,Switch + ComposeRuleCard);默认 null */
  imageTextBar?: ReactNode
  /** 左栏 item 选中变化回调(供父级判断是否显示 bar);不传则维持内部 selectedItemId 行为 */
  onSelectedItemChange?: (item: AuditItem | null) => void
  /**
   * 2026-07-30 「图文」独立规则配置。
   * 当 mode === 'independent' 时,在右栏 PointsColumn 之后追加渲染
   * 一棵 text 包规则树 (IndependentTextRulesBlock),
   * 让用户配置图文专有的独立规则(独立于 image/text 维度)。
   * enabled=false 或 mode='reuse_text' 时不渲染。
   */
  imageTextConfig?: {
    mode: ImageTextMode
    pointMap: ItemPointMap
    onPointMapChange: (itemId: number, next: PointMap) => void
  }
  /** 当前检测强度档位：用于 sub 阈值在没有用户 override 时作为显示回退 */
  intensity?: Intensity
  /**
   * 显式指定 mediaKey（覆盖 packageCode 反推）。
   * 用于「语音/文档/视频」独立规则树渲染 text/image 包数据时：
   * packageCode=text_audit_pro 但 pointOverrides/pointMap 仍按 tab 自身 key
   * （audio/doc/video）存取，避免与文本 tab 的阈值覆盖串数据。
   */
  mediaKey?: CategoryKey
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
  refreshKey,
  imageTextBar,
  onSelectedItemChange,
  imageTextConfig,
  intensity = DEFAULT_INTENSITY,
  mediaKey: mediaKeyOverride,
}: Props) {
  const [items, setItems] = useState<AuditItem[]>([])
  const [pointsByItem, setPointsByItem] = useState<Record<number, AuditPoint[]>>(
    {},
  )
  const [loading, setLoading] = useState(false)
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null)

  const mediaKey: CategoryKey =
    mediaKeyOverride ?? (packageCode ? PACKAGE_TO_MEDIA[packageCode] : null) ?? 'image'

  useEffect(() => {
    if (!packageCode) return
    let cancel = false
    setLoading(true)
    // 一次拉全包 points（后端 list 端点 item_id 可选，不带则返回全包），
    // 前端按 item_id 分组，替代 N+1 逐 item 拉取（11 请求 → 1 请求）。
    Promise.all([
      auditItemsApi.list(packageCode),
      auditPointsApi.list(packageCode),
    ])
      .then(([itemsRes, allPoints]) => {
        if (cancel) return
        setItems(itemsRes)
        const map: Record<number, AuditPoint[]> = {}
        for (const p of allPoints) {
          const iid = p.item_id
          if (iid == null) continue
          ;(map[iid] ??= []).push(p)
        }
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

  // 左栏点击 → 滚到右栏 section + 1.5s 闪烁高亮
  const [highlightItemId, setHighlightItemId] = useState<number | null>(null)
  // antd Table ref：虚拟滚动模式下用 ref.scrollTo({ key }) 定位行
  // （getElementById 在虚拟滚动下拿不到未渲染的行 DOM）
  const tableRef = useRef<TableRef>(null)
  const rightPaneRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (selectedItemId == null) return
    // 虚拟滚动：用 antd Table 官方 scrollTo API 按 rowKey 定位
    tableRef.current?.scrollTo({ key: `section-${selectedItemId}` })
    // 高亮延后设置：scrollTo 是异步动画，目标行需先渲染到 DOM 才能显示 flash class
    setHighlightItemId(selectedItemId)
    const t = window.setTimeout(() => setHighlightItemId(null), 1500)
    return () => window.clearTimeout(t)
  }, [selectedItemId])

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
      {/* Box A: 内置规则(中栏 + 右栏表格整体一个 box,2026-07-29) */}
      <div className="module-box">
        <div className="module-section-title">
          <span>通用规则</span>
          <span className="module-section-title-count">{builtinItems.length}</span>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: leftColTemplate,
            gap: 0,
            alignItems: 'start',
          }}
        >
          {/* 左栏：分组 item 列表(无 box 包裹,通过右侧边框划分左右栏)
              2026-07-29 删除「审核 Agent」分组:Box B 已独占 Agent 配置入口,
              左栏冗余。customItems 仍用作 Box B 的 items,保留计算与传参。 */}
          <div
            style={{
              paddingRight: isStacked ? 0 : 16,
              borderRight: isStacked ? 'none' : '1px solid var(--color-border)',
              maxHeight: isStacked ? 'none' : 540,
              overflowY: isStacked ? 'visible' : 'auto',
            }}
          >
            <ItemGroup
              title=""
              icon={null}
              items={builtinItems}
              enabledSet={enabledSet}
              enabledPointCountByItem={enabledPointCountByItem}
              activeItemId={selectedItemId}
              onPick={(id) => {
                setSelectedItemId(id)
                if (onSelectedItemChange) {
                  const picked = builtinItems.find((it) => it.id === id) ?? null
                  onSelectedItemChange(picked)
                }
              }}
              loading={loading}
              emptyText="暂无通用规则"
            />
          </div>

          {/* 右栏：所有内置 item 的审核点摊平 + 共用一个滚动容器。
               2026-07-30 「图文」bar 已挪到 PointsColumn 内部 section header 位置(替代「图文通用」module)。 */}
          <div
            style={{
              paddingLeft: isStacked ? 0 : 16,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              ref={rightPaneRef}
              style={{
                maxHeight: isStacked ? 'none' : 720,
                minHeight: isStacked ? 'auto' : 540,
                minWidth: 0,
                overflowY: isStacked ? 'visible' : 'auto',
                overflowX: isStacked ? 'visible' : 'auto',
              }}
            >
              {items.length > 0 ? (
                <PointsColumn
                  items={builtinItems}
                  pointsByItem={pointsByItem}
                  getPointMap={getPointMap}
                  pointOverrides={pointOverrides}
                  onPointMapChange={onPointMapChange}
                  onPointOverrideChange={onPointOverrideChange}
                  highlightItemId={highlightItemId}
                  mediaKey={mediaKey}
                  imageTextBar={imageTextBar}
                  intensity={intensity}
                  tableRef={tableRef}
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
              {/* 2026-07-30 「图文」独立模式:在 PointsColumn 后追加渲染
                  text 包规则树,允许用户配置独立的图文规则。
                  切到「复用」时整块消失,但 imageTextConfig.pointMap 状态保留
                  (CreateStrategyForm 顶层 imageTextPointMap 持有),再次独立时恢复。 */}
              {imageTextConfig?.mode === 'independent' && (
                <IndependentTextRulesBlock
                  pointMap={imageTextConfig.pointMap}
                  onPointMapChange={imageTextConfig.onPointMapChange}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Box B: 审核 Agent(独立 box,32px gap,2026-07-29) */}
      {customItems.length > 0 && (
        <>
          <div className="module-gap" />
          <div className="module-box">
            <AgentCardsColumn
              packageCode={packageCode}
              items={customItems}
            />
          </div>
        </>
      )}
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
      {/* 2026-07-30：title 为空且 icon=null 时整行不渲染；保留 title 时也不再显示 items.length「9」计数 */}
      {(icon || title) && (
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
          {title && <span>{title}</span>}
        </div>
      )}
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

/**
 * 风险分区间一致性检查(2026-07-28 业务规则):
 *   - 中风险分 max = 高风险分 min - 0.01 (abs 容差 1e-6)
 *   - 中风险分 min ≤ 中风险分 max
 *   - 高风险分 min ≤ 100.00 (上限固定)
 *
 * 返回 null = 一致;否则返回警告文案。
 */
function checkThresholdConsistency(
  medMin: number | null | undefined,
  medMax: number | null | undefined,
  highMin: number | null | undefined,
  highMax: number | null | undefined,
): string | null {
  const mm = typeof medMin === 'number' ? medMin : null
  const mM = typeof medMax === 'number' ? medMax : null
  const hm = typeof highMin === 'number' ? highMin : null
  const hM = typeof highMax === 'number' ? highMax : null
  if (mM != null && hm != null && Math.abs(mM + 0.01 - hm) > 1e-6) {
    return `中风险分上限 (${mM.toFixed(2)}) 与高风险分下限 (${hm.toFixed(2)}) 相差 ${(mM + 0.01 - hm).toFixed(2)},需调整使差值 = 0.01`
  }
  if (mm != null && mM != null && mm >= mM) {
    return `中风险分下限 (${mm.toFixed(2)}) ≥ 上限 (${mM.toFixed(2)})`
  }
  if (hm != null && hM != null && hm >= hM) {
    return `高风险分下限 (${hm.toFixed(2)}) ≥ 上限 (${hM.toFixed(2)})`
  }
  return null
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
    low_threshold_min?: number
    low_threshold_max?: number
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

type FlatRowRecord =
  | PointRowRecord
  | SectionHeaderRecord

function PointsColumn({
  items,
  pointsByItem,
  getPointMap,
  pointOverrides,
  onPointMapChange,
  onPointOverrideChange,
  highlightItemId,
  mediaKey,
  imageTextBar,
  intensity,
  tableRef,
}: {
  items: AuditItem[]
  pointsByItem: Record<number, AuditPoint[]>
  getPointMap: (itemId: number) => PointMap
  pointOverrides: MediaPointOverrideMap
  onPointMapChange: (itemId: number, next: PointMap) => void
  onPointOverrideChange: (itemId: number, pointId: number, override: {
    medium_threshold?: number | null
    high_threshold?: number | null
    low_threshold_min?: number | null
    low_threshold_max?: number | null
    medium_threshold_min?: number | null
    medium_threshold_max?: number | null
    high_threshold_min?: number | null
    high_threshold_max?: number | null
  }) => void
  highlightItemId: number | null
  mediaKey: CategoryKey
  /** 「图文」bar;当 record.item.name_cn === '图文' 时,在 section header 位置渲染 */
  imageTextBar?: ReactNode
  /** 当前检测强度档位：sub 阈值无 override 时的显示回退 */
  intensity: Intensity
  /** antd Table ref：供外层 RulesTreeView 调用 scrollTo 定位行 */
  tableRef: React.RefObject<TableRef>
}) {
  const dataSource = useMemo<FlatRowRecord[]>(
    () => {
      const rows: FlatRowRecord[] = []
      items.forEach((it) => {
        const ps = pointsByItem[it.id] ?? []
        rows.push({
          kind: 'section',
          key: `section-${it.id}`,
          item: it,
          pointCount: ps.length,
        })
        // 2026-07-30 「图文」item 不渲染下方的 parent row + sub row,
        // 替代方案由 section header render 直接返回 imageTextBar
        if (it.name_cn === '图文') return
        const pm = getPointMap(it.id)
        ps.forEach((p) => {
          rows.push({
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
      return rows
    },
    [items, pointsByItem, getPointMap, pointOverrides, mediaKey],
  )

  const COL_TOTAL = 2
  const [subEnabledMap, setSubEnabledMap] = useState<Record<number, boolean>>({})

  // 每个父审核点下的三级 sub 列表 — 从后端拉取（真实数据）
  const [subsByPointId, setSubsByPointId] = useState<Record<number, SubAuditPoint[]>>({})

  // dataSource 现在是 useMemo 包裹的稳定引用（依赖 items/pointsByItem/getPointMap/pointOverrides/mediaKey）。
  // pointIdsKey 基于 dataSource 派生，作为 sub-points 拉取 effect 的稳定依赖。
  const pointIdsKey = useMemo(
    () =>
      dataSource
        .filter((r) => r.kind === 'point')
        .map((r) => `${r.point.package_code}:${r.point.id}`)
        .join(','),
    [dataSource],
  )

  useEffect(() => {
    const points = dataSource.filter((r) => r.kind === 'point')
    const pkg = points[0]?.point.package_code
    if (points.length === 0 || !pkg) {
      setSubsByPointId({})
      return
    }
    // 按 point.id 建索引，用于给 sub 回填 l1/l2 标签
    const pointCtx: Record<number, { l1: string; l2: string }> = {}
    for (const r of points) {
      pointCtx[r.point.id] = {
        l1: r.item.name_cn,
        l2: r.point.label_cn || r.point.label,
      }
    }
    let alive = true
    const load = async () => {
      // 一次拉全包 sub-审核点，按 parent_point_id 分组（替代逐点 N+1 拉取）
      try {
        const allSubs = await auditPointsApi.listAllSubPoints(pkg)
        if (!alive) return
        const map: Record<number, SubAuditPoint[]> = {}
        for (const s of allSubs) {
          const pid = s.parent_point_id
          if (pid == null) continue
          const ctx = pointCtx[pid]
          if (!ctx) continue // 不属于当前展示的点，跳过
          ;(map[pid] ??= []).push({
            id: s.id,
            point_id: s.id,
            l1_label: ctx.l1,
            l2_label: ctx.l2,
            l3_label: s.label_cn || s.label,
            label_cn: s.label_cn || s.label,
            low_threshold: 0,
            medium_threshold: s.medium_threshold,
            high_threshold: s.high_threshold,
            is_enabled: s.is_enabled,
            sort_order: s.sort_order,
          })
        }
        if (alive) setSubsByPointId(map)
      } catch {
        if (alive) setSubsByPointId({})
      }
    }
    void load()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointIdsKey])

  const columns = useMemo<TableColumnsType<FlatRowRecord>>(
    () => [
      {
        title: '',
        dataIndex: 'checked',
        width: 40,
        onCell: (record) => {
          if (record.kind === 'section') return { colSpan: COL_TOTAL }
          // 2026-07-30 对齐 fix：td 不再固定高度，由内容撑开（避免截断 sub 多行）
          // ☐ ↔ label 对齐改为 ☐ cell / label cell 内部 div 强制 40px
          return { style: { verticalAlign: 'top', padding: 0 } }
        },
        render: (_, record) => {
          if (record.kind === 'section') {
            // 2026-07-30 「图文」item: 不渲染普通 section header(图文 [N 全选]),
            // 也不渲染下方的 parent row + sub row(由 PointsColumn dataSource 中的 point row 渲染);
            // 替代方案:渲染 imageTextBar(图文 + Switch + ComposeRuleCard)
            if (record.item.name_cn === '图文') {
              return (
                <div
                  style={{
                    padding: '20px 0 10px',
                  }}
                >
                  {imageTextBar}
                </div>
              )
            }
            const pm = getPointMap(record.item.id)
            const points = pointsByItem[record.item.id] ?? []
            const selected = points.filter((p) => pm[p.id] === true).length
            const allSelected = points.length > 0 && selected === points.length
            return (
              <div
                style={{
                  padding: '20px 0 10px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    flexWrap: 'wrap',
                    paddingLeft: 10,
                  }}
                >
                  <Text strong style={{ fontSize: 15, color: '#0F172A' }}>
                    {record.item.name_cn}
                  </Text>
                  <span
                    style={{
                      fontSize: 11,
                      padding: '1px 8px',
                      color: '#64748B',
                      lineHeight: 1.6,
                    }}
                  >
                    {record.pointCount}
                  </span>
                  <Button
                    type="link"
                    size="small"
                    disabled={points.length === 0}
                    style={{ padding: '0 6px', height: 22, fontSize: 12 }}
                    onClick={() => {
                      const nextAll = !allSelected
                      const nextMap: PointMap = {}
                      points.forEach((p) => {
                        nextMap[p.id] = nextAll
                      })
                      onPointMapChange(record.item.id, nextMap)
                    }}
                  >
                    {allSelected ? '取消选中' : '全选'}
                  </Button>
                </div>
              </div>
            )
          }
          // 2026-07-30 对齐 fix + 三态联动：☐ cell 内 div 强制 40px，让 checkbox
          // 视觉中心与右侧 label cell 内 div 顶部 40px 同基线
          // 子审核点全选/部分选 联动 父点 checkbox 视觉态：
          //   - sub 全选  -> 父点 checked (打勾)
          //   - sub 部分选 -> 父点 indeterminate (回字中间填充)
          //   - sub 全不选 -> 父点 unchecked (空)
          // 2026-07-30 点击父点 ☐ 联动 toggle 所有 sub:
          //   - 当前全选 / 部分选 -> 全部取消
          //   - 当前全不选 -> 全部选中
          const pointSubs = subsByPointId[record.point.id] ?? []
          const enabledCount = pointSubs.filter(
            (s) => subEnabledMap[s.id] ?? s.is_enabled,
          ).length
          const totalCount = pointSubs.length
          const allSubsSelected =
            totalCount > 0 && enabledCount === totalCount
          const partiallySelected =
            enabledCount > 0 && enabledCount < totalCount
          const onToggleSubs = () => {
            const nextAll = !(allSubsSelected || partiallySelected)
            setSubEnabledMap((m) => {
              const next = { ...m }
              pointSubs.forEach((s) => {
                next[s.id] = nextAll
              })
              return next
            })
          }
          return (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '100%',
                height: 40,
              }}
            >
              <input
                type="checkbox"
                ref={(el) => {
                  if (el) el.indeterminate = partiallySelected
                }}
                checked={record.checked || allSubsSelected}
                onChange={onToggleSubs}
                aria-label={`启用审核点 ${record.point.label_cn}`}
                style={{ margin: 0 }}
              />
            </div>
          )
        },
      },
      {
        title: '',
        dataIndex: 'point',
        onCell: (record) => {
          if (record.kind === 'point') {
            // 2026-07-30 对齐 fix：td 顶部对齐，由内容（label 40px + subs 自然撑开）撑高
            return { style: { verticalAlign: 'top', padding: 0 } }
          }
          return { colSpan: 0 }
        },
        render: (_, record) => {
          if (record.kind !== 'point') return null
          const name = record.point.label_cn || record.point.label || record.point.code
          const subs = subsByPointId[record.point.id] ?? []
          return (
            <Space size={6} direction="vertical" align="start" style={{ width: '100%' }}>
              {/* 父行 label：与 ☐ 同基线对齐（div 强制 height: 40 + flex center） */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '0 16px',
                  width: '100%',
                  height: 40,
                }}
              >
                <Text strong style={{ color: '#0F172A' }} ellipsis={{ tooltip: name }}>
                  {name}
                </Text>
              </div>
              {subs.length > 0 && record.checked && (
                <div
                  style={{
                    marginTop: 4,
                    width: '100%',
                  }}
                >
                  <Space direction="vertical" size={10} style={{ width: '100%' }}>
                    {subs.map((sub) => {
                      const enabled = subEnabledMap[sub.id] ?? sub.is_enabled
                      const fallback = getIntensityFallback(intensity)
                      const parentOv =
                        pointOverrides[mediaKey]?.[record.item.id]?.[record.point.id] ?? {}
                      const lowMin = parentOv.low_threshold_min ?? fallback.low_min
                      const medMin =
                        parentOv.medium_threshold_min ?? fallback.medium_min
                      const highMin =
                        parentOv.high_threshold_min ?? fallback.high_min
                      const lowMaxDisplay =
                        typeof medMin === 'number'
                          ? Math.max(0, medMin - 0.01)
                          : null
                      const lowMaxConstraint = lowMaxDisplay ?? 99.99
                      const mediumMaxDisplay =
                        typeof highMin === 'number'
                          ? Math.max(0, highMin - 0.01)
                          : null
                      const mediumMaxConstraint =
                        typeof highMin === 'number'
                          ? Math.max(0, highMin - 0.01)
                          : 99.99
                      const warning = checkThresholdConsistency(
                        medMin,
                        parentOv.medium_threshold_max,
                        highMin,
                        parentOv.high_threshold_max,
                      )
                      return (
                        <div
                          key={sub.id}
                          style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 12,
                            flexWrap: 'wrap',
                          }}
                        >
                          <Space size={6} align="center">
                            <input
                              type="checkbox"
                              checked={enabled}
                              onChange={(e) =>
                                setSubEnabledMap((m) => ({
                                  ...m,
                                  [sub.id]: e.target.checked,
                                }))
                              }
                              aria-label={`启用 sub-审核点 ${sub.label_cn}`}
                              style={{ margin: 0 }}
                            />
                            <Text style={{ fontSize: 12, color: '#0F172A' }}>
                              {sub.label_cn}
                            </Text>
                          </Space>
                          <Space size={10} align="center" wrap>
                            <RangeMinOnlyInput
                              disabled={!enabled}
                              minValue={lowMin}
                              maxDisplay={lowMaxDisplay}
                              maxConstraint={lowMaxConstraint}
                              onMinChange={(v) =>
                                onPointOverrideChange(record.item.id, record.point.id, {
                                  low_threshold_min: v ?? undefined,
                                  low_threshold_max: undefined,
                                })
                              }
                              label="低风险分"
                            />
                            <RangeMinOnlyInput
                              disabled={!enabled}
                              minValue={medMin}
                              maxDisplay={mediumMaxDisplay}
                              maxConstraint={mediumMaxConstraint}
                              onMinChange={(v) =>
                                onPointOverrideChange(record.item.id, record.point.id, {
                                  medium_threshold_min: v ?? undefined,
                                  medium_threshold_max: undefined,
                                })
                              }
                              label="中风险分"
                            />
                            <RangeMinOnlyInput
                              disabled={!enabled}
                              minValue={highMin}
                              maxDisplay={100}
                              maxConstraint={100}
                              onMinChange={(v) =>
                                onPointOverrideChange(record.item.id, record.point.id, {
                                  high_threshold_min: v ?? undefined,
                                  high_threshold_max: undefined,
                                })
                              }
                              label="高风险分"
                            />
                          </Space>
                          {warning && (
                            <Alert
                              type="warning"
                              showIcon
                              message={warning}
                              style={{ padding: '2px 8px', fontSize: 11, flexBasis: '100%' }}
                            />
                          )}
                        </div>
                      )
                    })}
                  </Space>
                </div>
              )}
            </Space>
          )
        },
      },
    ],
    // columns 的两个 render 闭包用到的外部变量：
    // col1: imageTextBar, getPointMap, pointsByItem, onPointMapChange, subsByPointId, subEnabledMap
    // col2: subsByPointId, subEnabledMap, intensity, pointOverrides, mediaKey, onPointOverrideChange
    // setSubEnabledMap 是 state setter（稳定），COL_TOTAL 是常量，均无需进依赖。
    [
      imageTextBar,
      getPointMap,
      pointsByItem,
      onPointMapChange,
      subsByPointId,
      subEnabledMap,
      intensity,
      pointOverrides,
      mediaKey,
      onPointOverrideChange,
    ],
  )

  return (
    <div style={{ width: '100%', minWidth: 0, textAlign: 'left' }}>
      <Table<FlatRowRecord>
        ref={tableRef}
        className="rules-tree-table"
        columns={columns}
        dataSource={dataSource}
        pagination={false}
        size="small"
        rowKey="key"
        scroll={{ x: 600, y: 600 }}
        virtual
        rowClassName={(record) => {
          if (record.kind === 'section') {
            if (highlightItemId != null && record.item.id === highlightItemId) {
              return 'rules-tree-row-section rules-tree-row-flash'
            }
            return 'rules-tree-row-section'
          }
          return ''
        }}
        onRow={(record) =>
          record.kind === 'section'
            ? { id: `rules-section-${record.item.id}` }
            : {}
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

/**
 * 「图文」独立规则 sub-TreeView (2026-07-30 新增)
 *
 * - 渲染在 RulesTreeView(image 包)右栏 PointsColumn 之后
 * - 自己 fetch text_audit_pro 包 + 渲染一个独立的 PointsColumn
 * - 不渲染左栏 ItemGroup、不渲染 Box A 标题 — 只关心 PointsColumn
 * - 勾选状态由父级 CreateStrategyForm.imageTextPointMap 持有(经 imageTextConfig 透传),
 *   不与 image/text 维度的 pointMap 共享
 * - 不接 pointOverrides(图文独立规则暂不做阈值/动作 override,2026-07-30 范围最小化)
 *
 * 后续如需支持 override/agent,扩展 props 即可,不影响 RulesTreeView 主包。
 */
function IndependentTextRulesBlock({
  pointMap,
  onPointMapChange,
}: {
  pointMap: ItemPointMap
  onPointMapChange: (itemId: number, next: PointMap) => void
}) {
  const [items, setItems] = useState<AuditItem[]>([])
  const [pointsByItem, setPointsByItem] = useState<Record<number, AuditPoint[]>>({})
  const [loading, setLoading] = useState(false)
  // 图文独立规则块不需要左栏点击定位，ref 仅满足 PointsColumn 的 prop 要求
  const tableRef = useRef<TableRef>(null)

  useEffect(() => {
    const packageCode = 'text_audit_pro'
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
  }, [])

  if (loading && items.length === 0) {
    return (
      <div style={{ padding: '24px 0 10px' }}>
        <Spin tip="加载文本审核规则..." />
      </div>
    )
  }
  if (!loading && items.length === 0) {
    return null
  }

  return (
    <div
      style={{
        marginTop: 16,
        paddingTop: 16,
        borderTop: '1px dashed #CBD5E1',
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: '#475569',
          paddingLeft: 10,
          marginBottom: 8,
        }}
      >
        图文独立规则
        <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>
          （基于文本审核维度，与文本 tab 配置相互独立）
        </Text>
      </div>
      <PointsColumn
        items={items}
        pointsByItem={pointsByItem}
        getPointMap={(itemId) => pointMap[itemId] ?? {}}
        pointOverrides={EMPTY_MEDIA_OVERRIDES}
        onPointMapChange={onPointMapChange}
        onPointOverrideChange={() => {
          /* 图文独立规则暂不支持阈值 override，no-op */
        }}
        highlightItemId={null}
        mediaKey="text"
        intensity={DEFAULT_INTENSITY}
        tableRef={tableRef}
      />
    </div>
  )
}

/**
 * 风险分区间约束(2026-07-28 / 2026-07-29 新增低风险分):
 * - 低风险分:  low_min ~ (medium_min - 0.01)
 * - 中风险分:  medium_min ~ (high_min - 0.01)
 * - 高风险分:  high_min ~ 100.00
 * - 低/中/中/高 的 max 由相邻 min 自动反推,差值固定 0.01;高 max 固定 100.00。
 *
 * RangeMinOnlyInput: 单值 min 输入,max 在 UI 上以只读 hint 形式展示。
 */
function RangeMinOnlyInput({
  disabled,
  minValue,
  maxDisplay,
  maxConstraint,
  onMinChange,
  label,
}: {
  disabled: boolean
  minValue: number | undefined
  /** 只读展示的上限值(由父级算好,可能因边界不存在) */
  maxDisplay: number | null
  /** 输入上限(超过该值会被截断到 maxConstraint) */
  maxConstraint: number | null
  onMinChange: (v: number | null) => void
  label: string
}) {
  const safeMax = maxDisplay
  return (
    <Space size={6} align="center">
      <Tooltip title={`${label} 下限`}>
        <InputNumber
          size="small"
          min={0}
          max={maxConstraint ?? 100}
          step={0.01}
          precision={2}
          value={minValue ?? null}
          disabled={disabled}
          onChange={(v) => onMinChange(typeof v === 'number' ? v : null)}
          style={{ width: 80 }}
        />
      </Tooltip>
      <span style={{ color: '#94A3B8', fontSize: 12 }}>~</span>
      <span
        style={{
          width: 80,
          fontSize: 12,
          color: '#64748B',
          padding: '0 11px',
          lineHeight: '24px',
          background: '#F8FAFC',
          border: '1px solid #E2E8F0',
          borderRadius: 6,
          textAlign: 'center',
        }}
      >
        {safeMax == null ? '—' : safeMax.toFixed(2)}
      </span>
    </Space>
  )
}
