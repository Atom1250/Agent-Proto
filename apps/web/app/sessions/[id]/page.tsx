'use client';

import type { CSSProperties, FormEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';

import { apiUrl } from '../../../lib/api';

type PageProps = {
  params: { id: string };
};

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
};

const pageStyle: CSSProperties = {
  margin: '0 auto',
  minHeight: '100vh',
  maxWidth: 960,
  padding: 24,
  display: 'flex',
  flexDirection: 'column',
  gap: 24,
  fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont',
};

const panelStyle: CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  padding: 20,
  backgroundColor: '#ffffff',
  boxShadow: '0 10px 30px rgba(15, 23, 42, 0.05)',
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
};

const messageListStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  height: '60vh',
  overflowY: 'auto',
  paddingRight: 8,
};

const messageBubbleBase: CSSProperties = {
  padding: '12px 16px',
  borderRadius: 12,
  maxWidth: '75%',
  whiteSpace: 'pre-wrap',
  lineHeight: 1.5,
};

const inputAreaStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

const textareaStyle: CSSProperties = {
  borderRadius: 10,
  border: '1px solid #d1d5db',
  padding: 12,
  fontSize: 14,
  resize: 'vertical',
  minHeight: 80,
  fontFamily: 'inherit',
};

const sendButtonStyle: CSSProperties = {
  alignSelf: 'flex-end',
  borderRadius: 8,
  backgroundColor: '#2563eb',
  color: '#ffffff',
  border: 'none',
  padding: '10px 18px',
  fontSize: 14,
  fontWeight: 600,
};

function extractAssistantMessages(data: unknown): ChatMessage[] {
  if (!data || typeof data !== 'object') {
    return [];
  }

  const payload = data as Record<string, unknown>;
  const candidates: unknown[] = [];

  if (Array.isArray(payload.messages)) {
    candidates.push(...payload.messages);
  }
  if (Array.isArray(payload.replies)) {
    candidates.push(...payload.replies);
  }
  if (payload.message) {
    candidates.push(payload.message);
  }
  if (payload.reply) {
    candidates.push(payload.reply);
  }
  if (payload.assistantMessage) {
    candidates.push(payload.assistantMessage);
  }
  if (payload.assistantMessages) {
    const assistantMessages = payload.assistantMessages;
    if (Array.isArray(assistantMessages)) {
      candidates.push(...assistantMessages);
    } else {
      candidates.push(assistantMessages);
    }
  }
  if (typeof payload.response === 'string') {
    candidates.push({ role: 'assistant', content: payload.response });
  }
  if (typeof payload.result === 'string') {
    candidates.push({ role: 'assistant', content: payload.result });
  }

  const messages: ChatMessage[] = [];
  const now = Date.now();

  candidates.forEach((candidate, index) => {
    if (!candidate) {
      return;
    }

    let role: string | undefined;
    let content: unknown;
    let id: string | undefined;

    if (typeof candidate === 'string') {
      role = 'assistant';
      content = candidate;
    } else if (typeof candidate === 'object') {
      const entry = candidate as Record<string, unknown>;
      role = typeof entry.role === 'string' ? entry.role : typeof entry.author === 'string' ? entry.author : undefined;
      content = entry.content ?? entry.text ?? entry.message ?? entry.output;
      id = typeof entry.id === 'string' ? entry.id : undefined;

      if (!content && Array.isArray(entry.parts)) {
        content = entry.parts
          .map((part) => {
            if (typeof part === 'string') {
              return part;
            }
            if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
              return part.text;
            }
            return '';
          })
          .filter(Boolean)
          .join('\n');
      }

      if (!content && Array.isArray(entry.content)) {
        content = entry.content
          .map((part) => {
            if (typeof part === 'string') {
              return part;
            }
            if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
              return part.text;
            }
            return '';
          })
          .filter(Boolean)
          .join('\n');
      }
    }

    const normalizedRole = role === 'system' ? 'system' : role === 'assistant' || role === 'tool' || role === 'ai' ? 'assistant' : undefined;
    const textContent = typeof content === 'string' ? content : '';

    if (!textContent.trim()) {
      return;
    }

    const finalRole = normalizedRole ?? 'assistant';
    if (finalRole === 'user') {
      return;
    }

    messages.push({
      id: id ?? `assistant-${now}-${index}`,
      role: finalRole,
      content: textContent.trim(),
    });
  });

  return messages;
}

