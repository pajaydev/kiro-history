import { useEffect, useState } from 'react';

interface StatusBarProps {
  count: number;
  type: 'commands' | 'conversations';
  lastUpdated: Date | null;
}

function formatRelativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function StatusBar({ count, type, lastUpdated }: StatusBarProps) {
  const [, setTick] = useState(0);

  // Update relative time every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(interval);
  }, []);

  const label = type === 'commands' ? 'commands' : 'conversations';

  return (
    <footer className="px-4 py-2 text-xs text-[rgb(var(--foreground-muted))] border-t border-[rgb(var(--border))]">
      {count.toLocaleString()} {label}
      {lastUpdated && ` · Last updated ${formatRelativeTime(lastUpdated)}`}
    </footer>
  );
}
