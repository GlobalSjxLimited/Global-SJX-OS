import { useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { ResourcePage } from '@/components/ui/ResourcePage';
import { MultiFileUploadModal } from '@/components/ui/MultiFileUploadModal';
import { openProtectedFile } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { can } from '@/lib/permissions';

export { Vendors } from './Vendors';

export function Sponsors() {
  const { user } = useAuth();
  const manage = can.manageVendorsSponsors(user?.role);
  return (
    <ResourcePage
      title="Sponsors"
      description="Event, academy and community sponsorships."
      endpoint="/sponsors"
      entityType="sponsor"
      filters={[{ name: 'type', label: 'Type', options: ['event', 'academy', 'community', 'other'] }, { name: 'status', label: 'Status', options: ['prospective', 'confirmed', 'completed'] }]}
      createLabel="New sponsor"
      canCreate={manage}
      canEdit={manage}
      canDelete={manage}
      columns={[
        { key: 'name', label: 'Sponsor' },
        { key: 'type', label: 'Type', badge: true },
        { key: 'contribution', label: 'Contribution', render: (r) => `${r.currency || 'NGN'} ${(r.contribution || 0).toLocaleString()}` },
        { key: 'status', label: 'Status', badge: true },
      ]}
      fields={[
        { name: 'name', label: 'Sponsor name', type: 'text', required: true, full: true },
        { name: 'type', label: 'Type', type: 'select', options: ['event', 'academy', 'community', 'other'] },
        { name: 'contribution', label: 'Contribution', type: 'number' },
        { name: 'contactName', label: 'Contact person', type: 'text' },
        { name: 'contactEmail', label: 'Contact e-mail', type: 'email' },
        { name: 'contactPhone', label: 'Contact phone', type: 'text' },
        { name: 'startDate', label: 'Start date', type: 'date' },
        { name: 'endDate', label: 'End date', type: 'date' },
        { name: 'relatedEvent', label: 'Related event', type: 'text' },
        { name: 'status', label: 'Status', type: 'select', options: ['prospective', 'confirmed', 'completed'] },
        { name: 'notes', label: 'Notes', type: 'richtext', full: true },
      ]}
    />
  );
}

export function Skills() {
  return (
    <ResourcePage
      title="Skills"
      description="The organization's skill catalog. Employee proficiency is tracked from each profile."
      endpoint="/skills"
      createLabel="New skill"
      columns={[
        { key: 'name', label: 'Skill' },
        { key: 'category', label: 'Category' },
        { key: 'description', label: 'Description' },
      ]}
      fields={[
        { name: 'name', label: 'Skill name', type: 'text', required: true, full: true },
        { name: 'category', label: 'Category', type: 'text' },
        { name: 'description', label: 'Description', type: 'richtext', full: true },
      ]}
    />
  );
}

export function Compliance() {
  const { user } = useAuth();
  const manage = can.manageCompliance(user?.role);
  return (
    <ResourcePage
      title="Compliance"
      canCreate={manage}
      canEdit={manage}
      canDelete={manage}
      description="Frameworks, SOPs and controls with review cadence and status."
      endpoint="/compliance"
      createLabel="New item"
      itemName="Compliance item"
      columns={[
        { key: 'title', label: 'Item' },
        { key: 'framework', label: 'Framework' },
        { key: 'reviewFrequency', label: 'Review frequency' },
        { key: 'nextReviewDate', label: 'Next review', render: (r) => (r.nextReviewDate ? new Date(r.nextReviewDate).toLocaleDateString() : '—') },
        { key: 'status', label: 'Status', badge: true },
      ]}
      fields={[
        { name: 'title', label: 'Compliance item title', type: 'text', required: true, full: true },
        { name: 'framework', label: 'Framework', type: 'select', options: ['PCI-DSS', 'PCI-3DS', 'ISO27001', 'NDPR', 'SOC2', 'Internal SOP', 'Other'] },
        { name: 'reviewFrequency', label: 'Review frequency', type: 'select', options: ['monthly', 'quarterly', 'annually'] },
        { name: 'nextReviewDate', label: 'Next review date', type: 'date' },
        { name: 'status', label: 'Status', type: 'select', options: ['compliant', 'in_progress', 'non_compliant'] },
        { name: 'description', label: 'Description', type: 'richtext', full: true },
      ]}
    />
  );
}

export function Groups() {
  return (
    <ResourcePage
      title="Groups"
      description="Reusable named groups of colleagues — invite a whole group to a meeting in one click instead of picking people one at a time."
      endpoint="/groups"
      createLabel="New group"
      columns={[
        { key: 'name', label: 'Group' },
        { key: 'description', label: 'Description' },
        { key: 'memberIds', label: 'Members', render: (r) => `${(r.memberIds || []).length} member${(r.memberIds || []).length === 1 ? '' : 's'}` },
      ]}
      fields={[
        { name: 'name', label: 'Group name', type: 'text', required: true, full: true },
        { name: 'description', label: 'Description', type: 'richtext', full: true },
        { name: 'memberIds', label: 'Members', type: 'multiselect', optionsEndpoint: '/employees', full: true },
      ]}
    />
  );
}

export function Reports() {
  const { user } = useAuth();
  const manage = can.viewFinance(user?.role);
  return (
    <ResourcePage
      title="Reports"
      canCreate={manage}
      canEdit={manage}
      canDelete={manage}
      description="Saved reports across projects, finance, sales, HR and compliance."
      endpoint="/reports"
      createLabel="New report"
      columns={[
        { key: 'title', label: 'Report' },
        { key: 'type', label: 'Type', badge: true },
        { key: 'periodStart', label: 'Period start', render: (r) => (r.periodStart ? new Date(r.periodStart).toLocaleDateString() : '—') },
        { key: 'periodEnd', label: 'Period end', render: (r) => (r.periodEnd ? new Date(r.periodEnd).toLocaleDateString() : '—') },
      ]}
      fields={[
        { name: 'title', label: 'Report title', type: 'text', required: true, full: true },
        { name: 'type', label: 'Type', type: 'select', options: ['project_status', 'financial', 'sales', 'hr', 'compliance', 'custom'] },
        { name: 'periodStart', label: 'Period start', type: 'date' },
        { name: 'periodEnd', label: 'Period end', type: 'date' },
        { name: 'summary', label: 'Summary', type: 'richtext', full: true },
      ]}
    />
  );
}

export function Documents() {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <>
      <ResourcePage
        title="Documents"
        description="The secure company document repository, organized by category."
        endpoint="/documents"
        entityType="document"
        createLabel="New document"
        refreshKey={refreshKey}
        extraHeaderAction={
          <button className="btn btn-ghost" onClick={() => setUploadOpen(true)}>
            <UploadCloud size={16} /> Upload multiple
          </button>
        }
        columns={[
          { key: 'title', label: 'Document', render: (r) => r.url ? (
              <button
                onClick={(e) => { e.stopPropagation(); openProtectedFile(r.url, r.title); }}
                style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 13.5, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}
              >
                {r.title}
              </button>
            ) : r.title },
          { key: 'category', label: 'Category', badge: true },
          { key: 'expiryDate', label: 'Expiry', render: (r) => (r.expiryDate ? new Date(r.expiryDate).toLocaleDateString() : '—') },
          { key: 'reviewDate', label: 'Review date', render: (r) => (r.reviewDate ? new Date(r.reviewDate).toLocaleDateString() : '—') },
        ]}
        fields={[
          { name: 'title', label: 'Document title', type: 'text', required: true, full: true },
          { name: 'category', label: 'Category', type: 'select', required: true, options: ['Corporate', 'Legal', 'Finance', 'HR', 'Clients', 'Projects', 'Vendors', 'Certifications', 'Compliance', 'Marketing', 'Training', 'Contracts', 'Proposals', 'Reports'] },
          { name: 'url', label: 'File', type: 'file', full: true },
          { name: 'description', label: 'Description', type: 'richtext', full: true },
          { name: 'expiryDate', label: 'Expiry date', type: 'date' },
          { name: 'reviewDate', label: 'Review date', type: 'date' },
          { name: 'ownerId', label: 'Owner', type: 'select', optionsEndpoint: '/employees', required: true },
        ]}
      />
      <MultiFileUploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploaded={() => setRefreshKey((k) => k + 1)}
        defaultCategory="Corporate"
      />
    </>
  );
}