function extractMissingSlots(data: unknown): string[] | null {
  if (!data || typeof data !== 'object') {
    return null;
  }
  const payload = data as Record<string, unknown>;
  const raw =
    payload.missing_required_slots ??
    payload.missingRequiredSlots ??
    payload.missingSlots ??
    payload.missing ??
    null;

  if (!raw) {
    return null;
  }

  if (Array.isArray(raw)) {
    return raw.map((item) => String(item));
  }

  if (typeof raw === 'string') {
    return raw.split(',').map((item) => item.trim()).filter(Boolean);
  }

  return null;
}

function extractPercentFilled(data: unknown): number | null {
  if (!data || typeof data !== 'object') {
    return null;
  }
  const payload = data as Record<string, unknown>;
  const raw =
    payload.percentRequiredSlotsFilled ??
    payload.percent_required_slots_filled ??
    payload.percentFilled ??
    payload.progress ??
    null;

  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.min(100, Math.max(0, raw));
  }
  if (typeof raw === 'string') {
    const parsed = Number.parseFloat(raw);
    if (!Number.isNaN(parsed)) {
      return Math.min(100, Math.max(0, parsed));
    }
  }
  return null;
}

export default function SessionPage({ params }: PageProps) {
  const sessionId = params.id;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [percentFilled, setPercentFilled] = useState(0);
  const [missingSlots, setMissingSlots] = useState<string[]>([]);
  const [hasMissingSlotsData, setHasMissingSlotsData] = useState(false);
  const [isCompactLayout, setIsCompactLayout] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = useCallback(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const fetchSessionStatus = useCallback(async () => {
    try {
      const response = await fetch(apiUrl(`/v1/sessions/${sessionId}`));
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      const percent = extractPercentFilled(data);
      if (percent !== null) {
        setPercentFilled(percent);
      }
    } catch (err) {
      console.error('Failed to fetch session status', err);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchSessionStatus();
  }, [fetchSessionStatus]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const updateLayout = () => {
      setIsCompactLayout(window.innerWidth < 900);
    };
    updateLayout();
    window.addEventListener('resize', updateLayout);
    return () => {
      window.removeEventListener('resize', updateLayout);
    };
  }, []);

  const progressBar = useMemo(() => {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
          <span style={{ fontWeight: 600 }}>Required slot completion</span>
          <span>{percentFilled}%</span>
        </div>
        <div
          style={{ height: 12, backgroundColor: '#e5e7eb', borderRadius: 9999, overflow: 'hidden' }}
          role="progressbar"
          aria-valuenow={percentFilled}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Required slot completion"
        >
          <div
            style={{
              width: `${percentFilled}%`,
              height: '100%',
              background: 'linear-gradient(90deg, #2563eb, #38bdf8)',
              transition: 'width 200ms ease-in-out',
            }}
          />
        </div>
      </div>
    );
  }, [percentFilled]);

  const missingSlotsPanel = useMemo(() => {
    if (!hasMissingSlotsData) {
      return (
        <div
          style={{
            borderRadius: 12,
            border: '1px dashed #d1d5db',
            backgroundColor: '#f9fafb',
            padding: 12,
            fontSize: 14,
            color: '#6b7280',
          }}
          aria-live="polite"
        >
          Missing slot information will appear after the assistant replies.
        </div>
      );
    }

    if (missingSlots.length === 0) {
      return (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            borderRadius: 12,
            border: '1px solid #bbf7d0',
            backgroundColor: '#f0fdf4',
            color: '#047857',
            padding: 12,
            fontSize: 14,
            fontWeight: 600,
          }}
          aria-live="polite"
        >
          <span role="img" aria-label="Complete">
            ✅
          </span>
          All required slots have been collected.
        </div>
      );
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} aria-live="polite">
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            borderRadius: 12,
            border: '1px solid #fcd34d',
            backgroundColor: '#fef3c7',
            color: '#92400e',
            padding: 12,
            fontSize: 14,
            lineHeight: 1.5,
          }}
        >
          <span role="img" aria-label="Attention">
            ⚠️
          </span>
          <div>
            <strong>{missingSlots.length}</strong> required field{missingSlots.length === 1 ? '' : 's'} still need attention.
            Collect the remaining details below.
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {missingSlots.map((slot) => (
            <span
              key={slot}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 10px',
                borderRadius: 9999,
                backgroundColor: '#fee2e2',
                border: '1px solid #fecaca',
                color: '#b91c1c',
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: 0.2,
                textTransform: 'capitalize',
              }}
            >
              <span
                style={{
                  display: 'inline-block',
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  backgroundColor: '#ef4444',
                }}
              />
              {slot.replace(/[_-]/g, ' ')}
            </span>
          ))}
        </div>
      </div>
    );
  }, [hasMissingSlotsData, missingSlots]);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmed = input.trim();
      if (!trimmed || isSending) {
        return;
      }

      const userMessage: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: trimmed,
      };

      setMessages((prev) => [...prev, userMessage]);
      setInput('');
      setIsSending(true);
      setError(null);

      try {
        const response = await fetch(apiUrl(`/v1/sessions/${sessionId}/messages`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: trimmed }),
        });

        const data = await response
          .json()
          .catch(() => ({ error: 'Invalid response from server' }));

        if (!response.ok) {
          throw new Error(typeof data?.error === 'string' ? data.error : 'Failed to send message');
        }

        const assistantMessages = extractAssistantMessages(data);
        if (assistantMessages.length > 0) {
          setMessages((prev) => {
            const existingIds = new Set(prev.map((message) => message.id));
            const deduped = assistantMessages.filter((message) => !existingIds.has(message.id));
            return deduped.length > 0 ? [...prev, ...deduped] : prev;
          });
        }

        const updatedMissingSlots = extractMissingSlots(data);
        if (updatedMissingSlots) {
          setMissingSlots(updatedMissingSlots);
          setHasMissingSlotsData(true);
        }

        const percentFromMessage = extractPercentFilled(data);
        if (percentFromMessage !== null) {
          setPercentFilled(percentFromMessage);
        } else {
          await fetchSessionStatus();
        }
      } catch (err) {
        setMessages((prev) => prev.filter((message) => message.id !== userMessage.id));
        setError(err instanceof Error ? err.message : 'Failed to send message');
        setInput(trimmed);
      } finally {
        setIsSending(false);
      }
    },
    [fetchSessionStatus, input, isSending, sessionId],
  );

  return (
    <main style={pageStyle}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Link href="/sessions/start" style={{ fontSize: 13, color: '#2563eb', width: 'fit-content' }}>
          ← Start another session
        </Link>
        <h1 style={{ fontSize: 30, fontWeight: 600 }}>Session {sessionId}</h1>
        <p style={{ fontSize: 14, color: '#4b5563', maxWidth: 720 }}>
          Chat with the client to collect all required onboarding information. Progress updates
          automatically as the assistant identifies completed slots.
        </p>
      </header>

      <section
        style={
          isCompactLayout
            ? { display: 'flex', flexDirection: 'column', gap: 24 }
            : { display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 24, alignItems: 'start' }
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={panelStyle}>
            <div style={messageListStyle}>
              {messages.length === 0 ? (
                <p style={{ fontSize: 14, color: '#6b7280' }}>
                  No messages yet. Start the conversation by introducing yourself to the client.
                </p>
              ) : (
                messages.map((message) => {
                  const isUser = message.role === 'user';
                  return (
                    <div
                      key={message.id}
                      style={{
                        display: 'flex',
                        justifyContent: isUser ? 'flex-end' : 'flex-start',
                      }}
                    >
                      <div
                        style={{
                          ...messageBubbleBase,
                          backgroundColor: isUser ? '#2563eb' : '#f3f4f6',
                          color: isUser ? '#ffffff' : '#111827',
                          alignSelf: isUser ? 'flex-end' : 'flex-start',
                        }}
                      >
                        <div style={{ fontSize: 12, fontWeight: 600, opacity: 0.75 }}>
                          {isUser ? 'You' : message.role === 'system' ? 'System' : 'Assistant'}
                        </div>
                        <div style={{ marginTop: 6, fontSize: 14 }}>{message.content}</div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            <form onSubmit={handleSubmit} style={inputAreaStyle}>
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Type your message and press send"
                style={textareaStyle}
                disabled={isSending}
              />
              {error ? <p style={{ fontSize: 13, color: '#dc2626' }}>{error}</p> : null}
              <button
                type="submit"
                disabled={isSending}
                style={{
                  ...sendButtonStyle,
                  opacity: isSending ? 0.7 : 1,
                  cursor: isSending ? 'wait' : 'pointer',
                }}
              >
                {isSending ? 'Sending…' : 'Send'}
              </button>
            </form>
          </div>
        </div>

        <aside style={panelStyle}>
          {progressBar}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600 }}>Missing required slots</h2>
            {missingSlotsPanel}
          </div>
        </aside>
      </section>
    </main>
  );
}
