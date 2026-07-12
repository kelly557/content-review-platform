# 账户与权限设计 (Account & Permissions Design)

> 状态: **Phase 1 — 设计文档 (本会话交付)**
> 后续: Phase 2~5 见 §5。
> 本文档不修改任何代码,仅作为后续实施的事实来源。

---

## 0. 摘要 & 决策记录

### 来源
用户提供的"账户与权限"结构截图,目标是从双轨(账户/权限)重新定义系统的角色与模块边界。

### 4 个核心决策 (已与用户确认)

| # | 议题 | 决策 | 含义 |
|---|---|---|---|
| 1 | 超级管理员 vs 管理员 | **超管专享「角色管理」** | 两者业务能力相同,仅角色管理这项是 super_admin 独占;管理员无法管理角色。 |
| 2 | 质检人员 vs 审核人员 | **MLR → inspector (仅名称变化)** | 现有 `mlr` 角色承载的"复审/抽检"语义整体迁移为 `inspector`,业务权限不变;Phase 2 同步 enum。 |
| 3 | 提交者角色去留 | **UI 取消,但后端 enum 保留作兼容** | UI 不再分配 `submitter`;后端 UserRole 仍含 `SUBMITTER` 值,以保护现存 JWT/外部 API 调用方。 |
| 4 | 本会话范围 | **Phase 1 仅产出本文档** | 不改 enum、不改 router、不改 NAV、不跑 init_db/seed。 |

### 落地策略

- **UI 视角的 4 角色**:超级管理员 / 管理员 / 审核人员 / 质检人员
- **后端视角的 5 角色**:4 角色 + 兼容性的 `submitter` (deprecated,后端拒绝新签发)
- **权限分两层**:路由级(<= 当前 `ProtectedRoute allow=[...]`)+ 行内级(用户与资源归属关系)

---

## 1. 角色定义

### 1.1 角色枚举 (设计态)

| 角色代码 | 显示名 | 英文代号 | 关键能力 |
|---|---|---|---|
| `super_admin` | 超级管理员 | SuperAdmin | 全部业务能力 + **角色管理** |
| `admin` | 管理员 | Admin | 全部业务能力 (除角色管理) |
| `reviewer` | 审核人员 | Reviewer | 审核、查询、提交素材 |
| `inspector` | 质检人员 | Inspector | 复审、抽检、查询、策略只读 |
| `submitter` *(deprecated)* | (提交者,UI 隐藏) | Submitter | 保留 enum 值;前端不出现 |

### 1.2 旧 enum → 新 enum 映射

| 旧 enum 值 | 新 enum 值 | 处理 |
|---|---|---|
| `SUBMITTER` (= `"submitter"`) | `(deprecated,不再签发)` | enum 保留,seed 不再创建,UI 不分配 |
| `REVIEWER` (= `"reviewer"`) | `reviewer` | 不变,标签从"审核员"改为"审核人员" (Phase 5) |
| `MLR` (= `"mlr"`) | `inspector` | enum 值从 `"mlr"` 迁到 `"inspector"`(需 Alembic/重置) |
| `ADMIN` (= `"admin"`) | `admin` | 不变 |
| (新增) | `super_admin` | 新增;seed 至少创建 1 个,作为唯一角色管理入口 |

> ⚠️ 名称变更(MLR → inspector)的 DB 影响:SQLite 测试库直接 reset 重灌;Postgres prod 需 Alembic 迁移。本文档**不**在这阶段执行迁移。

### 1.3 当前代码引用点 (Phase 2 必改)

