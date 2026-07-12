# AdReview Platform — 项目规则

继承全局 `~/.claude/CLAUDE.md` 的工具经济准则与一般行为。本文件仅记录项目特定约束。

## 技术栈

- **Backend**: FastAPI + SQLAlchemy 2.x async + asyncpg + Pydantic v2
- **Database**: PostgreSQL（async DSN），测试用 `sqlite+aiosqlite:///:memory:`
- **Frontend**: React 18 + TypeScript + Vite + Ant Design + Zustand
- **Auth**: JWT（python-jose）+ bcrypt
- **存储**: 本地文件存储（`STORAGE_ALLOWED_MIME` 是 JSON list，不是 CSV）

## 端口 & 进程

- 前端 dev 端口：**5273**（5173 被其他项目占用）
- 后端 dev 端口：8000
- 运行 PID 写在 `/tmp/adreview-*.pid`，日志 `/tmp/adreview-*.log`
- 虚拟环境：`backend/.venv`

## 数据库重建

**🚫 不允许用 `seed.py` / `init_db.py` 重置数据库**。已踩坑：

- `seed.py` 即使非 purgeme 也是 idempotent upsert，会把已经手工调过的 `is_builtin=true/false` 标记、阈值、enabled 全部覆盖回 DEFAULT_* 的字面值
- `init_db.py` 是 `DROP SCHEMA public CASCADE`，所有业务数据（导入的通用/个性化规则、strategy、人审配置、库、词条、trigger、alert_event …）**全部归零**
- 历史上 2026-07-12 16:30 误触 `seed.py` 导致前一轮手工导入的规则被静默盖写，事后无审计日志确认

**允许的做法**：

```bash
# 需要补种子/修默认 item 时，用 --dry-run 看清改了什么、确认无 --apply 才落
cd backend && source .venv/bin/activate
PYTHONPATH=. python3 scripts/seed.py --dry-run --purge-removed
PYTHONPATH=. python3 scripts/init_db.py   # 这个会直接拒绝，要求 RESET_DATABASE=YES I_KNOW=YES 双确认
```

**禁止**：

- ❌ 在已部署/含业务数据的 PG 上无脑跑 `python scripts/seed.py`
- ❌ 直接 `init_db.py` 不带双 env 验证
- ❌ 自动起/重启时跑 seed.py

`scripts/seed.py` 内部加了环境守门：未携带 `RESEED_ALLOWED=YES --reason <文本>` 时**直接 exit 1**，需要在 `seed.py` 头部对比 `/tmp/adreview.seed.lock`。

---

## 数据库重建（仅冷启动/dev 全新库）

**WARNING**: `init_db.py` 会 **DROP SCHEMA public CASCADE**，所有数据永久丢失。必须设置环境变量 `AGREE_RESET=YES` 确认。

```bash
cd backend
source .venv/bin/activate
AGREE_RESET=YES PYTHONPATH=. python3 scripts/init_db.py    # DROP & recreate（需确认）
PYTHONPATH=. python3 scripts/seed.py      # 默认数据（先清空 users/strategies/services 才能重跑）
```

用户邮箱必须 `.example.com`（pydantic[email] 拒绝 `.local`）。
admin 密码 = `APP_SECRET + "-admin"`（当前 `change-me-in-production-please-admin`）。
JWT access token 有效期 = **7 天免登录**（`JWT_ACCESS_TTL_MIN=10080`）。前端 `tokenStore` 用 `adreview.token_expires_at` 存过期时间戳（`LOGIN_TTL_DAYS=7`）；刷新/打开页面时 `fetchMe` 先校验是否过期，过期或 401 都自动清 token 跳 login。

## 布局与样式约定（关键 — 已踩坑）

### 「两侧大量空白」诊断清单

**症状**：截图/浏览器显示页面两侧留白过多，元素明显不贴侧栏或顶栏。

**优先排查**（按概率从高到低）：

1. **Page 顶层容器被锁宽 + 居中**
   ```tsx
   // ❌ 错误：把整页所有内容挤在 960px 居中盒子里
   <div style={{ maxWidth: 960, margin: '0 auto' }}>
     ...breadcrumbs, title, form, table 都在这 960px 里...
   </div>

   // ✅ 正确：铺满父容器
   <div style={{ width: '100%' }}>
   ```
2. 表格外层 `<div style={{ overflowX: 'auto' }}>`：本身没问题，但若页面已居中则叠加缩窄。
3. 表头 `<Card>` / `<Tabs>` / `<Drawer>` 等自带 padding/border 的组件。
4. `Form.style={{ maxWidth: X }}` 限定了字段宽度（仅影响输入区，不影响标题/表格）。
5. `Layout.Content` 的左右 padding 与 `Layout.Header` 不一致（视觉"错位"）。

### 「平铺」核心规则

- Page 顶层容器：**`width: '100%'`**，禁止 `maxWidth + margin: '0 auto'`。
- 子组件只允许：`<div>` / `<>...</>`，必要时 `<Row><Col span={X}>...`。
- **禁止** 在表格外再套 `<Card>`，如需视觉分割用 border / 间距即可。
- **禁止** `<div style={{ overflowX: 'auto' }}>` 包裹单层 Table（除非要很多列）。
- Table 列宽：百分比（`'30%'`）优于固定 px。
- Form `<Form.Item>` 子组件默认铺满父容器；如要限制输入宽度，限定到 `<Input style={{ maxWidth }}>` 而不是 `<Form>`。

### Header & Content 对齐

```tsx
// AppLayout.tsx
<Header style={{ padding: '0 20px', ... }}>
<Content style={{ padding: '20px', ... }}>
```

左右 padding 数值必须一致，否则视觉"错位"。

## API 路径

- 登录：`POST /api/v1/auth/login`
- 策略：`GET/POST /api/v1/strategies`、`GET/PUT/DELETE /api/v1/strategies/{id}`
- 服务（step2 选项）：`GET /api/v1/services?scope=&q=&size=`
- 默认策略是 singleton（不能删/复制）。`POST` body 必带 `name / application / services[]`；后端会把 `services` 合并进 `definition.services` JSONB。

## React 状态

- `useAuthStore` (Zustand)：`user`, `login`, `logout`
- `useUiStore`：`sidebarCollapsed`, `toggleSidebar`
- `selectedServices` (CreateStrategyForm local state)：Step 2 维护，提交时带回。

## 测试

```bash
cd backend && source .venv/bin/activate && python -m pytest tests -q
```

前端 typecheck & build：`npm run typecheck && npm run build`。都要求 0 错。
