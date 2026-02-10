import { useState } from 'react';
import { useConversations } from './hooks/useConversations';
import { ConversationList } from './components/ConversationList';
import { ConversationDetail } from './components/ConversationDetail';
import { SearchBar } from './components/SearchBar';
import type { ParsedConversation } from './types';

export function App() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedConversation, setSelectedConversation] = useState<ParsedConversation | null>(null);
  const { conversations, loading } = useConversations();

  const filteredConversations = conversations.filter((conv) =>
    conv.directoryPath.toLowerCase().includes(searchQuery.toLowerCase()) ||
    conv.messages.some((m) => m.content.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="h-screen flex flex-col bg-[rgb(var(--background))]">
      {/* Top bar */}
      <header className="flex items-center gap-4 px-4 py-3 border-b border-[rgb(var(--border))] bg-[rgb(var(--background-card))]">
        <span className="font-semibold text-[rgb(var(--foreground))]">Kiro History</span>
        <SearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search conversations..."
        />
        <span className="text-xs text-[rgb(var(--foreground-muted))]">
          {conversations.length} conversations
        </span>
      </header>

      {/* Main content */}
      <main className="flex-1 flex overflow-hidden">
        <ConversationList
          conversations={filteredConversations}
          loading={loading}
          selectedPath={selectedConversation?.conversationId}
          onSelect={setSelectedConversation}
        />
        <ConversationDetail conversation={selectedConversation} />
      </main>
    </div>
  );
}
