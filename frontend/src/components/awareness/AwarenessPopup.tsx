import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { GraduationCap, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

interface Q { serveId: string; text: string; options: string[]; topic: string; difficulty: string; points: number; remainingToday?: number }
interface Res { correct: boolean; correctIndex: number; explanation: string; policyRef?: string; points: number; streak: number; capped: boolean }

const EXTERNAL = ['client', 'vendor', 'training_customer'];
const FIRST_DELAY = 12_000, POLL = 20 * 60_000;

/**
 * One short question at a time, chosen for the person's role. Never blocks the screen; the server decides when a question is due
 * (max per day, minimum gap, snooze) and checks the answer, so refreshing the page cannot be used to farm points.
 */
export function AwarenessPopup() {
  const { user } = useAuth();
  const [q, setQ] = useState<Q | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [res, setRes] = useState<Res | null>(null);
  const [busy, setBusy] = useState(false);
  const live = useRef(true);
  const asking = useRef(false);

  const fetchNext = useCallback(async () => {
    if (!user || EXTERNAL.includes(user.role) || asking.current || document.hidden) return;
    asking.current = true;
    try {
      const r = await api.get('/awareness/popup');
      const d = r.data.data;
      if (live.current && d?.question) { setQ((cur) => cur || d.question); }
    } catch { /* awareness must never get in the way of work */ } finally { asking.current = false; }
  }, [user]);

  useEffect(() => {
    live.current = true;
    const first = window.setTimeout(fetchNext, FIRST_DELAY);
    const every = window.setInterval(fetchNext, POLL);
    const onVis = () => { if (!document.hidden) window.setTimeout(fetchNext, 2000); };
    document.addEventListener('visibilitychange', onVis);
    return () => { live.current = false; clearTimeout(first); clearInterval(every); document.removeEventListener('visibilitychange', onVis); };
  }, [fetchNext]);

  if (!q) return null;

  async function choose(i: number) {
    if (picked !== null || !q) return;
    setPicked(i); setBusy(true);
    try { const r = await api.post(`/awareness/popup/${q.serveId}/answer`, { choice: i }); setRes(r.data.data); }
    catch { setQ(null); setPicked(null); } finally { setBusy(false); }
  }
  async function close(snooze: boolean) {
    const id = q!.serveId;
    setQ(null); setPicked(null); setRes(null);
    if (snooze) api.post(`/awareness/popup/${id}/dismiss`, { snoozeHours: 4 }).catch(() => undefined);
  }

  return (
    <div className="aw-pop" role="dialog" aria-label="Security question" aria-live="polite">
      <div className="aw-head">
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><GraduationCap size={14} /> Quick security question · {q.topic.replace(/_/g, ' ')} · +{q.points} pts</span>
        {!res && <button className="btn btn-ghost" style={{ padding: 2 }} aria-label="Not now" title="Not now (snooze 4 hours)" onClick={() => close(true)}><X size={15} /></button>}
      </div>
      <div className="aw-q">{q.text}</div>
      {q.options.map((o, i) => (
        <button key={i} className={`aw-opt ${res ? (i === res.correctIndex ? 'right' : i === picked ? 'wrong' : '') : ''}`} disabled={picked !== null || busy} onClick={() => choose(i)}>{o}</button>
      ))}
      {res && (
        <>
          <div className="aw-expl"><b>{res.correct ? 'Correct.' : 'Not quite.'}</b> {res.explanation}{res.policyRef ? <span className="text-muted"> ({res.policyRef})</span> : null}</div>
          <div className="aw-foot">
            {res.correct && <span className="aw-pts">+{res.points} pts{res.streak >= 3 ? ` · ${res.streak} in a row` : ''}{res.capped ? ' (daily limit)' : ''}</span>}
            <Link to="/awareness" className="btn btn-ghost" onClick={() => close(false)}>Leaderboard</Link>
            <button className="btn btn-primary" onClick={() => close(false)}>Got it</button>
          </div>
        </>
      )}
      {!res && <div className="text-muted" style={{ fontSize: 11.5, marginTop: 2 }}>Short questions for your role, a couple a day. Not now? Use ✕ to pause them for 4 hours.</div>}
    </div>
  );
}
