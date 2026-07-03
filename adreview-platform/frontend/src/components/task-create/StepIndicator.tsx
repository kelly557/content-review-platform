import type { ReactNode } from 'react'
import { palette, font } from '@/lib/theme'

export interface StepOption<T extends string> {
  value: T
  label: string
  hint?: string
  icon?: ReactNode
}

export interface StepIndicatorProps<T extends string> {
  label: string
  step: 1 | 2
  value: T
  options: StepOption<T>[]
  onChange: (v: T) => void
}

export function StepIndicator<T extends string>({
  label,
  step,
  value,
  options,
  onChange,
}: StepIndicatorProps<T>) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontFamily: font.sans,
          fontSize: 11,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: palette.inkSubtle,
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 18,
            height: 18,
            borderRadius: '50%',
            border: `1px solid ${palette.borderStrong}`,
            color: palette.inkMuted,
            fontSize: 10,
            fontWeight: 600,
          }}
        >
          {step}
        </span>
        {label}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {options.map((opt) => {
          const active = opt.value === value
          return (
            <button
              type="button"
              key={opt.value}
              onClick={() => onChange(opt.value)}
              style={{
                appearance: 'none',
                cursor: 'pointer',
                padding: '8px 14px',
                borderRadius: 999,
                border: `1px solid ${active ? palette.accent : palette.border}`,
                background: active ? palette.accent : palette.surface,
                color: active ? '#FFFFFF' : palette.ink,
                fontFamily: font.sans,
                fontSize: 13,
                fontWeight: active ? 500 : 400,
                transition: 'all 120ms ease',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {opt.icon}
                {opt.label}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
