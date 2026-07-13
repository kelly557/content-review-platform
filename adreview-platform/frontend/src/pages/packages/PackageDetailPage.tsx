import { useEffect, useMemo, useState } from 'react'
import {
  App,
  Breadcrumb,
  Card,
  Col,
  List,
  Row,
  Space,
  Tag,
  Typography,
} from 'antd'
import {
  CloudUploadOutlined,
  SearchOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  FileTextOutlined,
  PictureOutlined,
  VideoCameraOutlined,
  FilePdfOutlined,
} from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import { packagesApi } from '@/api/materialPackages'
import { reviewsApi } from '@/api/reviews'
import { materialsApi } from '@/api/materials'
import { useAuthStore } from '@/store'
import {
  DECISION_LABELS,
  TYPE_LABELS,
  PACKAGE_STATUS_LABELS,
  type Material,
  type MaterialVersion,
  type MaterialPackage,
  type MaterialPackageItem,
  type ReviewTask,
  type MaterialType,
} from '@/types/domain'
import PreviewEditor from '@/components/task-detail/PreviewEditor'
import AgentReviewPanel from '@/components/task-detail/AgentReviewPanel'
import HumanActionPanel from '@/components/task-detail/HumanActionPanel'
import { colors } from '@/styles/theme'

const { Text } = Typography

