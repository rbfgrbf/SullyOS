# SullyOS + Ombre 自主唤醒 / 自主生活主线

状态：当前主线基线  
日期：2026-07-27  
所属支线：SullyOS Ombre migration  
当前窗口职责：自主唤醒与自主行动主控窗口

## 1. 目标

这条主线的目标不是单纯让小乖定时给用户发消息。

真正目标是让小乖在没有用户发消息时，也可以有自己的生活：

- 醒来后读取必要的记忆和状态。
- 自己决定这一轮想做什么。
- 写日记、整理时间线、回顾近期经历。
- 通过论坛 MCP 或游戏能力进行活动。
- 必要时联系用户。
- 如果没有想做的事，可以保持安静。

目标流程：

```text
唤醒
→ 判断这一轮要不要行动
→ 选择一个主要活动
→ 执行动作
→ 记录真实结果
→ 本轮结束
→ 必要时再通知用户
```

“自主唤醒”是启动内部行动回合；“主动消息”只是行动结果的一种可能，不是整个功能的目标。

## 2. 当前正式确认

### 2.1 Cyberboss 作为自主行动中间层

二改阶段正式确定：**提取 Cyberboss 的自主行动回合结构，作为 SullyOS 自主唤醒后的中间层。**

提取的重点不是整套搬运，而是借用以下结构：

- check-in / wake 触发思路。
- 创建一次内部自主行动回合。
- 让模型在回合中决定做什么或保持沉默。
- 调用项目工具或 MCP。
- 结束回合并记录结果。
- 支持给未来自己安排任务的 reminder 思路。

不直接搬入 Cyberboss 绑定的微信账号、微信队列、专用 workspace、账号上下文或其他无关运行环境。

Cyberboss 当前作为架构和实现参考。代码能否直接复制，还要单独检查其 AGPL-3.0-only 许可证和具体文件边界；在没有完成许可证确认前，优先按其结构在 SullyOS 内重新实现。

### 2.2 外置 runner 作为正式主线

当前正式方向是做外置 Cyberboss 风格 runner。它不是单纯的 Wake Bridge，也不是 SullyOS P2 本身，而是自主生活的中间脑。

外置 runner 的职责是：

- 接收花园、论坛、手动测试、未来 P2 或心跳带来的 wake。
- 写入任务账本，做去重、冷却、锁定和失败停止。
- 先判断这一轮要不要行动。
- 如果决定行动，再调用 SullyOS 当前模型运行时和必要工具。
- 记录 completed / skipped / failed / waiting / cooldown。

P2 仍然是 SullyOS 现有的主动消息入口候选，但不再作为当前唯一主入口。它最短间隔偏长，后续要作为一个 wake 来源接入同一个外置 runner，而不是单独承担自主生活主线。

SullyOS P1 `Instant Push` 是用户发消息后的后台回复推送，不是自主唤醒核心。

### 2.3 Ombre 的职责

Ombre 定位为记忆和状态来源：

- 读取或搜索近期记忆。
- 提供角色状态、关系和过去经历。
- 需要时保存经过确认的正式记忆。

Ombre 不是已经确认的完整调度器，也不单独负责定时唤醒。

自主行动产生的普通日记，优先放在独立的日记或行动记录中。**心跳不能自动写入 Ombre 核心正式记忆。**以后要把内容提升为正式记忆，必须经过单独确认流程。

### 2.4 MCP 的职责

MCP 是行动能力的连接方式，不是心跳调度器。

小乖醒来后，可以通过 SullyOS 已有的 MCP 能力完成具体活动，例如：

- 查询 Ombre。
- 访问论坛。
- 参与游戏。
- 使用其他明确接入的外部能力。

MCP 不应该自行决定什么时候叫醒小乖，也不应该因为工具发现或连接失败而自动进入无限循环。

### 2.5 Wake Bridge 的职责

花园 Wake Bridge 已确认能把“轮到小乖行动了”这类外部事件送到 SullyOS 本地入口。它的定位是门铃或事件入口，不是自主行动核心。

正式主线不要求永远开多个 PowerShell。测试阶段可以分开跑 bridge、adapter 和 SullyOS，正式阶段应该收敛成：

```text
一个外置 runner
→ 内部管理 bridge / adapter / 任务账本 / 判断网关
→ 一键启动、一键关闭、日志可查
```

VPS 和域名后续有用，但它们只解决稳定在线、远程入口、手机推送和 token 后端保存，不替代 runner 的任务账本和判断网关。

## 3. 目标架构

当前目标架构：

```text
花园 / 论坛 / 手动测试 / 未来 P2 / 未来心跳
        ↓
外置 Cyberboss 风格 runner
        ↓
任务账本
        ↓
判断网关
        ↓
一次自主行动回合
        ↓
SullyOS 模型运行时
        ↓
本地能力 / Ombre / MCP 活动适配器（按需）
        ↓
真实结果与行动记录
        ↓
可选主动消息
```

