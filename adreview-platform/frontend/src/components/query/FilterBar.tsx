import { useEffect, useState } from 'react'
import { DatePicker, Flex, Input, Select } from 'antd'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import {
  DETECTION_MODALITIES,
  MACHINE_DECISION_OPTIONS,
  MACHINE_REVIEW_FEEDBACK_OPTIONS,
  type DetectionModality,
  type MachineDecision,
  type MachineReviewFeedbackKind,
  type QueryFilters,
  type RiskTaxonomyNode,
} from '@/types/domain'
import StrategySelect from './StrategySelect'
import RiskLabelCascade from './RiskLabelCascade'

const { RangePicker } = DatePicker

export interface AdvancedFilterValues {
  channels?: string[]
  ips?: string[]
  account_ids?: string[]
}

export interface FilterBarProps {
  value: QueryFilters
  onChange: (next: QueryFilters) => void
  riskTaxonomy: RiskTaxonomyNode[]
  advancedOpen: boolean
  advancedValues: AdvancedFilterValues
  onAdvancedChange: (next: AdvancedFilterValues) => void
}

function parseCsv(s: string): string[] {
  if (!s.trim()) return []
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
}

function parseCsvInts(s: string): number[] {
  return parseCsv(s)
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n))
}

export default function FilterBar({
  value,
  onChange,
  riskTaxonomy,
  advancedOpen,
  advancedValues,
  onAdvancedChange,
}: FilterBarProps) {
  const [requestIdsRaw, setRequestIdsRaw] = useState((value.request_ids ?? []).join(','))
  const [taskIdsRaw, setTaskIdsRaw] = useState((value.task_ids ?? []).join(','))
  const [channelsRaw, setChannelsRaw] = useState((advancedValues.channels ?? []).join(','))
  const [ipsRaw, setIpsRaw] = useState((advancedValues.ips ?? []).join(','))
  const [accountIdsRaw, setAccountIdsRaw] = useState(
    (advancedValues.account_ids ?? []).join(','),
  )

  useEffect(() => {
    setRequestIdsRaw((value.request_ids ?? []).join(','))
    setTaskIdsRaw((value.task_ids ?? []).join(','))
  }, [value.request_ids, value.task_ids])

  useEffect(() => {
    setChannelsRaw((advancedValues.channels ?? []).join(','))
  }, [advancedValues.channels])
  useEffect(() => {
    setIpsRaw((advancedValues.ips ?? []).join(','))
  }, [advancedValues.ips])
  useEffect(() => {
    setAccountIdsRaw((advancedValues.account_ids ?? []).join(','))
  }, [advancedValues.account_ids])

  const setRange = (range: [Dayjs | null, Dayjs | null] | null) => {
    if (!range || !range[0] || !range[1]) {
      onChange({ ...value, start: undefined, end: undefined })
      return
    }
    onChange({
      ...value,
      start: range[0].startOf('day').toISOString(),
      end: range[1].endOf('day').toISOString(),
    })
  }

  const rangeValue: [Dayjs, Dayjs] | null =
    value.start && value.end ? [dayjs(value.start), dayjs(value.end)] : null

  return (
    <Flex gap="middle" wrap="wrap" style={{ width: '100%' }}>
      <div style={{ flex: '1 1 240px', minWidth: 220 }}>
        <RangePicker
          value={rangeValue}
          onChange={setRange}
          style={{ width: '100%' }}
          allowClear
        />
      </div>

      <div style={{ flex: '1 1 240px', minWidth: 220 }}>
        <Select<DetectionModality[]>
          mode="multiple"
          value={value.material_types ?? []}
          onChange={(v) => onChange({ ...value, material_types: v.length ? v : undefined })}
          options={DETECTION_MODALITIES}
          placeholder="选择审核模态"
          allowClear
          maxTagCount="responsive"
          style={{ width: '100%' }}
        />
      </div>

      <div style={{ flex: '1 1 240px', minWidth: 220 }}>
        <StrategySelect
          value={value.strategy_code}
          onChange={(v) => onChange({ ...value, strategy_code: v })}
          placeholder="选择审核策略"
        />
      </div>

      <div style={{ flex: '1 1 200px', minWidth: 180 }}>
        <Select<MachineDecision | undefined>
          value={value.machine_decision}
          onChange={(v) => onChange({ ...value, machine_decision: v })}
          options={[
            { value: undefined as unknown as MachineDecision, label: '全部' },
            ...MACHINE_DECISION_OPTIONS,
          ]}
          placeholder="选择审核结果"
          allowClear
          style={{ width: '100%' }}
        />
      </div>

      <div style={{ flex: '1 1 240px', minWidth: 220 }}>
        <Input
          value={requestIdsRaw}
          onChange={(e) => setRequestIdsRaw(e.target.value)}
          onBlur={() => onChange({ ...value, request_ids: parseCsvInts(requestIdsRaw) })}
          placeholder="输入 Request ID"
          allowClear
        />
      </div>

      <div style={{ flex: '1 1 200px', minWidth: 180 }}>
        <Input
          value={taskIdsRaw}
          onChange={(e) => setTaskIdsRaw(e.target.value)}
          onBlur={() => onChange({ ...value, task_ids: parseCsvInts(taskIdsRaw) })}
          placeholder="输入 Task ID"
          allowClear
        />
      </div>

      <div style={{ flex: '0 1 240px', minWidth: 220 }}>
        <RiskLabelCascade
          taxonomy={riskTaxonomy}
          value={value.risk_label_paths ?? []}
          onChange={(paths) =>
            onChange({ ...value, risk_label_paths: paths.length ? paths : undefined })
          }
          placeholder="选择风险标签"
        />
      </div>

      <div style={{ flex: '0 1 200px', minWidth: 180 }}>
        <Select<MachineReviewFeedbackKind | undefined>
          value={value.feedback}
          onChange={(v) => onChange({ ...value, feedback: v })}
          options={[
            { value: undefined as unknown as MachineReviewFeedbackKind, label: '全部' },
            ...MACHINE_REVIEW_FEEDBACK_OPTIONS,
          ]}
          placeholder="选择反馈结果"
          allowClear
          style={{ width: '100%' }}
        />
      </div>

      {advancedOpen && (
        <>
          <div style={{ flex: '0 1 200px', minWidth: 180 }}>
            <Input
              value={channelsRaw}
              onChange={(e) => setChannelsRaw(e.target.value)}
              onBlur={() =>
                onAdvancedChange({
                  ...advancedValues,
                  channels: parseCsv(channelsRaw),
                })
              }
              placeholder="输入渠道"
              allowClear
            />
          </div>
          <div style={{ flex: '0 1 200px', minWidth: 180 }}>
            <Input
              value={ipsRaw}
              onChange={(e) => setIpsRaw(e.target.value)}
              onBlur={() =>
                onAdvancedChange({
                  ...advancedValues,
                  ips: parseCsv(ipsRaw),
                })
              }
              placeholder="输入 IP"
              allowClear
            />
          </div>
          <div style={{ flex: '0 1 200px', minWidth: 180 }}>
            <Input
              value={accountIdsRaw}
              onChange={(e) => setAccountIdsRaw(e.target.value)}
              onBlur={() =>
                onAdvancedChange({
                  ...advancedValues,
                  account_ids: parseCsv(accountIdsRaw),
                })
              }
              placeholder="输入 Account ID"
              allowClear
            />
          </div>
        </>
      )}
    </Flex>
  )
}