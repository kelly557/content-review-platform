import { Navigate, Route, Routes, useParams } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import { Spin } from 'antd'
import { ProtectedRoute } from './ProtectedRoute'
import AppLayout from '@/layouts/AppLayout'

interface LegacyLibraryParams extends Record<string, string | undefined> {
  type: string
  id: string
}

function LegacyLibraryRedirect() {
  const params = useParams<LegacyLibraryParams>()
  const target =
    params.type === 'image'
      ? `/resources/images/${params.id}`
      : `/resources/words/${params.id}`
  return <Navigate to={target} replace />
}

interface LegacyRulesByTypeParams extends Record<string, string | undefined> {
  mediaType: string
}

function LegacyRulesByTypeRedirect() {
  const params = useParams<LegacyRulesByTypeParams>()
  // 老的 /strategies/rules-by-type/:mediaType 统一跳到「通用规则」页
  // (向后兼容 — 老链接 / 文档 / TagsPage 跳转仍可用)
  const mt = params.mediaType === 'text' ? 'text' : 'image'
  return <Navigate to={`/rules/general/${mt}`} replace />
}

const LoginPage = lazy(() => import('@/pages/auth/LoginPage'))
const OverviewPage = lazy(() => import('@/pages/overview/OverviewPage'))
const MaterialsListPage = lazy(() => import('@/pages/materials/MaterialsListPage'))
const MaterialDetailPage = lazy(() => import('@/pages/materials/MaterialDetailPage'))
const PackageDetailPage = lazy(() => import('@/pages/packages/PackageDetailPage'))
const TasksPage = lazy(() => import('@/pages/tasks/TasksPage'))
const TaskDetailPage = lazy(() => import('@/pages/tasks/TaskDetailPage'))
const CreateTaskPage = lazy(() => import('@/pages/tasks/CreateTaskPage'))
const ReportsPage = lazy(() => import('@/pages/reports/ReportsPage'))
const QueryPage = lazy(() => import('@/pages/query/QueryPage'))
const UsersAdminPage = lazy(() => import('@/pages/admin/UsersAdminPage'))
const RolesAdminPage = lazy(() => import('@/pages/admin/RolesAdminPage'))
const StrategyListPage = lazy(() => import('@/pages/strategy/StrategyListPage'))
const CreateStrategyPage = lazy(() => import('@/pages/strategy/CreateStrategyPage'))
const GeneralRuleListPage = lazy(() => import('@/pages/rules/GeneralRuleListPage'))
const GeneralRuleDetailPage = lazy(() => import('@/pages/rules/GeneralRuleDetailPage'))
const PersonalRuleListPage = lazy(() => import('@/pages/rules/PersonalRuleListPage'))
const PersonalRuleDetailPage = lazy(() => import('@/pages/rules/PersonalRuleDetailPage'))
const PersonalRulePointsPage = lazy(() => import('@/pages/rules/PersonalRulePointsPage'))
const AuditRulesPage = lazy(() => import('@/pages/audit-rules/AuditRulesPage'))
const WordLibraryListPage = lazy(() => import('@/pages/strategy/WordLibraryListPage'))
const ImageLibraryListPage = lazy(() => import('@/pages/strategy/ImageLibraryListPage'))
const WordLibraryDetailPage = lazy(() => import('@/pages/strategy/WordLibraryDetailPage'))
const ImageLibraryDetailPage = lazy(() => import('@/pages/strategy/ImageLibraryDetailPage'))
const ReplyLibraryListPage = lazy(() => import('@/pages/strategy/ReplyLibraryListPage'))
const ReplyLibraryDetailPage = lazy(() => import('@/pages/strategy/ReplyLibraryDetailPage'))
const ModelListPage = lazy(() => import('@/pages/models/ModelListPage'))
const ModelDetailPage = lazy(() => import('@/pages/models/ModelDetailPage'))
const ProviderDetailPage = lazy(() => import('@/pages/models/ProviderDetailPage'))
const KnowledgeDocumentListPage = lazy(
  () => import('@/pages/knowledge/KnowledgeDocumentListPage'),
)
const KnowledgeDocumentDetailPage = lazy(
  () => import('@/pages/knowledge/KnowledgeDocumentDetailPage'),
)
// StrategyRulesByTypePage 已退役 — 改用 /rules/{general,personal}/:mediaType
const ServiceRuleConfigPage = lazy(() => import('@/pages/strategy/ServiceRuleConfigPage'))
const PackageItemsPage = lazy(() => import('@/pages/packages/PackageItemsPage'))
const CreateAuditItemPage = lazy(() => import('@/pages/packages/CreateAuditItemPage'))
const AuditPointsPage = lazy(() => import('@/pages/packages/AuditPointsPage'))
const CreateAuditPointPage = lazy(() => import('@/pages/packages/CreateAuditPointPage'))
const EditAuditPointPage = lazy(() => import('@/pages/packages/EditAuditPointPage'))
const TagsPage = lazy(() => import('@/pages/tags/TagsPage'))
const HumanReviewRulesPage = lazy(() => import('@/pages/strategy/HumanReviewRulesPage'))
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'))
const TriggersListPage = lazy(() => import('@/pages/triggers/TriggersListPage'))
const CreateTriggerPage = lazy(() => import('@/pages/triggers/CreateTriggerPage'))
const TriggerDetailPage = lazy(() => import('@/pages/triggers/TriggerDetailPage'))
const FeatureDisabledPage = lazy(() => import('@/pages/FeatureDisabledPage'))
const ImportRulesPage = lazy(() => import('@/pages/ImportRulesPage'))

