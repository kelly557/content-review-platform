import { api } from './client'

export interface IngestPublishPayload {
  material_ids: number[]
  strategy_id?: number | null
  workflow_template_code?: string | null
  override_human_review?: Record<string, unknown> | null
}

export interface IngestPublishResponse {
  entry_id: string
  stream: string
  material_ids: number[]
}

export const ingestApi = {
  publish(payload: IngestPublishPayload) {
    return api
      .post<IngestPublishResponse>('/reviews/ingest/publish', payload)
      .then((r) => r.data)
  },
}