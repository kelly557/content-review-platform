/**
 * 通用审核规则批量导入 — hidden admin page.
 *
 * Lives at /import-rules (NOT linked in the sidebar). Users must type the
 * URL manually. Backend endpoints require admin role; this page additionally
 * hides itself unless the current user is admin.
 *
 * NOT wrapped in <AppLayout> — purely on its own canvas so anyone who
 * knows the URL gets a focused tool with no distractions.
 *
 * Scope: text + image only. Backend maps these to text_audit_pro /
 * image_audit_pro rule packages internally; frontend never sees the
 * package_code dimension.
 */
import { useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import {
  Alert,
  Button,
  Checkbox,
  Collapse,
  Divider,
  Input,
  Radio,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd'
import type { TableColumnsType } from 'antd'
import { AxiosError } from 'axios'
import { App as AntdApp } from 'antd'
import {
  adminImportRulesApi,
  MEDIA_TYPE_OPTIONS,
  type RuleImportChange,
  type RuleImportResult,
  type RuleMediaType,
} from '@/api/adminImportRules'
import { useAuthStore } from '@/store'

const { Title, Text, Paragraph } = Typography

const SAMPLE = `审核项 ｜ 审核点 ｜ 检测内容
涉政 ｜ 不出现国家领导人 ｜ 涉及现任国家领导人姓名、绰号
　　｜ 不出现敏感事件 ｜ 涉及敏感历史事件、集会
涉恐 ｜ 不出现恐怖组织 ｜ 涉恐组织名称及别称
`

function ResultPanel({ result }: { result: RuleImportResult | null }) {
  if (!result) {
    return (
      <Alert
        type="info"
        message="尚未执行；右侧会在预览/导入后显示变更明细"
        showIcon
      />
    )
  }
  const itemChanges = result.changes.filter((c) => c.entity === 'item')
  const pointChanges = result.changes.filter((c) => c.entity === 'point')
  const s = result.summary

  const summaryLine = (
    <Space wrap>
      <Tag color="green">新建审核项 {s.items_created}</Tag>
      <Tag color="blue">更新审核项 {s.items_updated}</Tag>
      <Tag>跳过审核项 {s.items_skipped}</Tag>
      <Tag color="green">新建审核点 {s.points_created}</Tag>
      <Tag color="blue">更新审核点 {s.points_updated}</Tag>
      <Tag>跳过审核点 {s.points_skipped}</Tag>
    </Space>
  )

  const itemsTable: TableColumnsType<RuleImportChange> = [
    { title: 'code', dataIndex: 'code', render: (v: string) => <Text code>{v}</Text> },
    { title: '审核项', dataIndex: 'label_cn' },
    {
      title: '动作',
      dataIndex: 'action',
      width: 100,
      render: (v: string) => (
        <Tag color={v === 'create' ? 'green' : v === 'update' ? 'blue' : 'default'}>
          {v}
        </Tag>
      ),
    },
  ]

  const pointsTable: TableColumnsType<RuleImportChange> = [
    { title: '审核项 code', dataIndex: 'item_code', render: (v?: string) => <Text code>{v ?? '-'}</Text> },
    { title: '审核点 code', dataIndex: 'code', render: (v: string) => <Text code>{v}</Text> },
    { title: '审核点', dataIndex: 'label_cn' },
    { title: '检测内容', dataIndex: 'description' },
    {
      title: '动作',
      dataIndex: 'action',
      width: 100,
      render: (v: string) => (
        <Tag color={v === 'create' ? 'green' : v === 'update' ? 'blue' : 'default'}>
          {v}
        </Tag>
      ),
    },
  ]

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      {summaryLine}
      {result.warnings.length > 0 && (
        <Alert
          type="warning"
          showIcon
          message="Warnings"
          description={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          }
        />
      )}
      {result.errors.length > 0 && (
        <Alert
          type="error"
          showIcon
          message="Errors"
          description={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {result.errors.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          }
        />
      )}
      <Collapse
        defaultActiveKey={['items', 'points']}
        items={[
          {
            key: 'items',
            label: <span>审核项 · {itemChanges.length}</span>,
            children:
              itemChanges.length === 0 ? <Text type="secondary">无</Text> : (
                <Table
                  size="small"
                  rowKey={(r) => `${r.entity}-${r.code}`}
                  dataSource={itemChanges}
                  columns={itemsTable}
                  pagination={false}
                />
              ),
          },
          {
            key: 'points',
            label: <span>审核点 · {pointChanges.length}</span>,
            children:
              pointChanges.length === 0 ? <Text type="secondary">无</Text> : (
                <Table
                  size="small"
                  rowKey={(r) => `${r.entity}-${r.code}`}
                  dataSource={pointChanges}
                  columns={pointsTable}
                  pagination={{ pageSize: 20 }}
                />
              ),
          },
        ]}
      />
    </Space>
  )
}

export default function ImportRulesPage() {
  const { message } = AntdApp.useApp()
  const { user, initialized } = useAuthStore()
  const [mediaType, setMediaType] = useState<RuleMediaType>('text')
  const [kind, setKind] = useState<'builtin' | 'personal'>('personal')
  const [tableText, setTableText] = useState<string>(SAMPLE)
  const [onConflict, setOnConflict] = useState<'update' | 'skip'>('update')
  const [isEnabled, setIsEnabled] = useState<boolean>(false)
  const [confirmDowngrade, setConfirmDowngrade] = useState<boolean>(false)
  const [busy, setBusy] = useState<boolean>(false)
  const [previewResult, setPreviewResult] = useState<RuleImportResult | null>(null)
  const [importResult, setImportResult] = useState<RuleImportResult | null>(null)

  const ready = useMemo(
    () => Boolean(mediaType && tableText.trim()),
    [mediaType, tableText],
  )

  if (initialized && (!user || user.role !== 'admin')) {
    return <Navigate to="/overview" replace />
  }
  if (!initialized) return null

  async function run(dryRun: boolean) {
    if (!ready || !mediaType) return
    setBusy(true)
    try {
      const payload = {
        media_type: mediaType,
        kind,
        table_text: tableText,
        is_enabled: isEnabled,
        on_conflict: onConflict,
        confirm_downgrade: confirmDowngrade,
      }
      const result = dryRun
        ? await adminImportRulesApi.preview(payload)
        : await adminImportRulesApi.import(payload)
      if (dryRun) {
        setPreviewResult(result)
      } else {
        setImportResult(result)
        setPreviewResult(result)
      }
      message.success(dryRun ? '预览完成' : '导入完成')
    } catch (e) {
      const err = e as AxiosError<{ detail?: string }>
      const status = err.response?.status
      const detail = err.response?.data?.detail
      if (status === 401 || status === 403) {
        message.error(detail || '权限不足')
      } else {
        message.error(detail || err.message || '未知错误')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#F1F5F9',
        padding: '32px 24px',
      }}
    >
      <div style={{ width: '100%', maxWidth: 1280, margin: '0 auto' }}>
        <Title level={3} style={{ marginBottom: 4 }}>
          通用审核规则 · 批量导入
        </Title>
        <Paragraph type="secondary" style={{ marginBottom: 24 }}>
          隐藏工具页：通过 <Text code>/import-rules</Text> 直接访问；不在主产品侧栏菜单出现。
          需要 admin 角色 — 否则会自动跳到 <Text code>/overview</Text>。
        </Paragraph>

        <div
          style={{
            background: '#FFFFFF',
            border: '1px solid #E2E8F0',
            borderRadius: 8,
            padding: 20,
            marginBottom: 16,
          }}
        >
          <Space size="middle" align="center" wrap>
            <Text>当前账号：</Text>
            <Text strong>{user?.email}</Text>
            <Tag color="purple">{user?.role}</Tag>
          </Space>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 16,
          }}
        >
          <div
            style={{
              background: '#FFFFFF',
              border: '1px solid #E2E8F0',
              borderRadius: 8,
              padding: 20,
            }}
          >
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <div>
                <Text>规则类型</Text>
                <div style={{ marginTop: 6 }}>
                  <Radio.Group
                    value={mediaType}
                    onChange={(e) => setMediaType(e.target.value)}
                    optionType="button"
                    buttonStyle="solid"
                  >
                    {MEDIA_TYPE_OPTIONS.map((o) => (
                      <Radio.Button key={o.value} value={o.value}>
                        {o.label}
                      </Radio.Button>
                    ))}
                  </Radio.Group>
                </div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  仅支持文本 / 图片两类通用规则；后端自动对应到 text_audit_pro / image_audit_pro 审核包
                </Text>
              </div>

              <div>
                <Text>导入到</Text>
                <div style={{ marginTop: 6 }}>
                  <Radio.Group
                    value={kind}
                    onChange={(e) => setKind(e.target.value)}
                    optionType="button"
                    buttonStyle="solid"
                  >
                    <Radio.Button value="personal">个性化规则 (is_builtin=false)</Radio.Button>
                    <Radio.Button value="builtin">通用规则 (is_builtin=true)</Radio.Button>
                  </Radio.Group>
                </div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  导入为「通用规则」会把行标记为内置审计项；导入为「个性化规则」保持非内置。
                  已经存在的通用项若要变成个性化，必须勾选下方「确认降级」。
                </Text>
              </div>

              <Space size="large" align="start">
                <div>
                  <Text>is_enabled</Text>
                  <div>
                    <Switch
                      checked={isEnabled}
                      onChange={setIsEnabled}
                      checkedChildren="开"
                      unCheckedChildren="关"
                    />
                  </div>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    批量控制本次写入的所有审核点是否启用
                  </Text>
                </div>
                <div>
                  <Text>on_conflict</Text>
                  <div>
                    <Radio.Group
                      value={onConflict}
                      onChange={(e) => setOnConflict(e.target.value)}
                      optionType="button"
                      buttonStyle="solid"
                    >
                      <Radio.Button value="update">update</Radio.Button>
                      <Radio.Button value="skip">skip</Radio.Button>
                    </Radio.Group>
                  </div>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {onConflict === 'update'
                      ? '已存在的审核项/审核点 就地修改（默认）'
                      : '已存在的审核项/审核点 保持不动，仅计入 summary.skipped'}
                  </Text>
                </div>
              </Space>

              {kind === 'personal' && (
                <div>
                  <Checkbox
                    checked={confirmDowngrade}
                    onChange={(e) => setConfirmDowngrade(e.target.checked)}
                  >
                    我知道风险：要把已存在的「通用规则」降级为「个性化规则」
                  </Checkbox>
                  <Text type="secondary" style={{ fontSize: 12, display: 'block', marginLeft: 24 }}>
                    不勾选 → 若表里出现同名通用项，后端会 422 拒绝整个批。勾选后降级会写入并在响应 warnings 字段里告知。
                  </Text>
                </div>
              )}

              <div>
                <Space style={{ marginBottom: 6 }}>
                  <Text>表格内容</Text>
                  <Button size="small" onClick={() => setTableText(SAMPLE)}>
                    加载示例
                  </Button>
                  <Button size="small" onClick={() => setTableText('')}>
                    清空
                  </Button>
                </Space>
                <Input.TextArea
                  rows={20}
                  value={tableText}
                  onChange={(e) => setTableText(e.target.value)}
                  style={{ fontFamily: 'Menlo, Consolas, monospace' }}
                  placeholder="审核项 ｜ 审核点 ｜ 检测内容"
                />
              </div>

              <Divider />

              <Space>
                <Button
                  type="primary"
                  disabled={!ready}
                  loading={busy}
                  onClick={() => run(true)}
                >
                  预览（dry-run）
                </Button>
                <Button
                  danger
                  disabled={!ready}
                  loading={busy}
                  onClick={() => run(false)}
                >
                  导入（写入）
                </Button>
              </Space>
            </Space>
          </div>

          <div
            style={{
              background: '#FFFFFF',
              border: '1px solid #E2E8F0',
              borderRadius: 8,
              padding: 20,
            }}
          >
            <Tabs
              items={[
                {
                  key: 'preview',
                  label: <span>预览（最近一次 dry-run）</span>,
                  children: <ResultPanel result={previewResult} />,
                },
                {
                  key: 'import',
                  label: <span>导入（最近一次真写入）</span>,
                  children: <ResultPanel result={importResult} />,
                },
              ]}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
