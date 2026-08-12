import { api } from './client'

export interface AgentPoint {
  id?: string
  label: string
  desc?: string
}

export interface ReviewAgent {
  id: number
  public_id: string
  app_id: string
  name: string
  modality: string
  status: string
  model_id: number | null
  points: AgentPoint[] | null
  online_at: string | null
  published_at: string | null
  draft_saved_at: string | null
  current_version: string | null
  created_at: string
  updated_at: string | null
}

export interface ReviewAgentCreate {
  app_id: string
  name: string
  modality: string
  model_id?: number | null
  points?: AgentPoint[]
}

export interface ReviewAgentUpdate {
  name?: string
  modality?: string
  model_id?: number | null
  points?: AgentPoint[]
}

export interface AgentVersionSnapshot {
  modality: string
  name: string
  modelId?: string | null
  points: AgentPoint[]
}

export interface ReviewAgentVersion {
  id: number
  agent_id: number
  version: string
  status: string
  is_current: boolean
  snapshot: AgentVersionSnapshot | null
  published_at: string
}

export interface AgentTestResult {
  decision: 'pass' | 'block'
  latencyMs: number
  confidence: number
  triggered: { pointId: string; label: string; triggered: boolean }[]
  rawOutput: string
}

export const reviewAgentsApi = {
  list() {
    return api.get<ReviewAgent[]>('/review-agents').then((r) => r.data)
  },
  create(body: ReviewAgentCreate) {
    return api.post<ReviewAgent>('/review-agents', body).then((r) => r.data)
  },
  get(id: number) {
    return api.get<ReviewAgent>(`/review-agents/${id}`).then((r) => r.data)
  },
  update(id: number, body: ReviewAgentUpdate) {
    return api.put<ReviewAgent>(`/review-agents/${id}`, body).then((r) => r.data)
  },
  delete(id: number) {
    return api.delete<{ ok: boolean; id: number }>(`/review-agents/${id}`).then((r) => r.data)
  },
  listVersions(agentId: number) {
    return api
      .get<ReviewAgentVersion[]>(`/review-agents/${agentId}/versions`)
      .then((r) => r.data)
  },
  publish(agentId: number, snapshot: AgentVersionSnapshot) {
    return api
      .post<ReviewAgentVersion>(`/review-agents/${agentId}/publish`, snapshot)
      .then((r) => r.data)
  },
  unpublish(agentId: number) {
    return api
      .post<ReviewAgentVersion>(`/review-agents/${agentId}/unpublish`)
      .then((r) => r.data)
  },
  test(agentId: number, body: { modality: string; text: string; image_base64?: string; mode: string; points: AgentPoint[] }) {
    return api
      .post<AgentTestResult>(`/review-agents/${agentId}/test`, body)
      .then((r) => r.data)
  },
  aiOptimize(body: { direction: string; original_label?: string; docs_context?: string }) {
    return api
      .post<{
        original: string
        issues: { label: string; text: string }[]
        checklist: string[]
        scenarioNote: string
        cases: { note: string; examples: { kind: string; text: string }[] }
        direction: string
        finalTag: { name: string; description: string }
      }>('/review-agents/ai-optimize', body)
      .then((r) => r.data)
  },
}
