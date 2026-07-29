import test from 'node:test';
import assert from 'node:assert/strict';
import { createDigestBridgeServer } from './ombre-digest-bridge.mjs';

const validOutput = {
    storedClaims: [{ claim: '已存在的事实', sourceMessageIds: [1] }],
    newMemoryItems: [{ claim: '新的事实', sourceMessageIds: [2] }],
    segmentSummary: '摘要',
    dailySummary: '',
    excluded: [],
};

function upstreamResponse(content = validOutput) {
    return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }] }),
    };
}

async function withServer(options, callback) {
    const server = createDigestBridgeServer(options);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const base = `http://127.0.0.1:${address.port}`;
    try { return await callback(base); } finally { await new Promise(resolve => server.close(resolve)); }
}

function requestBody() {
    return {
        protocolVersion: 1,
        jobId: 'job-1',
        charId: 'char-a',
        localDate: '2026-07-28',
        messages: [{ id: 1, role: 'user', type: 'text', timestamp: 1, content: 'hello' }],
    };
}

test('health never returns the API key', async () => {
    await withServer({ env: { OMBRE_COMPRESS_API_KEY: 'super-secret-key' } }, async base => {
        const response = await fetch(`${base}/health`);
        const text = await response.text();
        assert.equal(response.status, 200);
        assert.equal(text.includes('super-secret-key'), false);
        assert.match(text, /"configured":true/);
    });
});

test('rejects an invalid path and an unapproved origin', async () => {
    await withServer({ env: { OMBRE_COMPRESS_API_KEY: 'key' } }, async base => {
        const notFound = await fetch(`${base}/wrong`, { method: 'POST' });
        assert.equal(notFound.status, 404);
        const allowed = await fetch(`${base}/health`, { headers: { Origin: 'http://127.0.0.1:5173' } });
        assert.equal(allowed.status, 200);
        assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5173');
        const forbidden = await fetch(`${base}/health`, { headers: { Origin: 'https://evil.example' } });
        assert.equal(forbidden.status, 403);
    });
});

test('rejects oversized bodies and invalid JSON', async () => {
    await withServer({ env: { OMBRE_COMPRESS_API_KEY: 'key' } }, async base => {
        const oversized = await fetch(`${base}/v1/ombre/digest`, {
            method: 'POST',
            body: 'x'.repeat(2 * 1024 * 1024 + 1),
            headers: { 'Content-Type': 'application/json' },
        });
        assert.equal(oversized.status, 413);
        const invalid = await fetch(`${base}/v1/ombre/digest`, {
            method: 'POST',
            body: '{not json',
            headers: { 'Content-Type': 'application/json' },
        });
        assert.equal(invalid.status, 400);
    });
});

test('redacts upstream auth failures and returns only the digest schema', async () => {
    await withServer({
        env: { OMBRE_COMPRESS_API_KEY: 'key' },
        fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ secret: 'do-not-return' }) }),
    }, async base => {
        const authFailure = await fetch(`${base}/v1/ombre/digest`, { method: 'POST', body: JSON.stringify(requestBody()) });
        assert.equal(authFailure.status, 502);
        assert.deepEqual(await authFailure.json(), { error: 'upstream-auth' });
    });

    await withServer({
        env: { OMBRE_COMPRESS_API_KEY: 'key' },
        fetchImpl: async () => upstreamResponse(),
    }, async base => {
        const success = await fetch(`${base}/v1/ombre/digest`, { method: 'POST', body: JSON.stringify(requestBody()) });
        assert.equal(success.status, 200);
        assert.deepEqual(await success.json(), validOutput);
    });
});

test('sends an explicit non-echo JSON contract to the small model', async () => {
    let upstreamRequest;
    await withServer({
        env: { OMBRE_COMPRESS_API_KEY: 'key' },
        fetchImpl: async (_url, init) => {
            upstreamRequest = JSON.parse(init.body);
            return upstreamResponse();
        },
    }, async base => {
        const response = await fetch(`${base}/v1/ombre/digest`, {
            method: 'POST',
            body: JSON.stringify(requestBody()),
            headers: { Origin: 'http://127.0.0.1:4173', 'Content-Type': 'application/json' },
        });
        assert.equal(response.status, 200);
    });

    const systemPrompt = upstreamRequest.messages.find(message => message.role === 'system').content;
    assert.match(systemPrompt, /绝对不能复述或回显输入对象/);
    assert.match(systemPrompt, /禁止输出 protocolVersion、jobId、charId、localDate、messages/);
    assert.match(systemPrompt, /只能有这 5 个字段/);
});

test('retries one schema-invalid model response and then succeeds', async () => {
    let calls = 0;
    await withServer({
        env: { OMBRE_COMPRESS_API_KEY: 'key' },
        fetchImpl: async (_url, init) => {
            calls += 1;
            return calls === 1
                ? upstreamResponse(requestBody())
                : upstreamResponse();
        },
    }, async base => {
        const response = await fetch(`${base}/v1/ombre/digest`, {
            method: 'POST',
            body: JSON.stringify(requestBody()),
            headers: { Origin: 'http://127.0.0.1:4173', 'Content-Type': 'application/json' },
        });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), validOutput);
    });
    assert.equal(calls, 2);
});

test('stops after one schema retry instead of looping', async () => {
    let calls = 0;
    await withServer({
        env: { OMBRE_COMPRESS_API_KEY: 'key' },
        fetchImpl: async () => {
            calls += 1;
            return upstreamResponse(requestBody());
        },
    }, async base => {
        const response = await fetch(`${base}/v1/ombre/digest`, {
            method: 'POST',
            body: JSON.stringify(requestBody()),
            headers: { Origin: 'http://127.0.0.1:4173', 'Content-Type': 'application/json' },
        });
        assert.equal(response.status, 502);
        assert.deepEqual(await response.json(), { error: 'upstream-schema' });
    });
    assert.equal(calls, 2);
});