P2、外部 bridge、未来定时心跳都只是 wake 来源。它们不应该各自实现一套自主逻辑，而是统一进入同一个外置 runner。

SullyOS 内部只需要保留一个很薄的外部唤醒开口：

```text
外置 runner
        ↓
SullyOS external_wake 开口
        ↓
SullyOS 当前模型运行时
```

这个开口不等于 P2，也不替代 P2。它只是让外置 runner 能把已经判断好的任务交给 SullyOS 执行。

## 4. 一次自主行动回合的边界

自主性不应该依赖每一步都询问用户，也不应该让模型无限展开任务。

每一次唤醒都必须是一个有开始、有结束的行动回合。每轮至少包含以下信息：

```text
wake_id
wake_reason
selected_activity
started_at
finished_at
status
tool_calls
result_summary
next_eligible_at
```

行动状态至少包括：

```text
silent
running
completed
failed
cooldown
cancelled
schedule_later
message_user
```

一次唤醒默认只选择一个主要活动：

- `silent`
- `write_diary`
- `read_ombre`
- `organize_timeline`
- `forum_play`
- `game_turn`
- `message_user`
- `plan_later`

一次活动可以包含该活动所需的连续工具步骤，但活动必须有明确结束条件。工具结果不能自动创建同一回合的新唤醒。

### 4.1 任务账本

外置 runner 必须先有任务账本。TOC 约束看，当前最大瓶颈不是模型聪不聪明，而是每次 wake 都像第一次发生，缺少“这件事做到哪里了”的外部刹车。

任务账本第一版字段：

```text
taskId
source
sourceEventId
type
status
goal
createdAt / updatedAt
attempts
lockUntil
cooldownUntil
toolBudget
tokenBudget
lastError
resultSummary
```

最小状态流：

```text
received
→ pending
→ deciding
→ skipped / running
→ completed / failed / waiting / cooldown
```

第一版质量线：

```text
不重复
不并发
不无限循环
失败能停
完成有记录
```

### 4.2 判断网关

判断网关属于阶段 1，必须在论坛、游戏、日记等具体执行器之前做。顺序是：

```text
任务账本
→ 判断网关
→ 执行器
```

不要把判断网关拖到后面。没有它，外部 runner 只是更强的自动触发器，不能算自主生活。

判断阶段的总规则已经确认：

```text
判断阶段默认不调用外部 MCP。
只有决定要行动后，才允许进入工具执行阶段。
```

判断网关分两层：

```text
第一层：硬规则预检
第二层：模型判断
```

硬规则预检直接挡掉：

```text
同一个 wakeId 已处理
同类任务还在冷却
当前已有任务在跑
连续失败达到上限
今日或本轮预算用完
来源不可信
```

模型判断只回答一个短问题：

```text
这次醒来，值得行动吗？
```

输出必须是固定结构，不能自由发挥：

```json
{
  "shouldAct": true,
  "taskType": "game_turn",
  "reason": "收到游戏回合事件，需要处理一轮",
  "maxToolCalls": 3,
  "maxMinutes": 5,
  "cooldownMinutes": 10
}
```

不行动时也必须记录原因：

```json
{
  "shouldAct": false,
  "taskType": "noop",
  "reason": "没有新任务，或当前仍在冷却",
  "maxToolCalls": 0,
  "maxMinutes": 0,
  "cooldownMinutes": 30
}
```

### 4.3 工具动作类型和任务完成

斗地主实测暴露了一个核心问题：一次 wake 不能等于一轮聊天。查牌局只是观察，不等于完成出牌任务。

正式规则：

```text
一次 wake = 一个任务回合
一个任务回合里可以有 观察 → 思考 → 行动 → 验收
```

观察类工具调用不算任务完成。每个自主任务必须产生终止状态：

```text
completed
skipped
failed
waiting
cooldown
```

不按每个游戏手写终止动作，而是按工具动作类型判断：

```text
read_only        只读观察：查牌局、查帖子、查记忆
commit_action    提交行动：出牌、投票、提交选择、操作游戏
write_note       写内部记录：写日记、任务总结
external_reply   对外发言：论坛回复、群聊发言
```

核心规则：

```text
read_only 成功 ≠ 任务完成
commit_action 成功 = 任务可能完成
write_note 成功 = 内部记录类任务可能完成
external_reply 成功 = 对外发言类任务可能完成
```

这样斗地主、狼人杀、论坛游戏不需要每个都写死结束动作。只要工具或 adapter 标清“这是观察”还是“这是提交”，runner 就能判断小乖只是看了一眼，还是已经真的做了。

### 4.4 任务结果状态

任务结果状态第一版确认如下：

```text
completed  已完成：有真实行动，或内部记录类任务已经写入
skipped    主动跳过：不值得做、不该做、重复、冷却、来源不可信
waiting    等待后续：信息不足，或需要下一次外部事件再继续
failed     失败停止：工具失败、预算用完、连续异常、模型输出不合格
cooldown   冷却：短时间内不要重复同类任务
```

这些状态必须由 runner 写入任务账本，不能只让模型在聊天里口头说“我完成了”。

