import { useEffect, useMemo, useState } from 'react'
import {
  Layout,
  Menu,
  Tabs,
  Table,
  InputNumber,
  Switch,
  Select,
  Button,
  Space,
  Typography,
  Alert,
  Checkbox,
  App,
  Spin,
  type MenuProps,
  type TableColumnsType,
} from 'antd'
import { ArrowLeftOutlined, QuestionCircleOutlined, SaveOutlined, EditOutlined } from '@ant-design/icons'
import { useParams, Link, useLocation } from 'react-router-dom'
import { detectionRulesApi } from '@/api/detectionRules'
import type {
  DetectionRule,
  HumanReviewConfig,
  RiskLevel,
  WordSetOption,
} from '@/types/domain'

const { Sider: SiderComp, Content: ContentComp } = Layout
const { Title, Text } = Typography

const SERVICE_CODE = 'ad_compliance_detection_pro'

const NAV_GROUPS: Array<{ key: string; label: string; services: string[] }> = [
  { key: 'ad_flow', label: '广告引流检测', services: [SERVICE_CODE] },
  { key: 'bad_content', label: '不良内容检测', services: [] },
  { key: 'behavior', label: '行为内容检测', services: [] },
  { key: 'object', label: '特定物体检测', services: [] },
  { key: 'abuse', label: '谩骂内容检测', services: [] },
  { key: 'ad_law', label: '广告法内容检测', services: [] },
  { key: 'religion', label: '宗教内容检测', services: [] },
  { key: 'mark', label: '特殊标识检测', services: [] },
  { key: 'racism', label: '种族主义内容', services: [] },
  { key: 'other', label: '其他', services: [] },
]

interface DraftRule extends DetectionRule {
  _dirty?: boolean
}