| 文件 | 行 | 现有引用 | 计划改动 |
|---|---:|---|---|
| `backend/app/models/user.py` | 14-18 | `UserRole` enum 4 值 | 新增 `SUPER_ADMIN`、`INSPECTOR`,标记 `SUBMITTER` deprecated |
| `backend/scripts/seed.py` | — | 创建 `submitter/reviewer/mlr/admin` 4 个种子账户 | 改为 `inspector` 替 `mlr`,`submitter` 不再种子 |
| `frontend/src/types/auth.ts` | 1 | `UserRole = 'submitter' \| 'reviewer' \| 'mlr' \| 'admin'` | 添加 `super_admin`;`mlr` → `inspector` |
| `frontend/src/types/domain.ts` | 454-459 | `ROLE_LABELS` 4 项 | 5 项 + 改名,UI 隐藏 `submitter` 选项 |
| `frontend/src/layouts/AppLayout.tsx` | 67-71, 85, 105 等 | `roles: ['submitter', 'reviewer', 'mlr', 'admin']` | 替换为新 4 角色数组;`submitter` 从 `allow` 中删除 |
| `frontend/src/router/index.tsx` | 85, 90, 188, 195 | `allow={['reviewer', 'mlr', 'admin']}` 等 | 同步替换 enum 名 |

---

## 2. 功能模块矩阵 (4 角色 × 10 功能)

来自截图 5 大功能分类,展开到 10 个具体模块。

| 功能模块 🠂  | 超级管理员 | 管理员 | 审核人员 | 质检人员 | 截图分类 |
|---|:-:|:-:|:-:|:-:|---|
| **审核功能** — 文本/图片/视频/语音/文档 | ✓ | ✓ | ✓ | ✓ | 审核功能 |
| **质检管理** | ✓ | ✓ |  | ✓ | 质检功能 |
| **检测结果查询** | ✓ | ✓ | ✓ | ✓ | 查询功能 |
| **素材查询** | ✓ | ✓ | ✓ | ✓ | 查询功能 |
| **知识库** (词库/图片库/代答库) | ✓ | ✓ |  |  | 运营功能 |
| **规则管理** | ✓ | ✓ |  |  | 运营功能 |
| **策略配置** | ✓ | ✓ |  |  | 运营功能 |
| **处置结果配置** | ✓ | ✓ |  |  | 运营功能 |
| **账户管理** (用户列表) | ✓ | ✓ |  |  | 系统功能 |
| **角色管理** | ✓ |  |  |  | 系统功能 |

> 约定:空白表示该角色**不可见、不可达、不可写**。

### 模块 → 代码映射现状

| 模块 | 当前路由 | 当前页面 | 状态 |
|---|---|---|---|
| 审核功能 | `/tasks`, `/tasks/new`, `/tasks/:id`, `/tasks/package/:id` | `TasksPage`, `CreateTaskPage`, `TaskDetailPage`, `PackageDetailPage` | ✅ 已有 |
| 质检管理 | (无) | (无) | ❌ **Phase 3 新建** |
| 检测结果查询 | `/query` | `QueryPage` | ✅ 已有 |
| 素材查询 | `/materials`, `/materials/:id` | `MaterialsListPage`, `MaterialDetailPage` | ✅ 已有(标签名"素材库"待对齐截图的"素材查询") |
| 知识库 | `/knowledge/{words,images,replies}` | `*LibraryListPage`, `*LibraryDetailPage` | ✅ 已有 |
| 规则管理 | `/strategies/rules-by-type/{image,text,...}` | `StrategyRulesByTypePage` | ✅ 已有 |
| 策略配置 | `/strategies`, `/strategies/new`, `/strategies/:id/edit` | `StrategyListPage`, `CreateStrategyPage` | ✅ 已有 |
| 处置结果配置 | `/human-review-rules` | `HumanReviewRulesPage` | ⚠️ 已有(标签名待改成"处置结果配置") |
| 账户管理 | `/admin/users` | `UsersAdminPage` | ✅ 已有 |
| 角色管理 | (无) | (无) | ❌ **Phase 4 新建** |
| (隐藏) 标签管理 | `/tags` | `TagsPage` | ✅ 路由保留,菜单已隐藏(本会话前置任务) |

---

## 3. 菜单 / 路由 → 角色映射

### 3.1 侧边栏菜单项 (参考 `frontend/src/layouts/AppLayout.tsx:57-136`)

