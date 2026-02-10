import { useState, useEffect } from 'react';
import type { ParsedConversation } from '../types';

export function useConversations() {
  const [conversations, setConversations] = useState<ParsedConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchConversations = async () => {
    try {
      const res = await fetch('/api/conversations');
      const data = await res.json();
      setConversations(data);
      setLastUpdated(new Date());
    } catch (error) {
      console.error('Failed to fetch conversations:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConversations();

    const eventSource = new EventSource('/api/events');
    
    eventSource.addEventListener('refresh', () => {
      fetchConversations();
    });

    return () => {
      eventSource.close();
    };
  }, []);

  return { conversations, loading, lastUpdated };
}
