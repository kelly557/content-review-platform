import { useEffect, useMemo, useState } from 'react'
import {
  App,
  Button,
  Checkbox,
  Collapse,
  Drawer,
  Empty,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd'
import {
  CheckCircleTwoTone,
  CloseCircleTwoTone,
  CodeOutlined,
  ImportOutlined,
} from '@ant-design/icons'
import { knowledgeApi } from '@/api/knowledge'
import {
  type AuditPointRisk,
  type KnowledgeExtraction,
  type KnowledgeExtractionItem,
  type KnowledgeExtractionPoint,
  type KnowledgeImportRequest,
} from '@/types/domain'

const { Title, Text, Paragraph } = Typography

interface Props {
  extractionId: string | null
  onClose: () => void
  onImported: () => void
}

const RISK_OPTIONS: { value: AuditPointRisk; label: string; color: string }[] = [
  { value: '高风险', label: '高风险', color: 'red' },
  { value: '中风险', label: '中风险', color: 'orange' },
  { value: '低风险', label: '低风险', color: 'green' },
]

const LOGIC_TYPES = [
  { value: 'keyword_match', label: '关键词匹配' },
  { value: 'regex', label: '正则' },
  { value: 'semantic', label: '语义' },
  { value: 'threshold', label: '阈值' },
]

function asJson(text: string): { ok: true; value: any } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'JSON 解析失败' }
  }
}

export default function ExtractionReviewDrawer({ extractionId, onClose, onImported }: Props) {
  const { message } = App.useApp()
  const [ext, setExt] = useState<KnowledgeExtraction | null>(null)
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)

  const load = async () => {
    if (!extractionId) {
      setExt(null)
      return
    }
    setLoading(true)
    try {
      const data = await knowledgeApi.getExtraction(extractionId)
      setExt(data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extractionId])

  const totalSelected = useMemo(() => {
    if (!ext) return { items: 0, points: 0 }
    const items = ext.items.filter((i) => i.selected && !i.imported_item_id).length
    const points = ext.items.flatMap((i) => i.points).filter(
      (p) => p.selected && !p.imported_point_id,
    ).length
    return { items, points }
  }, [ext])

  const handleImport = async () => {
    if (!ext) return
    if (totalSelected.items === 0) {
      message.warning('请至少勾选一个审核项')
      return
    }
    const itemIds = ext.items
      .filter((it) => it.selected && !it.imported_item_id)
      .map((it) => it.id)
    const body: KnowledgeImportRequest = {
      item_ids: itemIds,
      enable_imported: true,
    }
    setImporting(true)
    try {
      const result = await knowledgeApi.importSelected(ext.id, body)
      message.success(
        `已导入 ${result.imported_items} 个审核项 / ${result.imported_points} 个审核点 → ${result.service_code}`,
      )
      onImported()
      load()
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '导入失败')
    } finally {
      setImporting(false)
    }
  }

  return (
    <Drawer
      open={!!extractionId}
      onClose={onClose}
      title="抽取结果审核"
      width={760}
      destroyOnHidden
      extra={
        <Space>
          <Button onClick={onClose}>关闭</Button>
          <Button
            type="primary"
            icon={<ImportOutlined />}
            loading={importing}
            disabled={!ext || totalSelected.items === 0}
            onClick={handleImport}
          >
            导入选中 ({totalSelected.items}/{totalSelected.points})
          </Button>
        </Space>
      }
    >
      {!ext && !loading && <Empty description="未选中抽取记录" />}
      {ext && (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div>
            <Title level={5} style={{ marginTop: 0 }}>
              {ext.model ?? '—'} · 第 {ext.round_no} 轮 · tokens {ext.prompt_tokens}/{ext.completion_tokens}
            </Title>
            <Text type="secondary">
              状态：{ext.status} · 分块 {ext.chunk_count} · 创建时间 {ext.created_at}
            </Text>
            {ext.error_message && (
              <Paragraph type="danger" style={{ marginTop: 8 }}>
                {ext.error_message}
              </Paragraph>
            )}
            {ext.raw_response && (
              <details>
                <summary style={{ cursor: 'pointer', color: '#64748B' }}>
                  <CodeOutlined /> 查看原始 LLM 响应
                </summary>
                <pre
                  style={{
                    background: '#0F172A',
                    color: '#E2E8F0',
                    padding: 12,
                    borderRadius: 6,
                    overflow: 'auto',
                    fontSize: 12,
                  }}
                >
                  {ext.raw_response}
                </pre>
              </details>
            )}
          </div>

          {ext.items.length === 0 && <Empty description="AI 未抽取到任何审核项" />}

          <Collapse accordion defaultActiveKey={ext.items[0]?.id}>
            {ext.items.map((item) => (
              <Collapse.Panel
                key={item.id}
                header={
                  <ItemHeader
                    item={item}
                    onSelectedChange={(v) =>
                      patchItem(item, { selected: v }).then(load)
                    }
                  />
                }
              >
                <ItemEditor
                  item={item}
                  onChange={async (patch) => {
                    await patchItem(item, patch)
                    await load()
                  }}
                />
                <div style={{ marginTop: 12 }}>
                  <Title level={5} style={{ marginTop: 0 }}>审核点</Title>
                  {item.points.length === 0 && <Empty description="无审核点" />}
                  {item.points.map((p) => (
                    <PointEditor
                      key={p.id}
                      point={p}
                      onChange={async (patch) => {
                        await patchPoint(p, patch)
                        await load()
                      }}
                    />
                  ))}
                </div>
              </Collapse.Panel>
            ))}
          </Collapse>
        </Space>
      )}
    </Drawer>
  )
}

