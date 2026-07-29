#!/usr/bin/env node
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const PORT = 17874;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_MESSAGES = 200;
const MAX_CHARS_PER_MESSAGE = 12_000;
const UPSTREAM_TIMEOUT_MS = 90_000;
const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-v4-flash';

const SYSTEM_PROMPT = [
    '你是 SullyOS 的分段摘要器，像纯函数一样工作。',
    '输入是一个包含 messages 的对象；你必须新建摘要结果，绝对不能复述或回显输入对象。',
    '禁止输出 protocolVersion、jobId、charId、localDate、messages。',
    '回复只能是一个 JSON 对象，且只能有这 5 个字段：storedClaims、newMemoryItems、segmentSummary、dailySummary、excluded。',
    '没有内容时也必须输出空数组或空字符串。不要输出 Markdown、解释或额外字段。',
    'storedClaims 和 newMemoryItems 的每项必须是 {"claim":"...","sourceMessageIds":[消息ID]}，sourceMessageIds 只能使用输入里的真实消息 ID。',
    '只抽取聊天中有来源消息支持的事实；普通寒暄、工具噪声、推测和敏感凭据放入 excluded。',
    '聊天里声称“已经存入记忆”只能作为待核对线索，不代表真的写入。',
    '输出示例：{"storedClaims":[],"newMemoryItems":[{"claim":"用户喜欢晚上散步","sourceMessageIds":[1]}],"segmentSummary":"用户分享了一个偏好。","dailySummary":"","excluded":[]}',
].join('\n');

function json(res, status, value, extraHeaders = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders });
    res.end(JSON.stringify(value));
}

function redactSensitiveText(value) {
    return String(value)
        .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
        .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
        .replace(/\b(?:api[_-]?key|token|password|secret)\s*[:=]\s*[^\s,;]+/gi, '[REDACTED]');
}

function containsSensitiveString(value) {
    if (typeof value === 'string') {
        return /\bsk-[A-Za-z0-9_-]{8,}\b|\bBearer\s+[A-Za-z0-9._~+/=-]+|\b(?:api[_-]?key|token|password|secret)\s*[:=]\s*[^\s,;]+/i.test(value);
    }
    if (Array.isArray(value)) return value.some(containsSensitiveString);
    if (value && typeof value === 'object') return Object.values(value).some(containsSensitiveString);
    return false;
}

function parseClaim(value, field) {
    if (!value || typeof value !== 'object' || typeof value.claim !== 'string' || !value.claim.trim()) {
        throw new Error(`schema:${field}`);
    }
    if (!Array.isArray(value.sourceMessageIds) || value.sourceMessageIds.length === 0 || value.sourceMessageIds.some(id => !['number', 'string'].includes(typeof id))) {
        throw new Error(`schema:${field}.sourceMessageIds`);
    }
    return { claim: value.claim, sourceMessageIds: value.sourceMessageIds };
}

function parseDigestModelOutput(value) {
    if (!value || typeof value !== 'object' || containsSensitiveString(value)) throw new Error('schema');
    if (!Array.isArray(value.storedClaims) || !Array.isArray(value.newMemoryItems) || !Array.isArray(value.excluded)) throw new Error('schema');
    if (typeof value.segmentSummary !== 'string') throw new Error('schema');
    if (value.dailySummary !== undefined && typeof value.dailySummary !== 'string') throw new Error('schema');
    return {
        storedClaims: value.storedClaims.map((item, index) => parseClaim(item, `storedClaims[${index}]`)),
        newMemoryItems: value.newMemoryItems.map((item, index) => parseClaim(item, `newMemoryItems[${index}]`)),
        segmentSummary: value.segmentSummary,
        dailySummary: value.dailySummary,
        excluded: value.excluded.map(item => {
            if (typeof item !== 'string') throw new Error('schema:excluded');
            return item;
        }),
    };
}

function parseModelText(text) {
    const trimmed = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    return parseDigestModelOutput(JSON.parse(trimmed));
}

function allowedOrigins(env) {
    return new Set(String(env.SULLYOS_ORIGIN || [
        'http://127.0.0.1:5173',
        'http://localhost:5173',
        'http://[::1]:5173',
        'http://127.0.0.1:4173',
        'http://localhost:4173',
        'http://[::1]:4173',
    ].join(','))
        .split(',').map(value => value.trim()).filter(Boolean));
}

function corsHeaders(origin, origins) {
    if (!origin || origins.has(origin)) return origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
    return null;
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let total = 0;
        let tooLarge = false;
        const chunks = [];
        req.on('data', chunk => {
            total += chunk.length;
            if (total > MAX_BODY_BYTES) {
                tooLarge = true;
                return;
            }
            if (!tooLarge) chunks.push(chunk);
        });
        req.on('end', () => {
            if (tooLarge) {
                reject(Object.assign(new Error('body-too-large'), { code: 'BODY_TOO_LARGE' }));
                return;
            }
            resolve(Buffer.concat(chunks).toString('utf8'));
        });
        req.on('error', reject);
    });
}

