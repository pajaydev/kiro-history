import type { ParsedConversation } from '../types';

interface ConversationListProps {
  conversations: ParsedConversation[];
  loading: boolean;
  selectedPath?: string;
  onSelect: (conversation: ParsedConversation) => void;
}

function getDirectoryName(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] || path;
}

function getFirstUserMessage(conv: ParsedConversation): string {
  const firstUser = conv.messages.find((m) => m.role === 'user');
  return firstUser?.content || 'No messages';
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trim() + '...';
}

function formatDate(timestamp?: number): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function ConversationList({ conversations, loading, selectedPath, onSelect }: ConversationListProps) {
  if (loading) {
    return (
      <div className="w-[35%] min-w-[280px] max-w-[400px] border-r border-[rgb(var(--border))] p-4">
        <div className="text-[rgb(var(--foreground-muted))] text-sm">Loading...</div>
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="w-[35%] min-w-[280px] max-w-[400px] border-r border-[rgb(var(--border))] p-4">
        <div className="text-[rgb(var(--foreground-muted))] text-sm">No conversations found</div>
      </div>
    );
  }

  return (
    <div className="w-[35%] min-w-[280px] max-w-[400px] border-r border-[rgb(var(--border))] overflow-y-auto">
      {conversations.map((conv) => {
        const firstMessage = getFirstUserMessage(conv);
        const dirName = getDirectoryName(conv.directoryPath);
        
        return (
          <button
            key={conv.conversationId}
            onClick={() => onSelect(conv)}
            className={`w-full text-left px-4 py-3 border-l-2 transition-colors ${
              selectedPath === conv.conversationId
                ? 'border-l-cyan-500 bg-[rgb(var(--background-card))]'
                : 'border-l-transparent hover:bg-[rgb(var(--background-hover))]'
            }`}
          >
            {/* Directory name + date */}
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-[rgb(var(--foreground-muted))] font-medium">
                {dirName}
              </span>
              <span className="text-xs text-[rgb(var(--foreground-muted))]">
                {formatDate(conv.updatedAt)}
              </span>
            </div>
            
            {/* First user message as preview */}
            <div className="text-sm text-[rgb(var(--foreground))] line-clamp-2">
              {truncateText(firstMessage, 100)}
            </div>
          </button>
        );
      })}
    </div>
  );
}
