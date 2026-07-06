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
