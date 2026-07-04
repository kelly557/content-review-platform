import type { CSSProperties, ReactNode, RefCallback } from 'react'
import { Typography } from 'antd'
import { palette, radius, shadow, font } from '@/lib/theme'

const { Title, Text } = Typography

export interface SectionCardProps {
  /** Small uppercase eyebrow shown above title. */
  eyebrow?: string
  title?: ReactNode
  description?: ReactNode
  /** Right-side tool row. */
  extra?: ReactNode
  children: ReactNode
  style?: CSSProperties
  bodyPadding?: number | string
  accentBar?: boolean
  stepRef?: RefCallback<HTMLDivElement>
  isActive?: boolean
}

export default function SectionCard({
  eyebrow,
  title,
  description,
  extra,
  children,
  style,
  bodyPadding = 24,
  accentBar = false,
  stepRef,
  isActive = false,
}: SectionCardProps) {
  return (
    <section
      ref={stepRef}
      style={{
        background: palette.surface,
        border: `1px solid ${isActive ? palette.accent : palette.border}`,
        borderLeft: isActive ? `3px solid ${palette.accent}` : undefined,
        borderRadius: radius.lg,
        boxShadow: shadow.card,
        overflow: 'hidden',
        position: 'relative',
        transition: 'border-color 200ms ease, border-left 200ms ease',
        ...style,
      }}
    >
      {accentBar && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 2,
            background: `linear-gradient(90deg, ${palette.accent} 0%, transparent 60%)`,
          }}
        />
      )}
      {(eyebrow || title || extra) && (
        <header
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: 16,
            padding: '20px 24px 12px',
            borderBottom: `1px solid ${palette.border}`,
          }}
        >
          <div style={{ minWidth: 0 }}>
            {eyebrow && (
              <div
                style={{
                  fontFamily: font.sans,
                  fontSize: 11,
                  letterSpacing: '0.16em',
                  textTransform: 'uppercase',
                  color: palette.inkSubtle,
                  marginBottom: 4,
                }}
              >
                {eyebrow}
              </div>
            )}
            {title && (
              <Title
                level={4}
                style={{
                  margin: 0,
                  fontFamily: font.serif,
                  fontWeight: 600,
                  fontSize: 20,
                  color: palette.ink,
                  letterSpacing: '-0.005em',
                }}
              >
                {title}
              </Title>
            )}
            {description && (
              <Text
                style={{
                  display: 'block',
                  marginTop: 4,
                  color: palette.inkMuted,
                  fontSize: 13,
                }}
              >
                {description}
              </Text>
            )}
          </div>
          {extra && <div style={{ flexShrink: 0 }}>{extra}</div>}
        </header>
      )}
      <div style={{ padding: bodyPadding }}>{children}</div>
    </section>
  )
}
