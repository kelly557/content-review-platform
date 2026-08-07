import { api } from './client'
import type {
  UploadedDocument,
  UploadedDocumentListResponse,
  UploadedDocumentUpdate,
} from '@/types/domain'

export const uploadedDocumentsApi = {
  list(packageCode: string, itemId: number) {
    return api
      .get<UploadedDocumentListResponse>(
        `/packages/${packageCode}/items/${itemId}/documents`,
      )
      .then((r) => r.data)
  },

  /**
   * 上传一个或多个文件 (.pdf/.docx/.txt/.md/.xlsx/.csv)
   * 多文件并发上传由前端控制；后端按文件逐个落库并触发解析任务。
   */
  async upload(
    packageCode: string,
    itemId: number,
    files: File[],
  ): Promise<UploadedDocument[]> {
    const formData = new FormData()
    files.forEach((f) => formData.append('files', f, f.name))
    const res = await api.post<UploadedDocument[]>(
      `/packages/${packageCode}/items/${itemId}/documents`,
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    )
    return res.data
  },

  get(packageCode: string, itemId: number, docId: number) {
    return api
      .get<UploadedDocument>(
        `/packages/${packageCode}/items/${itemId}/documents/${docId}`,
      )
      .then((r) => r.data)
  },

  updatePrompt(
    packageCode: string,
    itemId: number,
    docId: number,
    body: UploadedDocumentUpdate,
  ) {
    return api
      .put<UploadedDocument>(
        `/packages/${packageCode}/items/${itemId}/documents/${docId}/prompt`,
        body,
      )
      .then((r) => r.data)
  },

  reparse(packageCode: string, itemId: number, docId: number) {
    return api
      .post<UploadedDocument>(
        `/packages/${packageCode}/items/${itemId}/documents/${docId}/reparse`,
      )
      .then((r) => r.data)
  },

  remove(packageCode: string, itemId: number, docId: number) {
    return api
      .delete(
        `/packages/${packageCode}/items/${itemId}/documents/${docId}`,
      )
      .then(() => undefined as void)
  },

  /** 文件直链 (浏览器自动加 Authorization 头) */
  downloadUrl(packageCode: string, itemId: number, docId: number) {
    return `/api/v1/packages/${packageCode}/items/${itemId}/documents/${docId}/download`
  },
}