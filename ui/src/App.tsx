import { useState, useEffect } from 'react';
import { useConversations } from './hooks/useConversations';
import { ConversationList } from './components/ConversationList';
import { ConversationDetail } from './components/ConversationDetail';
import { SearchBar } from './components/SearchBar';
import { Terminal, Sparkles, Loader2, PanelLeftClose, PanelLeftOpen, Maximize2, Minimize2, Copy, Check, TerminalSquare } from 'lucide-react';
import type { ParsedConversation } from './types';

export function App() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedConversation, setSelectedConversation] = useState<ParsedConversation | null>(null);
  const [currentSource, setCurrentSource] = useState<'cli' | 'ide' | null>(null);
  const [availableSources, setAvailableSources] = useState<('cli' | 'ide')[]>([]);
  const [isSwitching, setIsSwitching] = useState(false);
  const [switchingTo, setSwitchingTo] = useState<'cli' | 'ide' | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const { conversations, loading } = useConversations(currentSource || undefined);

  // The CLI can resume a session by id (`kiro-cli chat --resume-id <id>`).
  // IDE sessions have no CLI resume path, so we fall back to copying the directory.
  const canResume = currentSource === 'cli' && !!selectedConversation?.conversationId;
  const resumeCommand = selectedConversation
    ? `kiro-cli chat --resume-id ${selectedConversation.conversationId}`
    : '';

  const handleCopy = async () => {
    if (!selectedConversation) return;
    const text = canResume ? resumeCommand : selectedConversation.directoryPath;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Clear switching state when loading finishes
  useEffect(() => {
    if (!loading && isSwitching) {
      setIsSwitching(false);
      setSwitchingTo(null);
    }
  }, [loading, isSwitching]);

  useEffect(() => {
    fetch('/api/sources')
      .then(res => res.json())
      .then(data => {
        setAvailableSources(data.sources);
        setCurrentSource(data.default);
      })
      .catch(err => console.error('Failed to fetch sources:', err));
  }, []);

  const handleSourceSwitch = async (target?: 'cli' | 'ide') => {
    const newSource = target ?? (currentSource === 'cli' ? 'ide' : 'cli');
    if (newSource === currentSource || isSwitching) return;
    setIsSwitching(true);
    setSwitchingTo(newSource);
    setSelectedConversation(null);
    // Set source and let the useEffect handle the fetch
    setCurrentSource(newSource);
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
      {!fullscreen && (
        <header className="flex items-center gap-4 px-4 py-3 border-b border-[rgb(var(--border))] bg-[rgb(var(--background-card))]">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="p-1.5 rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--background))] hover:bg-[rgb(var(--background-hover))] text-[rgb(var(--foreground))] transition-colors"
              title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
              aria-label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
            >
              {sidebarCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
            </button>
            <span className="font-semibold text-[rgb(var(--foreground))]">Kiro History</span>
            {/* Source: segmented toggle when both are available, static badge otherwise */}
            {currentSource && canSwitch && (
              <div
                role="tablist"
                aria-label="Conversation source"
                className="flex items-center p-0.5 rounded-md bg-[rgb(var(--background))] border border-[rgb(var(--border))]"
              >
                {(['cli', 'ide'] as const).map((src) => {
                  const active = currentSource === src;
                  const Icon = src === 'ide' ? Sparkles : Terminal;
                  return (
                    <button
                      key={src}
                      role="tab"
                      aria-selected={active}
                      onClick={() => handleSourceSwitch(src)}
                      disabled={isSwitching}
                      title={active ? `Viewing ${src.toUpperCase()} conversations` : `Switch to ${src.toUpperCase()}`}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-all duration-200 disabled:cursor-not-allowed ${
                        active
                          ? src === 'ide'
                            ? 'bg-purple-600/20 text-purple-400 shadow-sm'
                            : 'bg-cyan-600/20 text-cyan-400 shadow-sm'
                          : 'text-[rgb(var(--foreground-muted))] hover:text-[rgb(var(--foreground))]'
                      }`}
                    >
                      {isSwitching && switchingTo === src ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Icon className="w-3 h-3" />
                      )}
                      {src.toUpperCase()}
                    </button>
                  );
                })}
              </div>
            )}
            {currentSource && !canSwitch && (
              <div className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium ${
                currentSource === 'ide'
                  ? 'bg-purple-600/20 text-purple-400 border border-purple-600/30'
                  : 'bg-cyan-600/20 text-cyan-400 border border-cyan-600/30'
              }`}>
                {currentSource === 'ide' ? <Sparkles className="w-3 h-3" /> : <Terminal className="w-3 h-3" />}
                {currentSource.toUpperCase()}
              </div>
            )}
          </div>
          <SearchBar
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search conversations..."
          />
          <div className="flex items-center gap-2">
            <span className="text-xs text-[rgb(var(--foreground-muted))] whitespace-nowrap">
              {conversations.length} conversations
            </span>
            {selectedConversation && (
              <>
                <button
                  onClick={handleCopy}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-medium transition-colors ${
                    copied
                      ? 'border-green-500/40 bg-green-500/15 text-green-400'
                      : 'border-cyan-500/40 bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25 hover:border-cyan-400/60'
                  }`}
                  title={canResume ? `Copy resume command: ${resumeCommand}` : 'Copy directory path'}
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      Copied!
                    </>
                  ) : canResume ? (
                    <>
                      <TerminalSquare className="w-3.5 h-3.5" />
                      Copy resume command
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      Copy path
                    </>
                  )}
                </button>
                <button
                  onClick={() => setFullscreen(true)}
                  className="p-1.5 rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--background))] hover:bg-[rgb(var(--background-hover))] text-[rgb(var(--foreground))] transition-colors"
                  title="Fullscreen"
                  aria-label="Enter fullscreen mode"
                >
                  <Maximize2 className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        </header>
      )}

      {/* Fullscreen exit button */}
      {fullscreen && (
        <button
          onClick={() => setFullscreen(false)}
          className="fixed top-3 right-3 z-50 p-2 rounded-md bg-[rgb(var(--background-card))] border border-[rgb(var(--border))] hover:bg-[rgb(var(--background-hover))] text-[rgb(var(--foreground-muted))] hover:text-[rgb(var(--foreground))] transition-colors shadow-lg"
          title="Exit fullscreen"
          aria-label="Exit fullscreen mode"
        >
          <Minimize2 className="w-4 h-4" />
        </button>
      )}

      {/* Main content */}
      <main className="flex-1 flex overflow-hidden">
        {!sidebarCollapsed && !fullscreen && (
          <ConversationList
            conversations={filteredConversations}
            loading={false}
            selectedPath={selectedConversation?.conversationId}
            onSelect={setSelectedConversation}
          />
        )}
        <ConversationDetail conversation={selectedConversation} />
      </main>
    </div>
  );
}
