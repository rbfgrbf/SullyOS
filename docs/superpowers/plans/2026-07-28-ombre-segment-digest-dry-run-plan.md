# SullyOS Ombre 分段摘要 Dry-Run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不调用真实 Ombre MCP 写工具的前提下，为每个角色建立按 50 轮/长度/时段触发的分段摘要 checkpoint，并通过本机 loopback 桥接服务使用 `deepseek-v4-flash` 返回可验证的结构化结果。

**Architecture:** SullyOS 从 IndexedDB 读取完整私聊消息，使用独立的消息水位和 `ombre_digest_jobs` 队列规划不重叠分段。浏览器只调用 `127.0.0.1` 的摘要桥接客户端，DeepSeek Key 只在 Node 桥接进程环境变量中；Phase 1 只保存本地 `checkpointed` 结果，不调用真实 Ombre `breath_search`、`grow` 或其他写工具。后续正式晋级单独经过 read-only 查重、人工/配置闸门和 readback 验收。

**Tech Stack:** TypeScript, React event lifecycle, IndexedDB, Vitest + fake-indexeddb, Node.js native `http`/`fetch`, OpenAI-compatible DeepSeek Chat Completions API.

## Global Constraints

- 不修改冻结参考 repo `D:\ceshi\SullyOS`。
- 不修改主线文档；只更新当前迁移 worktree 的设计/计划文件。
- 本计划阶段默认 `dry-run`，不调用真实 Ombre `hold`、`grow`、`trace`、`anchor`、`release`、`plan`、`letter_write` 等工具，也不启动 Ombre 服务。
- 浏览器不保存、打印或发送 DeepSeek API Key；Key 只由本机桥接进程读取 `OMBRE_COMPRESS_API_KEY`。
- 摘要桥接只绑定 `127.0.0.1`，默认端口 `17874`，不做内网穿透，不复用外部唤醒 `17873`、Ombre `18001` 或 MCP 代理 `18061`。
- 完整历史必须使用 `DB.getMessagesByCharId(charId, true)`；当前聊天窗口 110 条不是摘要输入上限。
- 分段触发使用每角色 50 轮完整对话作为默认水位；一轮是用户消息和对应最终助手回复，系统消息、工具噪声和未完成回复不计入轮数。
- 分段结果先写本地 checkpoint；达到时段/日终封存点后才形成正式写入候选，不能每 50 轮直接新建 Ombre bucket。
- 不复活已关闭的记忆宫殿 UI、调度、数据库或状态机，只借鉴其 50 轮计数、上次处理水位、并发锁和多数经历不升级为记忆的原则。
- 用户明确要求不 commit；本计划执行不包含 commit 步骤，也不撤销工作树中的其他未提交改动。

---

## File Map

