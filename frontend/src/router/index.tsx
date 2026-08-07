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
  // 图片库已下线，旧链接统一跳到词库
  return <Navigate to={`/resources/words/${params.id}`} replace />
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
const PackageDetailPage = lazy(() => import('@/pages/packages/PackageDetailPage'))
const TaskDetailPage = lazy(() => import('@/pages/tasks/TaskDetailPage'))
const CreateTaskPage = lazy(() => import('@/pages/tasks/CreateTaskPage'))
const ReportsPage = lazy(() => import('@/pages/reports/ReportsPage'))
const QueryPage = lazy(() => import('@/pages/query/QueryPage'))
const UsersAdminPage = lazy(() => import('@/pages/admin/UsersAdminPage'))
const PermissionsAdminPage = lazy(() => import('@/pages/admin/PermissionsAdminPage'))
const RolesMetaAdminPage = lazy(() => import('@/pages/admin/RolesMetaAdminPage'))
const StrategyListPage = lazy(() => import('@/pages/strategy/StrategyListPage'))
const CreateStrategyPage = lazy(() => import('@/pages/strategy/CreateStrategyPage'))
const GeneralRuleListPage = lazy(() => import('@/pages/rules/GeneralRuleListPage'))
const GeneralRuleDetailPage = lazy(() => import('@/pages/rules/GeneralRuleDetailPage'))
const PersonalRuleListPage = lazy(() => import('@/pages/rules/PersonalRuleListPage'))
const PersonalRuleDetailPage = lazy(() => import('@/pages/rules/PersonalRuleDetailPage'))
const PersonalRulePointsPage = lazy(() => import('@/pages/rules/PersonalRulePointsPage'))
const AuditRulesPage = lazy(() => import('@/pages/audit-rules/AuditRulesPage'))
const ReviewAgentsPage = lazy(() => import('@/pages/audit-agents/ReviewAgentsPage'))
const WordLibraryListPage = lazy(() => import('@/pages/strategy/WordLibraryListPage'))
const WordLibraryDetailPage = lazy(() => import('@/pages/strategy/WordLibraryDetailPage'))
const ReplyLibraryListPage = lazy(() => import('@/pages/strategy/ReplyLibraryListPage'))
const ReplyLibraryDetailPage = lazy(() => import('@/pages/strategy/ReplyLibraryDetailPage'))
// StrategyRulesByTypePage 已退役 — 改用 /rules/{general,personal}/:mediaType
const ServiceRuleConfigPage = lazy(() => import('@/pages/strategy/ServiceRuleConfigPage'))
const PackageItemsPage = lazy(() => import('@/pages/packages/PackageItemsPage'))
const CreateAuditItemPage = lazy(() => import('@/pages/packages/CreateAuditItemPage'))
const AuditPointsPage = lazy(() => import('@/pages/packages/AuditPointsPage'))
const CreateAuditPointPage = lazy(() => import('@/pages/packages/CreateAuditPointPage'))
const EditAuditPointPage = lazy(() => import('@/pages/packages/EditAuditPointPage'))
const TagsAdminPage = lazy(() => import('@/pages/admin/TagsAdminPage'))
const ModelsAdminLargePage = lazy(() => import('@/pages/admin/ModelsAdminLargePage'))
const ModelsAdminSmallPage = lazy(() => import('@/pages/admin/ModelsAdminSmallPage'))
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'))
const FeatureDisabledPage = lazy(() => import('@/pages/FeatureDisabledPage'))
const ImportRulesPage = lazy(() => import('@/pages/ImportRulesPage'))
const ApiKeysPage = lazy(() => import('@/pages/admin/ApiKeysPage'))
const TenantsAdminPage = lazy(() => import('@/pages/admin/TenantsAdminPage'))

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
          <Route element={<ProtectedRoute allow={['admin', 'superadmin', 'root_admin']} />}>
            <Route path="/import-rules" element={<ImportRulesPage />} />
          </Route>

          <Route element={<AppLayout />}>
            <Route index element={<Navigate to="/overview" replace />} />
            <Route path="/overview" element={<OverviewPage />} />

            {/* 素材库已下线（root_admin 独占内容清理） */}
            <Route path="/materials" element={<Navigate to="/overview" replace />} />
            <Route path="/materials/:id" element={<Navigate to="/overview" replace />} />

            <Route path="/online-review" element={<CreateTaskPage />} />
            <Route path="/tasks/:id" element={<TaskDetailPage />} />
            <Route path="/tasks/package/:id" element={<PackageDetailPage />} />

            {/* 已下线的列表页与旧创建入口 → 跳到新的"在线审核" */}
            <Route path="/tasks" element={<Navigate to="/online-review" replace />} />
            <Route path="/tasks/new" element={<Navigate to="/online-review" replace />} />
            <Route path="/current-review" element={<Navigate to="/online-review" replace />} />

            <Route element={<ProtectedRoute allow={['reviewer', 'mlr', 'admin', 'superadmin', 'root_admin']} />}>
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/query" element={<QueryPage />} />
            </Route>

            <Route element={<ProtectedRoute allow={['admin', 'mlr', 'reviewer', 'superadmin', 'root_admin']} />}>
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
                element={<Navigate to="/resources/words" replace />}
              />
              <Route
                path="/knowledge/images/:id"
                element={<Navigate to="/resources/words" replace />}
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
                element={<Navigate to="/resources/words" replace />}
              />
              <Route
                path="/strategies/images/:id"
                element={<Navigate to="/resources/words" replace />}
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
                path="/strategies/custom-text"
                element={<Navigate to="/resources/words" replace />}
              />
              <Route
                path="/strategies/library/word"
                element={<Navigate to="/resources/words" replace />}
              />
              <Route
                path="/strategies/custom-image"
                element={<Navigate to="/resources/words" replace />}
              />
              <Route
                path="/strategies/library/image"
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
              <Route path="/admin/permissions" element={<PermissionsAdminPage />} />
              <Route path="/admin/roles" element={<RolesMetaAdminPage />} />
              <Route path="/admin/tags" element={<TagsAdminPage />} />
              <Route path="/admin/models/large" element={<ModelsAdminLargePage />} />
              <Route path="/admin/models/small" element={<ModelsAdminSmallPage />} />

              {/* 自动审核已下线（root_admin 独占内容清理） */}
              <Route path="/triggers" element={<Navigate to="/overview" replace />} />
              <Route path="/triggers/new" element={<Navigate to="/overview" replace />} />
              <Route path="/triggers/:id" element={<Navigate to="/overview" replace />} />

              {/* 老路径兼容 — 旧 /tags 跳到新入口 */}
              <Route path="/tags" element={<Navigate to="/admin/tags" replace />} />
              {/* /resources/models 已下线，跳到大模型管理 */}
              <Route
                path="/resources/models"
                element={<Navigate to="/admin/models/large" replace />}
              />
            </Route>

            <Route element={<ProtectedRoute allow={['superadmin', 'admin', 'root_admin']} />}>
              <Route path="/admin/api-keys" element={<ApiKeysPage />} />
            </Route>

            <Route element={<ProtectedRoute allow={['superadmin', 'admin', 'root_admin']} />}>
              <Route path="/strategies/agents" element={<ReviewAgentsPage />} />
            </Route>

            <Route element={<ProtectedRoute platformOnly />}>
              <Route path="/admin/tenants" element={<TenantsAdminPage />} />
            </Route>

            {/* 知识库/图片库/人工审核策略已下线（root_admin 独占内容清理） */}
            <Route path="/resources/knowledge" element={<Navigate to="/overview" replace />} />
            <Route path="/resources/knowledge/:id" element={<Navigate to="/overview" replace />} />
            <Route path="/resources/images" element={<Navigate to="/resources/words" replace />} />
            <Route path="/resources/images/:id" element={<Navigate to="/resources/words" replace />} />
            <Route path="/human-review-rules" element={<Navigate to="/strategies" replace />} />
            <Route path="/resources/providers/:id" element={<Navigate to="/admin/models/large" replace />} />
            <Route path="/resources/models/:id" element={<Navigate to="/admin/models/large" replace />} />
          </Route>
        </Route>

        {/* 老的独立「知识库」页面（已下线） */}
        <Route path="/knowledge" element={<Navigate to="/overview" replace />} />
        <Route path="/knowledge/*" element={<Navigate to="/overview" replace />} />

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  )
}
