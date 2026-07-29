import { describe, expect, it, vi } from 'vitest';
import {
  ExternalWakeDeduper,
  buildExternalWakeHint,
  createExternalWakePoller,
  loadExternalWakeClientConfig,
  normalizeExternalWakeEvent,
  pollExternalWakeOnce,
  resolveExternalWakeCharacterId,
} from './externalWake';

describe('external wake bridge', () => {
  it('normalizes a standard Garden wake envelope without exposing secrets', () => {
    const wake = normalizeExternalWakeEvent({
      version: 1,
      type: 'garden_wake',
      reason: 'game_turn_required',
      message: '游戏轮到你了。请调用 Garden MCP 的 get_my_status 查看当前局面。',
      id: 'garden-1',
      receivedAt: 1234,
      token: 'should-not-survive',
    });

    expect(wake).toEqual({
      version: 1,
      type: 'garden_wake',
      id: 'garden-1',
      reason: 'game_turn_required',
      message: '游戏轮到你了。请调用 Garden MCP 的 get_my_status 查看当前局面。',
      source: 'garden',
      receivedAt: 1234,
    });
    expect(JSON.stringify(wake)).not.toContain('should-not-survive');
  });

  it('rejects unsupported envelopes and overlong wake fields', () => {
    expect(normalizeExternalWakeEvent({ version: 2, type: 'garden_wake', reason: 'x', message: 'y' })).toBeNull();
    expect(normalizeExternalWakeEvent({ version: 1, type: 'other', reason: 'x', message: 'y' })).toBeNull();
    expect(normalizeExternalWakeEvent({ version: 1, type: 'garden_wake', reason: '', message: 'y' })).toBeNull();
    expect(normalizeExternalWakeEvent({ version: 1, type: 'garden_wake', reason: 'x'.repeat(129), message: 'y' })).toBeNull();
    expect(normalizeExternalWakeEvent({ version: 1, type: 'garden_wake', reason: 'x', message: ' ' })).toBeNull();
    expect(normalizeExternalWakeEvent({ version: 1, type: 'garden_wake', reason: 'x', message: 'y'.repeat(4097) })).toBeNull();
  });

  it('dedupes the same wake id inside the ttl window and accepts it after expiry', () => {
    const deduper = new ExternalWakeDeduper({ ttlMs: 60_000, now: () => 10_000 });
    const wake = normalizeExternalWakeEvent({
      version: 1,
      type: 'garden_wake',
      id: 'same-wake',
      reason: 'game_turn_required',
      message: '游戏轮到你了。',
      receivedAt: 10_000,
    })!;

    expect(deduper.accept(wake)).toBe(true);
    expect(deduper.accept(wake)).toBe(false);

    const laterDeduper = new ExternalWakeDeduper({ ttlMs: 60_000, now: () => 71_000 });
    laterDeduper.accept(wake);
    expect(laterDeduper.accept({ ...wake, id: 'same-wake-2' })).toBe(true);
  });

  it('resolves the target character from wake, stored setting, then current active character', () => {
    const characters = [{ id: 'a' }, { id: 'b' }];
    expect(resolveExternalWakeCharacterId({
      wake: { targetCharId: 'b' },
      characters,
      storedCharId: 'a',
      activeCharacterId: 'a',
    })).toBe('b');
    expect(resolveExternalWakeCharacterId({
      wake: {},
      characters,
      storedCharId: 'b',
      activeCharacterId: 'a',
    })).toBe('b');
    expect(resolveExternalWakeCharacterId({
      wake: {},
      characters,
      storedCharId: 'missing',
      activeCharacterId: 'a',
    })).toBe('a');
    expect(resolveExternalWakeCharacterId({
      wake: {},
      characters,
      storedCharId: 'missing',
      activeCharacterId: 'missing',
    })).toBeNull();
  });

  it('builds a hidden one-turn task hint instead of a user chat message', () => {
    const hint = buildExternalWakeHint({
      wake: {
        version: 1,
        type: 'garden_wake',
        id: 'garden-1',
        reason: 'game_turn_required',
        message: '游戏轮到你了。',
        source: 'garden',
        receivedAt: 1234,
      },
      userName: '李',
      timeText: '2026-07-27 16:00',
    });

    expect(hint).toContain('非李发言');
    expect(hint).toContain('来自 Garden/论坛的外部唤醒任务');
    expect(hint).toContain('最多完成本轮必要的一次行动');
    expect(hint).toContain('不要自行循环等待');
  });

  it('polls one wake from a loopback adapter and ignores empty responses', async () => {
    const onWake = vi.fn();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        wake: {
          version: 1,
          type: 'garden_wake',
          id: 'wake-1',
          reason: 'game_turn_required',
          message: '游戏轮到你了。',
          receivedAt: 1234,
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ wake: null }), { status: 200 }));

    await expect(pollExternalWakeOnce({
      adapterUrl: 'http://127.0.0.1:17873',
      fetchImpl,
      onWake,
    })).resolves.toEqual({ status: 'delivered', wakeId: 'wake-1' });
    await expect(pollExternalWakeOnce({
      adapterUrl: 'http://127.0.0.1:17873/',
      fetchImpl,
      onWake,
    })).resolves.toEqual({ status: 'empty' });

    expect(fetchImpl.mock.calls[0][0]).toBe('http://127.0.0.1:17873/wake/next');
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ __sullySilentNetworkError: true });
    expect(onWake).toHaveBeenCalledTimes(1);
  });

  it('creates a poller that can be started and stopped without scheduling duplicate loops', () => {
    const scheduled: Array<() => void> = [];
    const clearTimer = vi.fn();
    const poller = createExternalWakePoller({
      adapterUrl: 'http://127.0.0.1:17873',
      fetchImpl: vi.fn(),
      onWake: vi.fn(),
      setTimer: (fn) => {
        scheduled.push(fn);
        return scheduled.length;
      },
      clearTimer,
      intervalMs: 1000,
    });

    poller.start();
    poller.start();
    expect(scheduled).toHaveLength(1);
    poller.stop();
    expect(clearTimer).toHaveBeenCalledWith(1);
  });

  it('loads local-only client config without requiring a token', () => {
    const storage = new Map<string, string>([
      ['os_external_wake_enabled', '1'],
      ['os_external_wake_url', 'http://127.0.0.1:17873/'],
      ['os_external_wake_poll_ms', '5000'],
      ['os_external_wake_char_id', 'char-a'],
    ]);

    expect(loadExternalWakeClientConfig({
      storage: { getItem: (key: string) => storage.get(key) ?? null },
      location: { hostname: 'localhost' },
    })).toEqual({
      enabled: true,
      adapterUrl: 'http://127.0.0.1:17873',
      intervalMs: 5000,
      targetCharId: 'char-a',
    });
  });

  it('keeps wake polling disabled until the user explicitly turns it on', () => {
    expect(loadExternalWakeClientConfig({
      storage: { getItem: () => null },
      location: { hostname: 'localhost' },
    }).enabled).toBe(false);
  });
});
