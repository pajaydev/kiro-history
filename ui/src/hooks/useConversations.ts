import { useState, useEffect, useCallback } from 'react';
import type { ParsedConversation } from '../types';

export function useConversations(source?: 'cli' | 'ide') {
  const [conversations, setConversations] = useState<ParsedConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchConversations = useCallback(async (sourceParam?: 'cli' | 'ide') => {
    try {
      const url = sourceParam 
        ? `/api/conversations?source=${sourceParam}` 
        : '/api/conversations';
      const res = await fetch(url);
      const data = await res.json();
      setConversations(data);
      setLastUpdated(new Date());
    } catch (error) {
      console.error('Failed to fetch conversations:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConversations(source);

    const eventSource = new EventSource('/api/events');
    
    eventSource.addEventListener('refresh', () => {
      fetchConversations(source);
    });

    return () => {
      eventSource.close();
    };
  }, [source, fetchConversations]);

  return { 
    conversations, 
    loading, 
    lastUpdated,
    refetch: fetchConversations
  };
}
