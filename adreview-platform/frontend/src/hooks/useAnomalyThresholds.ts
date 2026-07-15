import { useCallback, useMemo } from 'react'
import { useLocalStorageState } from './useLocalStorageState'
import {
  DEFAULT_ANOMALY_THRESHOLDS,
  AnomalyThreshold,
  AnomalyRuleCode,
} from '@/lib/anomalyThresholds'

const STORAGE_KEY = 'adreview.anomaly_thresholds.v1'

export function useAnomalyThresholds() {
  const [thresholds, setThresholds] = useLocalStorageState<
    Record<AnomalyRuleCode, AnomalyThreshold>
  >(STORAGE_KEY, DEFAULT_ANOMALY_THRESHOLDS)

  const reset = useCallback(() => {
    setThresholds(DEFAULT_ANOMALY_THRESHOLDS)
  }, [setThresholds])

  const updateOne = useCallback(
    (code: AnomalyRuleCode, patch: Partial<AnomalyThreshold>) => {
      setThresholds({
        ...thresholds,
        [code]: { ...thresholds[code], ...patch, source: 'custom' },
      })
    },
    [setThresholds, thresholds],
  )

  const setAll = useCallback(
    (next: Record<AnomalyRuleCode, AnomalyThreshold>) => {
      setThresholds(next)
    },
    [setThresholds],
  )

  const summary = useMemo(
    () =>
      (Object.values(thresholds) as AnomalyThreshold[]).map((t) => ({
        code: t.rule_code,
        threshold: t.threshold,
        severity: t.severity,
        unit: t.unit,
      })),
    [thresholds],
  )

  return { thresholds, updateOne, setAll, reset, summary }
}
