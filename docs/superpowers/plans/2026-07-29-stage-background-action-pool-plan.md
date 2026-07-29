# SullyOS 阶段性动作临时池 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 SullyOS 自动摘要先捕捉“跨天重复的小动作”，放进本地临时池滚动观察 4 天，`3/4` 进入候选、`4/4` 才自动晋级正式 Ombre 记忆。

**Status:** 已完成并通过验收。本文件保留为实现记录；下面的步骤是原施工顺序。

**Architecture:** 现有自动摘要主线保持不变，只在本地新增一层“阶段性动作池”。桥接模型继续用 `deepseek-v4-flash` 输出结构化候选，SullyOS 负责把低价值但可能重复的动作先暂存到 IndexedDB，按 4 天滚动窗口计数；达到阈值后再生成正式写入请求并走现有 `hold/readback` 流程。临时池与正式记忆分开，池内条目到期自动清理。

**Tech Stack:** TypeScript, IndexedDB, Vitest, existing SullyOS/Ombre digest pipeline, local loopback bridge on `127.0.0.1`.

## Global Constraints

- 不修改冻结参考 repo `D:\ceshi\SullyOS`。
- 不改变现有 `hold/readback` 主链和确认写门的安全边界。
- 不把临时动作直接写成正式记忆，不 pinned。
- 不保存 API key、Bearer、完整 prompt 或原始请求头到日志/存储。
- 不 commit。

---

## File Map

- Modify: `scripts/ombre-digest-bridge.mjs` — 提示模型保留“阶段性重复的小动作”候选，不要直接丢弃。
- Modify: `scripts/ombre-digest-bridge.test.mjs` — 校验系统提示里包含阶段性候选说明。
- Modify: `utils/ombre/ombreDigestTypes.ts` — 增加阶段性候选状态/记录类型。
- Modify: `utils/ombre/ombreDigestWritePolicy.ts` — 新增 `stage-candidate` 判定。
- Modify: `utils/ombre/ombreDigestWritePolicy.test.ts` — 覆盖阶段性动作从“跳过”变成“候选”。
- Create: `utils/ombre/ombreDigestStagePool.ts` — 本地 4 天滚动临时池 DAO 与晋级判定。
- Create: `utils/ombre/ombreDigestStagePool.test.ts` — 覆盖 3/4 候选、4/4 晋级、过期清理。
- Modify: `utils/db.ts` — 新增 `ombre_digest_stage_actions` store 和索引，DB 版本升级。
- Modify: `utils/ombre/ombreDigestReconciler.ts` — 对 `stage-candidate` 先入池，再按阈值决定是否写正式记忆。
- Modify: `utils/ombre/ombreDigestReconciler.test.ts` — 覆盖“先入池不写”“4/4 自动晋级并写入”。
- Modify: `utils/ombre/ombreDigestRunner.ts` — 让 checkpointed 结果带着阶段性候选继续流转，不破坏现有 `dry-run` / `confirmed` 路径。

## Task 1: Add Stage-Candidate Classification

**Files:**
- Modify: `utils/ombre/ombreDigestWritePolicy.ts`
- Test: `utils/ombre/ombreDigestWritePolicy.test.ts`

**Interfaces:**
- `DigestMemoryDecision.action` 新增 `'stage-candidate'`
- 阶段性动作仍保留 `importance / tags / dedupeQuery / riskFlags`

- [ ] **Step 1: 写失败测试**
  - 断言“用户父亲今天早上买了豆浆”这类日常但可能重复的动作，不再直接 `skip`，而是进入 `stage-candidate`。
  - 断言普通低价值闲聊仍然 `skip`。
- [ ] **Step 2: 先跑测试看它失败**
  - Run: `pnpm exec vitest run utils/ombre/ombreDigestWritePolicy.test.ts`
- [ ] **Step 3: 最小实现**
  - 只在“低价值日常动作 + 有稳定关系/项目/身体上下文”时返回 `stage-candidate`。
- [ ] **Step 4: 再跑测试确认通过**
  - Run: `pnpm exec vitest run utils/ombre/ombreDigestWritePolicy.test.ts`

## Task 2: Add Local Stage Pool

**Files:**
- Create: `utils/ombre/ombreDigestStagePool.ts`
- Create: `utils/ombre/ombreDigestStagePool.test.ts`
- Modify: `utils/db.ts`

