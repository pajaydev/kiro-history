import { useState } from 'react';
import { User, Sparkles, ChevronDown, ChevronRight, Wrench } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { ParsedConversation, ToolUse } from '../types';

interface ConversationDetailProps {
  conversation: ParsedConversation | null;
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

export function ConversationDetail({ conversation }: ConversationDetailProps) {
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
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto py-6 px-4 space-y-6">
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
                      }}
                    >
                      {msg.content}
                    </ReactMarkdown>
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
  );
}