- Create: `utils/ombre/ombreDigestTypes.ts` — 分段任务、触发原因、checkpoint 和 DeepSeek schema 类型。
- Create: `utils/ombre/ombreDigestPolicy.ts` — 纯函数：有效消息、完整轮数、长度上限、时段边界和稳定 job key。
- Create: `utils/ombre/ombreDigestPlanner.ts` — 根据消息水位和触发原因选择不重叠的可摘要分段。
- Create: `utils/ombre/ombreDigestPolicy.test.ts` — 有效消息、完整轮、长度估算、时段键和去重键测试。
- Create: `utils/ombre/ombreDigestPlanner.test.ts` — 50 轮/长度/时段触发、未完成尾部和不重叠边界测试。
- Modify: `utils/db.ts:24-27, 204-430` — DB version 从 68 升到 69，并创建 `ombre_digest_jobs` store 及索引。
- Create: `utils/ombre/ombreDigestDb.ts` — `ombre_digest_jobs` 的读写、状态更新和按角色/状态查询。
- Create: `utils/ombre/ombreDigestDb.test.ts` — IndexedDB DAO 的新增、更新、查询和失败状态持久化测试。
- Create: `utils/ombre/ombreDigestBridgeClient.ts` — 浏览器端 loopback 请求、超时、请求脱敏和响应 schema 校验。
- Create: `utils/ombre/ombreDigestBridgeClient.test.ts` — bridge 请求/响应安全边界测试，所有网络均使用 mock fetch。
- Create: `scripts/ombre-digest-bridge.mjs` — 只绑定 loopback 的本机 DeepSeek 摘要服务。
- Create: `scripts/ombre-digest-bridge.test.mjs` — Node 内置测试，覆盖 HTTP 验证和不泄漏 Key 的错误处理。
- Modify: `package.json:scripts` — 增加只运行 bridge Node 测试的显式命令，不改变默认 dev/build 行为。
- Create: `utils/ombre/ombreDigestRunner.ts` — 读取水位、创建任务、调用摘要器、保存 checkpoint；Phase 1 不拥有 Ombre 写权限。
- Create: `utils/ombre/ombreDigestRunner.test.ts` — 端到端 dry-run runner 测试，使用假的消息读取、假摘要返回和 fake DAO。
- Create: `utils/ombre/ombreDigestConfig.ts` — `off`/`dry-run` 配置，默认 `off`，不把 Key 或完整消息写入配置。
- Create: `utils/ombre/ombreDigestScheduler.ts` — 每角色单飞调度、事件去重和前台恢复入口。
- Create: `utils/ombre/ombreDigestScheduler.test.ts` — 同时触发只运行一次、关闭状态不运行、失败后可恢复测试。
- Modify: `context/OSContext.tsx:1677-1809` — 接入已有 `CHAT_GEN_EVENTS.replyArrived`、`active-msg-received` 和 `visibilitychange` 事件，只触发 scheduler 检查。

## Task 1: Define Segment Policy, Planner And Stable Data Types

**Files:**
- Create: `utils/ombre/ombreDigestTypes.ts`
- Create: `utils/ombre/ombreDigestPolicy.ts`
- Create: `utils/ombre/ombreDigestPlanner.ts`
- Test: `utils/ombre/ombreDigestPolicy.test.ts`
- Test: `utils/ombre/ombreDigestPlanner.test.ts`

**Interfaces:**
- `DigestTriggerReason = 'round-threshold' | 'size-threshold' | 'period-boundary' | 'startup-recovery'`
- `DigestJobStatus = 'pending' | 'summarizing' | 'checkpointed' | 'reconciling' | 'write-pending' | 'written' | 'readback-passed' | 'write-unknown' | 'failed' | 'needs-review'`
- `DigestTriggerConfig = { roundThreshold: number; maxSourceChars: number; maxEstimatedTokens: number; periodBoundariesMinutes: number[] }`
- `OmbreDigestJob = { id: string; charId: string; localDate: string; periodKey: string; sourceStartMessageId: number; sourceEndMessageId: number; sourceMessageCount: number; sourceHash: string; triggerReason: DigestTriggerReason; status: DigestJobStatus; attempts: number; lastError?: string; updatedAt: number; storedClaims?: unknown[]; newMemoryItems?: unknown[]; segmentSummary?: string; dailySummary?: string; bucketIds?: string[]; readbackStatus?: string; auditId?: string }`
- `DigestModelOutput = { storedClaims: Array<{ claim: string; sourceMessageIds: Array<number | string> }>; newMemoryItems: Array<{ content: string; sourceMessageIds: Array<number | string> }>; segmentSummary: string; dailySummary?: string; excluded: string[] }`
- `countCompletedRounds(messages: Message[]): number`
- `estimateDigestChars(messages: Message[]): number`
- `computeDigestSourceHash(messages: Message[]): Promise<string>`
- `buildDigestJobKey(input: { charId: string; localDate: string; sourceStartMessageId: number; sourceEndMessageId: number; sourceHash: string }): string`
- `getLocalPeriodKey(timestamp: number, timeZone: string): string`
- `DigestSegmentPlan = { sourceStartMessageId: number; sourceEndMessageId: number; sourceMessages: Message[]; sourceMessageCount: number; sourceHash: string; triggerReason: DigestTriggerReason; periodKey: string }`
- `planNextDigestSegment(input: { messages: Message[]; lastProcessedMessageId: number; reason: DigestTriggerReason; config: DigestTriggerConfig; now: number; timeZone: string }): Promise<DigestSegmentPlan | null>`

