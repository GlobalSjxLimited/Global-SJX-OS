import { Link, useLocation, useParams } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';

const LABELS: Record<string, string> = {
  import: 'Import data', signatures: 'E-signatures', 'supplier-assessments': 'Supplier assessments', visitors: 'Visitors', 'my-visitors': 'My visitors',
  offboarding: 'Offboarding', 'my-report': 'My report', 'my-offboarding': 'My offboarding', 'threat-intel': 'Threat intelligence', isms: 'ISMS Automation Hub', awareness: 'Security Awareness',
  'my-work': 'My Work',
  tasks: 'Tasks',
  projects: 'Projects',
  meetings: 'Meetings',
  goals: 'Goals & OKRs',
  clients: 'Clients',
  sales: 'Sales Pipeline',
  vendors: 'Vendors',
  sponsors: 'Sponsors',
  marketing: 'Marketing',
  'social-queue': 'Posting queue',
  employees: 'Employees',
  training: 'Training',
  certifications: 'Certifications',
  skills: 'Skills',
  academy: 'Academy',
  documents: 'Documents',
  ideas: 'Idea Room',
  knowledge: 'Knowledge Base',
  reports: 'Reports',
  risks: 'Risks',
  compliance: 'Compliance',
  tickets: 'Support Desk',
  ai: 'SJX AI',
  settings: 'Settings',
  hub: 'Global SJX Hub',
};

/** Renders "Home / Section / :id" from the current path. Hidden on the dashboard itself. */
export function Breadcrumbs() {
  const location = useLocation();
  const params = useParams();
  const segments = location.pathname.split('/').filter(Boolean);

  if (segments.length === 0) return null;

  const idValues = new Set(Object.values(params).filter(Boolean) as string[]);

  return (
    <nav aria-label="Breadcrumb" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--muted-2)', marginBottom: 14, flexWrap: 'wrap' }}>
      <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <Home size={13} /> Dashboard
      </Link>
      {segments.map((seg, i) => {
        const path = '/' + segments.slice(0, i + 1).join('/');
        const isLast = i === segments.length - 1;
        const label = idValues.has(seg) ? 'Detail' : LABELS[seg] || seg;
        return (
          <span key={path} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <ChevronRight size={12} />
            {isLast ? <span style={{ color: 'var(--text)', fontWeight: 600 }}>{label}</span> : <Link to={path}>{label}</Link>}
          </span>
        );
      })}
    </nav>
  );
}
