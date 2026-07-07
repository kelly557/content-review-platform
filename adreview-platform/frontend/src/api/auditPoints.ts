import { api } from './client'
import type {
  AuditPoint,
  AuditPointBatchResult,
  AuditPointCreate,
  AuditPointUpdate,
} from '@/types/domain'

export const auditPointsApi = {
  list(
    packageCode: string,
    params?: { item_id?: number; enabled?: boolean },
  ) {
    return api
      .get<AuditPoint[]>(`/packages/${packageCode}/points`, { params })
      .then((r) => r.data)
  },
  create(packageCode: string, payload: AuditPointCreate) {
    return api
      .post<AuditPoint>(`/packages/${packageCode}/points`, payload)
      .then((r) => r.data)
  },
  createMany(
    packageCode: string,
    body: { item_id: number; points: AuditPointCreate[] },
  ) {
    return api
      .post<AuditPointBatchResult>(
        `/packages/${packageCode}/points/batch`,
        body,
      )
      .then((r) => r.data)
  },
  update(packageCode: string, pointId: number, payload: AuditPointUpdate) {
    return api
      .put<AuditPoint>(`/packages/${packageCode}/points/${pointId}`, payload)
      .then((r) => r.data)
  },
  remove(packageCode: string, pointId: number) {
    return api
      .delete(`/packages/${packageCode}/points/${pointId}`)
      .then(() => undefined as void)
  },
  reset(packageCode: string) {
    return api
      .post<{ items: AuditPoint[] }>(`/packages/${packageCode}/points/reset`)
      .then((r) => r.data)
  },
}
