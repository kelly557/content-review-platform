# 统一审核 API 业务流程图与数据流转图

本文基于 [moderation-openapi.yaml](/Users/kelly/Documents/test/adreview-platform/docs/moderation-openapi.yaml) 的现有接口设计整理，目标是把“谁发起、谁处理、产出什么、怎么聚合”讲清楚，便于产品、研发、审核策略、平台治理一起评审。

## 1. 业务总览树状图

```mermaid
flowchart TD
    A["统一审核 API"] --> B["同步审核<br/>POST /v1/moderation/check"]
    A --> C["异步审核任务<br/>POST /v1/moderation/jobs"]
    A --> D["异步任务查询<br/>GET /v1/moderation/jobs/{jobId}"]

    B --> B1["输入类型<br/>text / image / text_image / file / text_file"]
    B --> B2["适用场景<br/>短文本 / 单图 / 图文 / 小文件"]
    B --> B3["返回结果<br/>suggestion + details[] + advice[] + aggregation"]

    C --> C1["输入类型<br/>audio / video / file / batch"]
    C --> C2["预处理能力<br/>ASR / OCR / 抽帧 / 文件解析"]
    C --> C3["任务状态<br/>pending / processing / succeeded / failed / cancelled / expired"]
    C --> C4["输出模型<br/>与同步接口一致 + summary + segment"]

    D --> D1["处理中<br/>jobId + status + progress"]
    D --> D2["完成后<br/>suggestion + details[] + aggregation + summary"]

    B3 --> E["统一结果层"]
    C4 --> E
    E --> E1["最终动作<br/>pass / watch / mask / block"]
    E --> E2["维度结果<br/>content_moderation / prompt_attack / sensitive_data / malicious_file ..."]
    E --> E3["原子命中<br/>label / description / confidence / evidence / ext"]
    E --> E4["聚合解释<br/>winningSuggestion / winningDetails / notes"]
```

## 2. 业务决策树

```mermaid
flowchart TD
    A["业务方提交审核请求"] --> B{"素材类型?"}

    B -->|"text / image / text_image / file / text_file"| C{"是否能在单次在线请求内完成?"}
    B -->|"audio / video / batch / large file"| H["进入异步任务链路"]

    C -->|"是"| D["调用 POST /v1/moderation/check"]
    C -->|"否"| H

    D --> E["网关校验<br/>scene / input / options / context"]
    E --> F["同步执行审核维度<br/>content / sensitive / prompt / file / custom"]
    F --> G["聚合 detail 结果<br/>输出 suggestion + details + aggregation"]

    H --> I["调用 POST /v1/moderation/jobs"]
    I --> J["返回 jobId + pending"]
    J --> K["后台任务编排"]
    K --> L{"输入是否为媒体?"}

    L -->|"audio"| M["ASR -> transcript"]
    L -->|"video"| N["拆音轨 -> ASR"]
    L -->|"video"| O["抽帧 -> image moderation"]
    L -->|"video"| P["OCR -> text moderation"]
    L -->|"file"| Q["文件解析 / 文件扫描 / 文本提取"]
    L -->|"batch"| R["逐项分发处理"]

    M --> S["形成可审核对象"]
    N --> S
    O --> S
    P --> S
    Q --> S
    R --> S

    S --> T["执行各审核引擎"]
    T --> U["按 type + source 产出 details[]"]
    U --> V["统一聚合为最终 suggestion"]
    V --> W["GET /v1/moderation/jobs/{jobId} 查询结果或回调下发"]
```

## 3. 同步审核详细流程图

