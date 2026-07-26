import { describe, expect, it } from 'vitest';
import { isOmbreReadTool, isOmbreWriteTool, toolTouchesMetadata } from './ombreTypes';

describe('Ombre tool classification', () => {
  it('treats recall tools as read tools', () => {
    expect(isOmbreReadTool('breath')).toBe(true);
    expect(isOmbreReadTool('breath_search')).toBe(true);
    expect(isOmbreReadTool('breath_advanced')).toBe(true);
    expect(isOmbreReadTool('letter_read')).toBe(true);
    expect(isOmbreReadTool('pulse')).toBe(true);
    expect(isOmbreReadTool('dream')).toBe(true);
  });

  it('treats mutation tools as write tools', () => {
    for (const name of ['hold', 'grow', 'trace', 'anchor', 'release', 'plan', 'letter_write']) {
      expect(isOmbreWriteTool(name)).toBe(true);
    }
  });

  it('allows I only in explicit read forms and blocks unknown argument shapes', () => {
    expect(isOmbreWriteTool('I', { content: 'new self fact' })).toBe(true);
    expect(isOmbreWriteTool('I', { read: true })).toBe(false);
    expect(isOmbreReadTool('I', { read: true })).toBe(true);
    expect(isOmbreReadTool('I', {})).toBe(true);
    expect(isOmbreReadTool('I', { set: 'new self fact' })).toBe(false);
    expect(isOmbreReadTool('I', { patch: { name: 'X' } })).toBe(false);
  });

  it('marks search tools that touch access metadata', () => {
    expect(toolTouchesMetadata('breath_search', { query: 'promise' })).toBe(true);
    expect(toolTouchesMetadata('breath_advanced', { query: 'promise' })).toBe(true);
    expect(toolTouchesMetadata('breath_advanced', { catalog: true })).toBe(false);
  });
});
