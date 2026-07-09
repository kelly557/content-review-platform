import { api } from './client'
import type { MachineReviewRecord, QueryFilters } from '@/types/domain'

export interface QueryPage<T> {
  items: T[]
  total: number
  page: number
  size: number
}

function buildParams(filters: QueryFilters) {
  const params: Record<string, string | number | string[] | undefined> = {}
  if (filters.start) params.start = filters.start
  if (filters.end) params.end = filters.end
  if (filters.material_types?.length) params.material_types = filters.material_types as string[]
  if (filters.strategy_code) params.strategy_code = filters.strategy_code
  if (filters.machine_decision) params.machine_decision = filters.machine_decision
  if (filters.request_ids?.length) params.request_ids = filters.request_ids.join(',')
  if (filters.task_ids?.length) params.task_ids = filters.task_ids.join(',')
  if (filters.text_contains) params.text_contains = filters.text_contains
  if (filters.labels?.length) params.labels = filters.labels
  if (filters.feedback) params.feedback = filters.feedback
  if (filters.conditions?.length) params.conditions = JSON.stringify(filters.conditions)
  if (filters.page) params.page = filters.page
  if (filters.size) params.size = filters.size
  return params
}

export const queryApi = {
  results(filters: QueryFilters) {
    return api
      .get<QueryPage<MachineReviewRecord>>('/query/results', { params: buildParams(filters) })
      .then((r) => r.data)
  },
  exportCsvUrl(filters: Omit<QueryFilters, 'page' | 'size'>) {
    const qs = new URLSearchParams()
    if (filters.start) qs.set('start', filters.start)
    if (filters.end) qs.set('end', filters.end)
    if (filters.material_types?.length) {
      filters.material_types.forEach((v) => qs.append('material_types', v))
    }
    if (filters.strategy_code) qs.set('strategy_code', filters.strategy_code)
    if (filters.machine_decision) qs.set('machine_decision', filters.machine_decision)
    if (filters.request_ids?.length) qs.set('request_ids', filters.request_ids.join(','))
    if (filters.task_ids?.length) qs.set('task_ids', filters.task_ids.join(','))
    if (filters.text_contains) qs.set('text_contains', filters.text_contains)
    if (filters.labels?.length) {
      filters.labels.forEach((v) => qs.append('labels', v))
    }
    if (filters.feedback) qs.set('feedback', filters.feedback)
    if (filters.conditions?.length) qs.set('conditions', JSON.stringify(filters.conditions))
    return `${api.defaults.baseURL}/query/results/export.csv?${qs.toString()}`
  },
  labels() {
    return api.get<{ labels: string[] }>('/query/labels').then((r) => r.data)
  },
  strategies() {
    return api
      .get<{
        items: Array<{ id: number; code: string; name: string; scope: string; is_active: boolean }>
      }>('/query/strategies')
      .then((r) => r.data.items)
  },
}