import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';

/** Where a simulated phishing link lands. Public (the random token is the key); it only teaches – nothing is asked of the person. */
export function PhishLanding() {
  const { token = '' } = useParams();
  const [d, setD] = useState<any>(null); const [bad, setBad] = useState(false);
  useEffect(() => { api.get(`/public/phish/${token}`).then((r) => setD(r.data.data)).catch(() => setBad(true)); }, [token]);
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20, background: 'var(--bg)', color: 'var(--text)' }}>
      <div className="card" style={{ maxWidth: 560, width: '100%' }}>
        {bad ? <><h1 style={{ fontSize: 20, marginTop: 0 }}>This link is not valid</h1><p className="text-muted">It may have expired. If you were not expecting it, do not click links in emails you are unsure about.</p></> : !d ? <p className="text-muted">Loading…</p> : (
          <>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 6 }}><ShieldCheck size={26} color="var(--accent)" /><h1 style={{ fontSize: 20, margin: 0 }}>{d.firstName ? `${d.firstName}, ` : ''}this was a phishing simulation</h1></div>
            <p>Nothing was harmed and nothing was collected. Global SJX runs these practice exercises (authorised by management) so we can all spot the real thing.{d.simulationEnded ? ' This exercise has already ended, so your click was not counted.' : ''}</p>
            <div className="aw-expl"><b>The email: “{d.template.subject}”</b>
              <ul style={{ margin: '8px 0 0 18px', padding: 0 }}>{d.template.redFlags.map((r: string) => <li key={r}>{r}</li>)}</ul></div>
            <p style={{ fontSize: 14 }}><b>What to do next time:</b> {d.template.lesson}</p>
            <p className="text-muted" style={{ fontSize: 13 }}>Report anything suspicious in the app under Security Awareness → Report an email. Reporting, even after a click, earns points and helps everyone.</p>
            <a className="btn btn-primary" href="/awareness?tab=report">Open Security Awareness</a>
          </>)}
      </div>
    </div>
  );
}