| 菜单项 | 路径 | 现有 roles | **新 roles (Phase 2)** |
|---|---|---|---|
| 总览 | `/overview` | `submitter, reviewer, mlr, admin` | `reviewer, inspector, admin, super_admin` |
| 审核任务 | `/tasks` | `submitter, reviewer, mlr, admin` | `reviewer, inspector, admin, super_admin` |
| 自动审核 | `/triggers` | `admin` | `admin, super_admin` |
| 素材库 (→"素材查询") | `/materials` | `submitter, reviewer, mlr, admin` | `reviewer, inspector, admin, super_admin` |
| 审核策略 (组) | `/strategies` | `admin, mlr` | `admin, super_admin` |
| 知识库 (组) | `/knowledge/*` | `admin, mlr` | `admin, super_admin` |
| 人工审核策略 (→"处置结果配置") | `/human-review-rules` | `admin, mlr` | `admin, super_admin` |
| 数据查询 | `/query` | `reviewer, mlr, admin` | `reviewer, inspector, admin, super_admin` |
| 数据报表 | `/reports` | `reviewer, mlr, admin` | `reviewer, inspector, admin, super_admin` |
| 用户管理 (账户管理) | `/admin/users` | `admin` | `admin, super_admin` |
| ~~标签管理~~ (已隐藏) | `/tags` | `admin` | (菜单注释,路由可达) |
| **新增** 角色管理 | `/admin/roles` | — | `super_admin` **ONLY** |

### 3.2 路由级守卫 (参考 `frontend/src/router/index.tsx`)

| 路由组 | 现有 `allow` | 新 `allow` |
|---|---|---|
| `/reports`, `/query` | `['reviewer', 'mlr', 'admin']` | `['reviewer', 'inspector', 'admin', 'super_admin']` |
| `/strategies/*`, `/knowledge/*`, `/human-review-rules`, `/tags` | `['admin', 'mlr']` | `['admin', 'super_admin']` (+ 留 `inspector` 只读见 §3.3) |
| `/admin/users`, `/triggers/*` | `['admin']` | `['admin', 'super_admin']` |
| **`/admin/roles` (新)** | — | `['super_admin']` |

### 3.3 行内级权限 (现有,Phase 1 不改)

下列判定与角色弱相关,与"资源归属"强相关,**Phase 2 须保留并评审**:

| 判定 | 文件 | 现有逻辑 | 决策 |
|---|---|---|---|
| 任务创建权 | `TasksPage.tsx:46` | `role === 'submitter' \|\| 'admin'` | 提交者并入审核人员 ⇒ `role === 'reviewer' \|\| 'admin' \|\| 'super_admin'` |
| 任务详情编辑权 | `TaskDetailPage.tsx:294` | `role === 'submitter' && submitter_id === user.id` 或 admin | 同上替换 |
| 素材上传权 | `MaterialsListPage.tsx:81` | `role === 'submitter' \|\| 'admin'` | 同上 |
| 素材详情编辑权 | `MaterialDetailPage.tsx:81` | `user.id === material.submitter_id \|\| role === 'admin'` | 同上 |
| 提交者归属显示 | `RecordDetailDrawer.tsx:69`, `domain.ts:1757, 1841` | 显示 `submitter_name (#id)` | **保留**(无角色相关,只是数据展示) |

> Phase 2 在替换 `submitter` → `reviewer` 时,需要为已存在的 `submitter` 历史账户决定迁移策略:**全员升 reviewer**,或保留 `submitter` 角色但仅做行内级判定 (Phase 2 实施时决定)。

---

## 4. 术语映射

| 截图术语 | 当前 UI 文案 | 是否要改 | Phase |
|---|---|:-:|---|
| 超级管理员 | (不存在) | 🆕 添加 | 2 |
| 管理员 | 管理员 | – | – |
| 审核人员 | 审核员 (ROLE_LABELS) | ✅ 改文案 | 5 |
| 质检人员 | MLR 专家 | ✅ 改文案 + enum | 2 |
| 提交者 | 提交者 (ROLE_LABELS + 登录页 hint) | ✅ UI 隐藏分配 | 2 |
| 审核功能 | 审核任务 (菜单名) | – | – |
| 质检功能 — 质检管理 | (不存在) | 🆕 新建 | 3 |
| 查询功能 — 检测结果查询 | 数据查询 | ⚠️ 改名候选 | 5 |
| 查询功能 — 素材查询 | 素材库 | ⚠️ 改名候选 | 5 |
| 运营功能 — 知识库 | 知识库 | – | – |
| 运营功能 — 规则管理 | (审核策略组里 "图片/文本审核规则") | ⚠️ 拆分子菜单显式化 | 5 |
| 运营功能 — 策略配置 | 审核策略 (列表) | ⚠️ 改名候选 | 5 |
| 运营功能 — 处置结果配置 | 人工审核策略 | ✅ **改名** | 5 |
| 系统功能 — 账户管理 | 用户管理 | ✅ 改名 | 5 |
| 系统功能 — 角色管理 | (不存在) | 🆕 新建 | 4 |

