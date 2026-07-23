import { api } from './client'

export interface PageGuideOverride {
  path: string
  title: string
  markdown_md: string
  updated_by_id: number | null
  created_at: string
  updated_at: string
}

export const pageGuidesApi = {
  list: () => api.get<{ guides: PageGuideOverride[] }>('/page-guides'),
  upsert: (path: string, body: { title: string; markdown_md: string }) =>
    api.put<PageGuideOverride>(
      `/page-guides/${encodeURIComponent(path)}`,
      body,
    ),
  remove: (path: string) =>
    api.delete(`/page-guides/${encodeURIComponent(path)}`),
}
