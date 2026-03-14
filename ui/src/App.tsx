import { useState, useEffect } from 'react';
import { useConversations } from './hooks/useConversations';
import { ConversationList } from './components/ConversationList';
import { ConversationDetail } from './components/ConversationDetail';
import { SearchBar } from './components/SearchBar';
import { Terminal, Sparkles, RefreshCw, Loader2 } from 'lucide-react';
import type { ParsedConversation } from './types';

export function App() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedConversation, setSelectedConversation] = useState<ParsedConversation | null>(null);
  const [currentSource, setCurrentSource] = useState<'cli' | 'ide' | null>(null);
  const [availableSources, setAvailableSources] = useState<('cli' | 'ide')[]>([]);
  const [isSwitching, setIsSwitching] = useState(false);
  const [switchingTo, setSwitchingTo] = useState<'cli' | 'ide' | null>(null);
  const { conversations, loading, refetch } = useConversations(currentSource || undefined);

  useEffect(() => {
    fetch('/api/sources')
      .then(res => res.json())
      .then(data => {
        setAvailableSources(data.sources);
        setCurrentSource(data.default);
      })
      .catch(err => console.error('Failed to fetch sources:', err));
  }, []);

  const handleSourceSwitch = async () => {
    const newSource = currentSource === 'cli' ? 'ide' : 'cli';
    setIsSwitching(true);
    setSwitchingTo(newSource);
    setCurrentSource(newSource);
    setSelectedConversation(null);
    await refetch(newSource);
    setIsSwitching(false);
    setSwitchingTo(null);
  };

  const filteredConversations = conversations.filter((conv) =>
    conv.directoryPath.toLowerCase().includes(searchQuery.toLowerCase()) ||
    conv.messages.some((m) => m.content.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const canSwitch = availableSources.length > 1;
  const isLoading = loading || isSwitching || currentSource === null;

  return (
    <div className="h-screen flex flex-col bg-[rgb(var(--background))]">
      {/* Full-screen loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 bg-[rgb(var(--background))]/95 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-12 h-12 text-cyan-500 animate-spin" />
            <div className="text-[rgb(var(--foreground))] text-lg font-medium">
              {isSwitching && switchingTo ? `Switching to ${switchingTo.toUpperCase()}...` : 'Loading conversations...'}
            </div>
            <div className="text-[rgb(var(--foreground-muted))] text-sm">
              Please wait while we fetch your data
            </div>
          </div>
        </div>
      )}

      {/* Top bar */}
      <header className="flex items-center gap-4 px-4 py-3 border-b border-[rgb(var(--border))] bg-[rgb(var(--background-card))]">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-[rgb(var(--foreground))]">Kiro History</span>
          {currentSource && (
            <div className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium ${
              currentSource === 'ide' 
                ? 'bg-purple-600/20 text-purple-400 border border-purple-600/30' 
                : 'bg-cyan-600/20 text-cyan-400 border border-cyan-600/30'
            }`}>
              {currentSource === 'ide' ? (
                <>
                  <Sparkles className="w-3 h-3" />
                  IDE
                </>
              ) : (
                <>
                  <Terminal className="w-3 h-3" />
                  CLI
                </>
              )}
            </div>
          )}
          {canSwitch && currentSource && (
            <button
              onClick={handleSourceSwitch}
              disabled={isSwitching}
              className="group flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-gradient-to-r from-cyan-600/10 to-purple-600/10 hover:from-cyan-600/20 hover:to-purple-600/20 text-[rgb(var(--foreground))] transition-all duration-200 border border-[rgb(var(--border))] hover:border-cyan-500/50 hover:shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              title={`Switch to ${currentSource === 'cli' ? 'IDE' : 'CLI'}`}
            >
              {isSwitching ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5 group-hover:rotate-180 transition-transform duration-500" />
              )}
              <span>Switch to</span>
              {currentSource === 'cli' ? (
                <span className="flex items-center gap-1 text-purple-400">
                  <Sparkles className="w-3 h-3" />
                  IDE
                </span>
              ) : (
                <span className="flex items-center gap-1 text-cyan-400">
                  <Terminal className="w-3 h-3" />
                  CLI
                </span>
              )}
            </button>
          )}
        </div>
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
          loading={false}
          selectedPath={selectedConversation?.conversationId}
          onSelect={setSelectedConversation}
        />
        <ConversationDetail conversation={selectedConversation} />
      </main>
    </div>
  );
}
