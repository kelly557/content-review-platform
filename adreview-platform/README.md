# AdReview · 内容安全审核管理平台

面向企业市场部门的广告宣传品（海报、视频、PDF、文案等）审核管理平台，覆盖提交 → 初审 → 终审 → 通过/驳回 → 归档 全流程。

## 1. 技术栈

| 层 | 选型 |
|---|---|
| 后端框架 | **FastAPI** 0.115 + SQLAlchemy 2 (async) + Pydantic v2 |
| 数据库 | **PostgreSQL 15+**（开发可降级到 SQLite） |
| 鉴权 | JWT (python-jose) + bcrypt |
| 任务队列 | 内存 `asyncio.create_task`（视频转码/通知/报表） |
| 文件存储 | 本地文件系统（路径：`<STORAGE_ROOT>/uploads`） |
| 前端 | **React 18 + TypeScript + Vite** |
| UI | **Ant Design 5.x**（Trust & Authority 主题：深海军 + 蓝色 CTA） |
| 状态 | **Zustand** |
| 路由 | React Router v6 |
| 批注 | 自研 Canvas 圈注组件（基于图像的矩形区域绑定，坐标归一化） |
| 文档 | Swagger UI（`/docs`）+ Redoc（`/redoc`） |

## 2. 目录结构

```
adreview-platform/
├── backend/                          # Python 后端
│   ├── app/
│   │   ├── api/v1/                   # REST 路由（auth/users/materials/reviews/...）
│   │   ├── core/                     # 配置/日志/安全/依赖
│   │   ├── db/                       # SQLAlchemy 引擎 + Session
│   │   ├── models/                   # ORM 模型（User/Material/Workflow/Review/Annotation/Audit）
│   │   ├── schemas/                  # Pydantic v2 schemas
│   │   ├── services/                 # 业务服务（storage/audit/workflow_engine）
│   │   ├── tasks/                    # 内存后台任务
│   │   └── main.py                   # FastAPI 入口
│   ├── alembic/                      # 迁移（占位，待完善）
│   ├── scripts/
│   │   ├── dev.sh                    # 一键启动开发服务
│   │   └── seed.py                   # 种子数据
│   ├── storage/                      # 上传/缩略图/导出
│   ├── tests/                        # 单元/冒烟测试
│   ├── requirements.txt
│   └── .env.example
├── frontend/                         # React 前端
│   ├── src/
│   │   ├── api/                      # axios 客户端 + 业务 API
│   │   ├── components/               # AnnotationCanvas 等
│   │   ├── layouts/                  # AppLayout（侧栏 + 顶栏）
│   │   ├── pages/                    # auth/dashboard/materials/review/reports/admin
│   │   ├── router/                   # 路由 + 权限守卫
│   │   ├── store/                    # Zustand stores
│   │   ├── styles/                   # 主题 + 全局 CSS
│   │   ├── types/                    # TypeScript 类型
│   │   ├── utils/
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── public/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── .env.example
└── docs/
    └── design-system.md              # 设计系统说明
```

## 3. 快速开始

### 3.1 后端

环境要求：Python 3.11+（建议 3.12）、PostgreSQL 15+。

```bash
cd backend

# 1. 创建虚拟环境并安装依赖
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 2. 准备 .env
cp .env.example .env
# 编辑 .env，至少修改 DATABASE_URL 与 JWT_SECRET

# 3. 启动开发服务（自带 --reload）
./scripts/dev.sh
# 或显式启动：
# uvicorn app.main:app --reload --port 8000
```

健康检查：

```bash
curl http://localhost:8000/health
# {"status":"ok","app":"AdReview","version":"0.1.0"}
```

API 文档：

- Swagger UI: <http://localhost:8000/docs>
- Redoc:     <http://localhost:8000/redoc>
- OpenAPI:   <http://localhost:8000/openapi.json>

### 3.2 数据库迁移（占位）

当前 `app.db.session` 暴露 `Base` + 异步 engine。生产建议引入 Alembic：

```bash
alembic init alembic
# 配置 alembic/env.py 指向 app.db.session.Base.metadata
alembic revision --autogenerate -m "init"
alembic upgrade head
```

开发期快速建表（仅供本地）：

```python
# 在 Python REPL / 一次性脚本
import asyncio
from app.db.session import engine, Base
import app.models  # noqa
async def main():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
asyncio.run(main())
```

### 3.3 种子数据

```bash
source .venv/bin/activate
PYTHONPATH=. python scripts/seed.py
```

⚠️ **不要在已有业务数据的数据库上跑这条命令。**