- [ ] **Step 1: Write failing policy tests.**

  Add tests that assert:

  ```ts
  expect(countCompletedRounds(makeUserAssistantPairs(49))).toBe(49);
  expect(countCompletedRounds(makeUserAssistantPairs(50))).toBe(50);
  expect(countCompletedRounds([{ role: 'user', content: '未回复' } as Message])).toBe(0);
  expect(countCompletedRounds([{ role: 'system', content: 'tool noise' } as Message])).toBe(0);
  expect(estimateDigestChars(messages)).toBe(messages.reduce((n, m) => n + m.content.length, 0));
  expect(buildDigestJobKey(input)).toBe(buildDigestJobKey(input));
  ```

- [ ] **Step 2: Run the focused test and verify it fails.**

  Run:

  ```powershell
  pnpm exec vitest run utils/ombre/ombreDigestPolicy.test.ts
  ```

  Expected: FAIL because the new policy module and exports do not exist.

- [ ] **Step 3: Implement the pure policy module.**

  Implement only deterministic logic. Count a round only when a non-system user message is followed by a non-system assistant message; ignore system/tool-noise records and leave an unmatched user tail outside the completed segment. Use the supplied `DigestTriggerConfig` for thresholds; do not read localStorage, call fetch, or call Ombre from this module. Implement `computeDigestSourceHash` with `crypto.subtle.digest('SHA-256', ...)` over a stable serialization of message IDs, roles, types, timestamps, and content; return lowercase hexadecimal.

- [ ] **Step 4: Run the focused test and verify it passes.**

  Run the same Vitest command. Expected: all policy tests PASS.

- [ ] **Step 5: Write failing segment-planner tests.**

  Add tests that assert:

  ```ts
  expect(planNextDigestSegment({ messages: makeUserAssistantPairs(49), lastProcessedMessageId: 0, reason: 'round-threshold', config })).toBeNull();
  expect(planNextDigestSegment({ messages: makeUserAssistantPairs(50), lastProcessedMessageId: 0, reason: 'round-threshold', config })).toMatchObject({ triggerReason: 'round-threshold' });
  expect(planNextDigestSegment({ messages: makeLongPair(), lastProcessedMessageId: 0, reason: 'size-threshold', config })).toMatchObject({ triggerReason: 'size-threshold' });
  expect(planNextDigestSegment({ messages: makePairsWithUnmatchedUser(), lastProcessedMessageId: 0, reason: 'round-threshold', config })?.sourceEndMessageId).toBe(lastCompletedAssistantId);
  ```

- [ ] **Step 6: Run the planner test and verify it fails.**

  Run:

  ```powershell
  pnpm exec vitest run utils/ombre/ombreDigestPlanner.test.ts
  ```

  Expected: FAIL because the planner module does not exist.

- [ ] **Step 7: Implement `planNextDigestSegment`.**

  Filter input to the current character's messages after `lastProcessedMessageId`, preserve chronological order, find the last complete user/assistant pair that fits the configured character/token cap, and return `null` when the requested trigger has not been reached. A period-boundary or startup-recovery request may seal available complete pairs below 50; an unmatched user tail remains for the next check so its later assistant reply is not detached from it. The planner must not read IndexedDB, call fetch, or call Ombre.

- [ ] **Step 8: Run the planner test and verify it passes.**

  Run the same Vitest command. Expected: all planner tests PASS.

