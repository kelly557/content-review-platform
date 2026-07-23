import { useState } from 'react'
import { colors } from '@/styles/theme'

export interface JsonTreeViewProps {
  data: unknown
  /** Initial expanded depth; deeper nodes are collapsed. Default 1. */
  initialDepth?: number
  /** Render as a top-level object (suppress outer curly brace). Default false. */
  isRoot?: boolean
  /** Optional indent override for children. */
  depth?: number
}

type JsonValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | JsonValue[]
  | { [key: string]: JsonValue }

const MONO_FONT =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace'

function isObject(v: unknown): v is Record<string, JsonValue> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function getEntries(v: Record<string, JsonValue> | JsonValue[]): [string, JsonValue][] {
  if (Array.isArray(v)) {
    return v.map((item, idx) => [String(idx), item])
  }
  return Object.keys(v).map((k) => [k, v[k]])
}

function formatStringValue(s: string): string {
  if (s.length > 80) return JSON.stringify(s.slice(0, 77) + '…')
  return JSON.stringify(s)
}

interface LeafProps {
  value: JsonValue
}

function Leaf({ value }: LeafProps) {
  if (value === null || value === undefined) {
    return (
      <span style={{ color: colors.jsonNull, fontStyle: 'italic' }}>
        {value === null ? 'null' : 'undefined'}
      </span>
    )
  }
  if (typeof value === 'string') {
    return (
      <span style={{ color: colors.jsonString }}>{formatStringValue(value)}</span>
    )
  }
  if (typeof value === 'number') {
    return (
      <span style={{ color: colors.jsonNumber }}>{String(value)}</span>
    )
  }
  if (typeof value === 'boolean') {
    return (
      <span style={{ color: colors.jsonBool }}>{value ? 'true' : 'false'}</span>
    )
  }
  return null
}

interface BranchProps {
  value: Record<string, JsonValue> | JsonValue[]
  depth: number
  initialExpanded: boolean
}

function Branch({ value, depth, initialExpanded }: BranchProps) {
  const [expanded, setExpanded] = useState(initialExpanded)
  const isArr = Array.isArray(value)
  const entries = getEntries(value)
  const count = entries.length
  const metaLabel = isArr ? `${count} item${count === 1 ? '' : 's'}` : `${count} item${count === 1 ? '' : 's'}`
  const brace = isArr ? '[' : '{'

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          background: 'transparent',
          border: 0,
          padding: 0,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          color: colors.jsonMeta,
          fontFamily: MONO_FONT,
          fontSize: 12,
        }}
        aria-expanded={expanded}
      >
        <span
          aria-hidden
          style={{
            display: 'inline-block',
            width: 10,
            textAlign: 'center',
            color: colors.jsonMeta,
            transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 120ms ease',
          }}
        >
          ▶
        </span>
        <span style={{ color: colors.jsonMeta, fontStyle: 'italic' }}>{brace}</span>
        {!expanded && (
          <span style={{ color: colors.jsonMeta, fontStyle: 'italic' }}>
            {metaLabel} {isArr ? ']' : '}'}
          </span>
        )}
      </button>
      {expanded && (
        <div
          style={{
            paddingLeft: 18,
            marginTop: 2,
            borderLeft: `1px dashed ${colors.border}`,
            marginLeft: 4,
          }}
        >
          {entries.map(([k, v], idx) => (
            <div key={`${k}-${idx}`} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline' }}>
              <span
                style={{
                  color: colors.jsonKey,
                  marginRight: 6,
                }}
              >
                "{k}"
              </span>
              <span style={{ color: colors.jsonMeta, marginRight: 6 }}>:</span>
              {isObject(v) || Array.isArray(v) ? (
                <Branch value={v} depth={depth + 1} initialExpanded={depth + 1 < 1} />
              ) : (
                <Leaf value={v} />
              )}
            </div>
          ))}
          <div style={{ color: colors.jsonMeta, fontStyle: 'italic' }}>{isArr ? ']' : '}'}</div>
        </div>
      )}
    </div>
  )
}

export default function JsonTreeView({
  data,
  initialDepth = 1,
  isRoot = false,
  depth = 0,
}: JsonTreeViewProps) {
  if (data === null || typeof data !== 'object') {
    return <Leaf value={data as JsonValue} />
  }
  const isArr = Array.isArray(data)
  const entries = getEntries(data as Record<string, JsonValue> | JsonValue[])
  const count = entries.length
  const brace = isArr ? '[' : '{'
  const closeBrace = isArr ? ']' : '}'
  const metaLabel = `${count} item${count === 1 ? '' : 's'}`

  return (
    <div>
      {isRoot && (
        <div style={{ color: colors.jsonMeta, fontStyle: 'italic', marginBottom: 4 }}>
          {brace} <span style={{ marginLeft: 6 }}>{metaLabel}</span>
        </div>
      )}
      <div
        style={{
          paddingLeft: isRoot ? 0 : 18,
          borderLeft: isRoot ? 'none' : `1px dashed ${colors.border}`,
          marginLeft: isRoot ? 0 : 4,
        }}
      >
        {entries.map(([k, v], idx) => (
          <div key={`${k}-${idx}`} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline' }}>
            <span style={{ color: colors.jsonKey, marginRight: 6 }}>
              "{k}"
            </span>
            <span style={{ color: colors.jsonMeta, marginRight: 6 }}>:</span>
            {isObject(v) || Array.isArray(v) ? (
              <Branch value={v} depth={depth + 1} initialExpanded={depth + 1 < initialDepth} />
            ) : (
              <Leaf value={v} />
            )}
          </div>
        ))}
        <div style={{ color: colors.jsonMeta, fontStyle: 'italic' }}>{closeBrace}</div>
      </div>
    </div>
  )
}