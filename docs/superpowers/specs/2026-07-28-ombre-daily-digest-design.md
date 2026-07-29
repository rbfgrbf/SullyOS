# SullyOS Ombre 分段摘要与漏存补记忆设计

日期：2026-07-28  
状态：分段触发方案和本机摘要桥接边界已获用户确认；待规格复核；尚未实现，不提交 commit。

## 1. 目标

让 SullyOS 不再依赖小乖临场记得调用记忆工具，而是由固定的本地分段流程处理聊天记录：

1. 读取完整聊天记录，不受聊天上下文条数限制，并按消息水位分段。
2. 每个角色累计 50 轮完整对话，或达到消息长度上限时触发一次分段摘要。
3. 上午、下午等本地时段结束时封存未处理分段；日终或下次打开时兜底处理。
4. 识别聊天中“已经存入记忆”的声明。
5. 先到 Ombre 查询，确认声明是否有真实记忆桶支持。
6. 已存在的内容跳过写入；聊天中声称已存但实际不存在的内容只补写一次。
7. 用 DeepSeek `deepseek-v4-flash` 生成分段摘要，再在时段/日终整理时决定正式写入内容。
8. 写入后必须 readback，失败时保留队列并可重试，不能把模型自述当成成功。

## 2. 已确认的项目边界

- 聊天记录保存在浏览器 IndexedDB 的 `messages` store；完整历史可通过 `DB.getMessagesByCharId(charId, true)` 读取，不使用当前聊天窗口的 110 条窗口。
- 现有 `ombreMcpClient` 默认只允许读取工具；`breath_search` 属于允许的查重/回读入口，并可能触碰活动元数据。
- 现有 confirmed write gate 目前只允许 `hold`，不允许直接把 `grow` 接到聊天流程。分段摘要的自动写入必须新增独立的、范围更窄的自动摘要写入闸门，不能绕过现有保护。
- 用于 Ombre 压缩/拆分和分段摘要的 DeepSeek Key 只保留在本机后台进程环境中（沿用
  `OMBRE_COMPRESS_API_KEY` 这一环境变量边界），不进入浏览器前端、localStorage、
  导出备份或日志。
- 浏览器页面关闭或进入后台后，前端定时器不能保证继续运行。因此“分段/时段处理”采用前台恢复语义：启动、回到前台或打开聊天时补处理所有未完成水位；不承诺页面关闭时准点执行。

## 3. 推荐架构

采用“浏览器本地队列 + 本机摘要桥接 + 本机 Ombre + 受控写入”流程：

```text
IndexedDB messages
        |
        v
Segment digest job (按角色、时段、消息水位去重)
        |
        +--> DeepSeek Flash: 提取已存声明、待存项目、分段摘要
        |
        +--> Ombre breath_search: 查已存在记忆
        |
        +--> 时段/日终整理后，只有缺失项目才进入自动 grow gate
        |
        +--> readback bucket/content -> 完成或保留失败状态
```

### 3.1 摘要输出

摘要模型只能输出结构化候选，不能自行决定写入。预期结构：

```json
{
  "storedClaims": [
    {
      "claim": "聊天中声称已经存入的内容",
      "sourceMessageIds": [123, 124]
    }
  ],
  "newMemoryItems": [
    {
      "content": "当天新增、值得进入记忆库的事实或事件",
      "sourceMessageIds": [125]
    }
  ],
  "segmentSummary": "这一分段发生了什么，不重复扩写已单独存储内容",
  "dailySummary": "时段/日终合并时生成的摘要，可为空",
  "excluded": ["普通寒暄、纯工具噪声、无法确认的推测"]
}
```

模型输出无法解析、缺少来源消息 ID、包含疑似 API Key/Token/密码等敏感内容时，整批进入 `failed`，不写 Ombre。

### 3.2 “已存”声明的真实核对

聊天里的“我已经存了”只作为待核对线索，不是成功证明。对每个 `storedClaim`：

1. 先查本地去重账本；已有成功记录则跳过网络写入。
2. 没有账本记录时，用内容片段调用 `breath_search`。
3. 只有命中明确 bucket ID 或足够长的内容片段才标记 `already-present`。
4. 只有语义相似但无法确认的结果进入 `needs-review`，不能自动再写一条。
5. 明确声称已存但找不到匹配时，进入 `missing-claimed-memory`，允许后续只补写一次。

`breath_search` 的 metadata touch 要写入本地审计，不把它伪装成严格零写入。

### 3.3 本机摘要桥接边界

MCP 服务器不能直接读取 SullyOS 浏览器里的 IndexedDB。聊天记录必须由 SullyOS
自己的前端模块通过 `DB.getMessagesByCharId(charId, true)` 读取，再主动提交给本机
摘要桥接。桥接服务只负责调用 DeepSeek Flash 并返回结构化结果，不负责发现或读取
SullyOS 数据，也不替代 SullyOS 调用 Ombre MCP。