## Task 2: Add The IndexedDB Digest Job Store

**Files:**
- Modify: `utils/db.ts:24-27, 204-430`
- Create: `utils/ombre/ombreDigestDb.ts`
- Test: `utils/ombre/ombreDigestDb.test.ts`

**Interfaces:**
- `putOmbreDigestJob(job: OmbreDigestJob): Promise<void>`
- `getOmbreDigestJob(id: string): Promise<OmbreDigestJob | undefined>`
- `updateOmbreDigestJob(id: string, patch: Partial<OmbreDigestJob>): Promise<OmbreDigestJob>`
- `listOmbreDigestJobs(charId: string, statuses?: DigestJobStatus[]): Promise<OmbreDigestJob[]>`
- `getLatestCompletedOmbreDigestJob(charId: string): Promise<OmbreDigestJob | undefined>`

- [ ] **Step 1: Write failing DAO tests.**

  Test that a job can be inserted, retrieved by stable ID, updated from `pending` to `checkpointed`, filtered by `charId` and status, and that the latest completed source end ID is selected without returning a different character's job.

- [ ] **Step 2: Run the focused DAO test and verify it fails.**

  Run:

  ```powershell
  pnpm exec vitest run utils/ombre/ombreDigestDb.test.ts
  ```

  Expected: FAIL because the store and DAO are not present.

- [ ] **Step 3: Add the version-69 store migration.**

  In `utils/db.ts`, set `DB_VERSION = 69`, add `STORE_OMBRE_DIGEST_JOBS = 'ombre_digest_jobs'`, and create the store idempotently with keyPath `id`. Add indexes for `charId`, `status`, `charId_status`, and `sourceEndMessageId`. Do not modify or delete existing stores, and keep the migration safe for databases already above version 69.

- [ ] **Step 4: Implement the DAO with short IndexedDB transactions.**

  Use the existing `openDB()` singleton. `updateOmbreDigestJob` must read the existing record, merge the patch, write one record, and reject when the job ID does not exist. Never store raw source messages, API keys, bearer headers, or full DeepSeek responses in this store.

- [ ] **Step 5: Run the focused DAO test and verify it passes.**

  Run the same Vitest command. Expected: all DAO tests PASS.

## Task 3: Build The Browser Bridge Client And Schema Guard

**Files:**
- Create: `utils/ombre/ombreDigestBridgeClient.ts`
- Test: `utils/ombre/ombreDigestBridgeClient.test.ts`

**Interfaces:**
- `DigestBridgeRequest = { protocolVersion: 1; jobId: string; charId: string; localDate: string; messages: Array<{ id: number; role: 'user' | 'assistant'; type: string; timestamp: number; content: string }> }`
- `requestOmbreDigest(input: DigestBridgeRequest, options?: { endpoint?: string; fetchImpl?: typeof fetch; timeoutMs?: number }): Promise<DigestModelOutput>`
- `sanitizeDigestMessages(messages: Message[], limits: { maxMessages: number; maxCharsPerMessage: number }): DigestBridgeRequest['messages']`
- `parseDigestModelOutput(value: unknown): DigestModelOutput`

- [ ] **Step 1: Write failing client tests.**

  Cover these cases:

  ```ts
  expect(sanitizeDigestMessages([messageWithApiKey], limits)[0].content).not.toContain('sk-');
  await expect(requestOmbreDigest(request, { fetchImpl: rejectedFetch })).rejects.toThrow(/bridge/i);
  await expect(requestOmbreDigest(request, { fetchImpl: hangingFetch, timeoutMs: 10 })).rejects.toThrow(/timeout/i);
  expect(parseDigestModelOutput(validOutput)).toEqual(validOutput);
  expect(() => parseDigestModelOutput({ newMemoryItems: 'not-array' })).toThrow(/schema/i);
  ```

