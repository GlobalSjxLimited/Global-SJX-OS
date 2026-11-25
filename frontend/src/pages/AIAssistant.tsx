import { useState, useRef, useEffect } from 'react';
import { Sparkles, Send } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';

interface Message { role: 'user' | 'assistant'; text: string; }

const SUGGESTIONS = [
  'What should I work on today?',
  'What tasks are overdue?',
  'Which certifications expire this month?',
  'What projects are at risk?',
  'What opportunities are likely to close?',
  'Recommend training for me.',
];

export function AIAssistant() {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', text: "Hi, I'm SJX AI. I answer from your organization's real data — try one of the suggestions below, or ask your own question." },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send(text: string) {
    if (!text.trim() || loading) return;
    setMessages((m) => [...m, { role: 'user', text }]);
    setInput('');
    setLoading(true);
    try {
      const res = await api.post('/ai/ask', { message: text });
      setMessages((m) => [...m, { role: 'assistant', text: res.data.data.reply }]);
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', text: apiErrorMessage(err) }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)' }}>
      <div className="page-head" style={{ marginBottom: 16 }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Sparkles size={22} color="var(--accent)" /> SJX AI</h1>
          <p>Grounded in your organization's real tasks, projects, clients and certifications — not a generic chatbot.</p>
        </div>
      </div>

      <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 0 }}>
        <div style={{ flex: 1, overflowY: 'auto', padding: 24, display: 'grid', gap: 14, alignContent: 'start' }}>
          {messages.map((m, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div
                style={{
                  maxWidth: '75%',
                  padding: '12px 16px',
                  borderRadius: 14,
                  fontSize: 14,
                  background: m.role === 'user' ? 'var(--accent)' : 'var(--surface-2)',
                  color: m.role === 'user' ? '#fff' : 'var(--text)',
                  border: m.role === 'assistant' ? '1px solid var(--line)' : 'none',
                }}
              >
                {m.text}
              </div>
            </div>
          ))}
          {loading && <div style={{ fontSize: 13, color: 'var(--muted)' }}>SJX AI is thinking…</div>}
          <div ref={endRef} />
        </div>

        {messages.length <= 1 && (
          <div style={{ padding: '0 24px 16px', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {SUGGESTIONS.map((s) => (
              <button key={s} className="btn btn-ghost btn-sm" onClick={() => send(s)}>{s}</button>
            ))}
          </div>
        )}

        <div style={{ padding: 16, borderTop: '1px solid var(--line)', display: 'flex', gap: 10 }}>
          <input
            className="input"
            placeholder="Ask SJX AI anything about your work…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send(input)}
          />
          <button className="btn btn-primary" onClick={() => send(input)} disabled={loading}>
            <Send size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
