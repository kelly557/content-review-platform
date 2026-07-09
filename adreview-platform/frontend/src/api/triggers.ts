import { api } from './client'
import type { Page } from '@/types/domain'

export type TriggerTypeStr = 'cron' | 'external_callback'

export interface Trigger {
  id: number
  code: string
  name: string
  trigger_type: TriggerTypeStr
  is_enabled: boolean
  spec: Record<string, unknown>
  workflow_template_code: string | null
  strategy_id: number | null
  strategy_name: string | null
  match_conditions: Record<string, string[]>
  scan_interval_sec: number
  last_run_at: string | null
  next_run_at: string | null
  run_count: number
  last_error: string | null
  created_by: number | null
  created_at: string
  updated_at: string
}

export interface TriggerCreatePayload {
  code: string
  name: string
  trigger_type: TriggerTypeStr
  is_enabled: boolean
  spec: Record<string, unknown>
  workflow_template_code: string | null
  strategy_id: number | null
  match_conditions: Record<string, string[]>
  scan_interval_sec: number
}

export interface TriggerUpdatePayload {
  name?: string
  is_enabled?: boolean
  spec?: Record<string, unknown>
  workflow_template_code?: string | null
  strategy_id?: number | null
  match_conditions?: Record<string, string[]>
  scan_interval_sec?: number
}

export interface TriggerRun {
  id: number
  trigger_id: number
  source: string
  started_at: string
  finished_at: string | null
  status: string | null
  scanned_count: number
  created_count: number
  skipped_count: number
  failed_count: number
  error: string | null
  details: Record<string, unknown> | null
}

export const triggersApi = {
  list(params?: {
    page?: number
    size?: number
    trigger_type?: TriggerTypeStr
    is_enabled?: boolean
    q?: string
  }) {
    return api.get<Page<Trigger>>('/triggers', { params }).then((r) => r.data)
  },
  get(id: number) {
    return api.get<Trigger>(`/triggers/${id}`).then((r) => r.data)
  },
  create(payload: TriggerCreatePayload) {
    return api.post<Trigger>('/triggers', payload).then((r) => r.data)
  },
  update(id: number, payload: TriggerUpdatePayload) {
    return api.put<Trigger>(`/triggers/${id}`, payload).then((r) => r.data)
  },
  remove(id: number) {
    return api.delete(`/triggers/${id}`).then(() => null)
  },
  runNow(id: number) {
    return api.post<TriggerRun>(`/triggers/${id}/run`).then((r) => r.data)
  },
  listRuns(id: number, params?: { page?: number; size?: number }) {
    return api
      .get<{ items: TriggerRun[]; total: number }>(`/triggers/${id}/runs`, { params })
      .then((r) => r.data)
  },
}

// ── Webhook IP Allowlist ─────────────────────────────────────
export interface WebhookAllowlistEntry {
  id: number
  cidr: string
  label: string | null
  note: string | null
  is_enabled: boolean
  created_by: number | null
  created_at: string
}

export const webhookAllowlistApi = {
  list(params?: { page?: number; size?: number }) {
    return api.get<Page<WebhookAllowlistEntry>>('/webhook-allowlist', { params }).then((r) => r.data)
  },
  create(payload: { cidr: string; label?: string; note?: string; is_enabled?: boolean }) {
    return api.post<WebhookAllowlistEntry>('/webhook-allowlist', payload).then((r) => r.data)
  },
  update(
    id: number,
    payload: { cidr?: string; label?: string; note?: string; is_enabled?: boolean },
  ) {
    return api.put<WebhookAllowlistEntry>(`/webhook-allowlist/${id}`, payload).then((r) => r.data)
  },
  remove(id: number) {
    return api.delete(`/webhook-allowlist/${id}`).then(() => null)
  },
}