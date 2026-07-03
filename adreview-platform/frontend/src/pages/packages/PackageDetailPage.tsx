import { useEffect, useMemo, useState } from 'react'
import {
  App,
  Col,
  Form,
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
import { usersApi } from '@/api/admin'
import { useAuthStore } from '@/store'
import {
  DECISION_LABELS,
  TYPE_LABELS,
  PACKAGE_STATUS_LABELS,
  type Material,
  type MaterialVersion,
  type MaterialPackage,
  type MaterialPackageItem,
  type ReviewDecision,
  type ReviewTask,
  type User,
  type MaterialType,
} from '@/types/domain'
import PageHero from '@/components/task-create/PageHero'
import SectionCard from '@/components/task-create/SectionCard'
import PreviewEditor from '@/components/task-detail/PreviewEditor'
import AgentReviewPanel from '@/components/task-detail/AgentReviewPanel'
import HumanActionPanel, { type DecisionFormValues } from '@/components/task-detail/HumanActionPanel'
import { palette, font, shadow } from '@/lib/theme'

const { Text } = Typography

export default function PackageDetailPage() {
  const { message, modal } = App.useApp()
  const { id: routeId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuthStore()

  const [pkg, setPkg] = useState<MaterialPackage | null>(null)
  const [taskMap, setTaskMap] = useState<Record<number, ReviewTask>>({})
  const [materialMap, setMaterialMap] = useState<Record<number, Material>>({})
  const [versionMap, setVersionMap] = useState<Record<number, MaterialVersion>>({})
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null)
  const [users, setUsers] = useState<User[]>([])
  const [decisionForm] = Form.useForm<DecisionFormValues>()
  const [isDirty, setIsDirty] = useState(false)

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
    if (user?.role === 'admin' || user?.role === 'reviewer' || user?.role === 'mlr') {
      usersApi.list().then(setUsers).catch(() => {})
    }
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

  const onDecide = async (decision: ReviewDecision) => {
    if (!currentTask) return
    if (!currentTask.assignments.find((a) => a.assignee_id === user?.id && a.decision === 'pending')) {
      message.warning('当前阶段没有您的待办')
      return
    }
    const values = await decisionForm.validateFields().catch(() => ({} as DecisionFormValues))
    await reviewsApi.decide(currentTask.id, decision, values.note, values.comment_body)
    message.success('已提交决定')
    setIsDirty(false)
    decisionForm.resetFields()
    if (packageId) fetchPackage(packageId)
  }

  const onTransfer = async (toUserId: number) => {
    if (!currentTask) return
    await reviewsApi.transfer(currentTask.id, toUserId)
    message.success('已转交')
    if (packageId) fetchPackage(packageId)
  }

  const onAddReviewer = async (toUserId: number) => {
    if (!currentTask) return
    await reviewsApi.addReviewer(currentTask.id, toUserId)
    message.success('已加签')
    if (packageId) fetchPackage(packageId)
  }

  const downloadUrl = useMemo(() => {
    if (!currentTask || !currentVersion) return null
    return materialsApi.downloadUrl(currentTask.material_id, currentVersion.id)
  }, [currentTask, currentVersion])

  // 审核状态汇总
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

  const getItemStatus = (item: MaterialPackageItem) => {
    const task = taskMap[item.id]
    if (!task) return { label: '未提交', color: 'default' as const }
    return {
      label: DECISION_LABELS[task.final_decision],
      color: (task.final_decision === 'approved'
        ? 'success'
        : task.final_decision === 'rejected'
          ? 'error'
          : task.final_decision === 'returned'
            ? 'warning'
            : 'processing') as 'success' | 'error' | 'warning' | 'processing',
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
    <div
      style={{
        width: '100%',
        background: palette.bg,
        margin: '-20px',
        padding: 20,
        minHeight: 'calc(100vh - 64px)',
      }}
    >
      <PageHero
        eyebrow="Section · Material Package"
        title={pkg.name}
        subtitle={`素材包 · ${pkg.items.length} 个素材 · 创建于 ${new Date(pkg.created_at).toLocaleString('zh-CN')}`}
        onBack={() => navigate('/tasks')}
        rightExtra={
          <Space size={6}>
            <Tag style={{ borderRadius: 999, padding: '2px 10px' }}>
              {TYPE_LABELS[pkg.material_type as MaterialType] || pkg.material_type}
            </Tag>
            <Tag
              color="blue"
              style={{ borderRadius: 999, padding: '2px 10px' }}
            >
              {PACKAGE_STATUS_LABELS[pkg.status]}
            </Tag>
          </Space>
        }
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)',
          gap: 24,
          alignItems: 'start',
        }}
      >
        {/* 左栏 main */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* 01 基础信息 */}
          <SectionCard
            eyebrow="01"
            title="基础信息"
            description="素材包的基本属性与审核范围。"
            accentBar
            extra={
              <Text style={{ fontSize: 12, color: palette.inkSubtle }}>
                #{pkg.id}
              </Text>
            }
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
          </SectionCard>

          {/* 02 素材列表 */}
          <SectionCard
            eyebrow="02"
            title="素材列表"
            description="点击素材可查看其审核详情。"
            extra={
              <Text style={{ fontSize: 12, color: palette.inkSubtle }}>
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
                      borderBottom: `1px solid ${palette.border}`,
                      borderLeft: active ? `3px solid ${palette.accent}` : '3px solid transparent',
                      background: active ? palette.accentSoft : palette.surface,
                      borderRadius: active ? 6 : 0,
                      marginBottom: 4,
                      cursor: 'pointer',
                      transition: 'all 120ms ease',
                    }}
                  >
                    <span
                      style={{
                        color: active ? palette.accentInk : palette.inkMuted,
                        fontSize: 18,
                      }}
                    >
                      {getMaterialTypeIcon(mat?.material_type || pkg.material_type)}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontFamily: font.sans,
                          fontWeight: active ? 600 : 500,
                          color: palette.ink,
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
                          fontFamily: font.sans,
                          color: palette.inkSubtle,
                          fontSize: 12,
                          marginTop: 2,
                        }}
                      >
                        #{item.id} · {TYPE_LABELS[(mat?.material_type || pkg.material_type) as MaterialType] || ''}
                      </div>
                    </div>
                    <Tag color={status.color} style={{ borderRadius: 999 }}>
                      {status.label}
                    </Tag>
                  </div>
                )
              }}
            />
          </SectionCard>

          {/* 03 当前素材：预览 + 审核面板 */}
          <SectionCard
            eyebrow="03"
            title="当前素材"
            description={
              currentMaterial
                ? `正在审核：${currentMaterial.title}`
                : '从上方列表选择一个素材'
            }
            accentBar
            extra={
              currentTask && (
                <Text style={{ fontSize: 12, color: palette.inkSubtle }}>
                  任务 #{currentTask.id} · {currentTask.stage_key}
                </Text>
              )
            }
            bodyPadding={0}
          >
            {currentMaterial ? (
              <div style={{ height: 720, display: 'flex', flexDirection: 'column' }}>
                <Row gutter={0} style={{ flex: '1 1 auto', minHeight: 0 }}>
                  {/* 预览 */}
                  <Col span={16} style={{ height: '100%' }}>
                    <div
                      style={{
                        height: '100%',
                        borderRight: `1px solid ${palette.border}`,
                        background: palette.surface,
                        display: 'flex',
                        flexDirection: 'column',
                        minHeight: 0,
                      }}
                    >
                      {currentVersion ? (
                        <PreviewEditor
                          task={currentTask}
                          materialType={currentMaterial.material_type}
                          materialTitle={currentMaterial.title}
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
                            color: palette.inkSubtle,
                            margin: 'auto',
                          }}
                        >
                          暂无可预览的素材
                        </div>
                      )}
                    </div>
                  </Col>
                  {/* AI 审核 */}
                  <Col span={8} style={{ height: '100%' }}>
                    <div
                      style={{
                        height: '100%',
                        background: palette.surface,
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
                            color: palette.inkSubtle,
                            margin: 'auto',
                          }}
                        >
                          该素材尚未提交审核
                        </div>
                      )}
                    </div>
                  </Col>
                </Row>
                {/* 人工操作面板 */}
                {currentTask && currentTask.review_type !== 'machine' && (
                  <div
                    style={{
                      flex: '0 0 280px',
                      borderTop: `1px solid ${palette.border}`,
                      background: palette.surfaceAlt,
                      minHeight: 0,
                      overflow: 'auto',
                    }}
                  >
                    <HumanActionPanel
                      canDecide={canDecide}
                      decisionForm={decisionForm}
                      users={users}
                      currentUserId={user?.id}
                      onTransfer={onTransfer}
                      onAddReviewer={onAddReviewer}
                      onDecide={onDecide}
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
                  color: palette.inkSubtle,
                }}
              >
                请从上方素材列表选择一个素材开始审核
              </div>
            )}
          </SectionCard>
        </div>

        {/* 右栏 overview (sticky) */}
        <div style={{ position: 'sticky', top: 80, display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* 素材包概览：检测流程 */}
          <SectionCard
            eyebrow="Overview"
            title="素材包概览"
            description="从上传到出结果，整包一站式审核。"
            accentBar
          >
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <FlowStep
                color={palette.accent}
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
          </SectionCard>

          {/* 审核状态汇总 */}
          <SectionCard
            eyebrow="Status"
            title="审核状态汇总"
            description="当前素材包的整体审核进度。"
            accentBar
          >
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
                  <Text style={{ fontFamily: font.sans, color: palette.inkMuted, fontSize: 13 }}>
                    完成度
                  </Text>
                  <Text
                    style={{
                      fontFamily: font.serif,
                      color: palette.ink,
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
                    background: palette.surfaceAlt,
                    borderRadius: 3,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${completedRatio}%`,
                      height: '100%',
                      background: palette.accent,
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
                <Stat label="驳回/退回" value={statusSummary.rejected} color={palette.danger} />
                <Stat label="审核中" value={statusSummary.pending} color="#7C3AED" />
                <Stat label="未提交" value={statusSummary.noTask} color={palette.inkSubtle} />
              </div>
            </div>
          </SectionCard>

          {/* 检测贴士 */}
          <SectionCard
            eyebrow="Tips"
            title="检测贴士"
            accentBar={false}
          >
            <ul
              style={{
                margin: 0,
                paddingLeft: 18,
                color: palette.inkMuted,
                fontSize: 13,
                lineHeight: 1.8,
                fontFamily: font.sans,
              }}
            >
              <li>整包任一子项高风险，整包不能投放。</li>
              <li>图片单张 ≤ 10MB，视频单个 ≤ 1GB；数量不限。</li>
              <li>每条文案 ≥ 10 字符才会作为一个检测项。</li>
              <li>支持 JPG / PNG / WebP / MP4 / MOV，按类型自动分组。</li>
            </ul>
          </SectionCard>
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
          fontFamily: font.sans,
          fontSize: 11,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: palette.inkSubtle,
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: font.sans,
          color: palette.ink,
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
        background: palette.surfaceAlt,
        borderRadius: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      <div
        style={{
          fontFamily: font.sans,
          fontSize: 11,
          color: palette.inkMuted,
          letterSpacing: '0.05em',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: font.serif,
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
            boxShadow: shadow.soft,
          }}
        >
          {icon}
        </div>
        {!isLast && (
          <div
            style={{
              flex: 1,
              width: 2,
              background: palette.border,
              margin: '4px 0',
            }}
          />
        )}
      </div>
      <div style={{ paddingTop: 4, paddingBottom: isLast ? 0 : 18, flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: font.serif,
            fontSize: 15,
            fontWeight: 600,
            color: palette.ink,
            marginBottom: 2,
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontFamily: font.sans,
            fontSize: 12,
            color: palette.inkMuted,
            lineHeight: 1.6,
          }}
        >
          {desc}
        </div>
      </div>
    </div>
  )
}
