// IDE v1.0 workspace watching.
//
// Extracted from cli.ts so the wiring can be unit-tested with injected fakes
// (no real filesystem, no fs.watch timers). This encapsulates two concerns:
//
//   1. A per-workspace RECURSIVE watcher on each ~/.kiro/sessions/<hash>/ dir,
//      firing on new sessions and on new turns written inside existing ones.
//   2. A base-path NON-RECURSIVE, change-gated watcher on ~/.kiro/sessions/
//      that detects workspace-hash dirs added/removed after startup. It only
//      notifies when the resolved workspace SET actually changes (so writes
//      under the sibling cli/ dir — every CLI turn — never misfire it), and it
//      attaches a per-workspace watcher to any newly-added dir so subsequent
//      turns inside a workspace opened after startup are also seen live.

/** Minimal watcher handle (matches watcher.ts FileWatcher). */
export interface Closable {
  close(): void;
}

export interface WatchDirFn {
  (
    dir: string,
    onChange: (filename?: string | null) => void,
    options?: { recursive?: boolean }
  ): Closable;
}

export interface WorkspaceWatchDeps {
  /** Base sessions dir (~/.kiro/sessions). */
  basePath: string;
  /** Whether the base path currently exists. */
  basePathExists: boolean;
  /** Workspace dirs known at startup. */
  initialWorkspaceDirs: string[];
  /** Re-resolves the current workspace dir list (excludes cli/). */
  resolveWorkspaceDirs: (basePath: string) => string[];
  /** Directory watcher factory (watcher.ts watchDirectory). */
  watchDirectory: WatchDirFn;
  /** Called when a workspace's contents change (new session / new turn). */
  onSessionsChanged: () => void;
  /** Called when the set of workspace dirs changes (add/remove). */
  onWorkspacesChanged: () => void;
}

/**
 * Wire up all IDE v1.0 workspace watchers. Returns a single closable that
 * tears down every underlying watcher.
 */
export function watchIdeV1Workspaces(deps: WorkspaceWatchDeps): Closable {
  const {
    basePath,
    basePathExists,
    initialWorkspaceDirs,
    resolveWorkspaceDirs,
    watchDirectory,
    onSessionsChanged,
    onWorkspacesChanged,
  } = deps;

  const watchers: Closable[] = [];
  // Track which workspace dirs already have a per-workspace watcher so we never
  // double-watch and can attach watchers to workspaces discovered after startup.
  const watchedWorkspaces = new Set<string>();

  // Attach a recursive watcher to a single workspace dir (idempotent).
  const watchWorkspace = (dir: string): void => {
    if (watchedWorkspaces.has(dir)) return;
    watchedWorkspaces.add(dir);
    watchers.push(watchDirectory(dir, () => onSessionsChanged()));
  };

  // Watch each existing workspace directory for new sessions.
  for (const dir of initialWorkspaceDirs) {
    watchWorkspace(dir);
  }

  // Base-path watcher: NON-RECURSIVE + change-gated (see file header).
  if (basePathExists) {
    let knownWorkspaces = new Set(initialWorkspaceDirs);
    watchers.push(
      watchDirectory(
        basePath,
        () => {
          const current = new Set(resolveWorkspaceDirs(basePath));
          // Symmetric-difference check: same size AND every current dir known.
          const unchanged =
            current.size === knownWorkspaces.size &&
            [...current].every(d => knownWorkspaces.has(d));
          if (unchanged) return; // ignore noise (e.g. writes under cli/)
          // Attach a per-workspace watcher to any newly-added workspace dir so
          // subsequent turns inside it are also seen live (not just the first
          // one caught by this base-path notify).
          for (const dir of current) {
            if (!knownWorkspaces.has(dir)) watchWorkspace(dir);
          }
          knownWorkspaces = current;
          onWorkspacesChanged();
        },
        { recursive: false }
      )
    );
  }

  return { close: () => watchers.forEach(w => w.close()) };
}
