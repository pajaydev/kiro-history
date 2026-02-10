import { useState } from 'react';
import { useTheme } from './hooks/useTheme';
import { useCommands } from './hooks/useCommands';
import { useConversations } from './hooks/useConversations';
import { CommandList } from './components/CommandList';
import { CommandDetail } from './components/CommandDetail';
import { ConversationList } from './components/ConversationList';
import { ConversationDetail } from './components/ConversationDetail';
import { SearchBar } from './components/SearchBar';
import { ThemeToggle } from './components/ThemeToggle';
import { StatusBar } from './components/StatusBar';
import type { CommandEntry, ParsedConversation } from './types';

type Tab = 'commands' | 'conversations';

export function App() {
  const [activeTab, setActiveTab] = useState<Tab>('commands');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCommand, setSelectedCommand] = useState<CommandEntry | null>(null);
  const [selectedConversation, setSelectedConversation] = useState<ParsedConversation | null>(null);
  const { theme, toggleTheme } = useTheme();
  const { commands, loading: commandsLoading, lastUpdated: commandsUpdated } = useCommands();
  const { conversations, loading: conversationsLoading } = useConversations();

  const filteredCommands = commands.filter((cmd) =>
    cmd.command.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredConversations = conversations.filter((conv) =>
    conv.directoryPath.toLowerCase().includes(searchQuery.toLowerCase()) ||
    conv.messages.some((m) => m.content.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="h-screen flex flex-col">
      {/* Top bar */}
      <header className="flex items-center gap-4 px-4 py-3 border-b border-[rgb(var(--border))]">
        <SearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder={activeTab === 'commands' ? 'Search commands...' : 'Search conversations...'}
        />
        
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('commands')}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              activeTab === 'commands'
                ? 'bg-[rgb(var(--background-hover))] text-[rgb(var(--foreground))]'
                : 'text-[rgb(var(--foreground-muted))] hover:text-[rgb(var(--foreground))]'
            }`}
          >
            Commands
          </button>
          <button
            onClick={() => setActiveTab('conversations')}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              activeTab === 'conversations'
                ? 'bg-[rgb(var(--background-hover))] text-[rgb(var(--foreground))]'
                : 'text-[rgb(var(--foreground-muted))] hover:text-[rgb(var(--foreground))]'
            }`}
          >
            Chats
          </button>
        </div>

        <ThemeToggle theme={theme} onToggle={toggleTheme} />
      </header>

      {/* Main content */}
      <main className="flex-1 flex overflow-hidden">
        {activeTab === 'commands' ? (
          <>
            <CommandList
              commands={filteredCommands}
              loading={commandsLoading}
              selectedId={selectedCommand?.id}
              onSelect={setSelectedCommand}
            />
            <CommandDetail command={selectedCommand} />
          </>
        ) : (
          <>
            <ConversationList
              conversations={filteredConversations}
              loading={conversationsLoading}
              selectedPath={selectedConversation?.conversationId}
              onSelect={setSelectedConversation}
            />
            <ConversationDetail conversation={selectedConversation} />
          </>
        )}
      </main>

      {/* Status bar */}
      <StatusBar
        count={activeTab === 'commands' ? commands.length : conversations.length}
        type={activeTab}
        lastUpdated={commandsUpdated}
      />
    </div>
  );
}