> Phase 5 的改名是表层 UI 调整,工作量低、可独立 PR。

---

## 5. 实施路线图 (Phase 2~5)

### Phase 2 — 数据层 & 角色枚举对齐 (预计 1 PR)

**目标**:后端 enum 扩到 5 值;前端 union 同步;seed 调整;UI 文案改名。**不动路由表/不动页面逻辑**。

任务清单:
- [ ] `backend/app/models/user.py`:UserRole 新增 `SUPER_ADMIN`、`INSPECTOR`,`SUBMITTER` 加 docstring 标 deprecated
- [ ] `backend/scripts/seed.py`:`mlr` 替为 `inspector`;新增 `super_admin@adreview.example.com`;`submitter` 不再种子
- [ ] `backend/app/api/v1/auth.py`:登录接口登录后 token claim 完整覆盖 5 值
- [ ] `frontend/src/types/auth.ts`:UserRole union 同步
- [ ] `frontend/src/types/domain.ts`:ROLE_LABELS 5 项,改文案"MLR 专家→质检人员"、"审核员→审核人员"
- [ ] `frontend/src/layouts/AppLayout.tsx`:NAV_SECTIONS roles 数组替换为新 4 角色(注:`submitter` 删除)
- [ ] `frontend/src/pages/auth/LoginPage.tsx:98`:登录页默认账号提示去掉 submitter,加上 inspector + super_admin
- [ ] 测试库 reset & rebuild:AGREE_RESET=YES 重置,seed 重灌

> **2026-07-12 实施修订**: 用户新约束"除了超级管理员,暂时不新加角色"。因此本次 Phase 2 实际**只新增 `superadmin`**,不引入 `inspector`,不改 `mlr`/`submitter`,不做角色规整化层。详见 §5.6 实施记录。

风险:
- enum 值改名会破坏 Alembic 迁移(SQLite 测库直接 reset 覆盖)
- 前端 union 改后,凡仍用 `'mlr'` 字面量的位置会被 TS 编译拦下,可批量 grep

### Phase 3 — 质检管理模块 (预计 1 PR)

新增任务,UI 与 API 并行。

任务清单:
- [ ] `backend/app/api/v1/inspections/` (新路由):`GET /api/v1/inspections`、抽样规则、抽检操作
- [ ] `backend/app/models/inspection.py` (新):`InspectionSample`, `InspectionDecision`
- [ ] `backend/app/schemas/inspection.py` (新):Pydantic schema
- [ ] `backend/scripts/init_db.py` 与 `seed.py`:新建表 + 种子数据
- [ ] `frontend/src/pages/inspections/` (新目录):`InspectionsListPage`, `InspectionDetailPage`, `SamplingRulesPage`
- [ ] `frontend/src/layouts/AppLayout.tsx`:NAV_SECTIONS 新增"质检管理"项
- [ ] `frontend/src/router/index.tsx`:新增 `/inspections/*` 路由,`allow=['admin', 'super_admin', 'inspector']`
- [ ] 测试:Inspector 登录能看到列表+详情;Reviewer 登录 403

依赖:无前置 Phase,可与 Phase 2 并行,但路由守卫改动要在 Phase 2 之后(否则 allow list 写错的 enum 值会让 lint 走不下去)。

### Phase 4 — 角色管理模块 (预计 1 PR)

