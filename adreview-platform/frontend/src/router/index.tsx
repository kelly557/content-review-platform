import { Navigate, Route, Routes, useParams } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import { Spin } from 'antd'
import { ProtectedRoute } from './ProtectedRoute'
import AppLayout from '@/layouts/AppLayout'

const LoginPage = lazy(() => import('@/pages/auth/LoginPage'))
const DashboardPage = lazy(() => import('@/pages/dashboard/DashboardPage'))
const MaterialsListPage = lazy(() => import('@/pages/materials/MaterialsListPage'))
const MaterialDetailPage = lazy(() => import('@/pages/materials/MaterialDetailPage'))
const PackageDetailPage = lazy(() => import('@/pages/packages/PackageDetailPage'))
const TasksPage = lazy(() => import('@/pages/tasks/TasksPage'))
const TaskDetailPage = lazy(() => import('@/pages/tasks/TaskDetailPage'))
const CreateTaskPage = lazy(() => import('@/pages/tasks/CreateTaskPage'))
const ReportsPage = lazy(() => import('@/pages/reports/ReportsPage'))
const UsersAdminPage = lazy(() => import('@/pages/admin/UsersAdminPage'))
const StrategyListPage = lazy(() => import('@/pages/strategy/StrategyListPage'))
const CreateStrategyPage = lazy(() => import('@/pages/strategy/CreateStrategyPage'))
const WordLibraryListPage = lazy(() => import('@/pages/strategy/WordLibraryListPage'))
const ImageLibraryListPage = lazy(() => import('@/pages/strategy/ImageLibraryListPage'))
const WordLibraryDetailPage = lazy(() => import('@/pages/strategy/WordLibraryDetailPage'))
const ImageLibraryDetailPage = lazy(() => import('@/pages/strategy/ImageLibraryDetailPage'))
const LibraryGroupsPage = lazy(() => import('@/pages/strategy/LibraryGroupsPage'))
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
const KnowledgeBasePage = lazy(() => import('@/pages/knowledge/KnowledgeBasePage'))
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'))

function Fallback() {
  return <Spin style={{ display: 'block', margin: '20vh auto' }} />
}

function LegacyLibraryDetailRedirect() {
  const params = useParams<{ type?: string; id?: string }>()
  const target = `/strategies/${params.type === 'image' ? 'images' : 'words'}/${params.id ?? ''}`
  return <Navigate to={target} replace />
}

export default function AppRoutes() {
  return (
    <Suspense fallback={<Fallback />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />

            <Route path="/materials" element={<MaterialsListPage />} />
            <Route path="/materials/:id" element={<MaterialDetailPage />} />

            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/tasks/new" element={<CreateTaskPage />} />
            <Route path="/tasks/:id" element={<TaskDetailPage />} />
            <Route path="/tasks/package/:id" element={<PackageDetailPage />} />

            <Route element={<ProtectedRoute allow={['reviewer', 'mlr', 'admin']} />}>
              <Route path="/reports" element={<ReportsPage />} />
            </Route>

            <Route element={<ProtectedRoute allow={['admin', 'mlr']} />}>
              <Route path="/strategies" element={<StrategyListPage />} />
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
              <Route path="/strategies/words" element={<WordLibraryListPage />} />
              <Route path="/strategies/words/:id" element={<WordLibraryDetailPage />} />
              <Route path="/strategies/images" element={<ImageLibraryListPage />} />
              <Route path="/strategies/images/:id" element={<ImageLibraryDetailPage />} />
              <Route path="/strategies/library-groups" element={<LibraryGroupsPage />} />
              <Route
                path="/strategies/custom-image"
                element={<Navigate to="/strategies/images" replace />}
              />
              <Route
                path="/strategies/custom-text"
                element={<Navigate to="/strategies/words" replace />}
              />
              <Route
                path="/strategies/library/image"
                element={<Navigate to="/strategies/images" replace />}
              />
              <Route
                path="/strategies/library/word"
                element={<Navigate to="/strategies/words" replace />}
              />
              <Route
                path="/strategies/library/:type/:id"
                element={
                  <LegacyLibraryDetailRedirect />
                }
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

            <Route element={<ProtectedRoute allow={['admin']} />}>
              <Route path="/admin/users" element={<UsersAdminPage />} />
            </Route>

            <Route element={<ProtectedRoute allow={['admin', 'mlr']} />}>
              <Route path="/tags" element={<TagsPage />} />
              <Route path="/human-review-rules" element={<HumanReviewRulesPage />} />
              <Route path="/knowledge" element={<KnowledgeBasePage />} />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  )
}
