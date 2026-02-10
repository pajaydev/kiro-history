import { Copy, CheckCircle, XCircle } from 'lucide-react';
import { useState } from 'react';
import type { CommandEntry } from '../types';

interface CommandDetailProps {
  command: CommandEntry | null;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '-';
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString();
}

export function CommandDetail({ command }: CommandDetailProps) {
  const [copied, setCopied] = useState(false);

  if (!command) {
    return (
      <div className="flex-1 flex items-center justify-center text-[rgb(var(--foreground-muted))]">
        Select a command to view details
      </div>
    );
  }

  const copyCommand = async () => {
    await navigator.clipboard.writeText(command.command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex-1 p-6 overflow-y-auto">
      <div className="max-w-2xl">
        {/* Command */}
        <div className="flex items-start gap-2 mb-6">
          <code className="flex-1 font-mono text-lg bg-[rgb(var(--background-card))] p-4 rounded-lg break-all">
            {command.command}
          </code>
          <button
            onClick={copyCommand}
            className="p-2 rounded-md hover:bg-[rgb(var(--background-hover))] transition-colors"
            aria-label="Copy command"
          >
            {copied ? (
              <CheckCircle className="w-4 h-4 text-[rgb(var(--success))]" />
            ) : (
              <Copy className="w-4 h-4" />
            )}
          </button>
        </div>

        {/* Details */}
        <div className="space-y-4">
          <DetailRow label="Exit Code">
            <span className="flex items-center gap-2">
              {command.exitCode ?? '-'}
              {command.exitCode === 0 ? (
                <CheckCircle className="w-4 h-4 text-[rgb(var(--success))]" />
              ) : command.exitCode !== null ? (
                <XCircle className="w-4 h-4 text-[rgb(var(--failure))]" />
              ) : null}
            </span>
          </DetailRow>
          <DetailRow label="Duration">{formatDuration(command.duration)}</DetailRow>
          <DetailRow label="Shell">{command.shell}</DetailRow>
          <DetailRow label="Working Directory">
            <code className="font-mono text-sm">{command.cwd}</code>
          </DetailRow>
          <DetailRow label="Started">{formatTimestamp(command.startTime)}</DetailRow>
          <DetailRow label="Hostname">{command.hostname}</DetailRow>
          <DetailRow label="Session ID">
            <code className="font-mono text-xs">{command.sessionId}</code>
          </DetailRow>
          <DetailRow label="PID">{command.pid}</DetailRow>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex">
      <span className="w-40 text-[rgb(var(--foreground-muted))] text-sm">{label}</span>
      <span className="flex-1 text-sm">{children}</span>
    </div>
  );
}
