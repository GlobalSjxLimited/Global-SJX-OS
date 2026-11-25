import './work.css';
import { label } from '@/lib/format';

export const SEVERITY_OPTIONS = [
  { value: 'trivial', label: 'Trivial' },
  { value: 'minor', label: 'Minor' },
  { value: 'major', label: 'Major' },
  { value: 'critical', label: 'Critical' },
  { value: 'show_stopper', label: 'Show stopper' },
];

export const RISK_SEVERITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

export function SeverityBadge({ value }: { value?: string }) {
  if (!value) return null;
  return <span className={`sev sev-${value}`}>{label(value)}</span>;
}
