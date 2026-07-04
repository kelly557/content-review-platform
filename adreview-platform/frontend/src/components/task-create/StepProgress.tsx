import type { CSSProperties } from 'react'
import { palette, font, radius } from '@/lib/theme'

export interface StepProgressItem {
  key: string
  label: string
  completed: boolean
}

export interface StepProgressProps {
  steps: StepProgressItem[]
  currentStep: number
  onStepClick?: (stepIndex: number) => void
  style?: CSSProperties
}

export default function StepProgress({
  steps,
  currentStep,
  onStepClick,
  style,
}: StepProgressProps) {
  const progress = steps.length > 1 ? (currentStep / (steps.length - 1)) * 100 : 0

  return (
    <nav
      aria-label="创建流程进度"
      style={{
        background: palette.surface,
        border: `1px solid ${palette.border}`,
        borderRadius: radius.lg,
        padding: '20px 24px',
        position: 'sticky',
        top: 80,
        zIndex: 10,
        ...style,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <div
          style={{
            fontFamily: font.sans,
            fontSize: 11,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: palette.inkSubtle,
          }}
        >
          创建流程
        </div>
        <div
          style={{
            fontFamily: font.sans,
            fontSize: 12,
            color: palette.inkMuted,
          }}
        >
          步骤 {currentStep + 1} / {steps.length}
        </div>
      </div>

      <div
        style={{
          position: 'relative',
          height: 2,
          background: palette.border,
          borderRadius: 1,
          marginBottom: 24,
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            height: '100%',
            width: `${progress}%`,
            background: palette.accent,
            borderRadius: 1,
            transition: 'width 300ms ease',
          }}
        />
      </div>

      <ol
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          listStyle: 'none',
          margin: 0,
          padding: 0,
        }}
      >
        {steps.map((step, index) => {
          const isCurrent = index === currentStep
          const isCompleted = step.completed
          const isClickable = isCompleted || isCurrent

          return (
            <li
              key={step.key}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <button
                type="button"
                onClick={() => isClickable && onStepClick?.(index)}
                disabled={!isClickable}
                aria-label={`${step.label}${isCurrent ? '（当前步骤）' : ''}${isCompleted ? '（已完成）' : ''}`}
                aria-current={isCurrent ? 'step' : undefined}
                style={{
                  appearance: 'none',
                  cursor: isClickable ? 'pointer' : 'default',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  border: `2px solid ${
                    isCurrent
                      ? palette.accent
                      : isCompleted
                        ? palette.success
                        : palette.border
                  }`,
                  background: isCurrent
                    ? palette.accent
                    : isCompleted
                      ? palette.success
                      : palette.surface,
                  color: isCurrent || isCompleted ? '#FFFFFF' : palette.inkMuted,
                  fontSize: 14,
                  fontWeight: 600,
                  transition: 'all 200ms ease',
                  minWidth: 44,
                  minHeight: 44,
                }}
              >
                {isCompleted ? (
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 20 20"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M5 10L8.5 13.5L15 7"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  index + 1
                )}
              </button>
              <div
                style={{
                  fontFamily: font.sans,
                  fontSize: 13,
                  fontWeight: isCurrent ? 600 : 400,
                  color: isCurrent ? palette.ink : isCompleted ? palette.success : palette.inkMuted,
                  textAlign: 'center',
                  transition: 'all 200ms ease',
                }}
              >
                {step.label}
              </div>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
