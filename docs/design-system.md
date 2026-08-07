# Design System · AdReview

来源：`ui-ux-pro-max` skill 推荐：**Trust & Authority**（适用于医疗/金融/企业 SaaS/合规类场景）。

## 1. 核心定位

- **关键词**：可信赖、权威、合规、企业级、克制
- **反模式**：避免过度装饰、霓虹渐变、emoji 图标

## 2. 配色（Design Tokens）

| Token | Light | Dark | 用途 |
|---|---|---|---|
| `--color-primary` | `#0F172A` | `#0F172A` | 品牌主色（深海军）、侧栏背景 |
| `--color-accent` | `#0369A1` | `#38BDF8` | CTA / 链接 / 选中态 |
| `--color-bg` | `#F8FAFC` | `#0F172A` | 页面底色 |
| `--color-surface` | `#FFFFFF` | `#1E293B` | 卡片 / Modal |
| `--color-text` | `#020617` | `#F8FAFC` | 主文本 |
| `--color-muted` | `#64748B` | `#94A3B8` | 弱化文本 |
| `--color-border` | `#E2E8F0` | `#334155` | 分割线 / 边框 |
| `--color-destructive` | `#DC2626` | `#F87171` | 危险操作 |
| `--color-success` | `#16A34A` | `#4ADE80` | 成功 |
| `--color-warning` | `#D97706` | `#FBBF24` | 警告 |

**对比度**：
- 主文本 `#020617` on `#FFFFFF` ≈ 19.5:1（AAA）
- 副文本 `#64748B` on `#FFFFFF` ≈ 4.6:1（AA 边界）
- Accent `#0369A1` on `#FFFFFF` ≈ 7.0:1（AAA）

## 3. 字体

- 主字体：Roboto（拉丁）
- 中文回退：PingFang SC → Microsoft YaHei → 系统 sans-serif
- 字号阶梯：12 / 14 / 16 / 18 / 24 / 32
- 行高：body 1.5，标题 1.25

## 4. 间距 / 圆角 / 阴影

- 间距：4 / 8 / 16 / 24 / 32（4pt 网格）
- 圆角：sm 4 · md 6 · lg 8
- 阴影：
  - `--shadow-card`: `0 1px 2px 0 rgba(15,23,42,.04), 0 1px 3px 0 rgba(15,23,42,.06)`
  - `--shadow-hover`: `0 4px 12px -2px rgba(15,23,42,.12)`

## 5. 组件原则

| 组件 | 规范 |
|---|---|
| 按钮 | 高度 36px，CTA 用 `--color-accent`，危险操作单独红色 |
| 表格 | 斑马纹关闭，hover `rgba(15,23,42,.04)`；分页 ≤ 50/页 |
| 表单 | 可见 label（非占位符替代）、必填 `*`、错误就近、提交后保留滚动位置 |
| Modal | 中心化，遮罩 50% 黑；ESC 关闭；含未保存提示 |
| Tag | 状态：default / processing / success / error / warning |
| 圈注 | 矩形 `2px solid #0369A1` + 12% 透明填充；坐标归一化 |

## 6. 可达性清单

- [x] 焦点环 2px accent + 2px offset
- [x] 触摸目标 ≥ 44×44pt
- [x] `prefers-reduced-motion` 全局生效
- [x] 文本对比度 ≥ 4.5:1
- [x] 图标全部 SVG / AntD Icons（无 emoji）
- [x] 表单错误就近显示
- [x] 路由级权限守卫（`<ProtectedRoute allow={...} />`）
- [x] 主导航键盘可达（AntD `Menu` 默认支持）
- [x] 关键页面有 `<title>`、`<meta viewport>`、`<meta theme-color>`

## 7. 反模式（避免）

- 使用紫色/粉色渐变作为 AI 主题
- emoji 作为功能图标
- 隐藏焦点环
- placeholder 替代 label
- 纯色表达状态（必须配合图标或文字）
- 动画时长 > 500ms
- 嵌套可滚动区域干扰主滚动
