export const HR_PREFIX = 'hr_'

export function slugifyStrategyName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_\-]/g, '')
}

export function buildHrCode(name: string, existing: string[] = []): string {
  const slug = slugifyStrategyName(name)
  const base = slug ? `${HR_PREFIX}${slug}` : `${HR_PREFIX}strategy`
  const taken = new Set(existing.map((c) => c.toLowerCase()))
  if (!taken.has(base.toLowerCase())) return base
  let i = 2
  while (taken.has(`${base}_${i}`.toLowerCase())) {
    i += 1
  }
  return `${base}_${i}`
}