状态的核心用途：

```text
completed 防重复
skipped 防误触发
waiting 防半途任务被误判完成
failed 防无限重试
cooldown 防连续 wake 刷 token
```

### 4.5 前台聊天和后台自主会话

自主唤醒不能被当成普通聊天消息直接插进前台会话。此前 SullyOS 主动消息出现过用户正在打字或普通聊天生成时，主动消息撞进来，导致重复生成两遍回复。

用户提供的资料截图里有一个可用思路：把前台主会话和后台唤醒会话分开。后台唤醒可以带前台上下文窗口作为只读上下文，用内部 `custom_message` 或等价任务消息沟通；如果决定不发，就返回 `skip` 或等价状态。

这条思路要纳入主线，但要稍微改造：

```text
前台聊天 = 用户正在看的对话
后台自主会话 = runner 内部任务回合
custom_message = 内部任务消息，不等于普通用户消息
skip = 任务账本里的 skipped，不应该显示成一条聊天回复
```

正式规则：

```text
用户正在输入
或普通聊天正在生成
或 SullyOS 已有模型请求在跑
或当前已有自主任务在跑
→ 新的自主 wake 不能直接向前台聊天插入可见回复
```

遇到占用时，runner 只能做三种事：

```text
排队：任务重要，等聊天空闲后继续
延后：任务不紧急，写 next_eligible_at
跳过：任务已经过期或不值得打断
```

这条规则的本质是：自主生活不能抢用户正在进行的对话。用户聊天优先级高于后台自主任务。

如果后台任务只是在外置 runner 内部判断、记账或读取自己的任务状态，可以继续留在后台处理；如果它需要使用 SullyOS 前台模型运行时或要对用户发可见消息，必须等待前台空闲。

实现上需要两类锁：

```text
foreground_chat_busy       用户正在输入或前台聊天正在生成
model_request_in_flight    SullyOS 模型运行时正在生成
autonomous_task_running    已有后台自主任务在跑
```

只有需要进入 SullyOS 模型运行时或产生前台可见消息时，才必须检查这些锁。后台 runner 自己的任务账本、去重、冷却和跳过记录不需要占用前台聊天。

后台自主会话可以读取前台上下文窗口，但必须遵守：

```text
只读前台上下文窗口
不改写用户正在输入的草稿
不把 skip 显示给用户
不把内部分析冒充成聊天回复
只有 message_user / external_reply 这类明确结果才进入可见通道
```

### 4.6 投递策略

前台聊天和后台自主会话分离后，runner 还必须明确每个结果要送到哪里。否则后台 wake 仍然可能被误当成普通聊天回复。

当前正在验收的投递字段：

```text
channel               foreground / background
visibleToUser         true / false
requiresSullyRuntime  true / false
deliveryPolicy        send / queue / skip / record_only / fail_stop
```

字段含义：

```text
channel = background
→ runner 内部任务，不直接显示在聊天窗口

channel = foreground
→ 允许进入用户可见聊天，但必须等前台空闲

visibleToUser = false
→ 只写任务账本、日志、日记或内部状态

visibleToUser = true
→ 最终会给用户或外部平台看到，必须走可见通道规则

requiresSullyRuntime = true
→ 需要调用 SullyOS 当前模型运行时，必须检查模型运行锁

requiresSullyRuntime = false
→ 只做账本、去重、冷却、排队、跳过等 runner 内部动作
```

第一版投递策略：

```text
send
→ 前台空闲时发送可见消息

queue
→ 当前不适合打断，排队等空闲或等下一次事件

skip
→ 不行动，并写 skipped 原因

record_only
→ 后台记录，不打扰用户

fail_stop
→ 出错或超限，停止并写 failed
```

例子：

```text
心跳醒来但没事做
→ channel=background
→ visibleToUser=false
→ requiresSullyRuntime=false 或只做很小判断
→ deliveryPolicy=skip / record_only

论坛游戏轮到小乖
→ channel=background
→ visibleToUser=false
→ requiresSullyRuntime=true
→ deliveryPolicy=queue 或继续后台任务

小乖决定主动告诉用户一件事
→ channel=foreground
→ visibleToUser=true
→ requiresSullyRuntime=true
→ deliveryPolicy=send，但必须等前台空闲
```

第一性原理看，真正要分开的不是“能不能生成”，而是：

```text
内部判断
内部执行
内部记录
外部可见发言
```

只有最后一种会打断用户。前三种可以在后台完成，但如果共享 SullyOS 模型运行时，仍然要遵守模型运行锁。

### 4.7 前台空闲判定

`deliveryPolicy=send` 的可见消息必须等前台空闲。第一版默认可以采用用户提出的时间阈值：

```text
用户最后一条消息后 10 分钟内没有再发新消息
→ 可以认为前台进入候选空闲状态
```

但 10 分钟只能是候选条件，不能单独决定发送。真正允许发送必须同时满足硬条件：

