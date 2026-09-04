'use client';
import { useState, useEffect, useRef } from 'react';
import AppLayout from '@/components/AppLayout';
import { useAuth } from '@/components/AuthProvider';
import { useTheme } from '@/lib/ThemeContext';
import { aiChats } from '@/lib/api';

export default function AiChatPage() {
  const { supabase } = useAuth();
  const { BG, SURFACE, BORDER, MUTED, H1: TEXT, CORAL: A, NAV_ACTIVE: ABG } = useTheme();
  const [chats,       setChats]       = useState([]);
  const [activeChatId,setActiveChatId]= useState(null);
  const [messages,    setMessages]    = useState([]);
  const [input,       setInput]       = useState('');
  const [loading,     setLoading]     = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const bottomRef = useRef(null);

  useEffect(() => {
    if (!supabase) return;
    aiChats.list(supabase)
      .then(c => { setChats(c); setLoadingList(false); })
      .catch(() => setLoadingList(false));
  }, [supabase]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function newChat() {
    setActiveChatId(null);
    setMessages([]);
    setInput('');
  }

  function openChat(chat) {
    setActiveChatId(chat.id);
    setMessages(Array.isArray(chat.messages) ? chat.messages : []);
  }

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');

    const userMsg = { role: 'user', content: text };
    const next = [...messages, userMsg];
    setMessages(next);
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next }),
      });
      const data = await res.json();
      // A failed request used to be persisted as a cheerful "Sorry, I could not
      // respond." assistant turn, so the real reason never reached the user and
      // the placeholder was saved into the chat history for good.
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      const assistantMsg = { role: 'assistant', content: data.content || '' };
      if (!assistantMsg.content) throw new Error('пустой ответ от модели');
      const final = [...next, assistantMsg];
      setMessages(final);

      // Persist to Supabase
      if (!activeChatId) {
        const title = text.slice(0, 40);
        const chat = await aiChats.create(supabase, title, final);
        setActiveChatId(chat.id);
        setChats(c => [chat, ...c]);
      } else {
        const updated = await aiChats.update(supabase, activeChatId, final);
        setChats(c => c.map(x => x.id === activeChatId ? { ...x, messages: final, updated_at: updated.updated_at } : x));
      }
    } catch (err) {
      // Show the failure in the thread (matching the Sessions-page chat) rather
      // than leaving the user staring at their own unanswered message.
      console.error('[AI Chat]', err?.message);
      setMessages([...next, { role: 'assistant', content: '⚠ ' + (err?.message || 'запрос не удался') }]);
    } finally {
      setLoading(false);
    }
  }

  async function deleteChat(id, e) {
    e.stopPropagation();
    try {
      await aiChats.delete(supabase, id);
      setChats(c => c.filter(x => x.id !== id));
      if (activeChatId === id) newChat();
    } catch (err) {
      console.error('[AI Chat] delete:', err?.message);
    }
  }

  return (
    <AppLayout>
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        {/* Chat list sidebar */}
        <div style={{ width: 220, flexShrink: 0, borderRight: `1px solid ${BORDER}`, background: SURFACE, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '16px 12px', borderBottom: `1px solid ${BORDER}` }}>
            <button onClick={newChat}
              style={{ width: '100%', padding: '9px', borderRadius: 10, border: `1px solid ${BORDER}`, background: 'transparent', color: A, fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
              + New chat
            </button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 8px' }}>
            {loadingList && <p style={{ fontSize: 12, color: MUTED, padding: '8px 4px' }}>Loading…</p>}
            {chats.map(c => (
              <div key={c.id} onClick={() => openChat(c)}
                style={{ padding: '10px 12px', borderRadius: 10, cursor: 'pointer', marginBottom: 2, background: activeChatId === c.id ? ABG : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: 13, color: activeChatId === c.id ? A : TEXT, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: activeChatId === c.id ? 500 : 400 }}>{c.title || 'Chat'}</p>
                  <p style={{ fontSize: 11, color: MUTED, margin: '2px 0 0' }}>{new Date(c.updated_at || c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
                </div>
                <button onClick={e => deleteChat(c.id, e)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED, fontSize: 14, flexShrink: 0, opacity: 0.5, lineHeight: 1, padding: '2px 4px' }}>×</button>
              </div>
            ))}
          </div>
        </div>

        {/* Chat area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: BG }}>
          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
            {messages.length === 0 && (
              <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
                <p style={{ fontFamily: 'var(--font-serif)', fontSize: 28, fontWeight: 300, color: TEXT, margin: '0 0 10px' }}>How can I help?</p>
                <p style={{ fontSize: 15, color: MUTED, maxWidth: 400 }}>I'm your AI therapy companion. Share what's on your mind.</p>
              </div>
            )}
            <div style={{ maxWidth: 680, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
              {messages.map((m, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                  <div style={{
                    maxWidth: '78%', padding: '12px 16px', borderRadius: m.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                    background: m.role === 'user' ? A : SURFACE,
                    color: m.role === 'user' ? '#fff' : TEXT,
                    border: m.role === 'user' ? 'none' : `1px solid ${BORDER}`,
                    fontSize: 15, lineHeight: 1.6,
                  }}>
                    {m.content}
                  </div>
                </div>
              ))}
              {loading && (
                <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                  <div style={{ padding: '12px 16px', borderRadius: '16px 16px 16px 4px', background: SURFACE, border: `1px solid ${BORDER}`, color: MUTED, fontSize: 15 }}>…</div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          </div>

          {/* Input */}
          <div style={{ padding: '16px 28px', borderTop: `1px solid ${BORDER}`, background: SURFACE }}>
            <div style={{ maxWidth: 680, margin: '0 auto', display: 'flex', gap: 10 }}>
              <input value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
                placeholder="Type a message…"
                style={{ flex: 1, padding: '12px 16px', borderRadius: 12, border: `1px solid ${BORDER}`, background: BG, color: TEXT, fontSize: 15, outline: 'none' }} />
              <button onClick={send} disabled={!input.trim() || loading}
                style={{ padding: '12px 24px', borderRadius: 12, border: 'none', background: input.trim() ? A : BORDER, color: '#fff', fontSize: 14, fontWeight: 500, cursor: input.trim() ? 'pointer' : 'default' }}>
                Send
              </button>
            </div>
            {/* The same line the session chat carries. A safety notice that
                shows on only one of two chat surfaces is a half-measure.
                English here because this whole screen is in English. */}
            <p style={{ maxWidth: 680, margin: '10px auto 0', fontSize: 11, color: MUTED, lineHeight: 1.5, textAlign: 'center' }}>
              Miru is not a replacement for therapy. In a crisis, please reach out to a professional.
            </p>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
