import { useEffect, useMemo, useRef, useState } from 'react'
import {
  App,
  Button,
  Col,
  Drawer,
  Empty,
  Input,
  Row,
  Space,
  Tag,
  Typography,
} from 'antd'
import {
  ArrowLeftOutlined,
  RobotOutlined,
  StopOutlined,
} from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import { reviewsApi, annotationsApi } from '@/api/reviews'
import { materialsApi } from '@/api/materials'
import { usersApi } from '@/api/admin'
import { tagsApi } from '@/api/tags'
import { useAuthStore } from '@/store'
import { canHandleTask } from '@/lib/permissions'
import {
  DECISION_LABELS,
  TYPE_LABELS,
  WORKFLOW_MODE_LABELS,
  type Material,
  type MaterialVersion,
  type ReviewDecision,
  type ReviewTask,
  type TagSummary,
  type User,
} from '@/types/domain'
import TaskListPanel from '@/components/task-detail/TaskListPanel'
import PreviewEditor from '@/components/task-detail/PreviewEditor'
import AgentReviewPanel from '@/components/task-detail/AgentReviewPanel'
import HumanActionPanel from '@/components/task-detail/HumanActionPanel'
import { colors } from '@/styles/theme'

const { Title, Text } = Typography

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

export default function TaskDetailPage() {
  const { message, modal } = App.useApp()
  const { id: routeId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const layoutMode = useLayoutMode()

  const [task, setTask] = useState<ReviewTask | null>(null)
  const [material, setMaterial] = useState<Material | null>(null)
  const [version, setVersion] = useState<MaterialVersion | null>(null)
  const [users, setUsers] = useState<User[]>([])
  const [availableTags, setAvailableTags] = useState<TagSummary[]>([])
  const [annotationRefreshKey, setAnnotationRefreshKey] = useState(0)
  const [annotationCount, setAnnotationCount] = useState(0)
  const [isDirty, setIsDirty] = useState(false)
  const [rightDrawerOpen, setRightDrawerOpen] = useState(false)
  const [triggeringMachineReview, setTriggeringMachineReview] = useState(false)
  const rightPanelRef = useRef<HTMLDivElement>(null)

  const taskId = routeId ? Number(routeId) : undefined

  const fetchTask = async (id: number) => {
    const t = await reviewsApi.task(id)
    setTask(t)
    setIsDirty(false)
    const m = await materialsApi.get(t.material_id)
    setMaterial(m)
    const v = m.versions.find((x) => x.id === t.material_version_id) ?? m.versions[m.versions.length - 1] ?? null
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
    if (canHandleTask(user)) {
      usersApi.list().then(setUsers).catch(() => {})
    }
    tagsApi
      .list({ page: 1, size: 200, status: 'active' })
      .then((res) => setAvailableTags(res.items))
      .catch(() => {})
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
        title: '切换任务将丢弃未提交的备注/评论',
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
    tagIds: string[],
    note?: string,
    commentBody?: string,
  ) => {
    if (!task) return
    if (!task.assignments.find((a) => a.assignee_id === user?.id && a.decision === 'pending')) {
      message.warning('当前阶段没有您的待办')
      return
    }
    await reviewsApi.decide(task.id, decision, note, commentBody, tagIds)
    message.success('已提交决定')
    setIsDirty(false)
    fetchTask(task.id)
  }

  const onTransfer = async (toUserId: number) => {
    if (!task) return
    await reviewsApi.transfer(task.id, toUserId)
    message.success('已转交')
    fetchTask(task.id)
  }

  const onAddReviewer = async (toUserId: number) => {
    if (!task) return
    await reviewsApi.addReviewer(task.id, toUserId)
    message.success('已加签')
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

  const onCancelTask = () => {
    if (!task) return
    let reason = ''
    modal.confirm({
      title: '取消任务',
      content: (
        <div>
          <p style={{ marginBottom: 8 }}>确认取消任务「{task.title}」？该操作不可撤销。</p>
          <Input.TextArea
            rows={3}
            maxLength={500}
            showCount
            placeholder="请输入取消原因（可选）"
            onChange={(e) => {
              reason = e.target.value
            }}
          />
        </div>
      ),
      okText: '确认取消',
      okButtonProps: { danger: true },
      cancelText: '不取消',
      onOk: async () => {
        try {
          await reviewsApi.cancelTask(task.id, reason || undefined)
          message.success('任务已取消')
          await fetchTask(task.id)
        } catch (e) {
          const err = e as { response?: { data?: { detail?: string } }; message?: string }
          message.error(err.response?.data?.detail || err.message || '取消失败')
        }
      },
    })
  }

  const downloadUrl = useMemo(() => {
    if (!task || !version) return null
    return materialsApi.downloadUrl(task.material_id, version.id)
  }, [task, version])

  const existingTagIds = useMemo(() => {
    if (!task) return []
    const decided = task.assignments.find(
      (a) => a.assignee_id === user?.id && a.decision !== 'pending',
    )
    return decided?.tags?.map((t) => t.tag_id) ?? []
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
  const reviewerRoles = ['admin', 'reviewer', 'mlr']
  const canDecide =
    hasPendingAssignment ||
    (isMachineWithResult && !!user && reviewerRoles.includes(user.role))

  // v10: header visibility for the cancel button. The same predicate as
  // the list page so behavior stays consistent.
  const canCancel =
    task.final_decision === 'pending' &&
    task.canceled_at == null &&
    (task.machine_status === 'pending' ||
      task.machine_status === 'running' ||
      task.machine_status == null) &&
    (user?.role === 'admin' ||
      user?.role === 'superadmin' ||
      (user?.role === 'submitter' && material.submitter_id === user.id) ||
      hasPendingAssignment)

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
  const isCanceled = task.final_decision === 'canceled'

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
        <div style={{ flex: isMachineReview ? '1 1 100%' : '0 0 60%', minHeight: 0, borderBottom: isMachineReview ? 'none' : `1px solid ${colors.border}`, overflow: 'auto' }}>
          <AgentReviewPanel
            result={task.agent_review}
            task={task}
            onTriggerMachineReview={onTriggerMachineReview}
            triggering={triggeringMachineReview}
          />
        </div>
        {(!isMachineReview || task.machine_status === 'completed' || task.machine_status === 'failed') ? (
          <div style={{ flex: '0 0 40%', minHeight: 0, overflow: 'auto', background: colors.surface2 }}>
            <HumanActionPanel
              canDecide={canDecide}
              users={users}
              currentUserId={user?.id}
              availableTags={availableTags}
              existingTagIds={existingTagIds}
              onTransfer={onTransfer}
              onAddReviewer={onAddReviewer}
              onDecide={onDecide}
              onDirtyChange={setIsDirty}
            />
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* v10 PageHeader: task meta + workflow_mode + status + cancel button */}
      <div
        style={{
          width: '100%',
          padding: '12px 16px',
          background: '#fff',
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            rowGap: 8,
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
            <Title level={5} style={{ margin: 0 }}>
              {task.title}
            </Title>
            <Tag color={isHybrid ? 'purple' : 'blue'} style={{ margin: 0 }}>
              {WORKFLOW_MODE_LABELS[workflowMode]}
            </Tag>
            <Tag color={decisionTagColor} style={{ margin: 0 }}>
              {DECISION_LABELS[task.final_decision]}
            </Tag>
            <Tag style={{ margin: 0 }}>{TYPE_LABELS[material.material_type]}</Tag>
            <Tag color="default" style={{ margin: 0 }}>{task.stage_key}</Tag>
          </Space>

          <Space size={8} wrap>
            <Text type="secondary" style={{ fontSize: 12 }}>
              #{task.id} · 创建于 {new Date(task.created_at).toLocaleString('zh-CN')}
            </Text>
            {!isCanceled && canCancel && (
              <Button
                danger
                size="small"
                icon={<StopOutlined />}
                onClick={onCancelTask}
              >
                取消任务
              </Button>
            )}
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
        {isCanceled && task.cancel_reason && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            取消原因：{task.cancel_reason}
            {task.canceled_at && (
              <> · 取消于 {new Date(task.canceled_at).toLocaleString('zh-CN')}</>
            )}
          </Text>
        )}
      </div>

      <div style={{ height: 'calc(100vh - 200px)', minHeight: 520 }}>
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
                  materialTitle={material.title}
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
                  materialTitle={material.title}
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
              materialTitle={material.title}
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
    </div>
  )
}