推荐的数据边界如下：

```text
SullyOS IndexedDB
  -> SullyOS 读取完整聊天记录并做基础脱敏/限长
  -> 127.0.0.1 摘要桥接服务
  -> DeepSeek deepseek-v4-flash（Key 只在桥接进程环境变量）
  -> 结构化摘要回到 SullyOS
  -> SullyOS 通过现有 Ombre MCP 客户端执行 breath_search / 受控 grow / readback
```

桥接服务的约束：

- 只绑定 `127.0.0.1`，不绑定 `0.0.0.0`，不做内网穿透，不暴露公网地址。
- 使用独立端口（默认可定为 `17874`），不占用外部唤醒 `17873`、Ombre `18001`
  或现有 MCP 代理 `18061`；端口被占用时直接报错，不自动换到公网可访问端口。
- 不保存原始聊天内容、完整 prompt、Authorization、API Key 或 DeepSeek 返回原文日志。
  错误日志只保存 job ID、状态、脱敏错误分类和内容 hash。
- 只接受 SullyOS 需要的 `POST /v1/ombre/digest` 请求，并限制请求体大小、
  消息数、单条内容长度和处理超时。
- 提供 `GET /health` 只返回服务状态、模型名和是否配置完成，不返回 Key 或请求内容。
- 桥接服务不是 MCP 服务器，也不会让 Ombre 反向进入 SullyOS；它只是本机摘要 API。

桥接请求至少包含：

```json
{
  "protocolVersion": 1,
  "jobId": "稳定任务 ID",
  "charId": "角色 ID",
  "localDate": "2026-07-28",
  "messages": [
    {"id": 123, "role": "user", "type": "text", "timestamp": 0, "content": "..."}
  ]
}
```

桥接响应只允许返回符合预期 schema 的 `storedClaims`、`newMemoryItems`、
`segmentSummary`、`dailySummary`、`excluded` 和安全错误状态。响应缺少来源消息 ID、无法解析、疑似含有
API Key/Token/密码，或超出长度限制时，SullyOS 必须在 Ombre 写入前停止该任务。

这条设计不需要给外网“打开一道口子”。它只允许当前电脑上的 SullyOS 页面访问
当前电脑上的摘要服务；手机/iPad 后续通过内网穿透使用 SullyOS 时，也不能把这个
摘要桥接端口一并穿透出去。需要移动端触发摘要时，应由电脑上的 SullyOS/调度器执行，
而不是让手机直接访问 DeepSeek Key 所在的桥接服务。

### 3.4 分段、时段与日终的去重规则

- `missing-claimed-memory` 补写成功的项目，不再完整复制进 `dailySummary`。
- `already-present` 的项目只作为内部已核对引用，不进入新的 Ombre 写入正文。
- `segmentSummary` 只记录该分段尚未独立存储的新增信息；时段/日终合并不得重复复制已经写入的项目。
- 所有任务使用 `charId + localDate + sourceStartMessageId + sourceEndMessageId + contentHash` 生成稳定 job key。
- 同一个 job 已经 `written` 或 `readback-passed` 时，重复启动只返回已完成状态，不再次调用 `grow`。
- 分段摘要默认先保存为本地 checkpoint；达到时段/日终封存点后才合并成正式写入候选，避免每 50 轮都新建正式记忆。

## 4. 队列与状态

新增一个 IndexedDB store，例如 `ombre_digest_jobs`，不复用 `scheduled_messages`。每条任务至少包含：

- `id`：稳定 job key。
- `charId`、本地日期、时段标识、消息起止 ID、消息数量。
- `sourceHash`：本批原始消息的稳定指纹。
- `triggerReason`：`round-threshold`、`size-threshold`、`period-boundary`、`startup-recovery`。
- `status`：`pending`、`summarizing`、`checkpointed`、`reconciling`、`write-pending`、`written`、`readback-passed`、`failed`、`needs-review`。
- `attempts`、`lastError`、`updatedAt`。
- `storedClaims`、`newMemoryItems`、`segmentSummary`、`dailySummary` 的安全预览。
- `bucketIds`、`readbackStatus`、`auditId`。

同一角色同一时间只允许一个任务运行。页面崩溃后，超过租约时间的 `summarizing` 或 `reconciling` 任务可恢复；`write-pending` 不能盲目重写，必须先再次 `breath_search`。上一分段未完成时，不得创建重叠分段。

## 5. 自动写入闸门

自动摘要写入与角色聊天写入分开，第一版默认 `dry-run`。分段摘要本身先进入本地 checkpoint；时段/日终整理后的候选才进入正式写入闸门。切到真实写入前必须同时满足：

