import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseConversationValueSimple } from './parser.js';

afterEach(() => vi.restoreAllMocks());

describe('parse failure logging', () => {
  it('warns once per unreadable row, on one line', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (let i = 0; i < 3; i++) {
      expect(parseConversationValueSimple('/warn-once-test', '{not json')).toEqual([]);
    }
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]).toHaveLength(1);
    expect(warn.mock.calls[0][0]).toMatch(/^Skipping unreadable conversation for \/warn-once-test: /);
  });
});
