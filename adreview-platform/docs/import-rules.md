# 通用审核规则批量导入

一个 admin 角色专属的批量入口，把表格化的审核项 / 审核点一次性灌进文本 / 图片两类**通用规则**（系统内置审核包）。

不在主产品侧栏菜单出现，只能在 admin 登录后通过 URL 直接访问。

## URL

| 用途 | URL |
|---|---|
| 页面 | `GET /import-rules` |
| 预览 | `POST /api/v1/admin/import-rules/preview` |
| 导入 | `POST /api/v1/admin/import-rules/import` |

## 鉴权

复用主产品的 JWT + `require_roles("admin")`。

```bash
TOKEN=$(curl -s -X POST http://localhost:8000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@adreview.example.com","password":"admin123"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
```

再把 `$TOKEN` 当 Bearer 用。

## 范围

- ✅ 文本通用规则 → 后端内部 → `text_audit_pro`
- ✅ 图片通用规则 → 后端内部 → `image_audit_pro`
- ❌ 音频 / 文档 / 视频 通用规则 → 本工具暂不支持（前端 Radio.Group 不会渲染、后端会 422 拒绝）

要在以后支持更多媒体类型：在
- `app/schemas/rule_import.py` 的 `MediaType` Literal
- `app/services/rule_importer.py` 的 `MEDIA_TO_SERVICE_CODE`
- `frontend/src/api/adminImportRules.ts` 的 `MEDIA_TYPE_OPTIONS`

各加一行；不需要改 router 或 page。

## 请求体

```jsonc
POST /api/v1/admin/import-rules/import
Authorization: Bearer <admin-token>

{
  "media_type": "text",                  // 必填："text" | "image"
  "kind": "personal",                     // 必填（默认 "personal"）：
                                         //   "personal" = 个性化规则，is_builtin=false
                                         //   "builtin"  = 通用规则，  is_builtin=true
  "table_text": "<三列表格文本>",
  "is_enabled": false,                    // 可选：批量覆写所有点的启用状态
  "on_conflict": "update",                // 可选：update | skip
  "confirm_downgrade": false,             // 可选：要从"通用"降级到"个性化"时必须 true
  "default_medium_threshold": 60.0,       // 可选：覆写所有点的中风险分
  "default_high_threshold": 90.0,         // 可选：覆写所有点的高风险分
  "default_risk_level": "中风险"          // 可选：覆写所有点的风险等级
}
```

## 分类（kind）与跨类行为

写入时新建的 item / point 的 `is_builtin` 由 `kind` 决定。

| 现有 row | 请求 kind | 行为 |
|---|---|---|
| 不存在 | personal | 新建为 `is_builtin=false` |
| 不存在 | builtin  | 新建为 `is_builtin=true`  |
| personal  | personal | 就地 update（默认 name_cn / is_enabled） |
| personal  | builtin  | 静默升级为 `is_builtin=true` |
| builtin   | builtin  | 就地 update（仅允许改 is_enabled / 阈值） |
| builtin   | personal | **422** — 除非带 `confirm_downgrade=true` 才会降级并写入，降级成功会在响应 `warnings` 字段告知 |

## 输入表格格式

三列；列分隔符自动识别（第一行命中后整张表沿用）：

| 分隔符 | 例子 |
|---|---|
| 全角竖线 ｜ | `涉政｜领导人｜涉政` |
| 半角竖线 \| | `涉政\|领导人\|涉政` |
| TAB | `涉政\t领导人\t涉政` |
| 双空格及以上 | `涉政  领导人  涉政` |

第一列「审核项」，第二列「审核点」，第三列「检测内容」。
- 第一列可省略 → 沿用上一行
- 第二列不能省
- 第三列可空

第一行包含「审核项 / 审核点 / 检测内容」任意 token 即被识别为表头；可没有表头。

## 字段映射

| 表列 | 数据库字段 |
|---|---|
| 审核项 | `audit_item.name_cn` |
| 审核点 | `audit_point.label_cn` |
| 检测内容 | `audit_point.description` |

`item.code` / `point.code` 由后端以 SHA1 派生（16 位 hex），对外不暴露。

## 样本

```
审核项 ｜ 审核点   ｜ 检测内容
涉政   ｜ 涉政言论 ｜ 涉及现任国家领导人姓名、绰号
       ｜ 涉政事件 ｜ 涉及敏感历史事件、集会
涉恐   ｜ 涉恐组织 ｜ 恐怖组织名称及别称
```

提交（POST `/import`，`media_type=text`，`on_conflict=update`）：

```jsonc
{
  "package_code": "text_audit_pro",
  "summary": {
    "items_created": 2, "items_updated": 0, "items_skipped": 0,
    "points_created": 3, "points_updated": 0, "points_skipped": 0,
  },
  "changes": [
    { "entity": "item",  "code": "im_<hex>", "label_cn": "涉政", "action": "create", "id": 1 },
    { "entity": "point", "code": "ip_<hex>", "item_code": "im_<hex>", "label_cn": "涉政言论", "description": "…", "action": "create", "id": 1 }
  ],
  "warnings": [],
  "errors": []
}
```

同 body 再跑 → 全部回到 `update`，ID 不变、数据幂等。

## 错误码

| 状态码 | 含义 |
|---|---|
| 401 | 未登录 / JWT 失效 |
| 403 | 已登录但角色不是 admin |
| 422 | `media_type` 不在白名单（text/image）；表格解析失败（含行号）；中风险分 ≥ 高风险分；通用审核项拒绝新增审核点；要把现有通用项降级为个性化但未带 `confirm_downgrade=true` |
| 409 | DB 唯一约束冲突（hash slug 撞库——极罕见） |

## `on_conflict`

- `update`（默认）：已存在的 item / point 就地修改可变字段。`builtin` 项只允许翻转 `is_enabled`；`builtin` 点只允许 `is_enabled` / `medium` / `high`。
- `skip`：已存在的不动，只在 summary 里计入 `skipped`，不报错。

## 安全边界

- **没有独立 token**：直接复用主产品 admin JWT。Revoke 账号 / 改密码即失效。
- **隐藏路由作为唯一门槛**：`/import-rules` URL 不挂在侧栏菜单，不在邮件 / 文档 / 分享链接中出现。这层是弱安全，admin 本身必须保持密码强度与定期轮换（与主产品其他 admin 页面同等对待）。
- **复用现有 builtin 守门**：与主产品「通用项不可改、通用项下不可加 point」的约束一致；本工具不会绕过。