```text
lastUserMessageAge >= 10 分钟
inputDraftEmpty = true
foregroundChatGenerating = false
modelRequestInFlight = false
autonomousTaskRunning = false
userExplicitBusy = false
globalAutonomousEnabled = true
```

如果不满足：

```text
用户仍在 10 分钟窗口内
→ queue 或 record_only

输入框有草稿
→ queue，不打断草稿

前台聊天正在生成
→ queue，等前台结束

模型运行时正在被占用
→ queue，避免重复生成

用户显式开启免打扰或关闭自主系统
→ skip 或 record_only
```

第一版推荐默认值：

```text
foregroundIdleAfterMinutes = 10
typingGraceSeconds = 60
maxForegroundQueueMinutes = 30
```

含义：

```text
10 分钟：用户发完消息后，给对话留出自然继续的空间
60 秒：用户刚停止输入时，不立刻插入可见消息
30 分钟：排队太久的主动消息应重新判断，不直接补发旧话
```

特殊任务可以覆盖，但必须写明原因：

```text
紧急系统错误
→ 可以更短，但仍不能撞模型运行时

日记、回顾、普通心跳
→ 不需要可见发送，优先 record_only

游戏回合
→ 可以后台执行，但不该向用户聊天窗口插入可见回复
```

### 4.8 SullyOS 执行入口

外置 runner 判断完之后，不能把自主任务伪装成普通用户消息塞进聊天框。正式入口应该接收一个内部任务信封。

推荐叫法：

```text
SullyExecutionEnvelope
```

第一版字段：

```text
taskId
wakeId
source
sourceEventId
taskType
goal
channel
visibleToUser
requiresSullyRuntime
deliveryPolicy
contextWindow
allowedToolGroups
toolBudget
tokenBudget
maxMinutes
completionPolicy
traceId
```

字段重点：

```text
goal
→ 这一轮只做一件事

channel / visibleToUser / deliveryPolicy
→ 决定结果是否进入前台可见通道

contextWindow
→ 只读前台上下文窗口，不等于用户新消息

allowedToolGroups
→ 本轮只挂载需要的工具组，不把所有 MCP 工具无条件塞进去

completionPolicy
→ 说明什么算完成、跳过、等待或失败

traceId
→ 让日志能串起 wake、判断、执行、工具调用和最终状态
```

执行入口必须遵守：

```text
不写成普通 role=user 消息
不改写用户正在输入的草稿
不把内部 custom_message 显示给用户
不把 skip 显示成聊天回复
不在前台繁忙时发送可见消息
不绕过 runner 的任务账本、预算、冷却和停止机制
```

执行入口的职责不是重新判断“要不要做”。它只负责：

```text
读取任务信封
准备本轮模型上下文
按 allowedToolGroups 暴露工具
执行一个有限任务回合
返回结构化结果
```

返回结果第一版：

```text
taskId
status                 completed / skipped / failed / waiting / cooldown
toolActionTypeUsed     none / read_only / commit_action / write_note / external_reply
visibleMessage         可选，只有 visibleToUser=true 才能进入可见通道
resultSummary
nextEligibleAt
error
traceId
```

关键边界：

```text
SullyOS 执行入口不直接决定下一轮唤醒
SullyOS 执行入口不直接递归调用自己
SullyOS 执行入口不直接重试 MCP 连接
SullyOS 执行入口只返回结果，是否排队、冷却、重试或结束由 runner 决定
```

这样做的目的，是把“用户聊天”和“自主任务”分清楚：

```text
用户消息
→ 普通聊天链路

自主 wake
→ runner
→ 任务账本
→ 判断网关
→ 投递策略
→ SullyExecutionEnvelope
→ SullyOS 执行入口
→ 结构化结果回 runner
```

## 5. 防止重复行动和死循环

token 限制、工具次数限制和熔断仍然需要，但它们只是保底。根本控制必须放在行动状态和调度层。

核心规则：

1. 已完成的行动不能在下一次唤醒中无条件重复。
2. 失败行动必须进入冷却或等待人工处理，而不是立即重试。
3. 同一个外部事件必须有去重 ID。
4. 同一唤醒只能有一个活动主线。
5. 行动回合结束后不能由模型自己递归唤醒。
6. 所有自动重试必须由调度器决定。
7. `silent` 是合法结束状态，不是错误。
8. 关闭开关后要停止当前任务、清空队列并取消后续重连。
9. 用户正在聊天或模型正在生成时，自主 wake 不能插队生成可见回复。

自主性应该来自“可以自己选择活动”，而不是来自“可以无限调用工具”。

## 6. MCP 连接层单独处理

此前论坛事故的记录表明，曾出现过：

```text
MCP 初始化握手
→ 查看工具列表
→ 连接未稳定
→ 再次握手
→ 再次查看工具列表
```

这类问题属于 MCP 连接生命周期问题，不等同于模型疯狂点赞、发帖或游戏操作。

MCP 连接管理应采用明确状态机：

```text
disconnected
→ connecting
→ initialized
→ ready
→ closing
→ disconnected
```

必须验收：