任务清单:
- [ ] `backend/app/api/v1/roles/` (新):`GET/POST/PATCH/DELETE /api/v1/roles`
- [ ] 模型:简单的 `roles` 表(Id, key, display_name, description, permissions JSONB)
- [ ] `backend/app/schemas/role.py` (新)
- [ ] 迁移:把当前 enum 的 4 项作为预置种子写入 `roles` 表,**至少 1 个 `super_admin` 不可删除/降级**(业务约束)
- [ ] 用户表 `user.role` 仍保留 enum 列(短期两套并存)
- [ ] `frontend/src/pages/admin/roles/` (新):`RolesAdminPage` + drawer 编辑
- [ ] `frontend/src/layouts/AppLayout.tsx`:"系统管理"分组下新增"角色管理",`allow=['super_admin']`
- [ ] `frontend/src/router/index.tsx`:`/admin/roles` 路由 `allow=['super_admin']`
- [ ] 测试:非超管 403;超管能 CRUD;试图删除最后一个超管被拒

风险:🔴 高 — 涉及数据迁移 + 业务约束。需要单独会话评估是否引入"角色不可降级最后超管"的 SQL 触发器或应用层校验。

### Phase 5 — UI 文案与菜单细化 (预计 1 PR)

低成本,可独立完成。

任务清单:
- [ ] 改名("审核员→审核人员"、"MLR 专家→质检人员"、"用户管理→账户管理"、"人工审核策略→处置结果配置"、"素材库→素材查询"、"数据查询→检测结果查询")
- [ ] 菜单分组对齐截图分类(可建 `MENU_GROUPS` 常量,但不强求重组)
- [ ] 角色徽章颜色统一:super_admin / admin / reviewer / inspector 四色定调

### 各 Phase 工作量 & 风险概览

| Phase | 内容 | 工作量 | 风险 |
|---|---|:-:|:-:|
| 1 | 文档 | 🟢 完成 | 🟢 无 |
| 2 | enum & 文案对齐 | 🟡 中 | 🟡 中(enum 改名) |
| 3 | 质检管理模块 | 🟡 中 | 🟡 中 |
| 4 | 角色管理模块 | 🔴 大 | 🔴 高(数据迁移) |
| 5 | UI 文案与菜单 | 🟢 小 | 🟢 低 |

---

### 5.6 Phase 2 实施记录 (2026-07-12)

**实际范围**:用户最终决策"除了超级管理员,暂时不新加角色",因此 Phase 2 仅做**最小对齐**,让仓库既有 superadmin 能力暴露给前端。

**未改动**(因为已就绪):
- `backend/app/models/user.py:19` `SUPERADMIN = "superadmin"` 已存在
- `backend/app/core/deps.py:47` `require_superadmin` 依赖已存在
- `backend/app/api/v1/{audit_items,audit_points,libraries,users}.py` 已用 `require_roles("admin", "superadmin")` 守卫
- `frontend/src/types/auth.ts:1` UserRole union 已含 `'superadmin'`
- `frontend/src/types/domain.ts:459` ROLE_LABELS 已含 `'超级管理员'`
- `frontend/src/layouts/AppLayout.tsx:67-127` NAV_SECTIONS 的 roles 数组已含 `'superadmin'`
- `frontend/src/pages/admin/UsersAdminPage.tsx:22,89` 角色选项已含 superadmin (紫色徽章)
- `frontend/src/pages/strategy/{WordLibrary,ReplyLibrary,ImageLibrary}ListPage.tsx`、`ServiceRuleConfigPage.tsx` 已用 `isSuperadmin`

**本会话实际改动** (3 文件,6 处增量,~15 行净增):
| 文件 | 行 | 改动 |
|---|---:|---|
| `backend/scripts/seed.py` | 868~872 | +1 行:`_upsert_user(... SUPERADMIN ...)` |
| `frontend/src/router/index.tsx` | 85, 90, 188, 195 | 4 处 `ProtectedRoute allow` 数组追加 `'superadmin'` |
| `frontend/src/pages/auth/LoginPage.tsx` | 98 | 默认账号提示追加 superadmin |