```mermaid
flowchart LR
    A["调用方"] --> B["POST /v1/moderation/check"]
    B --> C["接入层<br/>认证 / 限流 / schema 校验"]
    C --> D["场景策略层<br/>scene -> 默认 checks / 阈值 / 处置规则"]
    D --> E{"input.type"}

    E -->|"text"| F1["文本审核引擎"]
    E -->|"image"| F2["图片审核引擎"]
    E -->|"text_image"| F3["图文联合审核引擎"]
    E -->|"file"| F4["文件审核引擎"]
    E -->|"text_file"| F5["文本审核 + 文件审核"]

    F1 --> G["维度拆分<br/>content_moderation / prompt_attack / sensitive_data / custom_label"]
    F2 --> G
    F3 --> G
    F4 --> G
    F5 --> G

    G --> H["输出 details[]"]
    H --> I["聚合器<br/>suggestionPriority: block > mask > watch > pass"]
    I --> J["形成 aggregation<br/>winningSuggestion / winningLevel / winningDetails / notes"]
    J --> K["返回 ModerationDecision"]
    K --> L["业务方落地动作<br/>拦截 / 脱敏 / 放行 / 人工复核"]
```

## 4. 异步媒体审核详细流程图

```mermaid
flowchart TD
    A["调用方"] --> B["POST /v1/moderation/jobs"]
    B --> C["接入层<br/>校验 input / options / context"]
    C --> D["任务中心<br/>创建 jobId / 状态=pending"]
    D --> E["任务编排器"]

    E --> F{"input.type"}
    F -->|"audio"| G["音频预处理"]
    F -->|"video"| H["视频预处理"]
    F -->|"file"| I["文件解析 / 文件扫描"]
    F -->|"batch"| J["批量拆分"]

    G --> G1["ASR 转写"]
    G1 --> G2["按 transcript segment 切分"]

    H --> H1["拆音轨"]
    H1 --> H2["ASR 转写"]
    H --> H3["按 frameIntervalMs 抽帧"]
    H --> H4["OCR 提取画面文字"]
    H2 --> H5["ASR segment 集合"]
    H3 --> H6["frame 集合"]
    H4 --> H7["OCR segment 集合"]

    I --> I1["文件元数据提取"]
    I --> I2["文件安全扫描"]
    I --> I3["文本抽取 / 页面解析"]

    J --> J1["逐项分发到音频/视频/文件/文本链路"]

    G2 --> K["统一可审核对象池"]
    H5 --> K
    H6 --> K
    H7 --> K
    I1 --> K
    I2 --> K
    I3 --> K
    J1 --> K

    K --> L["审核引擎集群"]
    L --> L1["文本审核"]
    L --> L2["图片审核"]
    L --> L3["文件风险审核"]
    L --> L4["自定义策略审核"]

    L1 --> M["按 type + source 生成 details"]
    L2 --> M
    L3 --> M
    L4 --> M

    M --> N["聚合器"]
    N --> O["生成 summary + aggregation + advice + details"]
    O --> P["更新任务状态=succeeded"]
    P --> Q["GET /v1/moderation/jobs/{jobId} / callbackUrl"]
```

## 5. 结果聚合规则图

```mermaid
flowchart TD
    A["details[]"] --> B["逐个读取 detail.suggestion"]
    B --> C{"是否存在 block?"}
    C -->|"是"| D["final suggestion = block"]
    C -->|"否"| E{"是否存在 mask?"}
    E -->|"是"| F["final suggestion = mask"]
    E -->|"否"| G{"是否存在 watch?"}
    G -->|"是"| H["final suggestion = watch"]
    G -->|"否"| I["final suggestion = pass"]

    D --> J["提取所有 winning details"]
    F --> J
    H --> J
    I --> J

    J --> K["计算 final level<br/>从 winning details 取最强 level"]
    K --> L["生成 aggregation.policyId / policyVersion"]
    L --> M["输出 aggregation.winningSuggestion"]
    L --> N["输出 aggregation.winningDetails"]
    L --> O["输出 aggregation.notes"]
```

## 6. 数据流转图