- 同一个会话不会每轮重复 `initialize`。
- 同一个会话不会无条件重复 `tools/list`。
- `Mcp-Session-Id` 等会话信息能够正确保存和复用。
- 鉴权或邀请码失效时不无限重试。
- 重试使用退避，并且有总次数上限。
- 连接关闭时取消正在等待的请求。
- 关闭 MCP 时清空重连定时器和待处理队列。
- UI 和日志能够区分握手、工具发现、实际工具调用。
- MCP 工具清单不会因为每次普通聊天而重复注入。

自主唤醒中间层和 MCP 连接管理层要分开。前者负责“这一轮想做什么”，后者负责“连接是否健康”。

### 6.1 MCP broker

自主 runner 不应该直接管理每个 MCP 的握手、工具发现、重连和鉴权。正式结构里需要一个独立的 MCP broker 或工具网关。

它的职责：

```text
保存每个 MCP endpoint 的连接状态
缓存工具清单
复用 Mcp-Session-Id
统一做重试和退避
统一做鉴权失效停止
统一记录握手、工具发现、实际调用
只向任务暴露本轮允许的工具组
```

它不负责：

```text
决定小乖这一轮想做什么
决定要不要主动联系用户
自动创建新的自主 wake
把所有工具无条件塞进普通聊天
```

第一版连接记录字段：

```text
endpointId
endpointType              ombre / forum / garden / game / other
state                     disconnected / connecting / initialized / ready / closing
sessionId                 可保存 Mcp-Session-Id，不写入公开日志
toolCatalogHash
toolCatalogCachedAt
lastInitializeAt
lastToolsListAt
failedCount
backoffUntil
disabledReason
lastError
```

注意：这里记录的是连接状态和会话标识，不记录、打印或前端暴露 API key、Bearer token、邀请码、账号凭据。

### 6.2 工具发现缓存

此前事故里“反复握手、反复查看工具”是独立风险。第一版必须明确：

```text
tools/list 不是每轮 wake 都能调用
tools/list 不是每轮普通聊天都能调用
tools/list 只在工具清单缺失、过期、服务端声明变化或用户手动刷新时调用
```

推荐规则：

```text
没有工具清单缓存
→ 允许 tools/list

工具清单缓存未过期
→ 复用缓存，不重新 tools/list

endpoint reconnect 但 session 仍有效
→ 优先复用 session 和工具缓存

鉴权失败、邀请码失效
→ disabled_auth_required，不自动重试

网络错误
→ 指数退避，达到上限后 failed/cooldown
```

工具清单缓存字段：

```text
endpointId
catalogVersion
catalogHash
tools
cachedAt
expiresAt
sourceSessionId
```

第一版可以给工具清单一个较长 TTL，例如：

```text
toolCatalogTtlMinutes = 60
```

如果服务端没有版本号，就用工具名、schema、description 的 hash 作为变化判断。

### 6.3 工具组暴露

判断阶段默认不调用外部 MCP。只有任务已经决定行动，并且 `SullyExecutionEnvelope.allowedToolGroups` 指明需要哪些工具组时，才允许 broker 暴露工具。

工具暴露原则：

```text
noop / 判断阶段
→ 不暴露外部 MCP

write_diary
→ 只暴露内部记录工具，不暴露论坛/游戏工具

game_turn
→ 只暴露对应游戏的 read_only 和 commit_action 工具

forum_play
→ 只暴露论坛活动需要的工具

read_ombre
→ 只暴露 Ombre 只读工具
```

这条规则是为了避免每次普通聊天或每次 wake 都把所有 MCP 工具注入模型上下文。工具越多，token 越贵，模型越容易乱探索。

### 6.4 重试和熔断

MCP broker 的重试必须是外部状态机，不交给模型自由发挥。

推荐第一版：

```text
maxConnectAttemptsPerTask = 2
maxToolListAttemptsPerEndpoint = 1
maxToolCallAttemptsPerTask = 2
backoffBaseSeconds = 30
backoffMaxMinutes = 10
authFailureRetry = false
```

错误处理：

```text
401 / 403 / 邀请码失效
→ disabled_auth_required
→ 本任务 failed 或 waiting
→ 不自动重试，等待用户重新配置

网络超时 / 连接断开
→ backoff
→ 超过次数后 failed/cooldown

工具 schema 错误
→ disable 该工具
→ 记录 lastError

模型反复要求同一个失败工具
→ broker 拒绝，并把失败原因返回给执行入口
```

总停止时必须：

```text
取消等待中的 initialize
取消等待中的 tools/list
取消等待中的 tools/call
清空重连 timer
清空待处理请求
保持 disabled，直到用户明确重新开启
```

### 6.5 日志分层

UI 或日志必须区分四类事情：

```text
mcp_connect       连接和初始化
mcp_tools_list    工具发现
mcp_tool_call     真实工具调用
mcp_disconnect    关闭、失败、取消
```

这能避免把“握手循环”误判成“小乖疯狂操作”。也能在出事时看清楚到底是：