function Fallback() {
  return <Spin style={{ display: 'block', margin: '20vh auto' }} />
}

export default function AppRoutes() {
  return (
    <Suspense fallback={<Fallback />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route element={<ProtectedRoute />}>
          {/* 隐藏工具页：admin 才能进、不挂主产品 chrome，URL 不在侧栏菜单暴露 */}
          <Route element={<ProtectedRoute allow={['admin', 'root_admin']} />}>
            <Route path="/import-rules" element={<ImportRulesPage />} />
          </Route>

          <Route element={<AppLayout />}>
            <Route index element={<Navigate to="/overview" replace />} />
            <Route path="/overview" element={<OverviewPage />} />

            <Route path="/materials" element={<MaterialsListPage />} />
            <Route path="/materials/:id" element={<MaterialDetailPage />} />

            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/tasks/new" element={<CreateTaskPage />} />
            <Route path="/tasks/:id" element={<TaskDetailPage />} />
            <Route path="/tasks/package/:id" element={<PackageDetailPage />} />

            <Route element={<ProtectedRoute allow={['reviewer', 'mlr', 'admin', 'superadmin', 'root_admin']} />}>
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/query" element={<QueryPage />} />
            </Route>

            <Route element={<ProtectedRoute allow={['admin', 'mlr', 'superadmin', 'root_admin']} />}>
              <Route path="/strategies" element={<StrategyListPage />} />
              {/* 老的 rules-by-type 路径重定向到新的"通用"页(向后兼容) */}
              <Route
                path="/strategies/rules-by-type/:mediaType"
                element={<LegacyRulesByTypeRedirect />}
              />
              <Route path="/strategies/new" element={<CreateStrategyPage />} />
              <Route path="/strategies/:id/edit" element={<CreateStrategyPage />} />
              <Route path="/strategies/rules/:serviceCode" element={<ServiceRuleConfigPage />} />

              {/* 图片/文本审核规则 — Tab 容器页 (系统规则 / 自定义 Agent) */}
              <Route
                path="/rules/audit/:mediaType"
                element={<AuditRulesPage />}
              />

              {/* 旧路径保留 (向后兼容) — 仍可直达,菜单不再暴露 */}
              <Route
                path="/rules/general/:mediaType"
                element={<GeneralRuleListPage />}
              />
              <Route
                path="/rules/general/:mediaType/:itemId"
                element={<GeneralRuleDetailPage />}
              />
              <Route
                path="/rules/personal/:mediaType"
                element={<PersonalRuleListPage />}
              />
              <Route
                path="/rules/personal/:mediaType/:itemId"
                element={<PersonalRuleDetailPage />}
              />
              <Route
                path="/rules/personal/:mediaType/:itemId/points"
                element={<PersonalRulePointsPage />}
              />
              <Route
                path="/rules/personal/:mediaType/new"
                element={<CreateAuditItemPage />}
              />

              {/* 资源库（原「知识库」） */}
              <Route path="/resources/words" element={<WordLibraryListPage />} />
              <Route path="/resources/words/:id" element={<WordLibraryDetailPage />} />
              <Route path="/resources/replies" element={<ReplyLibraryListPage />} />
              <Route path="/resources/replies/:id" element={<ReplyLibraryDetailPage />} />
              <Route path="/resources/models" element={<ModelListPage />} />
              <Route path="/resources/models/:id" element={<ModelDetailPage />} />
              <Route path="/resources/providers/:id" element={<ProviderDetailPage />} />

              {/* 旧路径 redirect 到新前缀 */}
              <Route
                path="/knowledge/words"
                element={<Navigate to="/resources/words" replace />}
              />
              <Route
                path="/knowledge/words/:id"
                element={<Navigate to="/resources/words/:id" replace />}
              />
              <Route
                path="/knowledge/images"
                element={<Navigate to="/resources/images" replace />}
              />
              <Route
                path="/knowledge/images/:id"
                element={<Navigate to="/resources/images/:id" replace />}
              />
              <Route
                path="/knowledge/replies"
                element={<Navigate to="/resources/replies" replace />}
              />
              <Route
                path="/knowledge/replies/:id"
                element={<Navigate to="/resources/replies/:id" replace />}
              />
              <Route
                path="/strategies/words"
                element={<Navigate to="/resources/words" replace />}
              />
              <Route
                path="/strategies/words/:id"
                element={<Navigate to="/resources/words/:id" replace />}
              />
              <Route
                path="/strategies/images"
                element={<Navigate to="/resources/images" replace />}
              />
              <Route
                path="/strategies/images/:id"
                element={<Navigate to="/resources/images/:id" replace />}
              />
              <Route
                path="/strategies/replies"
                element={<Navigate to="/resources/replies" replace />}
              />
              <Route
                path="/strategies/replies/:id"
                element={<Navigate to="/resources/replies/:id" replace />}
              />
              <Route
                path="/strategies/library-groups"
                element={<Navigate to="/resources/words" replace />}
              />
              <Route
                path="/strategies/custom-image"
                element={<Navigate to="/resources/images" replace />}
              />
              <Route
                path="/strategies/custom-text"
                element={<Navigate to="/resources/words" replace />}
              />
              <Route
                path="/strategies/library/image"
                element={<Navigate to="/resources/images" replace />}
              />
              <Route
                path="/strategies/library/word"
                element={<Navigate to="/resources/words" replace />}
              />
              <Route
                path="/strategies/library/:type/:id"
                element={<LegacyLibraryRedirect />}
              />

              <Route path="/packages/:code/items" element={<PackageItemsPage />} />
              <Route path="/packages/:code/items/new" element={<CreateAuditItemPage />} />
              <Route
                path="/packages/:code/items/:itemId/points"
                element={<AuditPointsPage />}
              />
              <Route
                path="/packages/:code/items/:itemId/points/new"
                element={<CreateAuditPointPage />}
              />
              <Route
                path="/packages/:code/items/:itemId/points/:pointId"
                element={<EditAuditPointPage />}
              />
            </Route>

            <Route path="/packages" element={<FeatureDisabledPage />} />
            <Route path="/packages/:id" element={<FeatureDisabledPage />} />

            <Route element={<ProtectedRoute allow={['admin', 'superadmin', 'root_admin']} />}>
              <Route path="/admin/users" element={<UsersAdminPage />} />
              <Route path="/triggers" element={<TriggersListPage />} />
              <Route path="/triggers/new" element={<CreateTriggerPage />} />
              <Route path="/triggers/:id" element={<TriggerDetailPage />} />
            </Route>

            <Route element={<ProtectedRoute allow={['superadmin', 'root_admin']} />}>
              <Route path="/admin/roles" element={<RolesAdminPage />} />
            </Route>

            <Route element={<ProtectedRoute allow={['root_admin']} />}>
              <Route path="/resources/knowledge" element={<KnowledgeDocumentListPage />} />
              <Route path="/resources/knowledge/:id" element={<KnowledgeDocumentDetailPage />} />
              <Route path="/resources/images" element={<ImageLibraryListPage />} />
              <Route path="/resources/images/:id" element={<ImageLibraryDetailPage />} />
            </Route>

            <Route element={<ProtectedRoute allow={['admin', 'mlr', 'superadmin', 'root_admin']} />}>
              <Route path="/tags" element={<TagsPage />} />
              <Route path="/human-review-rules" element={<HumanReviewRulesPage />} />
            </Route>
          </Route>
        </Route>

        {/* 老的独立「知识库」页面（已下线） */}
        <Route path="/knowledge" element={<Navigate to="/resources/knowledge" replace />} />
        <Route path="/knowledge/*" element={<Navigate to="/resources/knowledge" replace />} />

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  )
}
