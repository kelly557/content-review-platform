import { useEffect, useMemo, useState } from 'react'
import {
  Spin,
  Alert,
  Space,
  Typography,
  Select,
  Button,
  Tag,
  Card,
  App,
  Breadcrumb,
  Tooltip,
  Radio,
  Empty,
  Divider,
} from 'antd'
import {
  ArrowLeftOutlined,
  CheckCircleFilled,
  PlusOutlined,
  SaveOutlined,
  LinkOutlined,
  ReadOutlined,
} from '@ant-design/icons'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import dayjs from 'dayjs'
import { strategiesApi } from '@/api/strategies'
import { serviceCategoriesApi } from '@/api/serviceCategories'
import { servicesApi } from '@/api/services'
import ServiceRuleTable from '@/components/ServiceRuleTable'
import {
  CATEGORIES,
  expandCategoryNames,
  findCategory,
  isMediaType,
  type CategoryKey,
} from '@/components/strategy/constants'
import type { Service, ServiceCategory, Strategy } from '@/types/domain'

const { Title, Text, Paragraph } = Typography

type SourceMode = 'reuse' | 'independent'

interface SourceSubState {
  mode: SourceMode
}

export default function StrategyRulesByTypePage() {
  const { mediaType } = useParams<{ mediaType: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { message } = App.useApp()

  const validKey: CategoryKey = isMediaType(mediaType) ? (mediaType as CategoryKey) : 'image'
  const category = useMemo(
    () => findCategory(validKey) ?? CATEGORIES[0],
    [validKey],
  )

  const isComposite = useMemo(
    () => !!(category.composesFrom && category.composesFrom.length > 0),
    [category],
  )

  const strategyIdFromUrl = searchParams.get('strategy')
  const strategyIdNum = strategyIdFromUrl ? Number(strategyIdFromUrl) : null
  const hasValidStrategy = !!strategyIdNum && !Number.isNaN(strategyIdNum)

  const [strategies, setStrategies] = useState<Strategy[]>([])
  const [currentStrategy, setCurrentStrategy] = useState<Strategy | null>(null)
  const [selectedStrategyId, setSelectedStrategyId] = useState<number | null>(
    hasValidStrategy ? strategyIdNum : null,
  )
  const [selectedServices, setSelectedServices] = useState<string[]>([])
  const [initialServices, setInitialServices] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [categories, setCategories] = useState<ServiceCategory[]>([])
  const [allServices, setAllServices] = useState<Service[]>([])

  const [sourceModes, setSourceModes] = useState<Record<string, SourceSubState>>({})

  useEffect(() => {
    setSourceModes({})
  }, [validKey, selectedStrategyId])

  useEffect(() => {
    strategiesApi
      .list({ size: 100 })
      .then((s) => setStrategies(s.items.filter((x) => x.scope !== 'default')))
      .catch(() => setStrategies([]))
    serviceCategoriesApi
      .list({ size: 200 })
      .then((p) => setCategories(p.items.filter((c) => c.is_active)))
      .catch(() => setCategories([]))
  }, [])

  useEffect(() => {
    servicesApi
      .list({ size: 200 })
      .then((p) => setAllServices(p.items))
      .catch(() => setAllServices([]))
  }, [])

  const categoryNameToId = useMemo(() => {
    const m = new Map<string, number>()
    categories.forEach((c) => m.set(c.name, c.id))
    return m
  }, [categories])

  const expandedCategoryNames = useMemo(
    () => expandCategoryNames(validKey),
    [validKey],
  )

  const categoryIdsForFilter = useMemo(() => {
    if (!expandedCategoryNames.length) return [] as number[]
    return expandedCategoryNames
      .map((n) => categoryNameToId.get(n))
      .filter((id): id is number => typeof id === 'number')
  }, [expandedCategoryNames, categoryNameToId])

  useEffect(() => {
    if (!selectedStrategyId) {
      setCurrentStrategy(null)
      setSelectedServices([])
      setInitialServices([])
      return
    }
    setLoading(true)
    strategiesApi
      .get(selectedStrategyId)
      .then((s) => {
        setCurrentStrategy(s)
        const defs = (s.definition ?? {}) as { services?: string[] }
        const svc = Array.isArray(defs.services) ? defs.services : []
        setSelectedServices(svc)
        setInitialServices(svc)
      })
      .catch(() => {
        setCurrentStrategy(null)
      })
      .finally(() => setLoading(false))
  }, [selectedStrategyId])

  const onChangeStrategy = (id: number) => {
    setSelectedStrategyId(id)
    const next = new URLSearchParams(searchParams)
    next.set('strategy', String(id))
    navigate(`/strategies/rules-by-type/${validKey}?${next.toString()}`, {
      replace: true,
    })
  }

  const isDirty = useMemo(() => {
    if (selectedServices.length !== initialServices.length) return true
    const a = new Set(selectedServices)
    return initialServices.some((x) => !a.has(x))
  }, [selectedServices, initialServices])

  const canSave = !!currentStrategy && isDirty

  const onSave = async () => {
    if (!currentStrategy) {
      message.warning('请先选择目标策略后再保存')
      return
    }
    setSaving(true)
    try {
      await strategiesApi.update(currentStrategy.id, {
        services: selectedServices,
      })
      message.success('已保存')
      setInitialServices(selectedServices)
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail
      message.error(detail ?? '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const breadcrumb = (
    <Breadcrumb
      style={{ marginBottom: 12 }}
      items={[
        {
          title: <Link to="/strategies">审核策略</Link>,
        },
        { title: category.label },
      ]}
    />
  )

  const hasAnyStrategy = strategies.length > 0

  const codesByCategoryName = useMemo(() => {
    const m = new Map<string, Set<string>>()
    allServices.forEach((s) => {
      if (s.category_id != null) {
        const cat = categories.find((c) => c.id === s.category_id)
        if (cat) {
          if (!m.has(cat.name)) m.set(cat.name, new Set())
          m.get(cat.name)!.add(s.code)
        }
      }
    })
    return m
  }, [allServices, categories])

  const getSourceCategoryIds = (sourceKey: CategoryKey): Set<number> => {
    const names = expandCategoryNames(sourceKey)
    const ids = new Set<number>()
    names.forEach((n) => {
      const id = categoryNameToId.get(n)
      if (typeof id === 'number') ids.add(id)
    })
    return ids
  }

  const codesInSelectedForSource = (
    sourceKey: CategoryKey,
    codes: string[],
  ): string[] => {
    const sourceNames = expandCategoryNames(sourceKey)
    const sourceNameSet = new Set(sourceNames)
    return codes.filter((code) => {
      for (const name of sourceNameSet) {
        if (codesByCategoryName.get(name)?.has(code)) return true
      }
      return false
    })
  }

  const updateSourceSubset = (sourceKey: CategoryKey, newSubset: string[]) => {
    const sourceNames = expandCategoryNames(sourceKey)
    const sourceNameSet = new Set(sourceNames)
    const otherServices = selectedServices.filter((code) => {
      const svc = allServices.find((s) => s.code === code)
      if (!svc) return true
      const cat = categories.find((c) => c.id === svc.category_id)
      if (!cat) return true
      return !sourceNameSet.has(cat.name)
    })
    const merged = Array.from(new Set([...otherServices, ...newSubset]))
    setSelectedServices(merged)
  }

  return (
    <Spin spinning={loading}>
      <div style={{ width: '100%' }}>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {breadcrumb}

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <Title level={4} style={{ margin: 0 }}>
              {category.label} · 规则列表
            </Title>
            <Space wrap>
              <Button
                icon={<ArrowLeftOutlined />}
                onClick={() => navigate('/strategies')}
              >
                返回策略列表
              </Button>
              <Button onClick={() => navigate('/strategies/new')} icon={<PlusOutlined />}>
                新建策略
              </Button>
            </Space>
          </div>

          <Alert
            showIcon
            type="info"
            message={`「${category.label}」规则说明`}
            description={
              category.description ?? (
                <span>
                  本页展示「{category.label}」类型下可纳入审核策略的服务。
                  {hasAnyStrategy
                    ? '勾选服务并选择目标策略后，可点击保存将其写入该策略。'
                    : '当前尚无可用策略，可先创建策略后再保存所选规则。'}
                </span>
              )
            }
          />

          <Card styles={{ body: { padding: 16 } }}>
            <Space
              size={12}
              wrap
              align="center"
              style={{ marginBottom: 12, width: '100%' }}
            >
              <Text strong>目标策略</Text>
              <Select
                showSearch
                optionFilterProp="label"
                placeholder={
                  hasAnyStrategy
                    ? '选择目标策略（可选）'
                    : '暂无已有策略，请先创建'
                }
                value={selectedStrategyId ?? undefined}
                onChange={(v) => onChangeStrategy(v as number)}
                allowClear
                onClear={() => {
                  setSelectedStrategyId(null)
                  const next = new URLSearchParams(searchParams)
                  next.delete('strategy')
                  navigate(
                    `/strategies/rules-by-type/${validKey}${
                      next.toString() ? `?${next.toString()}` : ''
                    }`,
                    { replace: true },
                  )
                }}
                style={{ minWidth: 320 }}
                disabled={!hasAnyStrategy}
                options={strategies.map((s) => ({
                  value: s.id,
                  label: `${s.name}（${s.code}）`,
                }))}
              />
              {currentStrategy && (
                <>
                  {currentStrategy.is_active ? (
                    <Tag color="success" icon={<CheckCircleFilled />}>
                      启用
                    </Tag>
                  ) : (
                    <Tag>停用</Tag>
                  )}
                  {isDirty && <Tag color="warning">有未保存的修改</Tag>}
                </>
              )}
              {hasAnyStrategy ? (
                <Tooltip
                  title={
                    !currentStrategy
                      ? '请先选择目标策略'
                      : !isDirty
                        ? '当前未修改'
                        : ''
                  }
                >
                  <Button
                    type="primary"
                    icon={<SaveOutlined />}
                    loading={saving}
                    disabled={!canSave}
                    onClick={onSave}
                  >
                    保存到当前策略
                  </Button>
                </Tooltip>
              ) : null}
            </Space>
          </Card>

          {isComposite && category.composesFrom ? (
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              {category.composesFrom.map((sourceKey) => {
                const sourceDef = findCategory(sourceKey)
                const subState = sourceModes[sourceKey] ?? { mode: 'reuse' }
                const mode: SourceMode = subState.mode
                const setMode = (m: SourceMode) =>
                  setSourceModes((prev) => ({
                    ...prev,
                    [sourceKey]: { mode: m },
                  }))
                const sourceCategoryIds = getSourceCategoryIds(sourceKey)
                const selectedInSource = codesInSelectedForSource(
                  sourceKey,
                  selectedServices,
                )
                const sourceCategoryIdArr = Array.from(sourceCategoryIds)
                return (
                  <Card
                    key={sourceKey}
                    styles={{ body: { padding: 16 } }}
                    title={
                      <Space>
                        <ReadOutlined style={{ color: '#0369A1' }} />
                        <span>{sourceDef.label}</span>
                        <Tag color="blue">合成来源</Tag>
                      </Space>
                    }
                    extra={
                      <Radio.Group
                        optionType="button"
                        value={mode}
                        onChange={(e) => setMode(e.target.value as SourceMode)}
                      >
                        <Radio.Button value="reuse">
                          复用{sourceDef.label}规则
                        </Radio.Button>
                        <Radio.Button value="independent">
                          设置独立规则
                        </Radio.Button>
                      </Radio.Group>
                    }
                  >
                    {mode === 'reuse' ? (
                      <ReuseView
                        sourceLabel={sourceDef.label}
                        sourceKey={sourceKey}
                        selectedServices={selectedInSource}
                        hasStrategy={!!currentStrategy}
                        currentStrategyId={currentStrategy?.id}
                      />
                    ) : (
                      <IndependentView
                        sourceKey={sourceKey}
                        sourceLabel={sourceDef.label}
                        value={selectedInSource}
                        onChange={(next) => updateSourceSubset(sourceKey, next)}
                        categoryIds={sourceCategoryIdArr}
                        currentStrategyId={currentStrategy?.id}
                      />
                    )}
                  </Card>
                )
              })}
            </Space>
          ) : (
            <Card styles={{ body: { padding: 16 } }}>
              <ServiceRuleTable
                key={`${validKey}-${selectedStrategyId ?? 'none'}`}
                value={selectedServices}
                onChange={setSelectedServices}
                categoryIds={categoryIdsForFilter}
                categoryName={
                  category.categoryNames.length > 0
                    ? category.categoryNames[0]
                    : category.label
                }
                emptyHint={
                  expandedCategoryNames.length === 0
                    ? `${category.label} - 暂无服务`
                    : `${category.label} - 暂无该分类下的服务，可点击「新增规则」创建自定义服务`
                }
              />
            </Card>
          )}

          {currentStrategy && (
            <div style={{ color: '#64748B', fontSize: 12 }}>
              最近编辑：
              {currentStrategy.updated_at
                ? dayjs(currentStrategy.updated_at).format('YYYY.MM.DD HH:mm')
                : '—'}
              {' '}·{' '}
              <Paragraph
                type="secondary"
                style={{ display: 'inline', fontSize: 12, marginBottom: 0 }}
              >
                如需调整检测点阈值，请前往
                <Link
                  to={`/strategies/${currentStrategy.id}/rule-config`}
                  style={{ margin: '0 4px' }}
                >
                  规则配置
                </Link>
                页面。
              </Paragraph>
            </div>
          )}
        </Space>
      </div>
    </Spin>
  )
}

interface ReuseViewProps {
  sourceLabel: string
  sourceKey: CategoryKey
  selectedServices: string[]
  hasStrategy: boolean
  currentStrategyId?: number
}

function ReuseView({
  sourceLabel,
  sourceKey,
  selectedServices,
  hasStrategy,
  currentStrategyId,
}: ReuseViewProps) {
  return (
    <Space direction="vertical" size={10} style={{ width: '100%' }}>
      <Text type="secondary" style={{ fontSize: 13 }}>
        「复用」模式下，本类型不单独配置服务；其规则继承自当前策略中「{sourceLabel}」类别下的所有已选服务。
        若需调整，请前往「{sourceLabel}」页面编辑；本页保持只读。
      </Text>
      {!hasStrategy ? (
        <Alert
          type="warning"
          showIcon
          message="请先选择目标策略"
          description="未选择策略时，无法显示已纳入此策略的服务规则。"
        />
      ) : selectedServices.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <Space direction="vertical" size={4}>
              <Text type="secondary">当前策略尚未纳入「{sourceLabel}」类别的服务</Text>
              <Link to={`/strategies/rules-by-type/${sourceKey}${currentStrategyId ? `?strategy=${currentStrategyId}` : ''}`}>
                前往「{sourceLabel}」页面选择 →
              </Link>
            </Space>
          }
        />
      ) : (
        <>
          <Space size={6} wrap>
            {selectedServices.map((code) => (
              <Tag key={code} color="blue" style={{ fontFamily: 'monospace' }}>
                {code}
              </Tag>
            ))}
          </Space>
          <Divider style={{ margin: '8px 0' }} />
          <Space size={8} wrap>
            <Text type="secondary" style={{ fontSize: 12 }}>
              当前复用服务数：
            </Text>
            <Tag color="processing">{selectedServices.length} 项</Tag>
            <Link
              to={`/strategies/rules-by-type/${sourceKey}${currentStrategyId ? `?strategy=${currentStrategyId}` : ''}`}
              style={{ fontSize: 12 }}
            >
              <LinkOutlined /> 前往「{sourceLabel}」编辑
            </Link>
          </Space>
        </>
      )}
    </Space>
  )
}

interface IndependentViewProps {
  sourceKey: CategoryKey
  sourceLabel: string
  value: string[]
  onChange: (codes: string[]) => void
  categoryIds: number[]
  currentStrategyId?: number
}

function IndependentView({
  sourceKey,
  sourceLabel,
  value,
  onChange,
  categoryIds,
  currentStrategyId,
}: IndependentViewProps) {
  return (
    <Space direction="vertical" size={10} style={{ width: '100%' }}>
      <Text type="secondary" style={{ fontSize: 13 }}>
        「独立」模式下，可为「文档审核」/「视频审核」等组合类型单独选择「{sourceLabel}」类别下的服务，
        不与其他类型联动。保存后写入当前目标策略。
      </Text>
      <ServiceRuleTable
        value={value}
        onChange={onChange}
        categoryIds={categoryIds}
        categoryName={sourceLabel}
        emptyHint={`${sourceLabel} - 暂无该分类下的服务`}
      />
      <Divider style={{ margin: '8px 0' }} />
      <Space size={8} wrap>
        <Text type="secondary" style={{ fontSize: 12 }}>
          本类已选服务数：
        </Text>
        <Tag color="processing">{value.length} 项</Tag>
        {currentStrategyId && (
          <Link
            to={`/strategies/rules-by-type/${sourceKey}${currentStrategyId ? `?strategy=${currentStrategyId}` : ''}`}
            style={{ fontSize: 12 }}
          >
            <LinkOutlined /> 前往「{sourceLabel}」查看
          </Link>
        )}
      </Space>
    </Space>
  )
}
