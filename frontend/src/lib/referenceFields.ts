export interface ReferenceFormValues {
  product_sku?: string
  channels?: string[]
  industry?: string
  keyword?: string
}

/** 纯函数：用于 Collapse label 展示已填数量 */
export function countFilledReference(v: ReferenceFormValues | undefined): number {
  if (!v) return 0
  let n = 0
  if (v.product_sku && v.product_sku.trim()) n++
  if (v.channels && v.channels.length > 0) n++
  if (v.industry) n++
  if (v.keyword && v.keyword.trim()) n++
  return n
}