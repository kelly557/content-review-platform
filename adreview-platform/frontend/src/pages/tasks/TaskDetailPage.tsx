import { useEffect, useMemo, useRef, useState } from 'react'
import {
  App,
  Button,
  Col,
  Drawer,
  Empty,
  Row,
  Space,
  Tag,
  Typography,
} from 'antd'
import {
  ArrowLeftOutlined,
  RobotOutlined,
} from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import { annotationsApi, reviewsApi } from '@/api/reviews'
import { materialsApi } from '@/api/materials'
import { useAuthStore } from '@/store'
import {
  DECISION_LABELS,
  TYPE_LABELS,
  WORKFLOW_MODE_LABELS,
  type Material,
  type MaterialVersion,
  type ReviewDecision,
  type ReviewTask,
} from '@/types/domain'
import TaskListPanel from '@/components/task-detail/TaskListPanel'
import PreviewEditor from '@/components/task-detail/PreviewEditor'
import AgentReviewPanel from '@/components/task-detail/AgentReviewPanel'
import HumanActionPanel from '@/components/task-detail/HumanActionPanel'
import StickyDecisionBar from '@/components/task-detail/StickyDecisionBar'
import { colors } from '@/styles/theme'

const { Title } = Typography

type LayoutMode = 'triple' | 'double' | 'drawer'

