import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocalStorageState } from './useLocalStorageState'
import {
  DEFAULT_ANOMALY_THRESHOLDS,
  AnomalyThreshold,
} from '@/lib/anomalyThresholds'

// v3 key — 形态从 v2 (critical_threshold / warn_threshold / extra_condition
// 三个扁平字段) 改为 v3 (critical / warn 嵌套 + extra_conditions[]),
// v2 形态不可直接套用, 兜底 DEFAULT.
const STORAGE_KEY = 'adreview.anomaly_thresholds.v3'
const LEGACY_KEY_V1 = 'adreview.anomaly_thresholds.v1'
const LEGACY_KEY_V2 = 'adreview.anomaly_thresholds.v2'

function isV3Shape(value: unknown): value is AnomalyThreshold[] {
  if (!Array.isArray(value)) return false
  if (value.length === 0) return true
  const first = value[0]
  if (!first || typeof first !== 'object') return false
  return (
    typeof (first as Record<string, unknown>).critical === 'object' &&
    Array.isArray((first as Record<string, unknown>).extra_conditions)
  )
}

export function useAnomalyThresholds() {
  const [rawThresholds, setRawThresholds] = useLocalStorageState<AnomalyThreshold[]>(
    STORAGE_KEY,
    DEFAULT_ANOMALY_THRESHOLDS,
  )

  // 读到的不是 v3 形态时, 立刻清掉 localStorage 并 fallback DEFAULT.
  // 仅在挂载时跑一次.
  const [thresholds, setThresholds] = useState<AnomalyThreshold[]>(() => {
    if (!isV3Shape(rawThresholds)) {
      return DEFAULT_ANOMALY_THRESHOLDS
    }
    return rawThresholds
  })

  useEffect(() => {
    if (!isV3Shape(rawThresholds)) {
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.removeItem(STORAGE_KEY)
        } catch {
          // ignore
        }
      }
      setThresholds(DEFAULT_ANOMALY_THRESHOLDS)
    }
    // 只在挂载时跑一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const write = useCallback(
    (next: AnomalyThreshold[]) => {
      setThresholds(next)
      setRawThresholds(next)
    },
    [setRawThresholds],
  )

  const reset = useCallback(() => {
    write(DEFAULT_ANOMALY_THRESHOLDS)
  }, [write])

  const updateOne = useCallback(
    (code: string, patch: Partial<AnomalyThreshold>) => {
      write(
        thresholds.map((t) =>
          t.rule_code === code ? { ...t, ...patch, source: 'custom' } : t,
        ),
      )
    },
    [write, thresholds],
  )

  const toggleEnabled = useCallback(
    (code: string) => {
      const cur = thresholds.find((t) => t.rule_code === code)
      if (!cur) return
      write(
        thresholds.map((t) =>
          t.rule_code === code
            ? { ...t, enabled: !t.enabled, source: 'custom' }
            : t,
        ),
      )
    },
    [write, thresholds],
  )

  const addRule = useCallback(
    (rule: AnomalyThreshold) => {
      const normalized: AnomalyThreshold = {
        ...rule,
        threshold: rule.critical.value,
        unit: rule.critical.unit,
        source: 'custom',
      }
      write([...thresholds, normalized])
    },
    [write, thresholds],
  )

  const removeRule = useCallback(
    (code: string) => {
      write(thresholds.filter((t) => t.rule_code !== code))
    },
    [write, thresholds],
  )

  const setAll = useCallback(
    (next: AnomalyThreshold[]) => {
      write(next)
    },
    [write],
  )

  const summary = useMemo(
    () =>
      thresholds.map((t) => ({
        code: t.rule_code,
        threshold: t.threshold,
        unit: t.unit,
        enabled: t.enabled,
      })),
    [thresholds],
  )

  return { thresholds, updateOne, toggleEnabled, addRule, removeRule, setAll, reset, summary }
}

// 清理 v1 / v2 旧 key — 抽屉打开时主动调用一次.
export function purgeLegacyAnomalyThresholds() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(LEGACY_KEY_V1)
    window.localStorage.removeItem(LEGACY_KEY_V2)
  } catch {
    // ignore
  }
}