function ItemHeader({
  item,
  onSelectedChange,
}: {
  item: KnowledgeExtractionItem
  onSelectedChange: (v: boolean) => void
}) {
  const imported = !!item.imported_item_id
  return (
    <Space style={{ width: '100%', justifyContent: 'space-between' }}>
      <Space>
        <Checkbox
          checked={item.selected}
          disabled={imported}
          onChange={(e) => onSelectedChange(e.target.checked)}
        />
        <Text strong>{item.name_cn}</Text>
        <Tag color="blue">{item.code}</Tag>
        {item.aliases.length > 0 && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            别名：{item.aliases.join('、')}
          </Text>
        )}
      </Space>
      <Space>
        {imported ? (
          <Tag color="success" icon={<CheckCircleTwoTone twoToneColor="#16a34a" />}>
            已导入 #{item.imported_item_id}
          </Tag>
        ) : (
          <Tag>未导入</Tag>
        )}
      </Space>
    </Space>
  )
}

function ItemEditor({
  item,
  onChange,
}: {
  item: KnowledgeExtractionItem
  onChange: (patch: Partial<{
    name_cn: string
    aliases: string[]
    description: string
    sort_order: number
    selected: boolean
  }>) => Promise<void>
}) {
  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      <Input
        addonBefore="名称"
        value={item.name_cn}
        onBlur={(e) => onChange({ name_cn: e.target.value })}
      />
      <Input
        addonBefore="别名"
        value={item.aliases.join('、')}
        onBlur={(e) =>
          onChange({ aliases: e.target.value.split(/[,，、\s]+/).filter(Boolean) })
        }
      />
      <Input.TextArea
        rows={2}
        placeholder="描述（说明）"
        defaultValue={item.description ?? ''}
        onBlur={(e) => onChange({ description: e.target.value })}
      />
      <InputNumber
        addonBefore="排序"
        value={item.sort_order}
        onChange={(v) => v !== null && onChange({ sort_order: v })}
      />
    </Space>
  )
}