function validateRequest(value) {
    if (!value || value.protocolVersion !== 1 || typeof value.jobId !== 'string' || typeof value.charId !== 'string' || typeof value.localDate !== 'string' || !Array.isArray(value.messages)) return false;
    if (value.messages.length === 0 || value.messages.length > MAX_MESSAGES) return false;
    return value.messages.every(message => (
        Number.isInteger(message?.id) &&
        (message.role === 'user' || message.role === 'assistant') &&
        typeof message.type === 'string' &&
        Number.isFinite(message.timestamp) &&
        typeof message.content === 'string' &&
        message.content.length <= MAX_CHARS_PER_MESSAGE
    ));
}

function createDigestBridgeServer(options = {}) {
    const env = options.env || process.env;
    const fetchImpl = options.fetchImpl || fetch;
    const origins = allowedOrigins(env);
    const apiKey = env.OMBRE_COMPRESS_API_KEY || '';
    const baseUrl = String(env.OMBRE_COMPRESS_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
    const model = String(env.OMBRE_COMPRESS_MODEL || DEFAULT_MODEL);

    const server = createServer(async (req, res) => {
        const origin = req.headers.origin;
        const cors = corsHeaders(origin, origins);
        if (!cors) {
            json(res, 403, { error: 'origin-not-allowed' });
            return;
        }
        const headers = { ...cors, 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
        if (req.method === 'OPTIONS') {
            res.writeHead(204, headers);
            res.end();
            return;
        }
        if (req.method === 'GET' && req.url === '/health') {
            json(res, 200, { ok: true, model, configured: Boolean(apiKey) }, headers);
            return;
        }
        if (req.method !== 'POST' || req.url !== '/v1/ombre/digest') {
            json(res, 404, { error: 'not-found' }, headers);
            return;
        }
        let rawBody;
        try {
            rawBody = await readBody(req);
        } catch (error) {
            if (error?.code === 'BODY_TOO_LARGE') {
                json(res, 413, { error: 'body-too-large' }, headers);
                return;
            }
            json(res, 400, { error: 'invalid-request' }, headers);
            return;
        }
        let input;
        try { input = JSON.parse(rawBody); } catch {
            json(res, 400, { error: 'invalid-json' }, headers);
            return;
        }
        if (!validateRequest(input)) {
            json(res, 400, { error: 'invalid-request' }, headers);
            return;
        }
        if (!apiKey) {
            json(res, 503, { error: 'not-configured' }, headers);
            return;
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
        try {
            const userPayload = JSON.stringify({
                jobId: input.jobId,
                charId: input.charId,
                localDate: input.localDate,
                messages: input.messages.map(message => ({ ...message, content: redactSensitiveText(message.content) })),
            });
            for (let schemaAttempt = 0; schemaAttempt < 2; schemaAttempt += 1) {
                const upstream = await fetchImpl(`${baseUrl}/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
                    body: JSON.stringify({
                        model,
                        temperature: 0,
                        response_format: { type: 'json_object' },
                        messages: [
                            {
                                role: 'system',
                                content: schemaAttempt === 0
                                    ? SYSTEM_PROMPT
                                    : `${SYSTEM_PROMPT}\n这是格式修正请求：上一次输出未通过结构校验。请重新生成摘要对象，不要回显输入，也不要添加任何字段。`,
                            },
                            { role: 'user', content: userPayload },
                        ],
                    }),
                    signal: controller.signal,
                });
                if (!upstream.ok) {
                    json(res, 502, { error: upstream.status === 401 || upstream.status === 403 ? 'upstream-auth' : 'upstream-error' }, headers);
                    return;
                }
                let upstreamBody;
                try { upstreamBody = await upstream.json(); } catch {
                    json(res, 502, { error: 'upstream-error' }, headers);
                    return;
                }
                const content = upstreamBody?.choices?.[0]?.message?.content;
                if (typeof content === 'string') {
                    try {
                        json(res, 200, parseModelText(content), headers);
                        return;
                    } catch {
                        // Allow one bounded format retry, then stop.
                    }
                }
            }
            json(res, 502, { error: 'upstream-schema' }, headers);
        } catch (error) {
            json(res, 502, { error: controller.signal.aborted || error?.name === 'AbortError' ? 'upstream-timeout' : 'upstream-error' }, headers);
        } finally {
            clearTimeout(timeout);
        }
    });
    return server;
}

export { createDigestBridgeServer };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const server = createDigestBridgeServer();
    server.listen(PORT, '127.0.0.1', () => {
        console.log(`[ombre-digest-bridge] listening on http://127.0.0.1:${PORT} model=${process.env.OMBRE_COMPRESS_MODEL || DEFAULT_MODEL} configured=${Boolean(process.env.OMBRE_COMPRESS_API_KEY)}`);
    });
}