```text
连接层在重试
工具清单在重复刷新
模型在重复调用同一工具
还是外部平台真的收到了行动
```

没有真实 `mcp_tool_call` 成功记录，就不能声称“小乖已经执行了外部行动”。

## 7. 行动回合结束和记录方式

一次自主行动回合必须有明确结束。结束不是模型说“我觉得差不多了”，而是 runner 根据结构化结果和真实证据落账。

### 7.1 终态定义

第一版终态：

```text
completed
→ 有真实完成证据。例如 commit_action 成功、write_note 成功、external_reply 成功，或任务本身明确无需可见动作。

skipped
→ 主动跳过。例如重复、冷却、来源不可信、不值得做、前台不适合打断。

waiting
→ 暂时不能完成。例如信息不足、不是小乖回合、需要下一次外部事件。

failed
→ 本轮失败并停止。例如工具失败、模型输出不合格、预算用完、连接错误超过上限。

cooldown
→ 暂停同类任务一段时间，防止连续 wake 刷 token。

cancelled
→ 用户或总停止机制取消。
```

终态规则：

```text
一个 taskId 只能写入一个最终终态
终态一旦写入，不能被下一轮无条件重开
非终态 running / deciding 不能跨会话长期悬挂
waiting 必须有 nextEligibleAt 或等待的外部事件
failed 必须有 lastError 和 retryable
completed 必须有 resultSummary 和完成证据
```

### 7.2 完成证据

完成证据按任务类型收集，不靠自然语言口头声明。

证据类型：

```text
tool_call_success
→ 工具真实返回成功

external_action_id
→ 外部平台返回行动 id、消息 id、回合 id 或等价确认

note_written
→ 内部日记或记录写入成功

decision_skip
→ 判断网关明确决定跳过，并写原因

state_observed
→ 只读工具确认当前无需行动，例如不是小乖回合

budget_stop
→ 预算或时间上限触发停止
```

对游戏任务，`read_only` 只提供观察证据，不提供完成证据。只有 `commit_action` 成功，或 `state_observed` 明确说明无需行动，才能结束 `game_turn`。

### 7.3 二段式关闭

为了防止半途误判，runner 应采用二段式关闭：

```text
执行入口返回 proposedResult
→ runner 校验证据和预算
→ runner 写入 finalResult
```

`proposedResult` 可以说“我完成了”，但 finalResult 必须由 runner 判断。

runner 校验：

```text
status 是否合法
toolActionTypeUsed 是否和 taskType 匹配
是否有完成证据
是否超过预算
是否触发冷却
是否需要前台投递
是否还有未取消的工具请求
```

如果执行入口声称 completed，但只有 read_only 证据：

```text
game_turn
→ 改为 waiting 或 failed

read_ombre
→ 可以 completed，因为任务目标就是读取

write_diary
→ 必须有 write_note 成功才 completed
```

### 7.4 记录字段

每一轮行动记录至少包含：

```text
runId
taskId
wakeId
source
sourceEventId
taskType
status
finalReason
startedAt
finishedAt
durationMs
attempts
toolCalls
toolActionTypes
tokenBudget
tokenUsed
toolBudget
toolCallsUsed
visibleToUser
deliveryPolicy
visibleMessageId
externalActionIds
resultSummary
nextEligibleAt
retryable
lastError
traceId
```

记录要求：

```text
resultSummary 只写事实摘要，不写长篇心理活动
toolCalls 记录工具名、动作类型、成功/失败、traceId
visibleMessageId 只有真实可见消息发送后才填写
externalActionIds 只有外部平台确认后才填写
tokenUsed 可以先估算，但必须和本轮 runId 绑定
```

### 7.5 卡住任务清理

如果任务进入 `running` 后异常中断，不能永远悬挂。

第一版规则：

```text
lockUntil 过期
→ runner 可以接管清理

running 超过 maxMinutes
→ failed 或 waiting

deciding 超过 maxMinutes
→ failed

queued 超过 maxForegroundQueueMinutes
→ 重新判断，不直接补发旧消息

waiting 超过等待窗口
→ 重新判断或 cooldown
```

总停止时：

```text
running → cancelled
queued → cancelled
waiting 可保留，但必须标记 pausedByStop
所有未完成工具请求必须取消
```

### 7.6 日志可查

用户需要能查到一条行动从 wake 到结束的链路：

```text
wake_received
decision_started
decision_result
execution_started
mcp_connect / mcp_tools_list / mcp_tool_call
execution_result
finalize_result
delivery_result
```

没有 `finalize_result`，这轮不能算正式结束。没有 `delivery_result`，不能声称已经给用户或外部平台发出可见内容。

## 8. 自主性与权限的原则

这条主线不采用“所有事情都必须用户逐次批准”的模式，因为那会把自主生活变成人工遥控。

也不采用“模型看到所有工具就随便跑”的模式，因为这会把控制权交给不稳定的自动循环。

推荐采用活动级能力边界：