`seed.py` 是幂等 upsert，但它会把所有 `audit_items` / `audit_points` / 阈值 / `is_builtin` 标记覆盖回 `DEFAULT_*` 字面值——你手动导入的审核规则会被静默改写。如果一定要跑，加上 `RESEED_ALLOWED=YES` 和 `--allow-reseed` 双确认，参考 `CLAUDE.md`「不允许用 seed.py 重置数据库」一节。

默认账号（密码可在脚本中修改）：

| 角色 | 邮箱 | 密码 |
|---|---|---|
| 管理员 | `admin@adreview.example.com` | `<APP_SECRET>-admin` |
| 审核员 | `reviewer@adreview.example.com` | `reviewer123` |
| MLR 专家 | `mlr@adreview.example.com` | `mlr12345` |
| 提交者 | `submitter@adreview.example.com` | `submitter123` |

> 注：种子脚本里 `admin` 密码使用了 `settings.app_secret + "-admin"`，与 `.env` 中的 `APP_SECRET` 联动。**生产请改为强密码并禁用明文密码日志**。

### 3.4 前端

环境要求：Node 20+。

```bash
cd frontend
npm install
cp .env.example .env.local       # 默认 VITE_API_BASE_URL=/api/v1
npm run dev                       # http://localhost:5173
```

开发态通过 Vite proxy 把 `/api/*` 转发到 `http://localhost:8000`。

### 3.5 部署到 Cloudflare Pages

前端可以直接部署到 Cloudflare Pages；当前仓库已通过 `[frontend/wrangler.jsonc](/Users/kelly/Documents/test/adreview-platform/frontend/wrangler.jsonc)` 配置 `assets.not_found_handling = "single-page-application"`，用于 SPA 路由回退，避免刷新子路由时返回 404。

推荐配置：

| 项 | 值 |
|---|---|
| Framework preset | `Vite` |
| Root directory | `adreview-platform/frontend` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node.js | 20 |

环境变量：

- 如前端和后端同域代理，保留默认值即可，前端会请求 `/api/v1`
- 如后端部署在独立域名，设置 `VITE_API_BASE_URL=https://your-api.example.com/api/v1`

注意：

- Cloudflare Pages 只托管前端静态站点，不会自动部署 FastAPI 后端
- 如果直接使用 Pages 默认域名，且后端不在同域，你需要额外处理 CORS 或反向代理
- 每次推送到 GitHub 后，Pages 可自动触发重新构建

### 3.6 部署后端到 Render

仓库已提供 `[render.yaml](/Users/kelly/Documents/test/adreview-platform/render.yaml)`，可直接用 Render Blueprint 创建后端 Web Service 和 PostgreSQL。

推荐步骤：

1. 在 Render 里选择 `New` -> `Blueprint`
2. 连接 GitHub 仓库 `kelly557/content-review-platform`
3. 让 Render 读取仓库根目录的 `render.yaml`
4. 创建完成后，进入 `content-review-platform-api` 服务，补两个环境变量：
   - `APP_BASE_URL=https://你的-render-后端域名`
   - `CORS_ORIGINS=["https://content-review-platform.kelly-d.workers.dev"]`
5. 等待 PostgreSQL 和 Web Service 都变成 `Live`

说明：

- `DATABASE_URL` / `DATABASE_URL_SYNC` 已在 `render.yaml` 里绑定到 Render PostgreSQL
- 代码已兼容 Render 原生的 `postgres://...` 连接串，无需手动改成 SQLAlchemy 方言
- `ALERT_SCANNER_ENABLED` 和 `MQ_CONSUMER_ENABLED` 默认关闭，先保证基础 API 可用

前端回填：

- 回到 Cloudflare 前端项目，新增环境变量：
  `VITE_API_BASE_URL=https://你的-render-后端域名/api/v1`
- 重新部署前端后，登录请求就不会再打到 `workers.dev/api/v1`

## 4. 核心领域模型

```
┌────────┐ 1    N ┌──────────────────┐ 1    N ┌────────────────────┐
│ User   │────────│ Material         │───────│ MaterialVersion    │
└────────┘ submits└────────┬─────────┘        │ (immutable snapshot)│
                          │ 1                  └────────────────────┘
                          │ N
                          ▼
                ┌─────────────────────┐ 1    N ┌───────────────┐
                │ WorkflowInstance    │───────│ WorkflowNode  │
                │ (running/approved/  │        │ (stage)       │
                │  rejected)          │        └───────┬───────┘
                └─────────┬───────────┘                │ 1
                          │ 1                          │ N
                          │ N                          ▼
                          ▼                  ┌──────────────────┐
                ┌─────────────────────┐      │ ReviewTask       │
                │ ReviewTask          │      │ + Assignment[]   │
                │ + Comment[]         │      │ + Comment[]      │
                └─────────────────────┘      └──────────────────┘
                          │
                          │ N
                          ▼
                ┌─────────────────────┐
                │ Annotation          │  ←── 圈注：page/frame/timestamp/x/y/w/h
                │ (per-version)       │
                └─────────────────────┘
```