export default function PackageDetailPage() {
  const { message, modal } = App.useApp()
  const { id: routeId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuthStore()

  const [pkg, setPkg] = useState<MaterialPackage | null>(null)
  // 2026-07-16 cleanup: Transfer/AddReviewer UI removed, no longer need
  // a user list for the recipient pickers. Re-introduce when those return.
  const [taskMap, setTaskMap] = useState<Record<number, ReviewTask>>({})
  const [materialMap, setMaterialMap] = useState<Record<number, Material>>({})
  const [versionMap, setVersionMap] = useState<Record<number, MaterialVersion>>({})
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null)
  // (users list was previously fetched for Transfer/AddReviewer pickers;
  // those actions were removed in the 2026-07-16 cleanup.)
  const [isDirty, setIsDirty] = useState(false)
  const [pkgAuditItemIds, setPkgAuditItemIds] = useState<number[]>([])

  const packageId = routeId ? Number(routeId) : undefined

  const fetchPackage = async (id: number) => {
    const p = await packagesApi.get(id)
    setPkg(p)

    const tasks: Record<number, ReviewTask> = {}
    const materials: Record<number, Material> = {}
    const versions: Record<number, MaterialVersion> = {}

    for (const item of p.items) {
      if (item.review_task_id) {
        try {
          const task = await reviewsApi.task(item.review_task_id)
          tasks[item.id] = task
          const mat = await materialsApi.get(task.material_id)
          materials[item.id] = mat
          const v = mat.versions.find((x) => x.id === task.material_version_id) ?? mat.versions[mat.versions.length - 1]
          if (v) versions[item.id] = v
        } catch {
          // ignore
        }
      } else if (item.material) {
        materials[item.id] = item.material
        const v = item.material.versions[item.material.versions.length - 1]
        if (v) versions[item.id] = v
      }
    }

    setTaskMap(tasks)
    setMaterialMap(materials)
    setVersionMap(versions)

    if (p.items.length > 0 && !selectedItemId) {
      setSelectedItemId(p.items[0].id)
    }
  }

  useEffect(() => {
    if (!packageId) {
      navigate('/tasks', { replace: true })
      return
    }
    fetchPackage(packageId).catch(() => {
      message.error('加载素材包失败')
    })
    // 2026-07-16 cleanup: Transfer/AddReviewer UI removed, so the user list
    // is no longer needed for this page. Revisit if those actions return.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packageId])

  const selectedItem = useMemo(
    () => pkg?.items.find((i) => i.id === selectedItemId) ?? null,
    [pkg, selectedItemId],
  )
  const currentTask = selectedItem ? taskMap[selectedItem.id] ?? null : null
  const currentMaterial = selectedItem ? materialMap[selectedItem.id] ?? null : null
  const currentVersion = selectedItem ? versionMap[selectedItem.id] ?? null : null

  const switchItem = (itemId: number) => {
    if (itemId === selectedItemId) return
    const doSwitch = () => setSelectedItemId(itemId)
    if (isDirty) {
      modal.confirm({
        title: '切换素材将丢弃未提交的备注/评论',
        content: '当前有未保存的内容，是否继续？',
        okText: '丢弃并切换',
        cancelText: '留在当前素材',
        onOk: doSwitch,
      })
      return
    }
    doSwitch()
  }

  // 2026-07-16 cleanup: package-level decide was removed from the page UI;
  // per-item decisions go through /tasks/:id. Keep this commented until
  // a dedicated StickyDecisionBar lands here too.
  // const onDecide = async (
  //   decision: ReviewDecision,
  //   options: { auditItemIds: number[]; note?: string },
  // ) => {
  //   if (!currentTask) return
  //   if (!currentTask.assignments.find((a) => a.assignee_id === user?.id && a.decision === 'pending')) {
  //     message.warning('当前阶段没有您的待办')
  //     return
  //   }
  //   await reviewsApi.decide(currentTask.id, decision, {
  //     note: options.note,
  //     auditItemIds: options.auditItemIds,
  //   })
  //   message.success('已提交决定')
  //   setIsDirty(false)
  //   if (packageId) fetchPackage(packageId)
  // }

  const downloadUrl = useMemo(() => {
    if (!currentTask || !currentVersion) return null
    return materialsApi.downloadUrl(currentTask.material_id, currentVersion.id)
  }, [currentTask, currentVersion])

  const statusSummary = useMemo(() => {
    if (!pkg) return { approved: 0, rejected: 0, pending: 0, noTask: 0, total: 0 }
    let approved = 0
    let rejected = 0
    let pending = 0
    let noTask = 0
    for (const item of pkg.items) {
      const t = taskMap[item.id]
      if (!t) noTask += 1
      else if (t.final_decision === 'approved') approved += 1
      else if (t.final_decision === 'rejected' || t.final_decision === 'returned') rejected += 1
      else pending += 1
    }
    return { approved, rejected, pending, noTask, total: pkg.items.length }
  }, [pkg, taskMap])

  if (!pkg) {
    return <div style={{ padding: 40, textAlign: 'center' }}>加载中...</div>
  }

  const canDecide = currentTask
    ? !!currentTask.assignments.find((a) => a.assignee_id === user?.id && a.decision === 'pending')
    : false

  const existingAuditItemIds = useMemo(() => {
    if (!currentTask || !user) return []
    const decided = currentTask.assignments.find(
      (a) => a.assignee_id === user.id && a.decision !== 'pending',
    )
    return decided?.audit_items?.map((x) => x.audit_item_id) ?? []
  }, [currentTask, user?.id])

  const getItemStatus = (item: MaterialPackageItem) => {
    const task = taskMap[item.id]
    if (!task) return { label: '未提交', color: 'default' as const }
    return {
      label: DECISION_LABELS[task.final_decision],
      color: (task.final_decision === 'approved'
        ? 'success'
        : task.final_decision === 'rejected' || task.final_decision === 'returned'
          ? 'error'
          : 'processing') as 'success' | 'error' | 'processing',
    }
  }

  const getMaterialTypeIcon = (t: string) => {
    const k = t as MaterialType
    if (k === 'image') return <PictureOutlined />
    if (k === 'video') return <VideoCameraOutlined />
    if (k === 'pdf') return <FilePdfOutlined />
    return <FileTextOutlined />
  }

  const completedRatio = statusSummary.total > 0
    ? Math.round(((statusSummary.approved + statusSummary.rejected) / statusSummary.total) * 100)
    : 0

  return (
    <div style={{ width: '100%' }}>
      <Breadcrumb
        items={[
          { title: <a onClick={() => navigate('/tasks')}>审核任务</a> },
          { title: pkg.name },
        ]}
        style={{ marginBottom: 16 }}
      />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 24,
        }}
      >
        <Typography.Title level={3} style={{ margin: 0 }}>
          {pkg.name}
        </Typography.Title>
        <Space size={6}>
          <Tag>
            {TYPE_LABELS[pkg.material_type as MaterialType] || pkg.material_type}
          </Tag>
          <Tag color="blue">
            {PACKAGE_STATUS_LABELS[pkg.status]}
          </Tag>
        </Space>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)',
          gap: 24,
          alignItems: 'start',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <Card
            title="基础信息"
          >
            <Row gutter={[24, 16]}>
              <Col span={12}>
                <Field label="素材包名称" value={pkg.name} />
              </Col>
              <Col span={12}>
                <Field label="素材类型" value={TYPE_LABELS[pkg.material_type as MaterialType] || pkg.material_type} />
              </Col>
              <Col span={12}>
                <Field label="当前状态" value={PACKAGE_STATUS_LABELS[pkg.status]} />
              </Col>
              <Col span={12}>
                <Field label="素材数量" value={`${pkg.items.length} 个`} />
              </Col>
              {pkg.description && (
                <Col span={24}>
                  <Field label="描述" value={pkg.description} />
                </Col>
              )}
            </Row>
          </Card>

          <Card
            title="素材列表"
            extra={
              <Text style={{ fontSize: 12, color: colors.secondary }}>
                共 {pkg.items.length} 个 · 已选 {selectedItemId ? 1 : 0}
              </Text>
            }
          >
            <List
              dataSource={pkg.items}
              locale={{ emptyText: '暂无素材' }}
              renderItem={(item) => {
                const active = item.id === selectedItemId
                const status = getItemStatus(item)
                const mat = materialMap[item.id]
                return (
                  <div
                    onClick={() => switchItem(item.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '12px 14px',
                      borderBottom: `1px solid ${colors.border}`,
                      borderLeft: active ? `3px solid ${colors.accent}` : '3px solid transparent',
                      background: active ? colors.muted : undefined,
                      borderRadius: active ? 6 : 0,
                      marginBottom: 4,
                      cursor: 'pointer',
                      transition: 'all 120ms ease',
                    }}
                  >
                    <span
                      style={{
                        color: active ? colors.accent : colors.secondary,
                        fontSize: 18,
                      }}
                    >
                      {getMaterialTypeIcon(mat?.material_type || pkg.material_type)}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: active ? 600 : 500,
                          color: colors.foreground,
                          fontSize: 14,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {mat?.title || `素材 #${item.material_id}`}
                      </div>
                      <div
                        style={{
                          color: colors.secondary,
                          fontSize: 12,
                          marginTop: 2,
                        }}
                      >
                        {TYPE_LABELS[(mat?.material_type || pkg.material_type) as MaterialType] || ''}
                      </div>
                    </div>
                    <Tag color={status.color}>
                      {status.label}
                    </Tag>
                  </div>
                )
              }}
            />
          </Card>

          <Card
            title="当前素材"
            bodyStyle={{ padding: 0 }}
          >
            {currentMaterial ? (
              <div style={{ height: 720, display: 'flex', flexDirection: 'column' }}>
                <Row gutter={0} style={{ flex: '1 1 auto', minHeight: 0 }}>
                  <Col span={16} style={{ height: '100%' }}>
                    <div
                      style={{
                        height: '100%',
                        borderRight: `1px solid ${colors.border}`,
                        display: 'flex',
                        flexDirection: 'column',
                        minHeight: 0,
                      }}
                    >
                      {currentVersion ? (
                        <PreviewEditor
                          task={currentTask}
                          materialType={currentMaterial.material_type}
                          downloadUrl={downloadUrl}
                          textBody={currentVersion.text_body ?? null}
                          readOnly={!canDecide}
                          annotationRefreshKey={0}
                          onAnnotationChanged={() => {}}
                        />
                      ) : (
                        <div
                          style={{
                            padding: 40,
                            textAlign: 'center',
                            color: colors.secondary,
                            margin: 'auto',
                          }}
                        >
                          暂无可预览的素材
                        </div>
                      )}
                    </div>
                  </Col>
                  <Col span={8} style={{ height: '100%' }}>
                    <div
                      style={{
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        minHeight: 0,
                      }}
                    >
                      {currentTask ? (
                        <AgentReviewPanel result={currentTask.agent_review} />
                      ) : (
                        <div
                          style={{
                            padding: 32,
                            textAlign: 'center',
                            color: colors.secondary,
                            margin: 'auto',
                          }}
                        >
                          该素材尚未提交审核
                        </div>
                      )}
                    </div>
                  </Col>
                </Row>
                {currentTask && currentTask.review_type !== 'machine' && (
                  <div
                    style={{
                      flex: '0 0 280px',
                      borderTop: `1px solid ${colors.border}`,
                      background: colors.muted,
                      minHeight: 0,
                      overflow: 'auto',
                    }}
                  >
                    <HumanActionPanel
                      canDecide={canDecide}
                      hits={currentTask.agent_review?.hits ?? []}
                      existingAuditItemIds={existingAuditItemIds}
                      materialType={currentMaterial.material_type}
                      auditItemIds={pkgAuditItemIds}
                      onAuditItemsChange={setPkgAuditItemIds}
                      onNoteChange={() => {
                        /* no submit handler on this page yet */
                      }}
                      onDirtyChange={setIsDirty}
                    />
                  </div>
                )}
              </div>
            ) : (
              <div
                style={{
                  padding: 60,
                  textAlign: 'center',
                  color: colors.secondary,
                }}
              >
                请从上方素材列表选择一个素材开始审核
              </div>
            )}
          </Card>
        </div>

        <div style={{ position: 'sticky', top: 80, display: 'flex', flexDirection: 'column', gap: 24 }}>
          <Card title="素材包概览">
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <FlowStep
                color={colors.accent}
                icon={<CloudUploadOutlined />}
                title="上传素材"
                desc="整套文案 / 图 / 视频一次上传到云端"
              />
              <FlowStep
                color="#7C3AED"
                icon={<SearchOutlined />}
                title="逐条检测"
                desc="同时扫描每条文案、每张图、每个视频的合规风险"
              />
              <FlowStep
                color="#EA580C"
                icon={<ClockCircleOutlined />}
                title="实时进度"
                desc="本面板会同步显示每一项的检测状态"
              />
              <FlowStep
                color="#16A34A"
                icon={<CheckCircleOutlined />}
                title="整包通过"
                desc="全部子项合规即可放心投放，任一项有风险都会标出"
                isLast
              />
            </div>
          </Card>

          <Card title="审核状态汇总">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    marginBottom: 6,
                  }}
                >
                  <Text style={{ color: colors.secondary, fontSize: 13 }}>
                    完成度
                  </Text>
                  <Text
                    style={{
                      color: colors.foreground,
                      fontSize: 20,
                      fontWeight: 600,
                    }}
                  >
                    {completedRatio}%
                  </Text>
                </div>
                <div
                  style={{
                    height: 6,
                    background: colors.muted,
                    borderRadius: 3,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${completedRatio}%`,
                      height: '100%',
                      background: colors.accent,
                      transition: 'width 200ms ease',
                    }}
                  />
                </div>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: 8,
                }}
              >
                <Stat label="通过" value={statusSummary.approved} color="#16A34A" />
                <Stat label="驳回/退回" value={statusSummary.rejected} color={colors.destructive} />
                <Stat label="审核中" value={statusSummary.pending} color="#7C3AED" />
                <Stat label="未提交" value={statusSummary.noTask} color={colors.secondary} />
              </div>
            </div>
          </Card>

          <Card title="检测贴士">
            <ul
              style={{
                margin: 0,
                paddingLeft: 18,
                color: colors.secondary,
                fontSize: 13,
                lineHeight: 1.8,
              }}
            >
              <li>整包任一子项高风险，整包不能投放。</li>
              <li>图片单张 ≤ 10MB，视频单个 ≤ 1GB；数量不限。</li>
              <li>每条文案 ≥ 10 字符才会作为一个检测项。</li>
              <li>支持 JPG / PNG / WebP / MP4 / MOV，按类型自动分组。</li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: colors.secondary,
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          color: colors.foreground,
          fontSize: 14,
          fontWeight: 500,
        }}
      >
        {value}
      </div>
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div
      style={{
        padding: '10px 12px',
        background: colors.muted,
        borderRadius: 6,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: colors.secondary,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 600,
          color,
        }}
      >
        {value}
      </div>
    </div>
  )
}

function FlowStep({
  color,
  icon,
  title,
  desc,
  isLast = false,
}: {
  color: string
  icon: React.ReactNode
  title: string
  desc: string
  isLast?: boolean
}) {
  return (
    <div style={{ display: 'flex', gap: 12, position: 'relative' }}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: color,
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 16,
          }}
        >
          {icon}
        </div>
        {!isLast && (
          <div
            style={{
              flex: 1,
              width: 2,
              background: colors.border,
              margin: '4px 0',
            }}
          />
        )}
      </div>
      <div style={{ paddingTop: 4, paddingBottom: isLast ? 0 : 18, flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: colors.foreground,
            marginBottom: 2,
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: 12,
            color: colors.secondary,
            lineHeight: 1.6,
          }}
        >
          {desc}
        </div>
      </div>
    </div>
  )
}
