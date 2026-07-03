import { useEffect, useMemo, useState } from 'react'
import {
  Layout,
  Table,
  InputNumber,
  Switch,
  Button,
  Space,
  Typography,
  Alert,
  App,
  Spin,
  Checkbox,
  Tag,
  type TableColumnsType,
} from 'antd'
import { ArrowLeftOutlined, SaveOutlined, EditOutlined } from '@ant-design/icons'
import { useParams, Link, useLocation } from 'react-router-dom'
import { strategiesApi } from '@/api/strategies'
import { detectionRulesApi } from '@/api/detectionRules'
import type {
  DetectionRule,
  ServiceRuleConfigSnapshot,
} from '@/types/domain'

const { Content: ContentComp } = Layout
const { Title, Text } = Typography

interface StrategyServiceRule extends DetectionRule {
  _dirty?: boolean
  _strategy_enabled?: boolean
}

export default function StrategyRuleConfigPage() {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const { message } = App.useApp()
  const strategyId = Number(id)

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)
  const [strategyName, setStrategyName] = useState('')
  const [serviceRules, setServiceRules] = useState<
    Array<{ serviceCode: string; rules: StrategyServiceRule[]; subScopes: string[]; allSubScopes: string[] }>
  >([])
  const [activeService, setActiveService] = useState<string>('')

  const fetch = async () => {
    if (!strategyId) return
    setLoading(true)
    try {
      const strategy = await strategiesApi.get(strategyId)
      setStrategyName(strategy.name)
      const serviceCodes = ((strategy.definition ?? {}) as { services?: string[] }).services || []
      const configResult = await strategiesApi.getRuleConfig(strategyId)
      const configByCode = new Map<string, ServiceRuleConfigSnapshot>()
      for (const c of configResult) {
        configByCode.set(c.service_code, c)
      }

      const results: typeof serviceRules = []
      for (const sc of serviceCodes) {
        const rules = await detectionRulesApi.list(sc)
        const config = configByCode.get(sc)
        const allSubScopes = [...new Set(rules.map((r) => r.scope_text).filter(Boolean))] as string[]
        const enabledSubScopes = config?.sub_scopes ?? allSubScopes

        const strategyRules: StrategyServiceRule[] = rules.map((r) => {
          const override = config?.rule_overrides?.[r.label]
          return {
            ...r,
            _dirty: false,
            _strategy_enabled: override?.is_enabled ?? r.is_enabled,
            medium_threshold: override?.medium_threshold ?? r.medium_threshold,
            high_threshold: override?.high_threshold ?? r.high_threshold,
          }
        })

        results.push({
          serviceCode: sc,
          rules: strategyRules,
          subScopes: enabledSubScopes,
          allSubScopes,
        })
      }

      setServiceRules(results)
      if (results.length > 0 && !activeService) {
        setActiveService(results[0].serviceCode)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strategyId])

  const activeConfig = useMemo(
    () => serviceRules.find((s) => s.serviceCode === activeService),
    [serviceRules, activeService],
  )

  const updateRule = (serviceCode: string, ruleId: number, patch: Partial<StrategyServiceRule>) => {
    setServiceRules((prev) =>
      prev.map((s) =>
        s.serviceCode === serviceCode
          ? {
              ...s,
              rules: s.rules.map((r) =>
                r.id === ruleId ? { ...r, ...patch, _dirty: true } : r,
              ),
            }
          : s,
      ),
    )
  }

  const toggleSubScope = (serviceCode: string, scope: string, checked: boolean) => {
    setServiceRules((prev) =>
      prev.map((s) =>
        s.serviceCode === serviceCode
          ? {
              ...s,
              subScopes: checked
                ? [...s.subScopes, scope]
                : s.subScopes.filter((sc) => sc !== scope),
            }
          : s,
      ),
    )
  }

  const onSave = async () => {
    setSaving(true)
    try {
      const snapshots: ServiceRuleConfigSnapshot[] = serviceRules.map((s) => ({
        service_code: s.serviceCode,
        sub_scopes: s.subScopes,
        rule_overrides: Object.fromEntries(
          s.rules
            .filter((r) => r._dirty)
            .map((r) => [
              r.label,
              {
                medium_threshold: r.medium_threshold,
                high_threshold: r.high_threshold,
                is_enabled: r._strategy_enabled,
                scope_text: r.scope_text ?? undefined,
              },
            ]),
        ),
      }))
      await strategiesApi.updateRuleConfig(strategyId, snapshots)
      message.success('已保存策略审核范围配置')
      setEditing(false)
      await fetch()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail ?? '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const columns: TableColumnsType<StrategyServiceRule> = [
    {
      title: '标签',
      dataIndex: 'label_cn',
      width: '18%',
      render: (_v, row) => (
        <div>
          <span style={{ fontWeight: 500 }}>{row.label_cn || row.label}</span>
          <br />
          <Text type="secondary" style={{ fontSize: 11 }}>{row.scope_text ?? ''}</Text>
        </div>
      ),
    },
    {
      title: '中风险分',
      dataIndex: 'medium_threshold',
      width: '16%',
      render: (_v, row) => (
        <InputNumber
          min={0}
          max={100}
          step={0.01}
          value={row.medium_threshold}
          onChange={(v) => updateRule(row.service_code, row.id, { medium_threshold: Number(v ?? 0) })}
          style={{ width: 90 }}
          size="small"
          disabled={!editing}
        />
      ),
    },
    {
      title: '高风险分',
      dataIndex: 'high_threshold',
      width: '16%',
      render: (_v, row) => (
        <InputNumber
          min={0}
          max={100}
          step={0.01}
          value={row.high_threshold}
          onChange={(v) => updateRule(row.service_code, row.id, { high_threshold: Number(v ?? 0) })}
          style={{ width: 90 }}
          size="small"
          disabled={!editing}
        />
      ),
    },
    {
      title: '启用',
      dataIndex: '_strategy_enabled',
      width: '12%',
      render: (v: boolean, row) => (
        <Switch
          checked={v}
          onChange={(checked) => updateRule(row.service_code, row.id, { _strategy_enabled: checked })}
          size="small"
          disabled={!editing}
        />
      ),
    },
  ]

  const backState = (location.state ?? {}) as { from?: string }
  const backTarget = backState.from ?? '/strategies'

  return (
    <div style={{ width: '100%' }}>
      <Space style={{ marginBottom: 12 }} align="center">
        <Link to={backTarget} style={{ color: '#0369A1' }}>
          <Space size={4} align="center">
            <ArrowLeftOutlined />
            返回策略管理
          </Space>
        </Link>
      </Space>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>
          策略审核范围配置 — {strategyName}
        </Title>
        <Space>
          {editing ? (
            <>
              <Button onClick={() => { setEditing(false); fetch() }}>取消</Button>
              <Button type="primary" icon={<SaveOutlined />} onClick={onSave} loading={saving}>
                保存
              </Button>
            </>
          ) : (
            <Button type="primary" icon={<EditOutlined />} onClick={() => setEditing(true)}>
              编辑
            </Button>
          )}
        </Space>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16, background: '#EFF6FF', border: '1px solid #BAE6FD' }}
        message="在此页面可以为当前策略配置每个服务的细分审核范围。勾选的子场景表示该策略下启用此检测范围，同时可以调整每个检测规则的风险阈值和启停状态。"
      />

      <Spin spinning={loading}>
        {serviceRules.length === 0 && !loading && (
          <Text type="secondary">当前策略尚未选择任何服务。请先在策略编辑页面选择服务。</Text>
        )}

        {serviceRules.length > 0 && (
          <div style={{ display: 'flex', gap: 16 }}>
            <div style={{ width: 200, flexShrink: 0 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {serviceRules.map((s) => (
                  <Button
                    key={s.serviceCode}
                    type={s.serviceCode === activeService ? 'primary' : 'text'}
                    block
                    style={{ textAlign: 'left' }}
                    onClick={() => setActiveService(s.serviceCode)}
                  >
                    <span style={{ fontSize: 13 }}>{s.serviceCode}</span>
                    <Tag style={{ marginLeft: 4 }} color="blue">{s.rules.length}</Tag>
                  </Button>
                ))}
              </div>
            </div>

            <ContentComp style={{ flex: 1 }}>
              {activeConfig && (
                <>
                  <div style={{ marginBottom: 16 }}>
                    <Text strong style={{ display: 'block', marginBottom: 8 }}>细分场景选择</Text>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {activeConfig.allSubScopes.map((scope) => (
                        <Checkbox
                          key={scope}
                          checked={activeConfig.subScopes.includes(scope)}
                          onChange={(e) => toggleSubScope(activeConfig.serviceCode, scope, e.target.checked)}
                          disabled={!editing}
                        >
                          {scope}
                        </Checkbox>
                      ))}
                    </div>
                  </div>

                  <Table<StrategyServiceRule>
                    rowKey="id"
                    dataSource={activeConfig.rules}
                    columns={columns}
                    pagination={false}
                    size="middle"
                    scroll={{ x: true }}
                  />
                </>
              )}
            </ContentComp>
          </div>
        )}
      </Spin>
    </div>
  )
}