```mermaid
flowchart LR
    A["业务客户端<br/>App / Web / BFF / AI 网关"] --> B["统一审核 API"]
    B --> C["接入与校验层"]
    C --> D["场景策略层"]
    D --> E["任务编排层"]

    E --> F["文本审核引擎"]
    E --> G["图片审核引擎"]
    E --> H["文件审核引擎"]
    E --> I["ASR 服务"]
    E --> J["OCR 服务"]
    E --> K["抽帧服务"]
    E --> L["自定义规则/标签服务"]

    I --> M["Transcript Segments"]
    J --> N["OCR Segments"]
    K --> O["Frame Images"]

    M --> F
    N --> F
    O --> G

    F --> P["维度结果 details[]"]
    G --> P
    H --> P
    L --> P

    P --> Q["聚合器 aggregation"]
    Q --> R["最终审核结果 ModerationDecision / ModerationJobResult"]
    R --> S["业务动作层<br/>拦截 / 脱敏 / 放行 / 人工复核 / 替代回复"]
    R --> T["审计与风控沉淀<br/>日志 / 报表 / 样本回流 / 策略优化"]
```

## 7. 数据对象流转图

```mermaid
flowchart TD
    A["请求入参"] --> A1["scene"]
    A --> A2["input"]
    A --> A3["options"]
    A --> A4["context"]

    A2 --> B1["原始素材对象"]
    B1 --> B2["text"]
    B1 --> B3["imageUrls"]
    B1 --> B4["fileUrls"]
    B1 --> B5["audio/video url"]

    B5 --> C1["预处理派生对象"]
    C1 --> C2["ASR transcript segments"]
    C1 --> C3["OCR text segments"]
    C1 --> C4["video frames"]
    C1 --> C5["file metadata / scan result"]

    B2 --> D["审核输入对象池"]
    B3 --> D
    B4 --> D
    C2 --> D
    C3 --> D
    C4 --> D
    C5 --> D

    D --> E["审核命中对象"]
    E --> E1["detail.type"]
    E --> E2["detail.source"]
    E --> E3["result.label"]
    E --> E4["result.evidence"]
    E --> E5["result.segment"]
    E --> E6["result.ext"]

    E --> F["聚合对象 aggregation"]
    F --> F1["policyId"]
    F --> F2["suggestionPriority"]
    F --> F3["winningSuggestion"]
    F --> F4["winningDetails"]
    F --> F5["notes"]

    F --> G["最终输出对象"]
    G --> G1["suggestion"]
    G --> G2["level"]
    G --> G3["details[]"]
    G --> G4["advice[]"]
    G --> G5["summary"]
    G --> G6["aggregation"]
```

## 8. 角色与职责图

```mermaid
flowchart TB
    A["调用方业务系统"] --> A1["选择 scene"]
    A --> A2["上传或引用素材"]
    A --> A3["消费 suggestion 并执行业务动作"]

    B["统一审核 API"] --> B1["参数校验"]
    B --> B2["能力路由"]
    B --> B3["结果统一建模"]

    C["媒体预处理服务"] --> C1["ASR"]
    C --> C2["OCR"]
    C --> C3["抽帧"]
    C --> C4["文件解析"]

    D["审核引擎"] --> D1["内容合规"]
    D --> D2["提示词攻击"]
    D --> D3["敏感信息"]
    D --> D4["恶意文件/链接"]
    D --> D5["自定义标签"]

    E["聚合器"] --> E1["按优先级选 suggestion"]
    E --> E2["确定 winning details"]
    E --> E3["输出 aggregation"]

    F["审核运营/策略团队"] --> F1["配置 scene 策略"]
    F --> F2["观察误杀漏杀"]
    F --> F3["回流样本优化规则"]
```

## 9. 研发落地建议

- 同步接口和异步接口要共用同一套 `ModerationDecision` / `ModerationDetail` / `ModerationResult` 领域模型。
- 音视频链路不要直接把原始媒体作为“审核结果”，而要先转成 transcript、OCR、frame 这些可审核对象。
- `source` 和 `segment` 在媒体场景里必须保留，否则最终结果不可解释。
- `aggregation` 不应只停留在文档说明里，必须真实出现在返回结构中，方便审计、排障和人工复核。
- 业务方真正执行动作时应优先看 `suggestion`，自动化规则优先看 `label`，运营解释再看 `description`。