- **Material / MaterialVersion**：每次上传/重新提交生成**不可变版本快照**（`MaterialVersion.version_no` 单调递增），保证审核与回溯总能绑定到具体版本。
- **WorkflowInstance + Node**：人工审核规则实例按模板生成节点；`mode ∈ {single, joint, all}` 决定会签/或签/全签语义。
- **Annotation**：圈注坐标归一化（0..1）以适配不同尺寸图像/视频帧；`page`/`frame`/`timestamp_ms` 用于 PDF 与视频。
- **AuditEvent**：所有状态变化均写入 append-only 审计日志，支撑合规与回溯。

## 5. API 摘要（v1）

| 模块 | 端点 | 角色 |
|---|---|---|
| 认证 | `POST /auth/login` · `POST /auth/refresh` · `GET /auth/me` | 全部 |
| 用户 | `GET/POST/PATCH /users[/{id}]` | admin |
| 素材 | `GET/POST /materials` · `GET/PATCH /materials/{id}` · `POST /materials/{id}/versions`（上传） · `GET /materials/{id}/versions/{v}/download` · `POST /materials/{id}/submit` | submitter/admin |
| 审核任务 | `GET /reviews/tasks` · `GET /reviews/tasks/{id}` · `POST /reviews/tasks/{id}/decide` · `.../transfer` · `.../add-reviewer` | reviewer/mlr/admin |
| 批注 | `GET/POST /annotations` · `PATCH /annotations/{id}/resolve` | 全部 |
| 人工审核规则 | `GET /workflows/templates` · `GET /workflows/instances/{id}` | 全部 |
| 报表 | `GET /reports/overview` · `GET /reports/audit/export.csv` | reviewer/mlr/admin |

> 完整 OpenAPI 见 `/docs` 或 `openapi.json`。

## 6. 设计系统

- **风格**：Trust & Authority（专业 + 高信任 + WCAG AAA）
- **配色**：
  - Primary `#0F172A`（深海军蓝）
  - Accent `#0369A1`（CTA 蓝）
  - Surface `#F8FAFC`（背景） / `#FFFFFF`（卡片）
  - Destructive `#DC2626` / Success `#16A34A` / Warning `#D97706`
- **字体**：Roboto（已为中文系统字体回退到 PingFang SC / Microsoft YaHei）
- **可达性**：
  - 所有焦点环 2px accent + 2px offset
  - 触摸目标 ≥ 44×44pt（AntD 组件默认满足）
  - `prefers-reduced-motion` 全局生效
  - 图标全部使用 `@ant-design/icons`（无 emoji）

详见 `docs/design-system.md`。

## 7. 测试

### 后端
```bash
cd backend
source .venv/bin/activate
PYTHONPATH=. DATABASE_URL=sqlite+aiosqlite:///:memory: pytest -v
```

### 前端
```bash
cd frontend
npm run typecheck
npm run lint
npm run build
```

## 8. 后续可扩展点

按需演进，不在本次脚手架范围内：

- **AI 智能预审**：OCR/VLM/ASR 多模态预处理、规则引擎、风险评分 → 已预留 `RuleTrigger` 钩子（在 `models/review.py` / `services/workflow_engine.py` 附近扩展）
- **微服务拆分**：审核引擎 / 文件服务可独立部署（FastAPI 无状态）
- **消息通知**：当前 `tasks/background.send_notification` 为占位，可接 Email/企业 IM webhook
- **Celery / ARQ**：将 `app/tasks/background.spawn` 替换为外部队列
- **审计报表**：当前仅导出 CSV；可扩展为 Excel + 可视化看板（前端已有 Reports 页面占位）

## 9. 开发约定

- 后端：所有公开方法 `async`；跨模块导入使用绝对路径 `from app.xxx import yyy`。
- 前端：`@/` 路径别名指向 `src/`；状态以 Zustand store 形式集中；API 客户端统一从 `@/api/*` 调用。
- 代码风格：保持简洁；优先可读类型/接口设计；不引入未在 spec 中要求的功能。