function PointEditor({
  point,
  onChange,
}: {
  point: KnowledgeExtractionPoint
  onChange: (patch: any) => Promise<void>
}) {
  const [logicText, setLogicText] = useState(JSON.stringify(point.judgment_logic, null, 2))
  const [logicErr, setLogicErr] = useState<string | null>(null)
  const imported = !!point.imported_point_id

  useEffect(() => {
    setLogicText(JSON.stringify(point.judgment_logic, null, 2))
  }, [point.id])

  return (
    <div
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: 6,
        padding: 12,
        marginBottom: 12,
        background: imported ? '#f0fdf4' : '#fff',
      }}
    >
      <Space style={{ width: '100%', justifyContent: 'space-between' }}>
        <Space>
          <Checkbox
            checked={point.selected}
            disabled={imported}
            onChange={(e) => onChange({ selected: e.target.checked })}
          />
          <Text strong>{point.label_cn}</Text>
          <Tag>{point.code}</Tag>
          <Tag color={RISK_OPTIONS.find((r) => r.value === point.risk_level)?.color}>
            {point.risk_level}
          </Tag>
        </Space>
        {imported ? (
          <Tag color="success" icon={<CheckCircleTwoTone twoToneColor="#16a34a" />}>
            已导入 #{point.imported_point_id}
          </Tag>
        ) : (
          <Tag>未导入</Tag>
        )}
      </Space>
      <Space direction="vertical" size={8} style={{ width: '100%', marginTop: 8 }}>
        <Input
          addonBefore="名称"
          defaultValue={point.label_cn}
          onBlur={(e) => onChange({ label_cn: e.target.value })}
        />
        <Input.TextArea
          rows={2}
          placeholder="描述"
          defaultValue={point.description ?? ''}
          onBlur={(e) => onChange({ description: e.target.value })}
        />
        <Space.Compact style={{ width: '100%' }}>
          <span
            style={{
              padding: '0 8px',
              background: '#f1f5f9',
              border: '1px solid #d9d9d9',
              borderRight: 0,
              borderRadius: '6px 0 0 6px',
              lineHeight: '32px',
              fontSize: 12,
              color: '#475569',
            }}
          >
            判断逻辑 (JSON)
          </span>
          <Input.TextArea
            rows={3}
            value={logicText}
            onChange={(e) => {
              setLogicText(e.target.value)
              const parsed = asJson(e.target.value)
              setLogicErr(parsed.ok ? null : parsed.error)
            }}
            onBlur={() => {
              const parsed = asJson(logicText)
              if (parsed.ok) onChange({ judgment_logic: parsed.value })
            }}
            style={{ borderRadius: 0 }}
          />
          <Select
            value={point.judgment_logic.type}
            options={LOGIC_TYPES}
            style={{ width: 130, borderRadius: '0 6px 6px 0' }}
            onChange={(v) => {
              const next = { ...point.judgment_logic, type: v }
              setLogicText(JSON.stringify(next, null, 2))
              onChange({ judgment_logic: next })
            }}
          />
        </Space.Compact>
        {logicErr && (
          <Text type="danger">
            <CloseCircleTwoTone twoToneColor="#DC2626" /> JSON 解析失败：{logicErr}
          </Text>
        )}
        <Input.TextArea
          rows={2}
          placeholder="判断规则（自然语言）"
          defaultValue={point.judgment_rule ?? ''}
          onBlur={(e) => onChange({ judgment_rule: e.target.value })}
        />
        <Input.TextArea
          rows={2}
          placeholder="判断依据（条款 / 出处）"
          defaultValue={point.judgment_basis ?? ''}
          onBlur={(e) => onChange({ judgment_basis: e.target.value })}
        />
        <Space>
          <Select
            value={point.risk_level}
            options={RISK_OPTIONS}
            style={{ width: 120 }}
            onChange={(v) => onChange({ risk_level: v })}
          />
          <InputNumber
            addonBefore="中阈"
            value={point.medium_threshold}
            min={0}
            max={100}
            onChange={(v) => v !== null && onChange({ medium_threshold: v })}
          />
          <InputNumber
            addonBefore="高阈"
            value={point.high_threshold}
            min={0}
            max={100}
            onChange={(v) => v !== null && onChange({ high_threshold: v })}
          />
        </Space>
        <Input
          addonBefore="适用"
          placeholder="scope_text"
          defaultValue={point.scope_text ?? ''}
          onBlur={(e) => onChange({ scope_text: e.target.value })}
        />
      </Space>
    </div>
  )
}

async function patchItem(
  item: KnowledgeExtractionItem,
  patch: Partial<{
    name_cn: string
    aliases: string[]
    description: string
    sort_order: number
    selected: boolean
  }>,
) {
  try {
    await knowledgeApi.patchItem(item.id, patch)
  } catch (e: any) {
    Modal.error({ title: '保存失败', content: e?.response?.data?.detail || 'unknown' })
  }
}

async function patchPoint(
  point: KnowledgeExtractionPoint,
  patch: any,
) {
  try {
    await knowledgeApi.patchPoint(point.id, patch)
  } catch (e: any) {
    Modal.error({ title: '保存失败', content: e?.response?.data?.detail || 'unknown' })
  }
}