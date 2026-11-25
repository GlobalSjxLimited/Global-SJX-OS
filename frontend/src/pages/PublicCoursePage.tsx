import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { School, Clock, Users2, Video, MapPin, Layers } from 'lucide-react';
import { api } from '@/lib/api';

export function PublicCoursePage() {
  const { id } = useParams();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get(`/academy/public/${id}`)
      .then((res) => setData(res.data.data))
      .catch(() => setError("This course isn't available, or the link has expired."))
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--ink)', color: 'var(--text)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ maxWidth: 560, width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28, justifyContent: 'center' }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: 'linear-gradient(155deg,#C22FD4,#6d1a78)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 13, fontFamily: 'Fraunces, serif' }}>SJX</div>
          <span style={{ fontFamily: 'Fraunces, serif', fontSize: 16, fontWeight: 600 }}>{data?.organization?.name || 'Global SJX'} Academy <span className="beta-pill">Beta</span></span>
        </div>

        {loading && <p style={{ textAlign: 'center', color: 'var(--muted)' }}>Loading…</p>}
        {error && <p style={{ textAlign: 'center', color: 'var(--danger)' }}>{error}</p>}

        {data && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--line-strong)', borderRadius: 22, padding: 40 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--gold)', border: '1px solid rgba(240,169,59,.4)', background: 'rgba(240,169,59,.14)', padding: '5px 12px', borderRadius: 100, marginBottom: 18 }}>
              <School size={13} /> {data.course.category}
            </div>
            <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 28, marginBottom: 14 }}>{data.course.title}</h1>
            <p style={{ color: 'var(--muted)', fontSize: 15, lineHeight: 1.6, marginBottom: 26 }}>
              {data.course.description || 'Hands-on, instructor-guided training.'}
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 28 }}>
              <InfoRow icon={<Clock size={15} />} label="Duration" value={`${data.course.durationHours} hours`} />
              <InfoRow
                icon={data.course.deliveryMode === 'virtual' ? <Video size={15} /> : data.course.deliveryMode === 'physical' ? <MapPin size={15} /> : <Layers size={15} />}
                label="Format"
                value={data.course.deliveryMode}
              />
              <InfoRow icon={<Users2 size={15} />} label="Seats" value={data.seatsRemaining !== null ? `${data.seatsRemaining} remaining` : 'Unlimited'} />
              <InfoRow icon={<School size={15} />} label="Instructor" value={data.course.instructor || 'Global SJX Academy team'} />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--line)', paddingTop: 24 }}>
              <div>
                <div style={{ fontFamily: 'Fraunces, serif', fontSize: 26, fontWeight: 600 }}>{data.course.currency} {data.course.cost?.toLocaleString()}</div>
                <div style={{ fontSize: 12, color: 'var(--muted-2)' }}>per participant</div>
              </div>
              <a
                href={`mailto:talk2us@globalsjxltd.com?subject=${encodeURIComponent('Academy enrollment: ' + data.course.title)}`}
                className="btn btn-primary"
              >
                Enquire to enroll
              </a>
            </div>
          </div>
        )}

        <p style={{ textAlign: 'center', fontSize: 11.5, color: 'var(--muted-2)', marginTop: 20 }}>
          Shared from Global SJX OS — this page requires no login.
        </p>
      </div>
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 12, padding: '12px 14px' }}>
      <span style={{ color: 'var(--accent)' }}>{icon}</span>
      <div>
        <div style={{ fontSize: 11, color: 'var(--muted-2)' }}>{label}</div>
        <div style={{ fontSize: 13.5, fontWeight: 600, textTransform: 'capitalize' }}>{value}</div>
      </div>
    </div>
  );
}
