import { useEffect, useMemo, useState } from 'react'
import {
  Badge,
  Checkbox,
  Collapse,
  Input,
  List,
  Space,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import { SearchOutlined, ThunderboltOutlined } from '@ant-design/icons'
import type { AgentHit, AuditItem } from '@/types/domain'
import { colors } from '@/styles/theme'

const { Text } = Typography

interface Props {
  items: AuditItem[]
  /** Detection hits used to pre-select items. */
  hits: AgentHit[]
  selectedIds: number[]
  onChange: (ids: number[]) => void
  /** readOnly is rendered as static checklist (no edits). */
  readOnly?: boolean
  /** Visible cap before "show more" fold; default 5. */
  collapsedAbove?: number
}

/**
 * Pre-selection rules (2026-07-16):
 *  1. ``audit_item.code`` substring appears in any hit's label_cn → strong match
 *  2. ``audit_item.name_cn`` substring appears in any hit's label_cn → strong match
 *  3. any ``audit_item.aliases[i]`` substring appears in any hit's label_cn → strong match
 *  4. no other heuristic; the user can manually toggle anything.
 */
export function preselectHits(
  items: AuditItem[],
  hits: AgentHit[],
): number[] {
  if (!items.length || !hits.length) return []
  const label_corpus = hits
    .map((h) => `${h.label ?? ''} ${h.label_cn ?? ''}`)
    .join(' ')
  const matched: number[] = []
  for (const item of items) {
    if (item.code && label_corpus.includes(item.code)) {
      matched.push(item.id)
      continue
    }
    if (item.name_cn && label_corpus.includes(item.name_cn)) {
      matched.push(item.id)
      continue
    }
    if (item.aliases && item.aliases.some((a) => a && label_corpus.includes(a))) {
      matched.push(item.id)
      continue
    }
  }
  return matched
}

export default function AuditItemChecklist({
  items,
  hits,
  selectedIds,
  onChange,
  readOnly,
  collapsedAbove = 5,
}: Props) {
  const [query, setQuery] = useState('')

  const preselected = useMemo(() => preselectHits(items, hits), [items, hits])
  const hitByItemId = useMemo(() => {
    const map = new Map<number, AgentHit[]>()
    for (const aid of preselected) map.set(aid, [])
    for (const h of hits) {
      for (const aid of preselected) {
        const it = items.find((i) => i.id === aid)
        if (!it) continue
        if (
          (it.code && h.label_cn?.includes(it.code)) ||
          (it.name_cn && h.label_cn?.includes(it.name_cn)) ||
          (it.aliases ?? []).some((a) => h.label_cn?.includes(a))
        ) {
          map.get(aid)?.push(h)
        }
      }
    }
    return map
  }, [preselected, items, hits])

  const matchedItems = useMemo(
    () => items.filter((i) => preselected.includes(i.id)),
    [items, preselected],
  )
  const otherItems = useMemo(
    () =>
      items.filter(
        (i) =>
          !preselected.includes(i.id) &&
          (!query.trim() ||
            i.name_cn.includes(query.trim()) ||
            (i.aliases ?? []).some((a) => a.includes(query.trim())) ||
            i.code.includes(query.trim())),
      ),
    [items, preselected, query],
  )

  useEffect(() => {
    // On items/hits first arrival, ensure the preselected set is reflected
    // upstream (so the parent state contains the defaults).
    const set = new Set(selectedIds)
    let added = false
    for (const id of preselected) {
      if (!set.has(id)) {
        set.add(id)
        added = true
      }
    }
    if (added) onChange(Array.from(set))
    // We intentionally do not depend on selectedIds to avoid an infinite
    // re-emit loop; the parent owns the canonical state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselected.join('|')])

  const toggle = (id: number) => {
    if (readOnly) return
    const set = new Set(selectedIds)
    if (set.has(id)) set.delete(id)
    else set.add(id)
    onChange(Array.from(set))
  }

  const renderItem = (item: AuditItem, isMatched: boolean) => {
    const checked = selectedIds.includes(item.id)
    const itemHits = hitByItemId.get(item.id) ?? []
    return (
      <List.Item style={{ padding: '4px 8px', border: 'none' }}>
        <Checkbox
          checked={checked}
          disabled={readOnly}
          onChange={() => toggle(item.id)}
          style={{ marginRight: 6 }}
        >
          <Space size={6}>
            <span>{item.name_cn}</span>
            <Tag color="default" style={{ margin: 0, fontSize: 11 }}>
              {item.code}
            </Tag>
            {isMatched && (
              <Tooltip title="由命中片段自动预选">
                <Tag
                  color="red"
                  icon={<ThunderboltOutlined />}
                  style={{ margin: 0, fontSize: 11 }}
                >
                  命中预选
                </Tag>
              </Tooltip>
            )}
            {itemHits.length > 0 && (
              <Badge count={itemHits.length} size="small" />
            )}
          </Space>
        </Checkbox>
      </List.Item>
    )
  }

  return (
    <div>
      <Text strong>审核项</Text>
      <div style={{ marginTop: 6 }}>
        {matchedItems.length === 0 && otherItems.length === 0 ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            暂无可选审核项
          </Text>
        ) : (
          <Collapse
            size="small"
            ghost
            defaultActiveKey={['matched', 'other']}
            items={[
              {
                key: 'matched',
                label: (
                  <Space size={6}>
                    <Text>命中项</Text>
                    <Badge
                      count={matchedItems.length}
                      showZero
                      color={colors.destructive}
                      size="small"
                    />
                  </Space>
                ),
                children:
                  matchedItems.length === 0 ? (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      本次无命中项
                    </Text>
                  ) : (
                    <List
                      dataSource={matchedItems.slice(0, collapsedAbove)}
                      renderItem={(it) => renderItem(it, true)}
                      split={false}
                    />
                  ),
              },
              {
                key: 'other',
                label: (
                  <Space size={6}>
                    <Text>其他审核项</Text>
                    <Badge count={otherItems.length} showZero size="small" />
                  </Space>
                ),
                children: (
                  <Space direction="vertical" size={6} style={{ width: '100%' }}>
                    <Input
                      prefix={<SearchOutlined />}
                      placeholder="搜索审核项 / 别名 / code"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      allowClear
                      size="small"
                    />
                    <List
                      dataSource={otherItems}
                      renderItem={(it) => renderItem(it, false)}
                      split={false}
                      locale={{
                        emptyText:
                          otherItems.length === 0 ? '无更多审核项' : '无匹配项',
                      }}
                    />
                  </Space>
                ),
              },
            ]}
          />
        )}
      </div>
    </div>
  )
}
