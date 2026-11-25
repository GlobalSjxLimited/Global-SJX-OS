import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, apiErrorMessage } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useToast } from '@/context/ToastContext';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { Loading, Tabs } from '@/components/ui/PageHead';
import { AuditStamp } from '@/components/ui/AuditStamp';
import { PeoplePicker } from '@/components/work/PeoplePicker';
import { RecordDocuments } from '@/components/record/RecordDocuments';
import { Discussion } from '@/components/discussion/Discussion';
import { fdatetime, toInputDate } from '@/lib/format';
import { ContactsEditor, ContactRow, contactProblem } from './ContactsEditor';

const SOURCES = [['manual', 'Entered by hand'], ['project', 'From a project'], ['campaign', 'Marketing campaign'], ['referral', 'Referral'], ['event', 'Event'], ['inbound', 'Inbound enquiry'], ['other', 'Other']];
const idOf = (v: any) => (v && typeof v === 'object' ? String(v._id || '') : v ? String(v) : '');
const split = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

/** Create an opportunity, or open one: details, contacts, documents, conversation and history. */
export function OpportunityModal({ open, id, meta, defaults, refresh, onClose, onSaved, onMove }: { open: boolean; id?: string | null; meta: any; defaults?: any; refresh?: number; onClose: () => void; onSaved: () => void; onMove?: (opp: any) => void }) {
  const { showError, showSuccess } = useToast();
  const existing = useApi<any>(open && id ? `/opportunities/${id}` : null, { r: refresh || 0 });
  const clients = useApi<any[]>(open ? '/clients' : null);
  const [tab, setTab] = useState('details');
  const [f, setF] = useState<any>({});
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [busy, setBusy] = useState(false);
  const opp = id ? existing.data : null;
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));

  useEffect(() => {
    if (!open) return;
    setTab('details');
    if (id) return;
    setF({ title: '', clientId: defaults?.clientId || '', prospectName: '', value: 0, stage: 'Lead', probability: '', source: 'manual', salespersonId: '', startDate: '', expectedCloseDate: '', nextAction: '', nextActionDate: '', productsServices: '', competitors: '', stageComment: '' });
    setContacts([]);
  }, [open, id, defaults?.clientId]);
  useEffect(() => {
    if (!opp) return;
    setF({ title: opp.title, clientId: idOf(opp.clientId), prospectName: opp.prospectName || '', value: opp.value || 0, stage: opp.stage, probability: opp.probability ?? '', source: opp.source || 'manual', salespersonId: idOf(opp.salespersonId), startDate: toInputDate(opp.startDate), expectedCloseDate: toInputDate(opp.expectedCloseDate), nextAction: opp.nextAction || '', nextActionDate: toInputDate(opp.nextActionDate), productsServices: (opp.productsServices || []).join(', '), competitors: (opp.competitors || []).join(', ') });
    setContacts((opp.contacts || []).map((c: any) => ({ ...c })));
  }, [opp]);

  const client = (clients.data || []).find((c) => c._id === f.clientId);
  const clientContacts: ContactRow[] = useMemo(() => (client?.contacts || []).map((c: any) => ({ name: c.name, title: c.title, email: c.email, phone: c.phone })), [client]);
  const closed = opp && ['Closed Won', 'Closed Lost'].includes(opp.stage);
  const bad = contacts.map(contactProblem).find(Boolean);

  async function save() {
    setBusy(true);
    try {
      const body: any = {
        title: f.title.trim(), clientId: f.clientId || '', prospectName: f.prospectName || undefined, value: Number(f.value) || 0, source: f.source, salespersonId: f.salespersonId || undefined,
        startDate: f.startDate || '', expectedCloseDate: f.expectedCloseDate || '', nextAction: f.nextAction || undefined, nextActionDate: f.nextActionDate || '',
        productsServices: split(f.productsServices), competitors: split(f.competitors), contacts: contacts.map((c) => ({ name: c.name.trim(), title: c.title || undefined, email: c.email || '', phone: c.phone || undefined, role: c.role || 'other', isPrimary: !!c.isPrimary })),
      };
      if (f.probability !== '') body.probability = Number(f.probability);
      if (!id) { body.stage = f.stage; body.stageComment = f.stageComment || undefined; await api.post('/opportunities', body); showSuccess('Opportunity created.'); }
      else { await api.patch(`/opportunities/${id}`, body); showSuccess('Saved.'); existing.reload(); }
      onSaved(); if (!id) onClose();
    } catch (e) { showError(apiErrorMessage(e)); } finally { setBusy(false); }
  }

  const title = id ? (opp ? opp.title : 'Opportunity') : 'New opportunity';
  return (
    <Modal open={open} onClose={onClose} size="xwide" title={title}
      footer={tab === 'details' || tab === 'contacts' ? <><button className="btn btn-ghost" onClick={onClose}>Close</button><button className="btn btn-primary" disabled={busy || f.title?.trim().length < 2 || (!f.clientId && !f.prospectName?.trim()) || !!bad} onClick={save}>{busy ? 'Saving…' : id ? 'Save changes' : 'Create opportunity'}</button></> : <button className="btn btn-ghost" onClick={onClose}>Close</button>}>
      {id && existing.loading && !opp ? <Loading /> : (
        <div style={{ display: 'grid', gap: 14 }}>
          {opp && <div className="flex-between" style={{ flexWrap: 'wrap', gap: 8 }}>
            <div className="row-gap"><Badge tone={opp.stage === 'Closed Won' ? 'success' : opp.stage === 'Closed Lost' ? 'danger' : 'accent'}>{opp.stage}</Badge><span className="text-muted" style={{ fontSize: 13 }}>{opp.probability}% · {opp.currency} {(opp.value || 0).toLocaleString()}</span>
              {opp.sourceProjectId?.name && <span style={{ fontSize: 13 }}>from project <Link to={`/projects/${idOf(opp.sourceProjectId)}`} style={{ textDecoration: 'underline' }}>{opp.sourceProjectId.name}</Link></span>}</div>
            {onMove && <button className="btn btn-primary btn-sm" onClick={() => onMove(opp)}>{closed ? 'Reopen or change stage' : 'Move to another stage'}</button>}
          </div>}
          {opp?.lostReason && <div className="callout danger">Lost: {opp.lostReason}</div>}{opp?.winReason && <div className="callout ok">Won because: {opp.winReason}</div>}
          {id && <Tabs value={tab} onChange={setTab} tabs={[{ key: 'details', label: 'Details' }, { key: 'contacts', label: 'Contacts', count: contacts.length }, { key: 'documents', label: 'Documents', count: opp?.documentCount }, { key: 'comments', label: 'Comments' }, { key: 'history', label: 'History', count: opp?.stageHistory?.length }]} />}
          {!id && <Tabs value={tab} onChange={setTab} tabs={[{ key: 'details', label: 'Details' }, { key: 'contacts', label: 'Contacts', count: contacts.length }]} />}

          {tab === 'details' && (
            <div className="form-grid">
              <div className="field full"><label htmlFor="op-title">Opportunity title *</label><input id="op-title" className="input" value={f.title || ''} onChange={(e) => set('title', e.target.value)} /></div>
              <div className="field"><label htmlFor="op-client">Client</label><select id="op-client" className="input" value={f.clientId || ''} onChange={(e) => set('clientId', e.target.value)}><option value="">Not a client yet</option>{(clients.data || []).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}</select></div>
              <div className="field"><label htmlFor="op-pros">{f.clientId ? 'Prospect name (not needed)' : 'Prospect name *'}</label><input id="op-pros" className="input" disabled={!!f.clientId} value={f.prospectName || ''} onChange={(e) => set('prospectName', e.target.value)} /></div>
              <div className="field"><label htmlFor="op-val">Value</label><input id="op-val" className="input" type="number" min={0} value={f.value} onChange={(e) => set('value', e.target.value)} /></div>
              <div className="field"><label htmlFor="op-prob">Probability (%) <small className="text-muted">{id ? '' : '— set from the stage if empty'}</small></label><input id="op-prob" className="input" type="number" min={0} max={100} value={f.probability} onChange={(e) => set('probability', e.target.value)} /></div>
              {!id && <div className="field"><label htmlFor="op-stage">Stage</label><select id="op-stage" className="input" value={f.stage} onChange={(e) => set('stage', e.target.value)}>{meta.openStages.map((s: string) => <option key={s}>{s}</option>)}</select></div>}
              <div className="field"><label htmlFor="op-src">Where did it come from?</label><select id="op-src" className="input" value={f.source} onChange={(e) => set('source', e.target.value)}>{SOURCES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
              <div className="field"><label>Salesperson</label><PeoplePicker single value={f.salespersonId ? [f.salespersonId] : []} onChange={(ids) => set('salespersonId', ids[0] || '')} placeholder="You, unless you pick someone" /></div>
              <div className="field"><label htmlFor="op-start">Work would start</label><input id="op-start" className="input" type="date" value={f.startDate || ''} onChange={(e) => set('startDate', e.target.value)} /></div>
              <div className="field"><label htmlFor="op-close">Expected to close</label><input id="op-close" className="input" type="date" value={f.expectedCloseDate || ''} onChange={(e) => set('expectedCloseDate', e.target.value)} /></div>
              <div className="field"><label htmlFor="op-next">Next action</label><input id="op-next" className="input" value={f.nextAction || ''} onChange={(e) => set('nextAction', e.target.value)} placeholder="e.g. Send the revised proposal" /></div>
              <div className="field"><label htmlFor="op-nextd">Next action date</label><input id="op-nextd" className="input" type="date" value={f.nextActionDate || ''} onChange={(e) => set('nextActionDate', e.target.value)} /></div>
              <div className="field full"><label htmlFor="op-prod">Products and services (comma separated)</label><input id="op-prod" className="input" value={f.productsServices || ''} onChange={(e) => set('productsServices', e.target.value)} /></div>
              <div className="field full"><label htmlFor="op-comp">Competitors (comma separated)</label><input id="op-comp" className="input" value={f.competitors || ''} onChange={(e) => set('competitors', e.target.value)} /></div>
              {!id && <div className="field full"><label htmlFor="op-sc">Opening note</label><input id="op-sc" className="input" value={f.stageComment || ''} onChange={(e) => set('stageComment', e.target.value)} placeholder="How did this come in?" /></div>}
              {opp && <div className="full"><AuditStamp doc={opp} /></div>}
            </div>
          )}
          {tab === 'contacts' && (<div><p className="text-muted" style={{ fontSize: 13, marginTop: 0 }}>Who we are dealing with. Record the decision maker and a champion on every deal.</p>
            <ContactsEditor value={contacts} onChange={setContacts} fromClient={client ? { label: client.name, contacts: clientContacts } : undefined} />{bad && <small role="alert" style={{ color: 'var(--danger, #e5484d)' }}>{bad}</small>}</div>)}
          {tab === 'documents' && id && <div><p className="text-muted" style={{ fontSize: 13, marginTop: 0 }}>Proposals, contracts and signed paperwork. A deal cannot be closed as won until a contract, proposal or signed copy is attached.</p>
            <RecordDocuments entityType="opportunity" entityId={id} kinds={['proposal', 'contract', 'signed', 'other']} onChanged={() => existing.reload()} /></div>}
          {tab === 'comments' && id && <Discussion entityType="opportunity" entityId={id} title="Notes and comments" />}
          {tab === 'history' && opp && (
            <ol className="stack" style={{ listStyle: 'none', margin: 0, padding: 0 }}>{[...(opp.stageHistory || [])].reverse().map((h: any, i: number) => (
              <li key={i} className="mini-card" style={{ fontSize: 13 }}><b>{h.from ? `${h.from} → ` : ''}{h.stage}</b>{h.comment && <div className="text-muted">{h.comment}</div>}<div className="text-muted" style={{ fontSize: 11.5 }}>{h.byName || 'System'} · {fdatetime(h.changedAt)}{h.device ? ` · ${h.device}` : ''}{h.ip ? ` (${h.ip})` : ''}</div></li>))}</ol>
          )}
        </div>
      )}
    </Modal>
  );
}
