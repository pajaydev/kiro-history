import { useState, useRef, useEffect, useCallback } from 'react';
import { User, Sparkles, ChevronDown, ChevronRight, Wrench } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { ParsedConversation, ToolUse, TurnMetadata } from '../types';

interface ConversationDetailProps {
  conversation: ParsedConversation | null;
  searchQuery?: string;
}

function ToolUseBadges({ toolUses }: { toolUses: ToolUse[] }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-3 border-t border-[rgb(var(--border))] pt-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 transition-colors"
      >
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <Wrench className="w-3 h-3" />
        <span>{toolUses.length} tool{toolUses.length > 1 ? 's' : ''} used</span>
        {!expanded && (
          <span className="text-amber-500/70 ml-1">
            ({toolUses.map(t => t.name).join(', ')})
          </span>
        )}
      </button>
      
      {expanded && (
        <div className="mt-2 space-y-2 pl-5">
          {toolUses.map((tool) => (
            <div key={tool.id} className="bg-amber-950/30 border border-amber-900/50 rounded-lg p-3 text-xs">
              <div className="font-mono text-amber-400 mb-1">{tool.name}</div>
              <pre className="text-amber-200/60 overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(tool.args, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TurnCostBadge({ turnMetadata }: { turnMetadata: TurnMetadata }) {
  const cost = turnMetadata.creditCost.toFixed(4);
  return (
    <div className="turn-cost-badge mt-3 border-t border-[rgb(var(--border))] pt-3">
      <div className="flex items-center gap-1.5 text-xs">
        <span>⚡</span>
        <span>{cost} credits</span>
        <span className="opacity-50">·</span>
        <span>{turnMetadata.model}</span>
        <span className="opacity-50">·</span>
        <span>{turnMetadata.requestCount} request{turnMetadata.requestCount !== 1 ? 's' : ''}</span>
      </div>
    </div>
  );
}

function SessionCostSummary({ messages }: { messages: ParsedConversation['messages'] }) {
  let totalCredits = 0;
  let totalRequests = 0;
  let turnCount = 0;

  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.turnMetadata) {
      totalCredits += msg.turnMetadata.creditCost;
      totalRequests += msg.turnMetadata.requestCount;
      turnCount++;
    }
  }

  if (turnCount === 0) return null;

  return (
    <div className="session-cost-summary border-b border-[rgb(var(--border))] px-4 py-2">
      <div className="max-w-4xl mx-auto flex items-center gap-2 text-xs">
        <span>⚡</span>
        <span>Session total: {totalCredits.toFixed(4)} credits</span>
        <span className="opacity-50">·</span>
        <span>{totalRequests} requests</span>
        <span className="opacity-50">·</span>
        <span>{turnCount} turns</span>
      </div>
    </div>
  );
}

/**
 * Walk all text nodes within a container and wrap case-insensitive matches
 * of `query` with <mark class="search-highlight"> elements.
 * Returns the total number of matches found.
 */
function highlightTextNodes(container: HTMLElement, query: string): number {
  if (!query) return 0;

  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedQuery})`, 'gi');
  let matchCount = 0;

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
  const textNodes: Text[] = [];

  // Collect text nodes first (modifying DOM during walk is unsafe)
  let node = walker.nextNode();
  while (node) {
    textNodes.push(node as Text);
    node = walker.nextNode();
  }

  for (const textNode of textNodes) {
    const text = textNode.nodeValue;
    if (!text || !regex.test(text)) {
      regex.lastIndex = 0;
      continue;
    }
    regex.lastIndex = 0;

    // Split text by matches and build replacement fragment
    const parts = text.split(regex);
    if (parts.length <= 1) continue;

    const fragment = document.createDocumentFragment();
    for (const part of parts) {
      if (regex.test(part)) {
        regex.lastIndex = 0;
        const mark = document.createElement('mark');
        mark.className = 'search-highlight';
        mark.textContent = part;
        fragment.appendChild(mark);
        matchCount++;
      } else {
        fragment.appendChild(document.createTextNode(part));
      }
    }

    textNode.parentNode?.replaceChild(fragment, textNode);
  }

  return matchCount;
}

/**
 * Remove all <mark class="search-highlight"> elements, restoring the original
 * text nodes. Also normalizes adjacent text nodes afterward.
 */
function clearHighlights(container: HTMLElement): void {
  const marks = container.querySelectorAll('mark.search-highlight');
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    const textNode = document.createTextNode(mark.textContent || '');
    parent.replaceChild(textNode, mark);
    parent.normalize();
  });
}

export function ConversationDetail({ conversation, searchQuery }: ConversationDetailProps) {
  const messagesRef = useRef<HTMLDivElement>(null);

  // Apply highlights and scroll to first match whenever query or conversation changes
  const applyHighlights = useCallback(() => {
    const container = messagesRef.current;
    if (!container) return;

    // Always clear previous highlights first
    clearHighlights(container);

    const trimmedQuery = searchQuery?.trim() || '';
    if (!trimmedQuery) return;

    // Wait a tick for ReactMarkdown async rendering to complete
    requestAnimationFrame(() => {
      if (!messagesRef.current) return;
      const matchCount = highlightTextNodes(messagesRef.current, trimmedQuery);

      // Scroll to first match
      if (matchCount > 0) {
        const firstMark = messagesRef.current.querySelector('mark.search-highlight');
        firstMark?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  }, [searchQuery]);

  useEffect(() => {
    applyHighlights();
  }, [applyHighlights, conversation]);

  if (!conversation) {
    return (
      <div className="flex-1 flex items-center justify-center text-[rgb(var(--foreground-muted))]">
        Select a conversation to view messages
      </div>
    );
  }

  if (conversation.messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-[rgb(var(--foreground-muted))]">
        No messages in this conversation
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">

      {/* Session cost summary */}
      <SessionCostSummary messages={conversation.messages} />

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        <div ref={messagesRef} className="max-w-4xl mx-auto py-6 px-4 space-y-6">
        {conversation.messages.map((msg, idx) => (
          <div key={idx} className="flex gap-3">
            {/* Avatar */}
            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
              msg.role === 'user' 
                ? 'bg-cyan-600' 
                : 'bg-[rgb(var(--background-hover))]'
            }`}>
              {msg.role === 'user' ? (
                <User className="w-4 h-4 text-white" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
            </div>
            
            {/* Message content */}
            <div className="flex-1 min-w-0">
              <div className="text-xs text-[rgb(var(--foreground-muted))] mb-1">
                {msg.role === 'user' ? 'You' : 'Assistant'}
              </div>
              <div className={`text-sm ${
                msg.role === 'user' 
                  ? 'bg-cyan-900/30 text-[rgb(var(--foreground))] px-4 py-3 rounded-lg whitespace-pre-wrap' 
                  : 'prose prose-invert prose-sm max-w-none'
              }`}>
                {msg.role === 'user' ? (
                  msg.content
                ) : (
                  <>
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        code({ className, children, ...props }) {
                          const match = /language-(\w+)/.exec(className || '');
                          const isInline = !match && !String(children).includes('\n');
                          
                          if (isInline) {
                            return (
                              <code className="bg-[rgb(var(--background-hover))] px-1.5 py-0.5 rounded text-sm font-mono" {...props}>
                                {children}
                              </code>
                            );
                          }
                          
                          return (
                            <SyntaxHighlighter
                              style={oneDark}
                              language={match?.[1] || 'text'}
                              PreTag="div"
                              customStyle={{
                                margin: '0.5rem 0',
                                borderRadius: '0.5rem',
                                fontSize: '0.875rem',
                              }}
                            >
                              {String(children).replace(/\n$/, '')}
                            </SyntaxHighlighter>
                          );
                        },
                        p({ children }) {
                          return <p className="mb-3 last:mb-0">{children}</p>;
                        },
                        ul({ children }) {
                          return <ul className="list-disc pl-4 mb-3 space-y-1">{children}</ul>;
                        },
                        ol({ children }) {
                          return <ol className="list-decimal pl-4 mb-3 space-y-1">{children}</ol>;
                        },
                        li({ children }) {
                          return <li>{children}</li>;
                        },
                        h1({ children }) {
                          return <h1 className="text-xl font-bold mb-2 mt-4">{children}</h1>;
                        },
                        h2({ children }) {
                          return <h2 className="text-lg font-bold mb-2 mt-3">{children}</h2>;
                        },
                        h3({ children }) {
                          return <h3 className="text-base font-bold mb-2 mt-2">{children}</h3>;
                        },
                        a({ href, children }) {
                          return (
                            <a href={href} className="text-cyan-400 hover:underline" target="_blank" rel="noopener noreferrer">
                              {children}
                            </a>
                          );
                        },
                        blockquote({ children }) {
                          return (
                            <blockquote className="border-l-2 border-[rgb(var(--foreground-muted))] pl-4 italic my-2">
                              {children}
                            </blockquote>
                          );
                        },
                        table({ children }) {
                          return (
                            <div className="overflow-x-auto my-4">
                              <table className="min-w-full border-collapse border border-[rgb(var(--border))]">
                                {children}
                              </table>
                            </div>
                          );
                        },
                        thead({ children }) {
                          return <thead className="bg-[rgb(var(--background-hover))]">{children}</thead>;
                        },
                        tbody({ children }) {
                          return <tbody>{children}</tbody>;
                        },
                        tr({ children }) {
                          return <tr className="border-b border-[rgb(var(--border))]">{children}</tr>;
                        },
                        th({ children }) {
                          return (
                            <th className="px-4 py-2 text-left font-semibold border border-[rgb(var(--border))]">
                              {children}
                            </th>
                          );
                        },
                        td({ children }) {
                          return (
                            <td className="px-4 py-2 border border-[rgb(var(--border))]">
                              {children}
                            </td>
                          );
                        },
                      }}
                    >
                      {msg.content}
                    </ReactMarkdown>
                    {msg.turnMetadata && (
                      <TurnCostBadge turnMetadata={msg.turnMetadata} />
                    )}
                    {msg.toolUses && msg.toolUses.length > 0 && (
                      <ToolUseBadges toolUses={msg.toolUses} />
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
        </div>
      </div>
    </div>
  );
}
