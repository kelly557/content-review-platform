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
      ? `/knowledge/images/${params.id}`
      : `/knowledge/words/${params.id}`
  return <Navigate to={target} replace />
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
const StrategyListPage = lazy(() => import('@/pages/strategy/StrategyListPage'))
const CreateStrategyPage = lazy(() => import('@/pages/strategy/CreateStrategyPage'))
const WordLibraryListPage = lazy(() => import('@/pages/strategy/WordLibraryListPage'))
const ImageLibraryListPage = lazy(() => import('@/pages/strategy/ImageLibraryListPage'))
const WordLibraryDetailPage = lazy(() => import('@/pages/strategy/WordLibraryDetailPage'))
const ImageLibraryDetailPage = lazy(() => import('@/pages/strategy/ImageLibraryDetailPage'))
const ReplyLibraryListPage = lazy(() => import('@/pages/strategy/ReplyLibraryListPage'))
const ReplyLibraryDetailPage = lazy(() => import('@/pages/strategy/ReplyLibraryDetailPage'))
const StrategyRulesByTypePage = lazy(
  () => import('@/pages/strategy/StrategyRulesByTypePage'),
)
const ServiceRuleConfigPage = lazy(() => import('@/pages/strategy/ServiceRuleConfigPage'))
const PackageItemsPage = lazy(() => import('@/pages/packages/PackageItemsPage'))
const CreateAuditItemPage = lazy(() => import('@/pages/packages/CreateAuditItemPage'))
const AuditPointsPage = lazy(() => import('@/pages/packages/AuditPointsPage'))
const CreateAuditPointPage = lazy(() => import('@/pages/packages/CreateAuditPointPage'))
const TagsPage = lazy(() => import('@/pages/tags/TagsPage'))
const HumanReviewRulesPage = lazy(() => import('@/pages/strategy/HumanReviewRulesPage'))
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'))
const TriggersListPage = lazy(() => import('@/pages/triggers/TriggersListPage'))
const CreateTriggerPage = lazy(() => import('@/pages/triggers/CreateTriggerPage'))
const TriggerDetailPage = lazy(() => import('@/pages/triggers/TriggerDetailPage'))
const FeatureDisabledPage = lazy(() => import('@/pages/FeatureDisabledPage'))

function Fallback() {
  return <Spin style={{ display: 'block', margin: '20vh auto' }} />
}

export default function AppRoutes() {
  return (
    <Suspense fallback={<Fallback />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route index element={<Navigate to="/overview" replace />} />
            <Route path="/overview" element={<OverviewPage />} />

            <Route path="/materials" element={<MaterialsListPage />} />
            <Route path="/materials/:id" element={<MaterialDetailPage />} />

            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/tasks/new" element={<CreateTaskPage />} />
            <Route path="/tasks/:id" element={<TaskDetailPage />} />
            <Route path="/tasks/package/:id" element={<PackageDetailPage />} />

            <Route element={<ProtectedRoute allow={['reviewer', 'mlr', 'admin']} />}>
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/query" element={<QueryPage />} />
            </Route>

            <Route element={<ProtectedRoute allow={['admin', 'mlr']} />}>
              <Route path="/strategies" element={<StrategyListPage />} />
              <Route
                path="/strategies/rules-by-type/audio"
                element={<Navigate to="/strategies/rules-by-type/image" replace />}
              />
              <Route
                path="/strategies/rules-by-type/doc"
                element={<Navigate to="/strategies/rules-by-type/image" replace />}
              />
              <Route
                path="/strategies/rules-by-type/video"
                element={<Navigate to="/strategies/rules-by-type/image" replace />}
              />
              <Route
                path="/strategies/rules-by-type/:mediaType"
                element={<StrategyRulesByTypePage />}
              >
                <Route path=":itemId" element={<ServiceRuleConfigPage />} />
                <Route path="new" element={<CreateAuditItemPage />} />
              </Route>
              <Route path="/strategies/new" element={<CreateStrategyPage />} />
              <Route path="/strategies/:id/edit" element={<CreateStrategyPage />} />
              <Route path="/strategies/rules/:serviceCode" element={<ServiceRuleConfigPage />} />

              {/* 知识库（原「策略资源」） */}
              <Route path="/knowledge/words" element={<WordLibraryListPage />} />
              <Route path="/knowledge/words/:id" element={<WordLibraryDetailPage />} />
              <Route path="/knowledge/images" element={<ImageLibraryListPage />} />
              <Route path="/knowledge/images/:id" element={<ImageLibraryDetailPage />} />
              <Route path="/knowledge/replies" element={<ReplyLibraryListPage />} />
              <Route path="/knowledge/replies/:id" element={<ReplyLibraryDetailPage />} />

              {/* 旧路径 redirect 到新前缀 */}
              <Route
                path="/strategies/words"
                element={<Navigate to="/knowledge/words" replace />}
              />
              <Route
                path="/strategies/words/:id"
                element={<Navigate to="/knowledge/words/:id" replace />}
              />
              <Route
                path="/strategies/images"
                element={<Navigate to="/knowledge/images" replace />}
              />
              <Route
                path="/strategies/images/:id"
                element={<Navigate to="/knowledge/images/:id" replace />}
              />
              <Route
                path="/strategies/replies"
                element={<Navigate to="/knowledge/replies" replace />}
              />
              <Route
                path="/strategies/replies/:id"
                element={<Navigate to="/knowledge/replies/:id" replace />}
              />
              <Route
                path="/strategies/library-groups"
                element={<Navigate to="/knowledge/words" replace />}
              />
              <Route
                path="/strategies/custom-image"
                element={<Navigate to="/knowledge/images" replace />}
              />
              <Route
                path="/strategies/custom-text"
                element={<Navigate to="/knowledge/words" replace />}
              />
              <Route
                path="/strategies/library/image"
                element={<Navigate to="/knowledge/images" replace />}
              />
              <Route
                path="/strategies/library/word"
                element={<Navigate to="/knowledge/words" replace />}
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
            </Route>

            <Route path="/packages" element={<FeatureDisabledPage />} />
            <Route path="/packages/:id" element={<FeatureDisabledPage />} />

            <Route element={<ProtectedRoute allow={['admin']} />}>
              <Route path="/admin/users" element={<UsersAdminPage />} />
              <Route path="/triggers" element={<TriggersListPage />} />
              <Route path="/triggers/new" element={<CreateTriggerPage />} />
              <Route path="/triggers/:id" element={<TriggerDetailPage />} />
            </Route>

            <Route element={<ProtectedRoute allow={['admin', 'mlr']} />}>
              <Route path="/tags" element={<TagsPage />} />
              <Route path="/human-review-rules" element={<HumanReviewRulesPage />} />
            </Route>
          </Route>
        </Route>

        {/* 老的独立「知识库」页面（已下线） */}
        <Route path="/knowledge" element={<Navigate to="/knowledge/words" replace />} />

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  )
}