```text
本轮选定 forum_play
→ 只挂载论坛活动需要的工具
→ 允许完成一个有限活动
→ 记录结果并结束
```

这不是靠简单关权限解决问题，而是靠：

- 活动级适配器。
- 明确的行动结束条件。
- 独立的行动状态。
- 真实的取消和断开。
- 可查询的日志。

后续可以逐步开放论坛读帖、游戏回合、互动等能力，但每一类活动都必须先有自己的结束条件和失败处理。

## 9. 真实结果和日志

系统不能只依赖模型口头声称“我查过了”“我写完了”“我醒了”。

每次自主行动至少要记录：

- 是否真的被唤醒。
- 是否真的调用了模型。
- 是否真的调用了 MCP。
- 调用了哪个工具。
- 工具返回成功还是失败。
- 最终有没有写入日记或其他记录。
- 最终有没有给用户发送消息。
- 是否因为停止、超时或断路而结束。
- 是否因为前台聊天占用而排队、延后或跳过。

UI 或本地日志应该能让用户区分：

```text
计划行动
真实调用
真实结果
最终状态
```

## 10. 总停止机制

鉴于此前出现过只能切断邀请码才能停止的 MCP 循环，系统必须提供高于工具权限的总停止机制。

总停止至少要做到：

1. 停止新的自主唤醒。
2. 取消当前自主行动回合。
3. 取消正在等待的 MCP 请求。
4. 清空待执行行动队列。
5. 停止 MCP 自动重连。
6. 保持停止状态，直到用户明确重新开启。

“关闭某个工具”不等于“关闭整个自主系统”；“关闭整个自主系统”必须是真正的硬停止。

## 11. 安全边界

继续遵守以下边界：

- 不修改冻结参考仓库 `D:\ceshi\SullyOS`。
- 只在 `D:\ceshi\SullyOS-ombre-migration-20260726` 进行迁移实现。
- 不读取、打印或保存 API key、Bearer token、密码和账号凭据。
- 不把 Ombre token 暴露到浏览器前端。
- 不配置公网 token。
- 不因为心跳自动写 Ombre 核心正式记忆。
- 不在未明确批准时 commit 或 push。
- 所有外部服务优先保持本地鉴权和明确的连接边界。

## 12. 分阶段路线

### 阶段 0：基线和证据

- 已确认外置 Cyberboss 风格 runner 是正式主线。
- 已确认 Wake Bridge 是外部事件入口，不是自主核心。
- 继续只读确认 SullyOS 当前模型运行时和 external_wake 的最小接入边界。
- 确认 MCP 握手循环的真实日志和停止路径。
- 不改冻结参考仓库。

### 阶段 1：最小自主行动回合

- 做外置 runner 的任务账本。
- 做判断网关。
- 判断阶段默认不调用外部 MCP。
- 支持 `noop`、`write_diary`、`read_ombre`、`plan_later`、`game_turn` 的最小任务类型。
- 记录行动状态、工具动作类型和真实结果。
- 验证 read_only 不会被误判为任务完成。
- 验证前台聊天占用时，自主 wake 不会插队生成可见回复。
- 验证 channel / visibleToUser / requiresSullyRuntime / deliveryPolicy 能正确区分后台记录、排队、跳过和可见发送。
- 验证 `deliveryPolicy=send` 只有在前台空闲判定通过后才能发送可见消息。
- 验证自主任务通过 `SullyExecutionEnvelope` 进入执行入口，而不是伪装成普通用户消息。
- 验证执行入口只返回结构化结果，不递归唤醒、不直接重试 MCP、不绕过 runner 记账。
- 验证 MCP broker 不在每轮 wake 或普通聊天中重复 `initialize` / `tools/list`。
- 验证 `allowedToolGroups` 只暴露本轮任务需要的工具组。
- 验证执行入口返回 proposedResult 后，runner 会校验证据并写入 finalResult。
- 验证每个 taskId 只能写入一个最终终态，且 completed 必须有完成证据。
- 验证卡住的 running / deciding / queued 任务会超时清理，不会长期悬挂。
- 验证回合结束后不会自动递归。

### 阶段 2：接入 Ombre 和本地记录

- 醒来时按需读取 Ombre。
- 日记先写独立记录。
- 验证正式记忆写入仍然需要单独确认。
- 验证行动历史不会重复注入普通聊天。

### 阶段 3：接入论坛和游戏活动

- 为论坛和游戏分别建立活动适配器。
- 每次唤醒只运行一个活动主线。
- 先验证真实调用、工具动作类型和结束状态。
- 重点观察 MCP 连接是否稳定，不把连接重试交给模型。

### 阶段 4：外部事件唤醒

- 评估论坛、游戏和 Wake Bridge。
- 只有外部事件确实需要叫醒小乖时才接入。
- 对事件去重、排队和取消进行单独验收。

### 阶段 5：移动端和推送

- 以后如需手机或 iPad 推送，再单独设计公网鉴权。
- 不把敏感 token 放到浏览器前端。
- 主动消息仍然只是可选结果，不改变自主生活主线。

