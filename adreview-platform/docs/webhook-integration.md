# Webhook 集成指南

本文档面向**外部机审模型**的回调集成。所有示例使用占位符 `<...>`，请按实际环境替换。

## 1. 概述

平台支持 `cron` 定时触发与 `external_callback` 外部回执两种触发方式。本文档说明**回调接入**。

外部机审模型回调到平台后，平台会：

1. 校验 IP 白名单（fail-closed，空白名单拒绝全部）。
2. 校验 `X-Timestamp` 防重放窗口（默认 5 分钟）。
3. 校验 HMAC-SHA256 签名。
4. 解析 payload，写入对应 `ReviewTask` 的终态。

## 2. 快速开始

### 2.1 创建回调触发器

在平台的「触发器」页面创建一个 `external_callback` 类型：

```
触发器名称：机审模型回执
Secret 别名：primary    ← 对应环境变量 WEBHOOK_SECRET_PRIMARY
```

创建后，平台会生成一个 32 字符的 `path_token`，URL 形如：

```
POST {APP_BASE_URL}/api/v1/webhooks/callback/{path_token}
```

### 2.2 配置 Secret

服务端环境变量（**注意大小写**）：

```bash
WEBHOOK_SECRET_PRIMARY=<your-shared-secret>
```

服务端不存储 secret，丢失后请重新生成并在客户端同步。

### 2.3 测试连通性

下面示例使用 Linux shell + openssl 计算签名：

```bash
APP_BASE_URL="https://your-host"
PATH_TOKEN="<your-32-char-path-token>"
SECRET="<your-shared-secret>"

BODY='{"task_id":123,"material_id":456,"decision":"approved","score":0.95,"labels":[],"timestamp":"2026-07-10T08:00:00Z","external_id":"client-uuid-001"}'
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
SIG="sha256=$(printf '%s%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')"

curl -X POST "$APP_BASE_URL/api/v1/webhooks/callback/$PATH_TOKEN" \
  -H "X-Signature: $SIG" \
  -H "X-Timestamp: $TS" \
  -H "Content-Type: application/json" \
  -d "$BODY"
```

成功响应：
```json
{ "received": true, "task_id": 123, "final_decision": "approved" }
```

## 3. 签名算法

### 3.1 计算方式

```
HMAC-SHA256(secret, X-Timestamp + raw_body)
```

- 拼接顺序：**先 `X-Timestamp` 字符串，再原始请求体**（不要加任何分隔符或换行）。
- 签名结果以 `sha256=<hex>` 形式通过 `X-Signature` header 发送。

### 3.2 各语言参考实现

#### Python

```python
import hmac, hashlib

def sign(secret: str, timestamp: str, body: bytes) -> str:
    msg = timestamp.encode() + body
    digest = hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()
    return f"sha256={digest}"
```

#### Node.js

```js
const crypto = require('crypto');

function sign(secret, timestamp, body) {
  const msg = Buffer.concat([Buffer.from(timestamp), body]);
  const digest = crypto.createHmac('sha256', secret).update(msg).digest('hex');
  return `sha256=${digest}`;
}
```

#### Go

```go
func Sign(secret, timestamp string, body []byte) string {
    h := hmac.New(sha256.New, []byte(secret))
    h.Write([]byte(timestamp))
    h.Write(body)
    return "sha256=" + hex.EncodeToString(h.Sum(nil))
}
```

## 4. Payload 字段定义

```json
{
  "task_id": 123,
  "material_id": 456,
  "decision": "approved",
  "score": 0.95,
  "labels": ["label_a", "label_b"],
  "reason": "可选，违规原因说明",
  "timestamp": "2026-07-10T08:00:00Z",
  "external_id": "client-uuid-001"
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `task_id` | int | 是 | 平台任务 ID |
| `material_id` | int | 是 | 素材 ID（与 task 必须匹配，否则 400） |
| `decision` | string | 是 | `approved` / `rejected` / `desensitize` |
| `score` | float | 否 | 模型置信度 0-1，写入 audit |
| `labels` | string[] | 否 | 命中标签，写入 audit |
| `reason` | string | 否 | 写入 audit `trigger.callback_reason` |
| `timestamp` | string | 否 | 客户端时间，ISO-8601 |
| `external_id` | string | 否 | 外部业务 ID，写入 audit 便于追踪 |

## 5. 错误码表

| HTTP | 含义 | 排查 |
|---|---|---|
| 200 | 成功 | — |
| 400 | 请求体错误 | 检查 `task_id` / `material_id` / `decision` 是否完整、JSON 是否合法 |
| 401 | 签名或时间戳失败 | 检查 `X-Signature` 计算方式、secret 是否一致、`X-Timestamp` 是否在 5 分钟内 |
| 403 | IP 不在白名单 | 在「Webhook IP 白名单」页面添加客户端出口 IP |
| 404 | 触发器不存在 | 检查 `path_token` 是否与触发器一致 |
| 409 | 触发器被禁用或类型错误 | 在平台启用触发器，或检查是否为 `external_callback` 类型 |
| 500 | 服务端配置错误 | 检查服务端 `WEBHOOK_SECRET_<ALIAS>` 环境变量是否设置 |

## 6. 安全建议

### 6.1 IP 白名单（应用层）

平台「系统设置 > Webhook IP 白名单」维护。**空白名单 = 拒绝所有请求**。

添加示例：
- CIDR：`203.0.113.0/24`
- 标签：生产机审模型出口
- 启用：是

### 6.2 IP 白名单（反代层，推荐）

生产环境建议在 nginx 反代层再设一道 IP 白名单：

```nginx
location /api/v1/webhooks/ {
    allow 203.0.113.0/24;   # 客户端出口
    deny all;
    proxy_pass http://127.0.0.1:8000;
}
```

### 6.3 防重放

- `X-Timestamp` 与服务端时钟偏差 > 5 分钟 → 401
- 客户端应使用真实 UTC 时间（`date -u` / `datetime.utcnow()`）
- 不要把 timestamp 缓存复用

### 6.4 secret 轮换

平台支持多 alias（`primary` / `secondary` / `backup`），可在不停服的情况下：
1. 在平台新建 trigger 选 `secondary`
2. 客户端切到 `secondary` secret
3. 删除原 `primary` trigger

## 7. 部署清单

部署 webhook 接收端前请确认：

- [ ] `WEBHOOK_SECRET_<ALIAS>` 已写入服务端环境变量
- [ ] 服务端与客户端时钟偏差 < 1 分钟（NTP）
- [ ] 平台「Webhook IP 白名单」已添加客户端出口 IP
- [ ] 已在平台创建 `external_callback` 触发器并启用
- [ ] 测试连通性 cURL 通过
- [ ] 反代层（nginx）已设 IP 白名单（如使用）

## 8. 监控建议

建议在服务端监控：

- `POST /api/v1/webhooks/callback/*` 的 4xx / 5xx 比例
- 401 比例突增 → secret 可能泄露或时钟漂移
- 403 比例突增 → IP 漂移或白名单缺失
- 重复 `external_id` 频率 → 客户端重试过频

平台会在「触发器详情 > 执行历史」展示所有 callback 回执记录。