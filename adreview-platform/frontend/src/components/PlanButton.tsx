import { useState } from 'react'
import { Button, Drawer, Grid } from 'antd'
import { CalendarOutlined } from '@ant-design/icons'
import { AGILE_PLAN_SECTIONS } from '@/lib/pageGuides'
import { SectionsView } from '@/components/PageGuideButton'

export function PlanButton() {
  const [open, setOpen] = useState(false)
  const screens = Grid.useBreakpoint()
  const isMobile = !screens.md

  return (
    <>
      <Button
        type="text"
        icon={<CalendarOutlined />}
        onClick={() => setOpen(true)}
        style={{ color: '#fff' }}
      >
        计划安排
      </Button>
      <Drawer
        title="30天 MVP 计划"
        placement="right"
        width={isMobile ? '100%' : '60vw'}
        open={open}
        onClose={() => setOpen(false)}
        destroyOnClose
      >
        <SectionsView sections={AGILE_PLAN_SECTIONS} />
      </Drawer>
    </>
  )
}