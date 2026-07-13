import { useEffect, useState } from 'react'
import { DatePicker, Flex, Input, Select } from 'antd'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import {
  DETECTION_MODALITIES,
  FEEDBACK_OPTIONS,
  MACHINE_DECISION_OPTIONS,
  type DetectionModality,
  type MachineDecision,
  type QueryFilters,
  type ReviewDecision,
} from '@/types/domain'
import StrategySelect from './StrategySelect'

const { RangePicker } = DatePicker

export interface FilterBarProps {
  value: QueryFilters
  onChange: (next: QueryFilters) => void
  labelOptions: string[]
}

function parseCsv(s: string): number[] {
  if (!s.trim()) return []
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n))
}

export default function FilterBar({ value, onChange, labelOptions }: FilterBarProps) {
  const [requestIdsRaw, setRequestIdsRaw] = useState((value.request_ids ?? []).join(','))
  const [taskIdsRaw, setTaskIdsRaw] = useState((value.task_ids ?? []).join(','))

  useEffect(() => {
    setRequestIdsRaw((value.request_ids ?? []).join(','))
    setTaskIdsRaw((value.task_ids ?? []).join(','))
  }, [value.request_ids, value.task_ids])

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
        <div style={{ marginBottom: 4, fontSize: 12, color: '#64748B' }}>请求时间</div>
        <RangePicker
          value={rangeValue}
          onChange={setRange}
          style={{ width: '100%' }}
          allowClear
        />
      </div>

      <div style={{ flex: '1 1 240px', minWidth: 220 }}>
        <div style={{ marginBottom: 4, fontSize: 12, color: '#64748B' }}>检测模态</div>
        <Select<DetectionModality[]>
          mode="multiple"
          value={value.material_types ?? []}
          onChange={(v) => onChange({ ...value, material_types: v.length ? v : undefined })}
          options={DETECTION_MODALITIES}
          placeholder="全部模态"
          allowClear
          maxTagCount="responsive"
          style={{ width: '100%' }}
        />
      </div>

      <div style={{ flex: '1 1 240px', minWidth: 220 }}>
        <div style={{ marginBottom: 4, fontSize: 12, color: '#64748B' }}>审核策略</div>
        <StrategySelect
          value={value.strategy_code}
          onChange={(v) => onChange({ ...value, strategy_code: v })}
        />
      </div>

      <div style={{ flex: '1 1 200px', minWidth: 180 }}>
        <div style={{ marginBottom: 4, fontSize: 12, color: '#64748B' }}>检测结果</div>
        <Select<MachineDecision | undefined>
          value={value.machine_decision}
          onChange={(v) => onChange({ ...value, machine_decision: v })}
          options={[
            { value: undefined as unknown as MachineDecision, label: '全部' },
            ...MACHINE_DECISION_OPTIONS,
          ]}
          placeholder="全部"
          allowClear
          style={{ width: '100%' }}
        />
      </div>

      <div style={{ flex: '1 1 240px', minWidth: 220 }}>
        <div style={{ marginBottom: 4, fontSize: 12, color: '#64748B' }}>Request ID</div>
        <Input
          value={requestIdsRaw}
          onChange={(e) => setRequestIdsRaw(e.target.value)}
          onBlur={() =>
            onChange({ ...value, request_ids: parseCsv(requestIdsRaw) })
          }
          placeholder="多个以英文逗号分隔"
          allowClear
        />
      </div>

      <div style={{ flex: '1 1 200px', minWidth: 180 }}>
        <div style={{ marginBottom: 4, fontSize: 12, color: '#64748B' }}>Task ID</div>
        <Input
          value={taskIdsRaw}
          onChange={(e) => setTaskIdsRaw(e.target.value)}
          onBlur={() => onChange({ ...value, task_ids: parseCsv(taskIdsRaw) })}
          placeholder="请输入 Task ID"
          allowClear
        />
      </div>

      <div style={{ flex: '1 1 240px', minWidth: 220 }}>
        <div style={{ marginBottom: 4, fontSize: 12, color: '#64748B' }}>文本内容</div>
        <Input
          value={value.text_contains ?? ''}
          onChange={(e) =>
            onChange({ ...value, text_contains: e.target.value || undefined })
          }
          placeholder="请输入文本内容"
          allowClear
        />
      </div>

      <div style={{ flex: '1 1 240px', minWidth: 220 }}>
        <div style={{ marginBottom: 4, fontSize: 12, color: '#64748B' }}>审核点</div>
        <Select<string[]>
          mode="multiple"
          value={value.labels ?? []}
          onChange={(v) => onChange({ ...value, labels: v.length ? v : undefined })}
          options={labelOptions.map((l) => ({ value: l, label: l }))}
          placeholder="请选择审核点"
          allowClear
          maxTagCount="responsive"
          style={{ width: '100%' }}
        />
      </div>

      <div style={{ flex: '1 1 200px', minWidth: 180 }}>
        <div style={{ marginBottom: 4, fontSize: 12, color: '#64748B' }}>反馈结果</div>
        <Select<ReviewDecision | undefined>
          value={value.feedback}
          onChange={(v) => onChange({ ...value, feedback: v })}
          options={[
            { value: undefined as unknown as ReviewDecision, label: '全部' },
            ...FEEDBACK_OPTIONS,
          ]}
          placeholder="全部"
          allowClear
          style={{ width: '100%' }}
        />
      </div>
    </Flex>
  )
}