import { useState, useEffect } from 'react';
import type { CommandEntry } from '../types';

export function useCommands() {
  const [commands, setCommands] = useState<CommandEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchCommands = async () => {
    try {
      const res = await fetch('/api/commands');
      const data = await res.json();
      setCommands(data);
      setLastUpdated(new Date());
    } catch (error) {
      console.error('Failed to fetch commands:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCommands();

    // Subscribe to SSE for live updates
    const eventSource = new EventSource('/api/events');
    
    eventSource.addEventListener('refresh', () => {
      fetchCommands();
    });

    eventSource.addEventListener('error', () => {
      console.error('SSE connection error');
    });

    return () => {
      eventSource.close();
    };
  }, []);

  return { commands, loading, lastUpdated };
}