- 用户显式打开“摘要自动写入”开关。
- Ombre endpoint 必须是本机 loopback `http://127.0.0.1:18001/mcp`。
- 工具 allowlist 只包含本流程需要的 `breath_search` 和 `grow`。
- 每次运行有单批、单日和并发上限。
- 50 轮触发只产生一个分段 checkpoint，不等于立即新建一个正式记忆桶；正式写入按时段/日终批次合并。
- 写入正文经过敏感信息扫描和长度限制。
- 写入前已完成查重；写入后必须用 bucket ID 或内容片段 readback。
- 写入成功且 readback 失败时标记为不确定，不直接自动再次写入。
- 所有错误日志只保存脱敏后的错误、hash、bucket ID 和短预览，不保存 Key、Bearer 或完整请求头。

现有“角色聊天 confirmed write”仍维持原有规则，不因分段摘要功能而开放通用 `grow`。

摘要桥接本身不拥有 Ombre 写权限。`breath_search`、`grow` 和 readback 都由 SullyOS
任务状态机按独立 allowlist 调用；因此即使摘要服务被错误调用，也不能直接写入正式记忆。

## 6. 调度与恢复

第一版不依赖浏览器后台准点定时器，使用以下触发点：

- 每个角色累计 50 轮完整对话时触发；一轮定义为一条用户消息和对应的一条最终助手回复，系统消息、工具噪声和未完成回复不计入。
- 新增内容达到配置的最大字符数或估算 token 数时提前触发，不等待 50 轮。
- 本地时段边界触发封存，默认可用 12:00、18:00、24:00；只有存在未处理内容时才创建任务。
- SullyOS 启动后一次。
- 页面从后台回到前台时一次。
- 进入小乖聊天或设置页时一次轻量检查。
- 每次只扫描未完成的消息水位和时段，完成后不重复扫描整天记录。

如果当天聊天很多，按最大消息数和最大字符数分批；长批次失败时缩小批次重试。默认不在每条消息后调用模型，避免刷 token。浏览器关闭期间错过的触发点，在下次启动时按水位补处理，不声称后台准点运行。

## 7. 失败处理

| 阶段 | 失败行为 |
|---|---|
| 读取 IndexedDB | 任务保持 `pending`，下次前台恢复重试 |
| DeepSeek 摘要超时/401 | 保留原始消息范围和错误分类，不写 Ombre |
| `breath_search` 失败 | 不假定“不存在”，进入 `needs-review`，避免重复写入 |
| `grow` 失败 | 标记 `failed`，限制重试次数，不循环刷请求 |
| `grow` 成功、readback 失败 | 标记 `write-unknown`，下次先查重，不直接再写 |
| 内容疑似敏感 | 阻止写入，保留本地脱敏原因 |
| 页面关闭 | 任务留在 IndexedDB，下次启动继续 |

## 8. 测试范围

先用 mock MCP 和假摘要响应测试，不调用真实 Ombre：

- 完整历史读取不受 110 条窗口影响。
- 同一 job 重跑不会重复调用 `grow`。
- 已命中 bucket 的声明不会写入。
- 声称已存但查不到时只产生一个补写任务。
- `grow` 成功但 readback 失败时不会立即重复写入。
- DeepSeek 401、超时、无效 JSON、敏感内容都会停在写入之前。
- 页面恢复后能继续未完成任务，超过重试上限后进入人工处理。
- 49 轮不触发、50 轮触发；长消息达到字符/token 上限时可提前触发。
- 时段边界只封存未处理内容，不制造重叠分段；日终合并不重复写入分段已处理项目。
- 同一角色的两个触发点同时到达时只生成一个任务，锁释放前不会重复调用模型。
- Ombre Bearer/API Key 不进入浏览器日志、localStorage 或导出备份。

真实记忆写入验收另行进行，不能由单元测试或模型自述代替。

## 9. 非目标

- 本阶段不改 SullyOS 主线文档。
- 不把所有普通聊天自动写成正式记忆。
- 不开放 hold/grow 之外的 Ombre 写工具。
- 不把浏览器定时器包装成“电脑关闭时仍会执行”的后台服务。
- 不删除原始聊天记录或现有记忆。
- 不让公网 MCP、DeepSeek 或手机/iPad 直接读取 SullyOS IndexedDB。
- 不在浏览器代码、localStorage、备份导出或 MCP payload 中保存 DeepSeek API Key。
- 不把 `127.0.0.1` 摘要桥接端口通过内网穿透暴露给手机/iPad。

## 10. 对已关闭记忆宫殿的借鉴边界

- 记忆宫殿已经关闭，不作为当前运行依赖，不重新启用它的 UI、调度、数据库或状态机。
- 只借鉴已验证过的机制：每 50 轮触发、按角色计数、以上次处理时间/水位划分材料、
  同一角色并发锁，以及“绝大多数经历只保留为经历”的克制规则。
- Ombre 摘要使用独立的 `ombre_digest_jobs` 队列，不复用记忆宫殿的
  `digest_reports`、`processed` 标记或房间状态。
- 第一版只新增 Ombre 这条独立链路，先做 dry-run；不把历史记忆宫殿重新接回聊天流程。