- [ ] **Step 2: Run the focused test and verify it fails.**

  Run:

  ```powershell
  pnpm exec vitest run utils/ombre/ombreDigestBridgeClient.test.ts
  ```

  Expected: FAIL because the client and schema guard do not exist.

- [ ] **Step 3: Implement sanitization, timeout, and strict response parsing.**

  Use the loopback default `http://127.0.0.1:17874`, POST to `/v1/ombre/digest`, send no Authorization header, strip `metadata` and `replyTo`, cap content, and use an `AbortController` timeout. `parseDigestModelOutput` must require arrays and source message IDs, reject unknown sensitive strings, and return no raw HTTP body in thrown errors.

- [ ] **Step 4: Run the focused test and verify it passes.**

  Run the same Vitest command. Expected: all client tests PASS and serialized requests contain no API key/header fields.

## Task 4: Implement The Loopback DeepSeek Bridge

**Files:**
- Create: `scripts/ombre-digest-bridge.mjs`
- Test: `scripts/ombre-digest-bridge.test.mjs`
- Modify: `package.json:scripts`

**Interfaces:**
- `GET /health` returns `{ ok: true, model: 'deepseek-v4-flash', configured: boolean }` without secrets.
- `POST /v1/ombre/digest` accepts the `DigestBridgeRequest` JSON shape and returns `DigestModelOutput` JSON.
- The process reads `OMBRE_COMPRESS_API_KEY`, `OMBRE_COMPRESS_BASE_URL` (default `https://api.deepseek.com`), `OMBRE_COMPRESS_MODEL` (default `deepseek-v4-flash`), and `SULLYOS_ORIGIN` (default `http://127.0.0.1:4173,http://localhost:4173`).

- [ ] **Step 1: Write Node HTTP tests before starting any server.**

  Use Node's `node:test` and an injected fake upstream fetch. Assert that `/health` never returns the key, an invalid method/path returns 404, an unapproved Origin is rejected, an oversized body returns 413, invalid JSON returns 400, an upstream 401 returns a redacted 502, and a valid fake response returns only the allowed digest schema.

- [ ] **Step 2: Run the bridge test and verify it fails.**

  Run:

  ```powershell
  node --test scripts/ombre-digest-bridge.test.mjs
  ```

  Expected: FAIL because the bridge module is not present.

- [ ] **Step 3: Implement the server with fixed resource limits.**

  Bind only to `127.0.0.1:17874`. Enforce a 2 MiB request-body limit, at most 200 messages, at most 12,000 characters per message, and a 90-second upstream timeout. Do not write request bodies or upstream responses to logs. Return only redacted error categories such as `not-configured`, `invalid-request`, `upstream-auth`, `upstream-timeout`, and `upstream-error`.

  Send DeepSeek an OpenAI-compatible request whose system instruction requires JSON only with these keys: `storedClaims`, `newMemoryItems`, `segmentSummary`, `dailySummary`, and `excluded`. The Authorization header is constructed inside this Node process from `process.env.OMBRE_COMPRESS_API_KEY` and is never returned to the browser.

- [ ] **Step 4: Add an explicit bridge test command without changing default app scripts.**

  Add:

  ```json
  "test:ombre-digest-bridge": "node --test scripts/ombre-digest-bridge.test.mjs"
  ```

  Do not add an automatic postinstall, dev-server hook, or background process.

- [ ] **Step 5: Run the bridge test and verify it passes.**

  Run:

  ```powershell
  pnpm test:ombre-digest-bridge
  ```

  Expected: all Node bridge tests PASS without making a network request or requiring a real API key.

## Task 5: Implement The Dry-Run Runner And Config Gate

**Files:**
- Create: `utils/ombre/ombreDigestConfig.ts`
- Create: `utils/ombre/ombreDigestRunner.ts`
- Test: `utils/ombre/ombreDigestRunner.test.ts`