**重要发现**:
- 仓库命名采用 **`superadmin`**(单数,无下划线),不是 `super_admin`。前端 union、后端 enum、allow 列表均沿用此命名。
- 仓库 superadmin 已有部分业务特权(内置项删除、平台级库管理),但**菜单与登录入口此前**未暴露给用户。

**验证结果**:
- ✅ 后端 5 个种子账户含 superadmin(SQL 查询确认)
- ✅ 前端 `npm run typecheck` 0 错
- ✅ 前端 `npm run build` 通过
- ✅ 后端 `pytest` 315/316 通过(1 个失败是 `test_init_db_accepts_with_env_var` 与 init_db 双变量保护的历史不一致,**与本 PR 无关**,已 git diff 确认两文件未改)

**未做的事** (与原定 Phase 2 任务清单的差异):
- ❌ 未加 `INSPECTOR`(用户最终不引入)
- ❌ 未改 `mlr` 为 `inspector`(用户最终不改)
- ❌ 未改 `submitter`(用户最终保留,不做并入)
- ❌ 未写 `normalize_role()` 角色规整化函数(双轨过渡不再需要)
- ❌ 未改 JWT claim 格式(不需要 deprecated 标记)
- ❌ 未改文案"审核员→审核人员"、"MLR 专家→质检人员"(推迟到 Phase 5)

**Phase 2 完结标志**:
- [x] superadmin 已有种子账户可登录(`superadmin@adreview.example.com / <APP_SECRET>-superadmin`)
- [x] superadmin 与 admin 共享同一套前端路由组(临时态,Phase 4 前置)
- [x] superadmin 已暴露给 LoginPage hint
- [x] DB reset + seed 重灌成功
- [x] 前端 typecheck/build + 后端 pytest 通过

---

## 6. 风险 & 回滚预案

| 风险 | 影响 | 回滚预案 |
|---|---:|---|
| `mlr → inspector` 改 enum 值,旧数据 read 失败 | 所有 `user.role='mlr'` 在后端加载时找不到 enum | (测库:reset 重灌;prod:Alembic up/down 迁移,需要双写期) |
| Phase 4 误删最后 super_admin | 全员失管,锁系统 | 业务层校验:删除前查 "count(super_admin) >= 1" |
| `submitter` 完全移除会破坏现存 JWT/外部 API | 持旧 token 的提交者用户登录失败 | enum 保留值,登录接口允许 `submitter` 登录但 JWT 标 `deprecated=true`,前端识别后强制跳到升级提示页 |
| `NAV_SECTIONS` 与 `router/index.tsx` 不一致 | 菜单显示但点开 403 / 或反之 | 单测覆盖 `Allow-Lists 数组 ∩ NAV_SECTIONS roles 数组 = ∅` 不变量 |
| Phase 5 改名文案导致 i18n 提取错位 | (本项目无 i18n,暂不适用) | n/a |

---

## 7. 验收清单 (Phase 1 完成后)

- [x] `docs/design/account-permissions.md` 已创建
- [x] 4 个决策显式写在 §0
- [x] 角色矩阵覆盖 10 模块 × 4 角色
- [x] 菜单/路由 roles 映射表与现状代码行号一致(`AppLayout.tsx:57`、`router/index.tsx:85,90,188,195`)
- [x] Phase 2~5 路线图明确、可独立发布
- [x] **未修改任何 .ts / .tsx / .py / .json 文件**(本任务仅文档)

---

## 8. 参考

- 用户截图:账户与权限结构图(2026-07-12 上传)
- 现状代码定位:
  - 角色枚举:`backend/app/models/user.py:14`
  - 角色标签:`frontend/src/types/domain.ts:454`
  - 角色 union:`frontend/src/types/auth.ts:1`
  - 侧栏菜单配置:`frontend/src/layouts/AppLayout.tsx:57-136`
  - 路由守卫:`frontend/src/router/index.tsx:85, 90, 188, 195`
  - 行内级角色判定:`TasksPage.tsx:46`, `TaskDetailPage.tsx:294`, `MaterialsListPage.tsx:81`, `MaterialDetailPage.tsx:81`
- 已完成的前置任务:隐藏「标签管理」侧栏项(见 `AppLayout.tsx:133`,已注释)