**Interfaces:**
- `recordOmbreDigestStageCandidate(...)`
- `getOmbreDigestStageCandidateWindow(...)`
- `pruneOmbreDigestStageCandidates(...)`
- 晋级结果：`observed | candidate | promote | expired`

- [ ] **Step 1: 写失败测试**
  - 断言同一动作在 3 个不同日期出现时进入候选。
  - 断言第 4 个不同日期出现时返回 `promote`。
  - 断言超过 4 天窗口的旧记录会被清掉。
- [ ] **Step 2: 先跑测试看它失败**
  - Run: `pnpm exec vitest run utils/ombre/ombreDigestStagePool.test.ts`
- [ ] **Step 3: 最小实现**
  - 新增 `ombre_digest_stage_actions` store，记录 `charId + signature + localDate`。
  - 仅统计最近 4 个本地日期的唯一出现天数。
- [ ] **Step 4: 再跑测试确认通过**
  - Run: `pnpm exec vitest run utils/ombre/ombreDigestStagePool.test.ts`

## Task 3: Wire Reconcile Promotion

**Files:**
- Modify: `utils/ombre/ombreDigestReconciler.ts`
- Modify: `utils/ombre/ombreDigestReconciler.test.ts`

**Interfaces:**
- `stage-candidate` 先入池，不直接写 Ombre
- `promote` 时复用现有 `hold` / `readback` 流程

- [ ] **Step 1: 写失败测试**
  - 断言 `stage-candidate` 不会立刻触发 `hold`。
  - 断言达到 4/4 后会走现有 `buildDigestHoldRequest` + `runOmbreConfirmedHoldWorkflow`。
- [ ] **Step 2: 先跑测试看它失败**
  - Run: `pnpm exec vitest run utils/ombre/ombreDigestReconciler.test.ts`
- [ ] **Step 3: 最小实现**
  - 在 reconciler 里加一个“先入池、再判定是否晋级”的分支。
- [ ] **Step 4: 再跑测试确认通过**
  - Run: `pnpm exec vitest run utils/ombre/ombreDigestReconciler.test.ts`

## Task 4: Tune Bridge Prompt

**Files:**
- Modify: `scripts/ombre-digest-bridge.mjs`
- Modify: `scripts/ombre-digest-bridge.test.mjs`

**Interfaces:**
- 保持现有 5 字段 schema 不变
- 只补 prompt 语义，不改请求/响应协议

- [ ] **Step 1: 写失败测试**
  - 断言 system prompt 明确要求保留“阶段性重复的小动作”候选。
- [ ] **Step 2: 先跑测试看它失败**
  - Run: `node --test scripts/ombre-digest-bridge.test.mjs`
- [ ] **Step 3: 最小实现**
  - 在 system prompt 里补一句：小而可能重复的动作不要直接丢弃，先作为候选输出。
- [ ] **Step 4: 再跑测试确认通过**
  - Run: `node --test scripts/ombre-digest-bridge.test.mjs`

## Task 5: Full Verification

**Files:**
- None

- [ ] **Step 1: 跑分类测试**
  - `pnpm exec vitest run utils/ombre/ombreDigestWritePolicy.test.ts`
- [ ] **Step 2: 跑临时池测试**
  - `pnpm exec vitest run utils/ombre/ombreDigestStagePool.test.ts`
- [ ] **Step 3: 跑 reconciler 测试**
  - `pnpm exec vitest run utils/ombre/ombreDigestReconciler.test.ts`
- [ ] **Step 4: 跑桥接测试**
  - `node --test scripts/ombre-digest-bridge.test.mjs`
- [ ] **Step 5: 跑 Ombre 整体测试**
  - `pnpm exec vitest run utils/ombre`
- [ ] **Step 6: 跑 build**
  - `pnpm build`

## Verification Result

截至 2026-07-29，本计划已完成，验收结果如下：

- `pnpm exec vitest run utils/ombre/ombreDigestWritePolicy.test.ts` passed。
- `pnpm exec vitest run utils/ombre/ombreDigestStagePool.test.ts` passed。
- `pnpm exec vitest run utils/ombre/ombreDigestDb.test.ts` passed。
- `pnpm exec vitest run utils/ombre/ombreDigestReconciler.test.ts` passed。
- `pnpm exec vitest run utils/ombre/ombreDigestRunner.test.ts` passed。
- `pnpm exec vitest run utils/ombre` passed。
- `pnpm build` passed。
- `git diff --check` 只有既有 LF/CRLF 提示，没有新错误。