**Interfaces:**
- `OmbreDigestConfig = { mode: 'off' | 'dry-run'; bridgeEndpoint: string; roundThreshold: number; maxSourceChars: number; maxEstimatedTokens: number; periodBoundariesMinutes: number[]; maxAttempts: number }`
- `loadOmbreDigestConfig(): OmbreDigestConfig`
- `runOmbreDigestCheck(charId: string, reason: DigestTriggerReason, deps: DigestRunnerDeps): Promise<DigestRunResult>`
- `DigestRunnerDeps = { now: () => number; loadConfig: () => OmbreDigestConfig; getMessages: (charId: string) => Promise<Message[]>; listJobs: typeof listOmbreDigestJobs; getLatestJob: typeof getLatestCompletedOmbreDigestJob; putJob: typeof putOmbreDigestJob; updateJob: typeof updateOmbreDigestJob; summarize: (request: DigestBridgeRequest) => Promise<DigestModelOutput> }`
- `DigestRunResult = { status: 'disabled' | 'no-op' | 'checkpointed' | 'failed'; jobId?: string; sourceEndMessageId?: number; errorCode?: string }`

- [ ] **Step 1: Write failing runner tests.**

  Assert that:

  ```ts
  expect(await runOmbreDigestCheck('char-a', 'round-threshold', depsWithOffConfig)).toEqual({ status: 'disabled' });
  expect(await runOmbreDigestCheck('char-a', 'round-threshold', depsWith50CompletedRounds)).toMatchObject({ status: 'checkpointed' });
  expect(deps.summarize).toHaveBeenCalledTimes(1);
  expect(savedJob.status).toBe('checkpointed');
  expect(savedJob.sourceStartMessageId).toBe(previousWatermark + 1);
  expect(savedJob.sourceEndMessageId).toBeLessThanOrEqual(lastCompletedAssistantId);
  ```

  Add a failure test proving that a bridge rejection leaves the job in `failed`, preserves source boundaries, and does not advance the completed watermark.

- [ ] **Step 2: Run the focused test and verify it fails.**

  Run:

  ```powershell
  pnpm exec vitest run utils/ombre/ombreDigestRunner.test.ts
  ```

  Expected: FAIL because the config and runner do not exist.

- [ ] **Step 3: Implement the config gate with safe defaults.**

  Default to `mode: 'off'`, bridge endpoint `http://127.0.0.1:17874`, round threshold `50`, and local period boundaries `[720, 1080, 1440]` minutes. If configuration is read from localStorage, store only these non-secret controls; never store message content, API keys, or bearer tokens. The runner must return `disabled` before reading messages when mode is `off`. The runner receives `loadConfig` through `DigestRunnerDeps`, so tests never depend on ambient localStorage.

- [ ] **Step 4: Implement the runner as a checkpoint-only state machine.**

  Read `DB.getMessagesByCharId(charId, true)` through the injected dependency, find the latest completed job watermark, call `planNextDigestSegment`, persist `pending`, call the injected summarizer, validate the response, and persist `checkpointed`. In Phase 1 the runner must not import `callOmbreReadTool`, `callOmbreWriteTool`, or any `tools/call` path. It must not mark a segment complete when the bridge fails.

- [ ] **Step 5: Run the focused test and verify it passes.**

  Run the same Vitest command. Expected: all runner tests PASS, including disabled mode, 50-round checkpoint, no-overlap watermark, and failed bridge recovery.

## Task 6: Add One-Flight Scheduling And Lifecycle Hooks

**Files:**
- Create: `utils/ombre/ombreDigestScheduler.ts`
- Test: `utils/ombre/ombreDigestScheduler.test.ts`
- Modify: `context/OSContext.tsx:1677-1809`

**Interfaces:**
- `createOmbreDigestScheduler(deps): { request(charId: string, reason: DigestTriggerReason): Promise<void>; recover(charIds: string[]): Promise<void>; dispose(): void }`
- The scheduler uses a per-character in-flight map and delegates all work to `runOmbreDigestCheck`; it does not contain prompt text, MCP calls, or API keys.

