# Phase 1: Step Progress & Navigation (Accordion Style)

## Overview

Add a visual step progress indicator at the top of the CreateTaskPage. All steps remain visible (accordion-style), with a sticky progress bar showing the user's current position. Users can click any step to scroll to it.

## Current Structure

```
CreateTaskPage.tsx (537 lines)
├── PageHero (title, subtitle)
├── Type Tabs (text/image/video/pdf/audio/package)
├── Two-column layout
│   ├── Left: SectionCards (Step 01, 02, 03)
│   └── Right: AnalysisPanel (sticky)
└── Action buttons (Cancel, Submit)
```

**Step structure:**
- Package mode: 2 steps (选择素材包 -> 审核配置)
- Normal mode: 3 steps (创建方式与素材来源 -> 素材 -> 审核配置)

## Implementation Plan

### 1. Create `StepProgress.tsx` Component

**File:** `frontend/src/components/task-create/StepProgress.tsx`

**Design:**
```
┌─────────────────────────────────────────────────────────────┐
│  创建流程                                    步骤 2 / 3     │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━               │
│                                                             │
│    ✓               ●               ○                        │
│  创建方式          素材            审核配置                   │
└─────────────────────────────────────────────────────────────┘
```

**Props:**
```typescript
interface StepProgressItem {
  key: string
  label: string
  completed: boolean
}

interface StepProgressProps {
  steps: StepProgressItem[]
  currentStep: number
  onStepClick?: (stepIndex: number) => void
  style?: CSSProperties
}
```

**Features:**
- Sticky positioning (top: 80px, same as AnalysisPanel)
- Progress bar with animated width transition
- Step indicators: completed (checkmark green), current (filled accent), upcoming (empty gray)
- Clickable completed/current steps to scroll
- Progress text: "步骤 X / Y"
- Touch targets >= 44x44px
- Uses existing theme tokens (palette, font, radius)

**Styling:**
- Background: `palette.surface`
- Border: `palette.border`
- Current step: `palette.accent` background
- Completed step: `palette.success` background with checkmark SVG
- Upcoming step: `palette.surface` background with `palette.border` border
- Font: `font.sans` for labels, uppercase eyebrow
- Transitions: 200ms ease for color/background changes

### 2. Modify `SectionCard.tsx`

**Changes:**
- Add optional `stepRef` prop for scroll targeting
- Add optional `isActive` prop for visual highlight
- When `isActive` is true, add subtle left border accent (3px solid accent)

```typescript
interface SectionCardProps {
  // ... existing props
  stepRef?: React.RefObject<HTMLDivElement>
  isActive?: boolean
}
```

### 3. Modify `CreateTaskPage.tsx`

**New state and refs:**
```typescript
const [currentStep, setCurrentStep] = useState(0)
const stepRefs = useRef<(HTMLDivElement | null)[]>([])
```

**Step definition (computed):**
```typescript
const steps = useMemo(() => {
  if (isPackageTab) {
    return [
      { key: 'package', label: '选择素材包', completed: selectedPackageId !== null },
      { key: 'config', label: '审核配置', completed: false },
    ]
  }
  return [
    { key: 'mode', label: '创建方式', completed: uploadItems.length > 0 || pickedIds.length > 0 },
    { key: 'material', label: '素材', completed: uploadItems.length > 0 || pickedIds.length > 0 },
    { key: 'config', label: '审核配置', completed: false },
  ]
}, [isPackageTab, uploadItems.length, pickedIds.length, selectedPackageId])
```

**Scroll handler:**
```typescript
const handleStepClick = (index: number) => {
  const ref = stepRefs.current[index]
  if (ref) {
    ref.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setCurrentStep(index)
  }
}
```

**IntersectionObserver for auto-tracking:**
```typescript
useEffect(() => {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const index = stepRefs.current.indexOf(entry.target as HTMLDivElement)
          if (index !== -1) setCurrentStep(index)
        }
      })
    },
    { rootMargin: '-20% 0px -60% 0px', threshold: 0.1 }
  )
  stepRefs.current.forEach((ref) => {
    if (ref) observer.observe(ref)
  })
  return () => observer.disconnect()
}, [steps.length])
```

**Layout changes:**
- Add `StepProgress` between Type Tabs and two-column layout
- Add `stepRef` to each `SectionCard`
- Add `isActive={currentStep === index}` to each `SectionCard`

### 4. Keyboard Navigation

```typescript
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight' && currentStep < steps.length - 1) {
      handleStepClick(currentStep + 1)
    } else if (e.key === 'ArrowLeft' && currentStep > 0) {
      handleStepClick(currentStep - 1)
    }
  }
  window.addEventListener('keydown', handleKeyDown)
  return () => window.removeEventListener('keydown', handleKeyDown)
}, [currentStep, steps.length])
```

### 5. Responsive Design

**Desktop (>= 768px):**
- Horizontal step progress bar with full labels
- Sticky positioning

**Mobile (< 768px):**
- Compact progress bar: smaller circles (36px), smaller font (12px)
- Labels may truncate with ellipsis
- Progress bar remains sticky

### 6. Accessibility

**ARIA attributes:**
- `role="navigation"` on container
- `aria-label` on nav: "创建流程进度"
- `aria-current="step"` on current step button
- `aria-label` on each step button: "创建方式（当前步骤）"

**Keyboard:**
- Left/Right arrows to navigate steps
- Tab to focus step buttons
- Visible focus rings on step buttons

## Files to Create/Modify

| File | Action | Est. Lines |
|------|--------|------------|
| `components/task-create/StepProgress.tsx` | Create | ~150 |
| `components/task-create/SectionCard.tsx` | Modify | +20 |
| `pages/tasks/CreateTaskPage.tsx` | Modify | +80 |

## Implementation Order

1. Create `StepProgress.tsx` component
2. Modify `SectionCard.tsx` to add `stepRef` and `isActive` props
3. Modify `CreateTaskPage.tsx`:
   - Add `currentStep` state and `stepRefs`
   - Add `steps` computed value
   - Add `IntersectionObserver` effect
   - Add keyboard navigation effect
   - Add `handleStepClick` function
   - Render `StepProgress` component
   - Pass `stepRef` and `isActive` to each `SectionCard`
4. Run `npm run typecheck` and `npm run build`

## Visual Design Details

**StepProgress component:**
- Container: white background, border, rounded corners, sticky
- Progress bar: 2px height, gray background, accent fill with transition
- Step circles: 44x44px, border 2px
  - Completed: green background, white checkmark SVG
  - Current: accent background, white number
  - Upcoming: white background, gray border, gray number
- Labels: 13px, current is bold, completed is green
- Progress text: "步骤 X / Y" in top right

**SectionCard active state:**
- Left border: 3px solid accent when active
- Smooth transition on border color

## Testing Checklist

- [ ] Step progress shows correct number of steps (2 for package, 3 for normal)
- [ ] Clicking completed/current step scrolls to section smoothly
- [ ] Current step updates as user scrolls (IntersectionObserver)
- [ ] Keyboard navigation works (Left/Right arrows)
- [ ] Progress bar width animates smoothly
- [ ] Step indicators show correct state (completed/current/upcoming)
- [ ] Responsive layout works on mobile (< 768px)
- [ ] ARIA attributes are correct
- [ ] Typecheck passes (`npm run typecheck`)
- [ ] Build succeeds (`npm run build`)
