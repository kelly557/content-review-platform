import { api } from './client'
import type { ReviewTask, ReviewDecision, Page, Annotation, MaterialType, ReviewType, MachineStatus } from '@/types/domain'

export const reviewsApi = {
  myTasks(params?: {
    page?: number
    size?: number
    pending?: boolean
    scope?: 'assigned' | 'mine' | 'all'
    q?: string
    material_type?: MaterialType
    review_type?: ReviewType
    status?: ReviewDecision
    machine_status?: MachineStatus
    sort_by?: string
    sort_order?: 'asc' | 'desc'
    created_after?: string
    created_before?: string
  }) {
    return api.get<Page<ReviewTask>>('/reviews/tasks', { params }).then((r) => r.data)
  },
  task(id: number) {
    return api.get<ReviewTask>(`/reviews/tasks/${id}`).then((r) => r.data)
  },
  decide(
    taskId: number,
    decision: ReviewDecision,
    options: { note?: string; tagIds?: string[]; auditItemIds?: number[] } = {},
  ) {
    return api
      .post<ReviewTask>(`/reviews/tasks/${taskId}/decide`, {
        decision,
        note: options.note,
        tag_ids: options.tagIds ?? [],
        audit_item_ids: options.auditItemIds ?? [],
      })
      .then((r) => r.data)
  },
  bulkDecide(taskIds: number[], decision: ReviewDecision, note?: string) {
    return api
      .post<{ success: number; failed: number; failed_ids: number[] }>('/reviews/tasks/bulk-decide', {
        task_ids: taskIds,
        decision,
        note,
      })
      .then((r) => r.data)
  },
  triggerMachineReview(taskId: number) {
    return api
      .post<{ message: string; task_id: number }>(`/reviews/tasks/${taskId}/trigger-machine-review`)
      .then((r) => r.data)
  },
  cancelTask(taskId: number, reason?: string) {
    return api
      .post<ReviewTask>(`/reviews/tasks/${taskId}/cancel`, { reason })
      .then((r) => r.data)
  },
}

export const annotationsApi = {
  list(versionId: number, page = 1, size = 100) {
    return api
      .get<Page<Annotation>>('/annotations', { params: { version_id: versionId, page, size } })
      .then((r) => r.data)
  },
  create(payload: {
    version_id: number
    body: string
    page?: number
    frame?: number
    timestamp_ms?: number
    x?: number
    y?: number
    w?: number
    h?: number
    quote?: string
    parent_id?: number
  }) {
    const { version_id, ...rest } = payload
    return api
      .post<Annotation>('/annotations', rest, { params: { version_id } })
      .then((r) => r.data)
  },
  resolve(id: number) {
    return api.patch<Annotation>(`/annotations/${id}/resolve`).then((r) => r.data)
  },
}
