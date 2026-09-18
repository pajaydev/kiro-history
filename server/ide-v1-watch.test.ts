import { describe, it, expect, beforeEach } from 'vitest';
import { watchIdeV1Workspaces, type Closable, type WatchDirFn } from './ide-v1-watch.js';

// A fake watchDirectory that records every watch call and lets tests fire the
// registered callback on demand — no real fs.watch, no timers, no flakiness.
interface FakeWatch {
  dir: string;
  recursive: boolean;
  fire: () => void;
  closed: boolean;
}

function makeFakeWatcher() {
  const calls: FakeWatch[] = [];
  const watchDirectory: WatchDirFn = (dir, onChange, options) => {
    const entry: FakeWatch = {
      dir,
      recursive: options?.recursive !== false, // default true
      fire: () => onChange(null),
      closed: false,
    };
    calls.push(entry);
    const handle: Closable = { close: () => { entry.closed = true; } };
    return handle;
  };
  return { calls, watchDirectory };
}

describe('watchIdeV1Workspaces', () => {
  const BASE = '/sessions';
  const WS_A = '/sessions/ws-A';
  const WS_B = '/sessions/ws-B';

  let sessionsChanged: number;
  let workspacesChanged: number;

  beforeEach(() => {
    sessionsChanged = 0;
    workspacesChanged = 0;
  });

  function setup(initialDirs: string[], resolver: () => string[]) {
    const { calls, watchDirectory } = makeFakeWatcher();
    const handle = watchIdeV1Workspaces({
      basePath: BASE,
      basePathExists: true,
      initialWorkspaceDirs: initialDirs,
      resolveWorkspaceDirs: resolver,
      watchDirectory,
      onSessionsChanged: () => { sessionsChanged++; },
      onWorkspacesChanged: () => { workspacesChanged++; },
    });
    return { calls, handle };
  }

  it('attaches a recursive watcher to each initial workspace dir', () => {
    const { calls } = setup([WS_A, WS_B], () => [WS_A, WS_B]);
    const wsWatchers = calls.filter(c => c.dir === WS_A || c.dir === WS_B);
    expect(wsWatchers).toHaveLength(2);
    expect(wsWatchers.every(c => c.recursive)).toBe(true);
  });

  it('attaches exactly one NON-recursive watcher to the base path', () => {
    const { calls } = setup([WS_A], () => [WS_A]);
    const baseWatchers = calls.filter(c => c.dir === BASE);
    expect(baseWatchers).toHaveLength(1);
    expect(baseWatchers[0].recursive).toBe(false);
  });

  it('does not watch the base path when it does not exist', () => {
    const { calls, watchDirectory } = makeFakeWatcher();
    watchIdeV1Workspaces({
      basePath: BASE,
      basePathExists: false,
      initialWorkspaceDirs: [WS_A],
      resolveWorkspaceDirs: () => [WS_A],
      watchDirectory,
      onSessionsChanged: () => { sessionsChanged++; },
      onWorkspacesChanged: () => { workspacesChanged++; },
    });
    expect(calls.filter(c => c.dir === BASE)).toHaveLength(0);
    expect(calls.filter(c => c.dir === WS_A)).toHaveLength(1);
  });

  it('firing a workspace watcher triggers onSessionsChanged', () => {
    const { calls } = setup([WS_A], () => [WS_A]);
    calls.find(c => c.dir === WS_A)!.fire();
    expect(sessionsChanged).toBe(1);
    expect(workspacesChanged).toBe(0);
  });

  it('REGRESSION: a workspace discovered after startup gets its own live watcher', () => {
    // Start with only WS_A. The resolver will later report WS_B too.
    let resolved = [WS_A];
    const { calls } = setup([WS_A], () => resolved);

    // Initially only WS_A + base are watched.
    expect(calls.filter(c => c.dir === WS_B)).toHaveLength(0);

    // Simulate a new IDE project: WS_B appears, then the base watcher fires.
    resolved = [WS_A, WS_B];
    calls.find(c => c.dir === BASE)!.fire();

    // The set changed -> onWorkspacesChanged fired once...
    expect(workspacesChanged).toBe(1);
    // ...and a per-workspace watcher was attached to WS_B (the fix).
    const wsBWatchers = calls.filter(c => c.dir === WS_B);
    expect(wsBWatchers).toHaveLength(1);
    expect(wsBWatchers[0].recursive).toBe(true);

    // A SECOND turn inside WS_B now fires onSessionsChanged (was stale before).
    wsBWatchers[0].fire();
    expect(sessionsChanged).toBe(1);
  });

  it('base watcher firing with an UNCHANGED set does not notify or add watchers', () => {
    // Models a write under cli/: base fires, but resolveWorkspaceDirs is stable.
    const { calls } = setup([WS_A], () => [WS_A]);
    const before = calls.length;

    calls.find(c => c.dir === BASE)!.fire();

    expect(workspacesChanged).toBe(0);
    expect(sessionsChanged).toBe(0);
    expect(calls.length).toBe(before); // no new watcher attached
  });

  it('does not double-watch a workspace already being watched', () => {
    // Resolver reports WS_A (already initial) plus a genuinely new WS_B.
    let resolved = [WS_A];
    const { calls } = setup([WS_A], () => resolved);

    resolved = [WS_A, WS_B];
    calls.find(c => c.dir === BASE)!.fire();
    // Fire base again with the same set — must not re-add WS_A or WS_B.
    calls.find(c => c.dir === BASE)!.fire();

    expect(calls.filter(c => c.dir === WS_A)).toHaveLength(1);
    expect(calls.filter(c => c.dir === WS_B)).toHaveLength(1);
    expect(workspacesChanged).toBe(1); // second fire was a no-op (unchanged set)
  });

  it('close() closes every underlying watcher', () => {
    const { calls, handle } = setup([WS_A, WS_B], () => [WS_A, WS_B]);
    handle.close();
    expect(calls.every(c => c.closed)).toBe(true);
  });
});
