import { create } from 'zustand'

import { riskCategoriesApi, type RiskCategory } from '@/api/risk-categories'

interface RiskCategoryState {
  /** 字典 */
  items: RiskCategory[]
  loading: boolean
  loaded: boolean
  error: string | null

  /** 拉取一次（多次调用共享 in-flight promise） */
  ensureLoaded: () => Promise<void>
  /** 强制刷新 */
  refresh: () => Promise<void>
  /** 新建一条并插入 store */
  add: (item: RiskCategory) => void
}

export const useRiskCategoryStore = create<RiskCategoryState>((set, get) => {
  let inflight: Promise<void> | null = null

  const fetchAll = async () => {
    set({ loading: true, error: null })
    try {
      const items = await riskCategoriesApi.list()
      set({ items, loading: false, loaded: true })
    } catch (e: unknown) {
      const detail =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        '风险类型字典加载失败'
      set({ loading: false, error: detail })
    }
  }

  return {
    items: [],
    loading: false,
    loaded: false,
    error: null,

    ensureLoaded: async () => {
      const s = get()
      if (s.loaded || inflight) return inflight ?? Promise.resolve()
      inflight = fetchAll().finally(() => {
        inflight = null
      })
      return inflight
    },

    refresh: async () => {
      await fetchAll()
    },

    add: (item) => {
      set((s) =>
        s.items.some((x) => x.code === item.code) ? s : { items: [...s.items, item] },
      )
    },
  }
})

/** 派生：根据 code 查字典项（fallback null） */
export function useRiskCategoryByCode(code: string | null | undefined): RiskCategory | null {
  const items = useRiskCategoryStore((s) => s.items)
  if (!code) return null
  return items.find((c) => c.code === code) ?? null
}