export default function ServiceRuleConfigPage() {
  const { serviceCode } = useParams<{ serviceCode: string }>()
  const location = useLocation()
  const { message } = App.useApp()
  const code = serviceCode ?? SERVICE_CODE

  const backState = (location.state ?? {}) as { from?: string; fromStep?: 0 | 1 }
  const backTarget = backState.from ?? '/strategies'
  const backStepState =
    backState.fromStep != null ? { step: backState.fromStep } : undefined
  const backLabel = backState.from ? '返回策略审核规则' : '返回策略管理列表'

  const [items, setItems] = useState<DraftRule[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [wordsetOptions, setWordsetOptions] = useState<WordSetOption[]>([])

  const [tabKey, setTabKey] = useState<string>('range')
  const [hr, setHr] = useState<HumanReviewConfig | null>(null)
  const [hrDraft, setHrDraft] = useState<{
    is_enabled: boolean
    risk_levels: RiskLevel[]
    review_rule_id: number | null
    notify_plan_id: number | null
  } | null>(null)
  const [hrLoading, setHrLoading] = useState(false)
  const [hrSaving, setHrSaving] = useState(false)

  const [editing, setEditing] = useState(false)
  const [pendingReset, setPendingReset] = useState<DraftRule[] | null>(null)

  const fetch = async () => {
    setLoading(true)
    try {
      const [rules, wss] = await Promise.all([
        detectionRulesApi.list(code),
        detectionRulesApi.listWordsets(code),
      ])
      setItems(rules.map((r) => ({ ...r, _dirty: false })))
      setWordsetOptions(wss)
    } finally {
      setLoading(false)
    }
  }

  const fetchHr = async () => {
    setHrLoading(true)
    try {
      const data = await detectionRulesApi.getHumanReview(code)
      setHr(data)
      setHrDraft({
        is_enabled: data.is_enabled,
        risk_levels: data.risk_levels,
        review_rule_id: data.review_rule_id,
        notify_plan_id: data.notify_plan_id,
      })
    } finally {
      setHrLoading(false)
    }
  }

  useEffect(() => {
    fetch()
    fetchHr()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  const hrDirty =
    !!hr &&
    !!hrDraft &&
    (hrDraft.is_enabled !== hr.is_enabled ||
      hrDraft.review_rule_id !== hr.review_rule_id ||
      hrDraft.notify_plan_id !== hr.notify_plan_id ||
      hrDraft.risk_levels.length !== hr.risk_levels.length ||
      hrDraft.risk_levels.some((r, i) => r !== hr.risk_levels[i]))

  const onSaveHr = async () => {
    if (!hrDraft) return
    setHrSaving(true)
    try {
      await detectionRulesApi.updateHumanReview(code, {
        is_enabled: hrDraft.is_enabled,
        risk_levels: hrDraft.risk_levels,
        review_rule_id: hrDraft.review_rule_id,
        notify_plan_id: hrDraft.notify_plan_id,
      })
      message.success('已保存')
      fetchHr()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail ?? '保存失败')
    } finally {
      setHrSaving(false)
    }
  }

  const dirty = items.some((i) => i._dirty)
  const wordsetByAction = useMemo(() => {
    const map = new Map<string, WordSetOption[]>()
    for (const w of wordsetOptions) {
      const a = w.action ?? w.kind ?? '黑名单'
      if (!map.has(a)) map.set(a, [])
      map.get(a)!.push(w)
    }
    return map
  }, [wordsetOptions])

  const updateLocal = (id: number, patch: Partial<DraftRule>) => {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, ...patch, _dirty: true } : it)),
    )
  }

  const validateAll = (): string | null => {
    for (const r of items) {
      if (r.medium_threshold >= r.high_threshold) {
        return `「${r.label}」中风险分必须 < 高风险分`
      }
      if (r.medium_threshold < 0 || r.medium_threshold > 100) {
        return `「${r.label}」中风险分需在 0-100 范围内`
      }
      if (r.high_threshold < 0 || r.high_threshold > 100) {
        return `「${r.label}」高风险分需在 0-100 范围内`
      }
    }
    return null
  }

  const enterEdit = () => {
    setPendingReset(items.map((r) => ({ ...r })))
    setEditing(true)
  }

  const cancelEdit = () => {
    if (pendingReset) setItems(pendingReset)
    setPendingReset(null)
    setEditing(false)
  }

  const onSave = async () => {
    const err = validateAll()
    if (err) {
      message.error(err)
      return
    }
    const dirtyItems = items.filter((i) => i._dirty)
    if (dirtyItems.length === 0) {
      message.info('没有改动')
      return
    }
    setSaving(true)
    try {
      for (const it of dirtyItems) {
        await detectionRulesApi.update(code, it.label, {
          medium_threshold: it.medium_threshold,
          high_threshold: it.high_threshold,
          scope_text: it.scope_text ?? '',
          is_enabled: it.is_enabled,
          custom_wordset_id: it.custom_wordset_id,
        })
      }
      message.success('已保存')
      await fetch()
      setEditing(false)
      setPendingReset(null)
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail ?? '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const onReset = async () => {
    ModalShim.confirmReset(async () => {
      try {
        await detectionRulesApi.reset(code)
        message.success('已恢复默认分值')
        fetch()
      } catch (e: unknown) {
        const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        message.error(detail ?? '恢复失败')
      }
    })
  }

  const navItems: MenuProps['items'] = NAV_GROUPS.map((g) => ({
    key: g.key,
    label: g.label,
    disabled: g.services.length === 0,
  }))

  const mainColumns: TableColumnsType<DraftRule> = [
    {
      title: '标签值',
      dataIndex: 'label',
      width: '14%',
      render: (_v, row) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ color: '#020617', fontWeight: 500 }}>{row.label_cn || row.label}</span>
          <Text type="secondary" style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace' }}>
            {row.label}
          </Text>
        </div>
      ),
    },
    {
      title: '含义',
      dataIndex: 'description',
      width: '24%',
      render: (v: string | null) => <span style={{ color: '#020617' }}>{v ?? '—'}</span>,
    },
    {
      title: (
        <Space size={4}>
          中风险分
          <QuestionCircleOutlined style={{ color: '#94A3B8', fontSize: 12 }} />
        </Space>
      ),
      dataIndex: 'medium_threshold',
      width: '18%',
      render: (_v, row) => (
        <Space size={4}>
          <InputNumber
            min={0}
            max={100}
            step={0.01}
            value={row.medium_threshold}
            onChange={(v) => updateLocal(row.id, { medium_threshold: Number(v ?? 0) })}
            style={{ width: 90 }}
            size="small"
            aria-label={`${row.label_cn || row.label} 中风险分`}
            disabled={!editing}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>~ 79.99</Text>
        </Space>
      ),
    },
    {
      title: (
        <Space size={4}>
          高风险分
          <QuestionCircleOutlined style={{ color: '#94A3B8', fontSize: 12 }} />
        </Space>
      ),
      dataIndex: 'high_threshold',
      width: '18%',
      render: (_v, row) => (
        <Space size={4}>
          <InputNumber
            min={0}
            max={100}
            step={0.01}
            value={row.high_threshold}
            onChange={(v) => updateLocal(row.id, { high_threshold: Number(v ?? 0) })}
            style={{ width: 90 }}
            size="small"
            aria-label={`${row.label_cn || row.label} 高风险分`}
            disabled={!editing}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>~ 100.00</Text>
        </Space>
      ),
    },
    {
      title: '细分检测范围',
      dataIndex: 'scope_text',
      width: '16%',
      render: (v: string | null) => <span style={{ color: '#020617' }}>{v ?? '—'}</span>,
    },
    {
      title: '检测状态',
      dataIndex: 'is_enabled',
      width: '10%',
      render: (active: boolean, row) => (
        <Space size={6}>
          <Switch
            checked={active}
            onChange={(v) => updateLocal(row.id, { is_enabled: v })}
            aria-label={`${row.label_cn || row.label} 检测状态`}
            size="small"
            disabled={!editing}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            {active ? '开' : '关'}
          </Text>
        </Space>
      ),
    },
  ]

  const customColumns: TableColumnsType<DraftRule> = [
    {
      title: '标签值',
      dataIndex: 'label',
      width: '20%',
      render: (_v, row) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ color: '#020617', fontWeight: 500 }}>{row.label_cn || row.label}</span>
          <Text type="secondary" style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace' }}>
            {row.label}_lib
          </Text>
        </div>
      ),
    },
    {
      title: '含义',
      dataIndex: 'description',
      width: '32%',
      render: (v: string | null) => <span style={{ color: '#020617' }}>{v ?? '—'}</span>,
    },
    {
      title: '图库/词库选配',
      dataIndex: 'custom_wordset_id',
      width: '48%',
      render: (_v, row) => (
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <Space size={8} wrap>
            <Text type="secondary" style={{ fontSize: 12, minWidth: 40 }}>图库:</Text>
            <Select
              disabled
              placeholder="自定义图库 - 即将上线"
              style={{ minWidth: 280 }}
              size="small"
            />
          </Space>
          <Space size={8} wrap>
            <Text type="secondary" style={{ fontSize: 12, minWidth: 40 }}>词库:</Text>
            <Select
              placeholder="选择词库用于命中返回该行标签"
              value={row.custom_wordset_id ?? undefined}
              onChange={(v) => updateLocal(row.id, { custom_wordset_id: v ?? null })}
              allowClear
              style={{ minWidth: 280 }}
              size="small"
              disabled={!editing}
              options={[
                ...(wordsetByAction.get('黑名单') ?? []).map((w) => ({
                  value: w.id,
                  label: `[黑名单] ${w.name}`,
                })),
                ...(wordsetByAction.get('白名单') ?? []).map((w) => ({
                  value: w.id,
                  label: `[白名单] ${w.name}`,
                })),
                ...(wordsetByAction.get('需复审') ?? []).map((w) => ({
                  value: w.id,
                  label: `[需复审] ${w.name}`,
                })),
                ...(wordsetByAction.get('标签') ?? []).map((w) => ({
                  value: w.id,
                  label: `[标签] ${w.name}`,
                })),
              ]}
            />
          </Space>
        </Space>
      ),
    },
  ]


  return (
    <div className="service-rule-page">
      <Space style={{ marginBottom: 12 }} align="center">
        <Link to={backTarget} state={backStepState} style={{ color: '#0369A1' }}>
          <Space size={4} align="center">
            <ArrowLeftOutlined />
            {backLabel}
          </Space>
        </Link>
      </Space>

      <Title level={3} style={{ marginTop: 0, marginBottom: 16 }}>
        审核范围配置
      </Title>

      <Tabs
        activeKey={tabKey}
        items={[
          { key: 'range', label: '审核范围配置' },
          { key: 'hmx', label: '人机审核配置' },
        ]}
        onChange={(k) => {
          if (k === 'hmx') {
            setTabKey('hmx')
            if (!hr) fetchHr()
            return
          }
          if (k === 'range') {
            setTabKey('range')
            return
          }
          message.info('该功能 - 即将上线')
        }}
      />

      {tabKey === 'range' && (
        <>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16, background: '#EFF6FF', border: '1px solid #BAE6FD' }}
            message={
              <ol style={{ margin: 0, paddingLeft: 18, color: '#0369A1' }}>
                <li>您可以根据需求调整检测范围，如果检测到对应的疑似内容，系统会返回对应的标签值。在全部关闭检测或对应检测项计算后均未发现异常时，系统会返回 &quot;nonLabel&quot;的标签。</li>
                <li>您也可以基于自定义的图库/词库配置对应的检测标签。系统会将检测图片与您选定的自定义图库的图片进行相似比对；图片中的文字会与自定义词库的关键进行比对。有命中时，系统会返回对应的标签值。</li>
                <li>配置修改对生产环境生效通常需要 2~5 分钟，请谨慎操作。</li>
              </ol>
            }
          />
          <Layout
            className="service-rule-range-layout"
            style={{
              background: 'transparent',
              border: '1px solid #E2E8F0',
              borderRadius: 6,
            }}
          >
            <SiderComp
              width="clamp(160px, 14vw, 220px)"
              breakpoint="md"
              collapsedWidth={0}
              trigger={null}
              className="service-rule-range-sider"
              style={{
                background: '#F8FAFC',
                borderRight: '1px solid #E2E8F0',
              }}
            >
              <Menu
                mode="inline"
                selectedKeys={['ad_flow']}
                items={navItems}
                style={{ background: 'transparent', borderInlineEnd: 0 }}
                onClick={({ key }) => {
                  if (key !== 'ad_flow') message.info('该分类 - 即将上线')
                }}
              />
            </SiderComp>
            <ContentComp style={{ background: '#FFFFFF', padding: 20 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 16,
                  flexWrap: 'wrap',
                  gap: 12,
                }}
              >
                <Title level={4} style={{ margin: 0 }}>
                  审核范围配置
                </Title>
                <Space wrap>
                  {editing ? (
                    <>
                      <Button onClick={cancelEdit} disabled={saving}>
                        取消
                      </Button>
                      <Button
                        type="primary"
                        icon={<SaveOutlined />}
                        onClick={onSave}
                        loading={saving}
                        disabled={!dirty}
                      >
                        保存
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="primary"
                      icon={<EditOutlined />}
                      onClick={enterEdit}
                    >
                      编辑
                    </Button>
                  )}
                </Space>
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 12,
                  flexWrap: 'wrap',
                  gap: 12,
                }}
              >
                <Text strong>细分场景配置</Text>
                <Button size="small" onClick={onReset}>
                  恢复默认分值
                </Button>
              </div>

              <Table<DraftRule>
                rowKey="id"
                loading={loading}
                dataSource={items}
                columns={mainColumns}
                pagination={false}
                size="middle"
                scroll={{ x: true }}
              />

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginTop: 24,
                  marginBottom: 12,
                }}
              >
                <Text strong>自定义配置图库/词库</Text>
              </div>

              <Table<DraftRule>
                rowKey="id"
                loading={loading}
                dataSource={items}
                columns={customColumns}
                pagination={false}
                size="middle"
                scroll={{ x: true }}
              />
            </ContentComp>
          </Layout>
        </>
      )}

      {tabKey === 'hmx' && (
        <Spin spinning={hrLoading} style={{ marginTop: 16 }}>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16, background: '#EFF6FF', border: '1px solid #BAE6FD' }}
            message={
              <ol style={{ margin: 0, paddingLeft: 18, color: '#0369A1' }}>
                <li>在此处您可以配置是否开启人机审核服务，开启之后，您调用该 Service 符合条件的机审结果或直接进入人工审核环节。</li>
                <li>
                  人工审核服务是需要单独开通的收费服务，接入人机审核服务之前，请确认您已经知晓人工审核服务的收费规则，具体可以参见
                  <a style={{ color: '#0369A1', textDecoration: 'underline', marginLeft: 4 }}>
                    人工审核增强版介绍
                  </a>
                  。
                </li>
                <li>接入人机审核之前，您可以找商务同学沟通您的审核规则配置，以保证人工审核标准符合您的要求。</li>
              </ol>
            }
          />
          <div
            style={{
              border: '1px solid #E2E8F0',
              borderRadius: 6,
              padding: 'clamp(12px, 1.5vw, 20px)',
              background: '#FFFFFF',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 20,
              }}
            >
              <Text strong style={{ fontSize: 16 }}>人机审核</Text>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                onClick={onSaveHr}
                loading={hrSaving}
                disabled={!hrDirty}
              >
                保存
              </Button>
            </div>

            <Space size={12} align="center" style={{ marginBottom: 20, paddingLeft: 16 }}>
              <Space size={6} align="center">
                <Text>开启人机审核</Text>
                <QuestionCircleOutlined style={{ color: '#94A3B8', fontSize: 12 }} />
              </Space>
              <Switch
                checked={hrDraft?.is_enabled ?? false}
                onChange={(v) =>
                  setHrDraft((d) => (d ? { ...d, is_enabled: v } : d))
                }
                aria-label="开启人机审核"
              />
            </Space>

            <Space size={12} align="center" wrap style={{ marginBottom: 20, paddingLeft: 16 }}>
              <Space size={6} align="center">
                <Text>流入人审内容</Text>
                <QuestionCircleOutlined style={{ color: '#94A3B8', fontSize: 12 }} />
              </Space>
              {(['高风险', '中风险', '低风险', '无风险'] as RiskLevel[]).map((lvl) => (
                <Checkbox
                  key={lvl}
                  checked={hrDraft?.risk_levels.includes(lvl) ?? false}
                  onChange={(e) => {
                    setHrDraft((d) => {
                      if (!d) return d
                      const next = e.target.checked
                        ? Array.from(new Set([...d.risk_levels, lvl]))
                        : d.risk_levels.filter((r) => r !== lvl)
                      return { ...d, risk_levels: next }
                    })
                  }}
                >
                  {lvl}
                </Checkbox>
              ))}
            </Space>

            <Space size={12} align="center" wrap style={{ marginBottom: 16, paddingLeft: 16 }}>
              <Space size={6} align="center" style={{ minWidth: 110 }}>
                <Text>人审审核规则</Text>
                <QuestionCircleOutlined style={{ color: '#94A3B8', fontSize: 12 }} />
              </Space>
              <Select
                placeholder="请选择"
                allowClear
                value={hrDraft?.review_rule_id ?? undefined}
                onChange={(v) =>
                  setHrDraft((d) => (d ? { ...d, review_rule_id: v ?? null } : d))
                }
                style={{ minWidth: 'clamp(200px, 100%, 320px)', flex: 1 }}
                options={[
                  { value: 1, label: '默认人审流程' },
                  { value: 2, label: '快速人审流程' },
                ]}
              />
            </Space>

            <Space size={12} align="center" wrap style={{ paddingLeft: 16 }}>
              <Space size={6} align="center" style={{ minWidth: 110 }}>
                <Text>回调通知方案</Text>
                <QuestionCircleOutlined style={{ color: '#94A3B8', fontSize: 12 }} />
              </Space>
              <Select
                placeholder="请选择"
                allowClear
                value={hrDraft?.notify_plan_id ?? undefined}
                onChange={(v) =>
                  setHrDraft((d) => (d ? { ...d, notify_plan_id: v ?? null } : d))
                }
                style={{ minWidth: 'clamp(200px, 100%, 320px)', flex: 1 }}
                options={[
                  { value: 1, label: '邮件通知' },
                  { value: 2, label: '短信通知' },
                  { value: 3, label: '站内信通知' },
                ]}
              />
              <a style={{ color: '#0369A1' }} onClick={() => message.info('新增通知 - 即将上线')}>
                没有想要的通知方案？可以去 新增通知
              </a>
            </Space>
          </div>
        </Spin>
      )}

      <style>{`
        @media (max-width: 768px) {
          .service-rule-range-sider { display: none !important; }
          .service-rule-range-layout { flex-direction: column !important; }
        }
      `}</style>
    </div>
  )
}

// Simple confirm wrapper (avoid pulling in Modal.confirm into tree)
const ModalShim = {
  confirmReset: (onOk: () => void) => {
    // eslint-disable-next-line no-alert
    if (window.confirm('确认恢复默认分值？将覆盖所有规则的中/高风险分。')) onOk()
  },
}