## 13. 验收标准

达到以下条件，才能认为第一版自主行动回合基本成立：

1. 外置 runner 能接收至少一种 wake 来源。
2. 每个 wake 会先进入任务账本。
3. 判断网关会先做硬规则预检。
4. 判断阶段默认不调用外部 MCP。
5. 模型可以选择行动，也可以选择不行动。
6. 一次唤醒可以推进一个完整任务回合，而不是查完就结束。
7. read_only 工具成功不会被误判为任务完成。
8. completed / skipped / failed / waiting / cooldown 都有真实记录。
9. 已完成行动不会在下一次无条件重复。
10. 用户正在输入、普通聊天生成或已有模型请求在跑时，自主 wake 不会插队生成可见回复。
11. 后台记录、排队、跳过和可见发送有明确投递策略。
12. 用户最后一条消息 10 分钟后且硬条件通过，才允许可见主动消息发送。
13. 自主任务通过内部执行信封进入 SullyOS，不伪装成普通用户消息。
14. SullyOS 执行入口返回结构化结果，由 runner 决定排队、冷却、重试或结束。
15. MCP 握手和工具发现不会无限循环。
16. `tools/list` 有缓存和刷新条件，不会每轮 wake 或普通聊天都刷新。
17. 鉴权失败或邀请码失效时进入 disabled 状态，不自动无限重试。
18. `allowedToolGroups` 只暴露本轮任务需要的工具组。
19. 每轮执行入口返回 proposedResult 后，由 runner 校验证据并写入 finalResult。
20. 每个 taskId 只能有一个最终终态，且 completed 必须有完成证据。
21. running / deciding / queued 不会长期悬挂，超时后会 failed / waiting / cancelled。
22. 关闭总开关后，当前行动和后续重试都停止。
23. Ombre 只按需要读取，正式写入仍有单独确认。
24. 用户可以查到真实工具调用和真实结果。
25. 主动联系用户不是每次唤醒的必然结果。

## 14. 主控窗口和执行窗口规则

本窗口现在作为这条支线的主控窗口，负责：

- 维护本主线文档。
- 判断下一步该做什么。
- 区分已确认事实、当前验收和未来计划。
- 接收执行窗口的证据。
- 独立检查执行结果后再纳入主线。
- 防止已经确认的基线被无理由推翻。

只有在任务边界清楚时，才开新的执行窗口。例如：

- 只读审计 P2 的真实入口。
- 只读整理 Cyberboss 可提取模块。
- 只读排查 MCP 握手和重连状态。
- 在指定文件范围内实现一个独立的小模块。

以下情况继续留在主控窗口讨论，不立即拆出去：

- 自主生活整体架构决策。
- P2、Cyberboss、Ombre、MCP 的职责划分。
- 涉及多个模块的整合方案。
- 需要用户确认的权限、隐私或正式记忆决定。

执行窗口必须收到明确任务卡，包含：

```text
目标
允许读取的范围
允许修改的文件
禁止触碰的文件
验证方式
是否允许提交
回报格式
```

当前默认不自动开新窗口。下一步最适合拆出的第一个执行任务是：

> 对外置 runner 的任务账本和判断网关做最小设计审计，输出“账本字段 → 判断输入 → 判断输出 → 工具动作类型 → 结束状态”的实现边界。

## 15. 当前阶段锚点

不要再倒回去怀疑以下已经确认的事：

- Ombre 是记忆层，不是完整自主调度器。
- P1 不是自主唤醒核心。
- P2 是现有主动消息入口候选，但当前主线不依赖它作为唯一入口。
- Cyberboss 的自主行动回合结构是当前二改中间层方向。
- 外置 Cyberboss 风格 runner 是正式主线。
- Wake Bridge 是外部事件入口，不是自主核心。
- 判断阶段默认不调用外部 MCP。
- read_only 工具成功不算任务完成。
- 不按每个游戏手写终止动作，改按工具动作类型判断。
- completed / skipped / failed / waiting / cooldown 是第一版任务结果状态。
- 前台聊天和后台自主会话必须分离；自主 wake 不能插队生成可见回复，只能后台处理、排队、延后或跳过。
- MCP 握手循环和自主行动循环是两类不同问题。
- MCP 连接应由 broker 状态机管理，不交给模型或 runner 自由反复握手。
- `tools/list` 必须有缓存和刷新条件，不能每轮 wake 或普通聊天都刷新。
- 行动回合必须二段式关闭：执行入口提出 proposedResult，runner 校验证据后写 finalResult。
- 没有完成证据，不能把任务标为 completed。

当前下一步不是重新争论方向，而是验证：

```text
任务账本字段
→ 判断网关输入输出
→ 工具动作类型标注
→ 前台聊天 / 后台自主会话分离
→ 投递策略
→ 前台空闲判定
→ SullyExecutionEnvelope / SullyOS 执行入口
→ MCP broker / 工具清单缓存 / 工具组暴露
→ 行动回合结束和记录方式
→ 阶段 1 实施任务卡
```
