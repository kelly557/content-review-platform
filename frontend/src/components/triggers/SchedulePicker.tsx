import { useEffect, useMemo, useState } from 'react'
import { Alert, Checkbox, Collapse, Input, InputNumber, Radio, Select, Space, Typography } from 'antd'
import { parseCron, describeCron } from '@/lib/cronDescriber'

const { Text } = Typography

export interface SchedulePickerValue {
  /** 可视化选出来的 cron 字符串 */
  cron: string
  /** 扫描间隔（高级设置） */
  scanIntervalSec: number
}

export interface SchedulePickerProps {
  value?: SchedulePickerValue
  onChange?: (v: SchedulePickerValue) => void
  defaultScanIntervalSec?: number
}

const WEEKDAY_OPTIONS = [
  { value: 1, label: '一' },
  { value: 2, label: '二' },
  { value: 3, label: '三' },
  { value: 4, label: '四' },
  { value: 5, label: '五' },
  { value: 6, label: '六' },
  { value: 0, label: '日' },
]

const HOURS = Array.from({ length: 24 }, (_, i) => ({ value: i, label: pad2(i) }))
const MINUTES = Array.from({ length: 60 }, (_, i) => ({ value: i, label: pad2(i) }))

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

type Frequency = 'daily' | 'weekly' | 'monthly' | 'custom'

function freqFromCron(cron: string | undefined): Frequency {
  if (!cron) return 'daily'
  const desc = describeCron(cron)
  return desc.kind
}

function valueToCron(
  frequency: Frequency,
  hour: number,
  minute: number,
  weekdays: number[],
  dayOfMonth: number,
): string {
  if (frequency === 'custom') return ''
  if (frequency === 'daily') return `${pad2(minute)} ${pad2(hour)} * * *`
  if (frequency === 'weekly') {
    const wd = weekdays.length > 0 ? [...weekdays].sort((a, b) => a - b).join(',') : '1'
    return `${pad2(minute)} ${pad2(hour)} * * ${wd}`
  }
  // monthly
  return `${pad2(minute)} ${pad2(hour)} ${dayOfMonth} * *`
}

export default function SchedulePicker({
  value,
  onChange,
  defaultScanIntervalSec = 60,
}: SchedulePickerProps) {
  const cron = value?.cron ?? ''
  const parsed = parseCron(cron)
  const initialFrequency: Frequency = freqFromCron(cron) === 'custom' && !cron ? 'daily' : freqFromCron(cron)

  const [frequency, setFrequency] = useState<Frequency>(
    initialFrequency === 'custom' ? 'daily' : initialFrequency,
  )
  const [hour, setHour] = useState<number>(parsed?.hour ?? 9)
  const [minute, setMinute] = useState<number>(parsed?.minute ?? 0)
  const [weekdays, setWeekdays] = useState<number[]>(parsed?.weekdays ?? [1, 2, 3, 4, 5])
  const [dayOfMonth, setDayOfMonth] = useState<number>(parsed?.dayOfMonth ?? 1)
  const [scanIntervalSec, setScanIntervalSec] = useState<number>(
    value?.scanIntervalSec ?? defaultScanIntervalSec,
  )
  const [customCron, setCustomCron] = useState<string>(cron && freqFromCron(cron) === 'custom' ? cron : '')

  useEffect(() => {
    onChange?.({
      cron: valueToCron(frequency, hour, minute, weekdays, dayOfMonth),
      scanIntervalSec,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frequency, hour, minute, weekdays, dayOfMonth, scanIntervalSec])

  const previewCron = useMemo(
    () => valueToCron(frequency, hour, minute, weekdays, dayOfMonth),
    [frequency, hour, minute, weekdays, dayOfMonth],
  )
  const previewHuman = describeCron(previewCron).human

  const advancedItems = [
    {
      key: 'advanced',
      label: '高级设置',
      children: (
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              自定义时间规则（覆盖上面的可视化设置）
            </Text>
            <Input
              addonBefore="cron"
              placeholder="例如 0 9 * * *"
              value={customCron}
              onChange={(e) => setCustomCron(e.target.value)}
            />
          </div>
          <Alert
            type="info"
            showIcon
            message="每天都用 0 9 * * * 表示"
            description={
              <span>
                字段顺序：<strong>分 时 日 月 周</strong>。
                例如 <code>0 9 * * 1-5</code> = 每个工作日 09:00；
                <code>*/15 * * * *</code> = 每 15 分钟一次。
              </span>
            }
          />
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              每隔多少秒检查一次（不建议改）
            </Text>
            <InputNumber
              min={10}
              max={3600}
              value={scanIntervalSec}
              onChange={(v) => setScanIntervalSec(typeof v === 'number' ? v : 60)}
              addonAfter="秒"
              style={{ width: '100%' }}
            />
          </div>
        </Space>
      ),
    },
  ]

  return (
    <div>
      <Radio.Group
        value={frequency}
        onChange={(e) => setFrequency(e.target.value)}
        style={{ marginBottom: 16 }}
      >
        <Radio.Button value="daily">每天</Radio.Button>
        <Radio.Button value="weekly">每周</Radio.Button>
        <Radio.Button value="monthly">每月</Radio.Button>
      </Radio.Group>

      <div style={{ marginTop: 8 }}>
        {frequency === 'daily' && (
          <Space wrap>
            <span>在</span>
            <Select value={hour} onChange={setHour} options={HOURS} style={{ width: 80 }} />
            <span>:</span>
            <Select value={minute} onChange={setMinute} options={MINUTES} style={{ width: 80 }} />
          </Space>
        )}

        {frequency === 'weekly' && (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Checkbox.Group
              value={weekdays}
              onChange={(vals) => {
                if (Array.isArray(vals)) setWeekdays(vals as number[])
              }}
            >
              {WEEKDAY_OPTIONS.map((w) => (
                <Checkbox key={w.value} value={w.value} style={{ marginRight: 12 }}>
                  周{w.label}
                </Checkbox>
              ))}
            </Checkbox.Group>
            <Space wrap>
              <span>在</span>
              <Select value={hour} onChange={setHour} options={HOURS} style={{ width: 80 }} />
              <span>:</span>
              <Select value={minute} onChange={setMinute} options={MINUTES} style={{ width: 80 }} />
            </Space>
          </Space>
        )}

        {frequency === 'monthly' && (
          <Space wrap>
            <span>第</span>
            <InputNumber min={1} max={31} value={dayOfMonth} onChange={(v) => setDayOfMonth(typeof v === 'number' ? v : 1)} />
            <span>日 在</span>
            <Select value={hour} onChange={setHour} options={HOURS} style={{ width: 80 }} />
            <span>:</span>
            <Select value={minute} onChange={setMinute} options={MINUTES} style={{ width: 80 }} />
          </Space>
        )}
      </div>

      <div style={{ marginTop: 12, padding: '8px 12px', background: '#fafafa', borderRadius: 4 }}>
        <Text style={{ fontSize: 13 }}>
          当前规则：<strong>{previewHuman}</strong>{' '}
          <Text type="secondary" style={{ fontSize: 12 }}>
            （{previewCron}）
          </Text>
        </Text>
      </div>

      <Collapse items={advancedItems} style={{ marginTop: 16 }} />
    </div>
  )
}