function useLayoutMode(): LayoutMode {
  const [mode, setMode] = useState<LayoutMode>(() => detect())

  useEffect(() => {
    const onResize = () => setMode(detect())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return mode
}

function detect(): LayoutMode {
  if (typeof window === 'undefined') return 'triple'
  const w = window.innerWidth
  if (w >= 1200) return 'triple'
  if (w >= 992) return 'double'
  return 'drawer'
}

const RISK_COLOR_HEX: Record<string, string> = {
  高风险: colors.destructive,
  中风险: colors.warning,
  低风险: colors.success,
  敏感: colors.accent,
  无风险: colors.muted,
}

const RISK_SOFT: Record<string, string> = {
  高风险: colors.dangerSoft,
  中风险: colors.warningSoft,
  低风险: colors.successSoft,
  敏感: colors.accentSoft,
  无风险: colors.surface2,
}

export default function TaskDetailPage() {
  const { message, modal } = App.useApp()
  const { id: routeId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const layoutMode = useLayoutMode()

  const [task, setTask] = useState<ReviewTask | null>(null)
  const [material, setMaterial] = useState<Material | null>(null)
  const [version, setVersion] = useState<MaterialVersion | null>(null)
  const [annotationRefreshKey, setAnnotationRefreshKey] = useState(0)
  const [annotationCount, setAnnotationCount] = useState(0)
  const [isDirty, setIsDirty] = useState(false)
  const [rightDrawerOpen, setRightDrawerOpen] = useState(false)
  const [triggeringMachineReview, setTriggeringMachineReview] = useState(false)
  const [auditItemIds, setAuditItemIds] = useState<number[]>([])
  const [note, setNote] = useState('')
  const rightPanelRef = useRef<HTMLDivElement>(null)

  const taskId = routeId ? Number(routeId) : undefined

  const fetchTask = async (id: number) => {
    const t = await reviewsApi.task(id)
    setTask(t)
    setIsDirty(false)
    const m = await materialsApi.get(t.material_id)
    setMaterial(m)
    const v =
      m.versions.find((x) => x.id === t.material_version_id) ??
      m.versions[m.versions.length - 1] ??
      null
    setVersion(v ?? null)
    if (v) {
      try {
        const annRes = await annotationsApi.list(v.id, 1, 1)
        setAnnotationCount(annRes.total)
      } catch {
        setAnnotationCount(0)
      }
    } else {
      setAnnotationCount(0)
    }
  }

  useEffect(() => {
    if (!taskId) {
      navigate('/tasks', { replace: true })
      return
    }
    fetchTask(taskId).catch(() => {
      message.error('加载任务失败')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId])

  useEffect(() => {
    if (!taskId) return
    if (task?.review_type !== 'machine') return
    const status = task?.machine_status
    if (status !== 'pending' && status !== 'running') return

    let cancelled = false
    let count = 0
    const tick = async () => {
      if (cancelled) return
      if (count++ >= 15) return
      try {
        const fresh = await reviewsApi.task(taskId)
        if (cancelled) return
        setTask(fresh)
        const next = fresh.machine_status
        if (next === 'pending' || next === 'running') {
          setTimeout(tick, 2000)
        }
      } catch {
        /* ignore polling errors */
      }
    }
    const timer = setTimeout(tick, 2000)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [taskId, task?.review_type, task?.machine_status])

  const switchTask = (nextId: number) => {
    if (nextId === taskId) return
    const doSwitch = () => navigate(`/tasks/${nextId}`)
    if (isDirty) {
      modal.confirm({
        title: '切换任务将丢弃未提交的审核意见',
        content: '当前任务有未保存的内容，是否继续？',
        okText: '丢弃并切换',
        cancelText: '留在当前任务',
        onOk: doSwitch,
      })
      return
    }
    doSwitch()
  }

  const onDecide = async (
    decision: ReviewDecision,
    options: { auditItemIds?: number[]; note?: string },
  ) => {
    if (!task) return
    if (
      !task.assignments.find(
        (a) => a.assignee_id === user?.id && a.decision === 'pending',
      )
    ) {
      message.warning('当前阶段没有您的待办')
      return
    }
    await reviewsApi.decide(task.id, decision, {
      note: options.note,
      auditItemIds: options.auditItemIds ?? [],
    })
    message.success('已提交决定')
    setIsDirty(false)
    fetchTask(task.id)
  }

  const onAnnotationChanged = () => {
    setAnnotationRefreshKey((k) => k + 1)
    setAnnotationCount((c) => c + 1)
  }

  const onTriggerMachineReview = async () => {
    if (!task) return
    setTriggeringMachineReview(true)
    try {
      await reviewsApi.triggerMachineReview(task.id)
      message.success('AI 审核已触发')
      fetchTask(task.id)
    } catch (e) {
      const err = e as { response?: { data?: { detail?: string } }; message?: string }
      message.error(err.response?.data?.detail || err.message || '触发失败')
    } finally {
      setTriggeringMachineReview(false)
    }
  }

  const downloadUrl = useMemo(() => {
    if (!task || !version) return null
    return materialsApi.downloadUrl(task.material_id, version.id)
  }, [task, version])

  const existingAuditItemIds = useMemo(() => {
    if (!task || !user) return []
    const decided = task.assignments.find(
      (a) => a.assignee_id === user.id && a.decision !== 'pending',
    )
    return decided?.audit_items?.map((x) => x.audit_item_id) ?? []
  }, [task, user?.id])

  if (!task || !material) {
    return <Empty description="加载中" />
  }

  const hasPendingAssignment = !!task.assignments.find(
    (a) => a.assignee_id === user?.id && a.decision === 'pending',
  )
  const isMachineWithResult =
    task.review_type === 'machine' &&
    (task.machine_status === 'completed' || task.machine_status === 'failed')

  const canDecide =
    hasPendingAssignment ||
    (isMachineWithResult && !!user && ['admin', 'superadmin', 'reviewer', 'mlr'].includes(user.role))

  const decisionTagColor =
    task.final_decision === 'approved'
      ? 'success'
      : task.final_decision === 'rejected'
        ? 'error'
        : task.final_decision === 'returned'
          ? 'warning'
          : task.final_decision === 'canceled'
            ? 'default'
            : 'processing'

  const workflowMode = task.workflow_mode ?? 'machine_only'
  const isHybrid = workflowMode === 'machine_then_human'

  const riskLevel = task.agent_review?.risk_level

  const renderRightPanel = () => {
    const isMachineReview = task.review_type === 'machine'
    return (
      <div
        ref={rightPanelRef}
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          background: colors.surface,
          borderLeft: `1px solid ${colors.border}`,
        }}
      >
        <div
          style={{
            flex: isMachineReview ? '1 1 100%' : '0 0 55%',
            minHeight: 0,
            borderBottom: isMachineReview
              ? 'none'
              : `1px solid ${colors.border}`,
            overflow: 'auto',
          }}
        >
          <AgentReviewPanel
            result={task.agent_review}
            task={task}
            onTriggerMachineReview={onTriggerMachineReview}
            triggering={triggeringMachineReview}
          />
        </div>
        {(!isMachineReview ||
          task.machine_status === 'completed' ||
          task.machine_status === 'failed') && (
          <div
            style={{
              flex: '0 0 45%',
              minHeight: 0,
              overflow: 'auto',
              background: colors.surface2,
            }}
          >
            <HumanActionPanel
              canDecide={canDecide}
              hits={task.agent_review?.hits ?? []}
              existingAuditItemIds={existingAuditItemIds}
              materialType={material.material_type}
              auditItemIds={auditItemIds}
              onAuditItemsChange={setAuditItemIds}
              onNoteChange={setNote}
              onDirtyChange={setIsDirty}
            />
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      {/* Compact header: title + risk chip + tags + danger action */}
      <div
        style={{
          width: '100%',
          padding: '10px 14px',
          background: '#fff',
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            rowGap: 6,
            columnGap: 12,
          }}
        >
          <Space size={8} wrap>
            <Button
              icon={<ArrowLeftOutlined />}
              onClick={() => navigate('/tasks')}
              size="small"
            >
              返回任务列表
            </Button>
            <Title level={5} style={{ margin: 0 }} ellipsis={{ tooltip: task.title }}>
              {task.title}
            </Title>
            {riskLevel && (
              <Tag
                style={{
                  margin: 0,
                  fontSize: 12,
                  background: RISK_SOFT[riskLevel] ?? colors.surface2,
                  color: RISK_COLOR_HEX[riskLevel] ?? colors.muted,
                  borderColor: RISK_COLOR_HEX[riskLevel] ?? colors.border,
                }}
              >
                {riskLevel}
              </Tag>
            )}
            <Tag color={isHybrid ? 'purple' : 'blue'} style={{ margin: 0 }}>
              {WORKFLOW_MODE_LABELS[workflowMode]}
            </Tag>
            <Tag color={decisionTagColor} style={{ margin: 0 }}>
              {DECISION_LABELS[task.final_decision]}
            </Tag>
            <Tag style={{ margin: 0 }}>{TYPE_LABELS[material.material_type]}</Tag>
          </Space>

          <Space size={8} wrap>
            <Button
              size="small"
              icon={<RobotOutlined />}
              onClick={() => {
                if (layoutMode === 'triple') {
                  rightPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                } else {
                  setRightDrawerOpen(true)
                }
              }}
            >
              AI 结论 & 处理动作
            </Button>
          </Space>
        </div>
      </div>

      <div style={{ height: 'calc(100vh - 220px)', minHeight: 520 }}>
        {layoutMode === 'triple' ? (
          <Row gutter={12} style={{ height: '100%' }}>
            <Col span={6} style={{ height: '100%' }}>
              <div
                style={{
                  height: '100%',
                  background: '#fff',
                  border: `1px solid ${colors.border}`,
                  borderRadius: 8,
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: 0,
                }}
              >
                <TaskListPanel currentTaskId={task.id} onSelect={switchTask} />
              </div>
            </Col>
            <Col span={12} style={{ height: '100%' }}>
              <div
                style={{
                  height: '100%',
                  background: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 8,
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: 0,
                }}
              >
                <PreviewEditor
                  task={task}
                  materialType={material.material_type}
                  downloadUrl={downloadUrl}
                  textBody={version?.text_body ?? null}
                  readOnly={!canDecide}
                  annotationRefreshKey={annotationRefreshKey}
                  annotationCount={annotationCount}
                  onAnnotationChanged={onAnnotationChanged}
                />
              </div>
            </Col>
            <Col span={6} style={{ height: '100%' }}>
              {renderRightPanel()}
            </Col>
          </Row>
        ) : layoutMode === 'double' ? (
          <Row gutter={12} style={{ height: '100%' }}>
            <Col span={7} style={{ height: '100%' }}>
              <div
                style={{
                  height: '100%',
                  background: '#fff',
                  border: `1px solid ${colors.border}`,
                  borderRadius: 8,
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: 0,
                }}
              >
                <TaskListPanel currentTaskId={task.id} onSelect={switchTask} />
              </div>
            </Col>
            <Col span={17} style={{ height: '100%' }}>
              <div
                style={{
                  height: '100%',
                  background: '#fff',
                  border: `1px solid ${colors.border}`,
                  borderRadius: 8,
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: 0,
                }}
              >
                <PreviewEditor
                  task={task}
                  materialType={material.material_type}
                  downloadUrl={downloadUrl}
                  textBody={version?.text_body ?? null}
                  readOnly={!canDecide}
                  annotationRefreshKey={annotationRefreshKey}
                  annotationCount={annotationCount}
                  onAnnotationChanged={onAnnotationChanged}
                />
              </div>
            </Col>
          </Row>
        ) : (
          <div
            style={{
              height: '100%',
              background: '#fff',
              border: `1px solid ${colors.border}`,
              borderRadius: 8,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
            }}
          >
            <PreviewEditor
              task={task}
              materialType={material.material_type}
              downloadUrl={downloadUrl}
              textBody={version?.text_body ?? null}
              readOnly={!canDecide}
              annotationRefreshKey={annotationRefreshKey}
              annotationCount={annotationCount}
              onAnnotationChanged={onAnnotationChanged}
            />
          </div>
        )}
      </div>

      {layoutMode !== 'triple' && (
        <Drawer
          title={
            <Space>
              <RobotOutlined />
              <span>AI 结论 & 处理动作</span>
            </Space>
          }
          placement="right"
          width={420}
          open={rightDrawerOpen}
          onClose={() => setRightDrawerOpen(false)}
          styles={{ body: { padding: 0, height: '100%' } }}
        >
          {renderRightPanel()}
        </Drawer>
      )}

      <StickyDecisionBar
        taskId={task.id}
        taskTitle={task.title}
        isDirty={isDirty}
        canDecide={canDecide}
        onApprove={() => onDecide('approved', { auditItemIds, note })}
        onReject={() => onDecide('rejected', { auditItemIds, note })}
        badge={
          !canDecide
            ? '无可决策的待办'
            : hasPendingAssignment
              ? '当前阶段待办'
              : undefined
        }
      />
    </div>
  )
}
