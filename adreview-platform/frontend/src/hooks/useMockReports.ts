import { useCallback, useMemo } from 'react'
import { useLocalStorageState } from './useLocalStorageState'

const STORAGE_KEY = 'adreview.reports.mock.v1'

interface MockReportsState {
  enabled: boolean
  /** 重新生成按钮使用 — 变化时所有 mock 调用重新洗牌 */
  seed: number
}

const DEFAULT_STATE: MockReportsState = {
  enabled: true,
  seed: 0xc1d2e3f4,
}

/**
 * 报表 mock 演示数据开关。
 *
 * - 开关状态与 seed 一起持久化在 localStorage；
 * - ReportsPage 顶部「演示数据」Switch 调用 ``setEnabled``；
 * - 「重新生成」按钮调用 ``regenerate``，所有 mock 调用读这个 seed。
 */
export function useMockReports() {
  const [state, setState] = useLocalStorageState<MockReportsState>(STORAGE_KEY, DEFAULT_STATE)

  const setEnabled = useCallback(
    (enabled: boolean) => {
      setState((s) => ({ ...s, enabled }))
    },
    [setState],
  )

  const regenerate = useCallback(() => {
    setState((s) => ({ ...s, seed: (s.seed * 1103515245 + 12345) >>> 0 }))
  }, [setState])

  const toggle = useCallback(() => {
    setState((s) => ({ ...s, enabled: !s.enabled }))
  }, [setState])

  return useMemo(
    () => ({
      enabled: state.enabled,
      seed: state.seed,
      setEnabled,
      toggle,
      regenerate,
    }),
    [state.enabled, state.seed, setEnabled, toggle, regenerate],
  )
}