- [ ] **Step 1: Write failing scheduler tests.**

  Test that two simultaneous `request('char-a', ...)` calls invoke the runner once, a request for `char-b` can run independently, `mode: off` invokes no summarizer, and a failed run removes the in-flight lock so the next request can retry.

- [ ] **Step 2: Run the focused test and verify it fails.**

  Run:

  ```powershell
  pnpm exec vitest run utils/ombre/ombreDigestScheduler.test.ts
  ```

  Expected: FAIL because the scheduler does not exist.

- [ ] **Step 3: Implement one-flight scheduling.**

  Keep one Promise per `charId`, return the existing Promise for duplicate requests, and remove it in `finally`. `dispose()` must clear the map and prevent new work. Do not use a recurring timer; triggers are event-driven and recovery-driven.

- [ ] **Step 4: Wire only existing lifecycle events.**

  In the existing OS-level event effect, call `request(charId, 'startup-recovery')` after startup/recovery, call it for `CHAT_GEN_EVENTS.replyArrived` and `active-msg-received`, and call `recover` on `visibilitychange` when the document becomes visible. Do not hook every `DB.saveMessage` call because cards, tool results, and post-processing can create multiple records inside one reply and would cause duplicate checks.

- [ ] **Step 5: Run the focused test and verify it passes.**

  Run the scheduler test. Expected: one-flight behavior, disabled behavior, failure retry, and dispose behavior all PASS.

## Task 7: Phase 1 Verification And Handoff

**Files:**
- Modify only the Phase 1 files listed above if verification exposes a defect.
- Do not modify `D:\ceshi\SullyOS`, mainline docs, or Ombre files.

- [ ] **Step 1: Run all new unit tests.**

  Run:

  ```powershell
  pnpm exec vitest run utils/ombre/ombreDigestPolicy.test.ts utils/ombre/ombreDigestPlanner.test.ts utils/ombre/ombreDigestDb.test.ts utils/ombre/ombreDigestBridgeClient.test.ts utils/ombre/ombreDigestRunner.test.ts utils/ombre/ombreDigestScheduler.test.ts
  pnpm test:ombre-digest-bridge
  ```

  Expected: all new tests PASS without network access.

- [ ] **Step 2: Run the existing regression suite.**

  Run:

  ```powershell
  pnpm test:run
  ```

  Expected: existing tests remain PASS; any failure is investigated before claiming the Phase 1 dry-run is usable.

- [ ] **Step 3: Verify the safety boundary from source and test output.**

  Confirm that browser bundle code contains no `OMBRE_COMPRESS_API_KEY`, no Authorization construction, and no real Ombre `grow` call in the Phase 1 runner. Confirm bridge tests use fake upstream fetch and no real DeepSeek request was made. Do not print environment values while checking.

- [ ] **Step 4: Run formatting and worktree checks.**

  Run:

  ```powershell
  git diff --check
  git status --short --branch
  ```

  Expected: no whitespace errors; existing unrelated modifications remain untouched; no commit is created.

- [ ] **Step 5: Stop at the Phase 1 review gate.**

  Report: trigger evidence, checkpoint records, failure/retry behavior, bridge health behavior, and any remaining gaps. Do not start `D:\OmbreBrain\Start-OmbreBrain.ps1`, do not call real Ombre MCP, and do not promote `checkpointed` results to formal memory until a separate user approval is received.

## Explicitly Deferred After Phase 1

- Real Ombre `breath_search` reconciliation through the official MCP channel.
- Automatic `grow` promotion, any other write tool, and bucket readback against the real service.
- Human confirmation UI and production “摘要自动写入” switch.
- Mobile/iPad access or any bridge port tunneling.
- Sharing or replacing any closed Memory Palace pipeline.
