import { api } from './client'
import type { ReviewTask, ReviewDecision, Page, Annotation } from '@/types/domain'

export const reviewsApi = {
  myTasks(params?: {
    page?: number
    size?: number
    pending?: boolean
    scope?: 'assigned' | 'mine' | 'all'
  }) {
    return api.get<Page<ReviewTask>>('/reviews/tasks', { params }).then((r) => r.data)
  },
  task(id: number) {
    return api.get<ReviewTask>(`/reviews/tasks/${id}`).then((r) => r.data)
  },
  decide(taskId: number, decision: ReviewDecision, note?: string, commentBody?: string) {
    return api
      .post<ReviewTask>(`/reviews/tasks/${taskId}/decide`, {
        decision,
        note,
        comment_body: commentBody,
      })
      .then((r) => r.data)
  },
  transfer(taskId: number, toUserId: number, note?: string) {
    return api
      .post(`/reviews/tasks/${taskId}/transfer`, { to_user_id: toUserId, note })
      .then((r) => r.data)
  },
  addReviewer(taskId: number, userId: number, note?: string) {
    return api
      .post(`/reviews/tasks/${taskId}/add-reviewer`, { user_id: userId, note })
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
