import { useState, useEffect, useCallback, useRef } from 'react';
import type { ParsedConversation } from '../types';

export function useConversations(source?: 'cli' | 'ide') {
  const [conversations, setConversations] = useState<ParsedConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const fetchIdRef = useRef(0);
  const hasLoadedRef = useRef(false);

  const fetchConversations = useCallback(async (sourceParam?: 'cli' | 'ide', showLoading = false) => {
    const id = ++fetchIdRef.current;
    if (showLoading) setLoading(true);
    try {
      const url = sourceParam 
        ? `/api/conversations?source=${sourceParam}` 
        : '/api/conversations';
      const res = await fetch(url);
      const data = await res.json();
      if (id === fetchIdRef.current) {
        setConversations(data);
        setLastUpdated(new Date());
        hasLoadedRef.current = true;
      }
    } catch (error) {
      console.error('Failed to fetch conversations:', error);
    } finally {
      if (id === fetchIdRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    // Show loading only on initial load or source change
    hasLoadedRef.current = false;
    fetchConversations(source, true);

    const eventSource = new EventSource('/api/events');
    
    eventSource.addEventListener('refresh', () => {
      // Background refresh — no loading overlay
      fetchConversations(source, false);
    });

    return () => {
      eventSource.close();
    };
  }, [source, fetchConversations]);

  return { 
    conversations, 
    loading, 
    lastUpdated,
  };
}
