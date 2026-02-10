import { CheckCircle, XCircle } from 'lucide-react';
import type { CommandEntry } from '../types';

interface CommandListProps {
  commands: CommandEntry[];
  loading: boolean;
  selectedId?: number;
  onSelect: (command: CommandEntry) => void;
}

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp * 1000) / 1000);
  
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function CommandList({ commands, loading, selectedId, onSelect }: CommandListProps) {
  if (loading) {
    return (
      <div className="w-[35%] border-r border-[rgb(var(--border))] p-4">
        <div className="text-[rgb(var(--foreground-muted))] text-sm">Loading...</div>
      </div>
    );
  }

  if (commands.length === 0) {
    return (
      <div className="w-[35%] border-r border-[rgb(var(--border))] p-4">
        <div className="text-[rgb(var(--foreground-muted))] text-sm">No commands found</div>
      </div>
    );
  }

  return (
    <div className="w-[35%] border-r border-[rgb(var(--border))] overflow-y-auto">
      {commands.map((cmd) => (
        <button
          key={cmd.id}
          onClick={() => onSelect(cmd)}
          className={`w-full text-left px-4 py-3 border-l-2 transition-colors ${
            selectedId === cmd.id
              ? 'border-l-[rgb(var(--foreground))] bg-[rgb(var(--background-card))]'
              : 'border-l-transparent hover:bg-[rgb(var(--background-hover))]'
          }`}
        >
          <div className="flex items-center gap-2">
            <code className="flex-1 text-sm font-mono truncate">{cmd.command}</code>
            {cmd.exitCode === 0 ? (
              <CheckCircle className="w-4 h-4 text-[rgb(var(--success))] shrink-0" />
            ) : cmd.exitCode !== null ? (
              <XCircle className="w-4 h-4 text-[rgb(var(--failure))] shrink-0" />
            ) : null}
          </div>
          <div className="text-xs text-[rgb(var(--foreground-muted))] mt-1">
            {formatRelativeTime(cmd.startTime)}
          </div>
        </button>
      ))}
    </div>
  );
}
