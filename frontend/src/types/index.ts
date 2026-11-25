export type Role =
  | 'super_admin' | 'ceo' | 'coo' | 'finance' | 'hr' | 'sales'
  | 'project_manager' | 'engineer' | 'employee' | 'client' | 'vendor' | 'training_customer';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  avatarUrl?: string;
  jobTitle?: string;
  department?: string;
  organizationId: string;
  mfaEnabled?: boolean;
  securityAcknowledgedAt?: string;
  /** Modules this person may use (role defaults + personal overrides) — drives the menu. */
  modules?: string[];
  mustChangePassword?: boolean;
  passwordExpiresInDays?: number | null;
}

export interface Paginated<T> {
  data: T[];
  pagination?: { page: number; limit: number; total: number; pages: number };
}

export interface Task {
  _id: string;
  title: string;
  description?: string;
  ownerId: { _id: string; name: string; avatarUrl?: string } | string;
  department?: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'open' | 'in_progress' | 'on_hold' | 'delayed' | 'to_be_reviewed' | 'to_be_tested' | 'complete' | 'closed' | 'cancelled' | 'abandoned';
  dueDate?: string;
  projectId?: { _id: string; name: string } | string;
  clientId?: { _id: string; name: string } | string;
  tags?: string[];
  createdAt: string;
}

export interface Project {
  _id: string;
  name: string;
  overview?: string;
  clientId?: { _id: string; name: string; logoUrl?: string } | string;
  practice?: string;
  projectManagerId?: { _id: string; name: string; avatarUrl?: string } | string;
  team?: string[];
  budget: number;
  revenue: number;
  currency: string;
  startDate?: string;
  endDate?: string;
  status: 'planning' | 'active' | 'on_hold' | 'completed' | 'cancelled';
  health: 'on_track' | 'at_risk' | 'off_track';
  milestones: Array<{ _id: string; title: string; dueDate?: string; status: string; completedAt?: string }>;
}

export interface ClientRecord {
  _id: string;
  name: string;
  industry?: string;
  country?: string;
  status: 'prospect' | 'active' | 'inactive' | 'churned';
  revenue: number;
  contacts: Array<{ name: string; title?: string; email?: string; phone?: string; isPrimary?: boolean }>;
  contracts: Array<{ title: string; value: number; currency: string; startDate?: string; endDate?: string; status: string }>;
  accountOwnerId?: { _id: string; name: string; avatarUrl?: string } | string;
  renewalDate?: string;
}

export interface Opportunity {
  _id: string;
  title: string;
  clientId?: { _id: string; name: string } | string;
  stage: 'Lead' | 'Qualified' | 'Discovery' | 'Proposal' | 'Negotiation' | 'Won' | 'Lost';
  value: number;
  currency: string;
  probability: number;
  expectedCloseDate?: string;
  salespersonId?: { _id: string; name: string; avatarUrl?: string } | string;
  nextAction?: string;
}

export interface Idea {
  _id: string;
  title: string;
  problem: string;
  proposedSolution: string;
  stage: string;
  votes: string[];
  submittedById: { _id: string; name: string; avatarUrl?: string } | string;
  aiScore?: { strategicFit: number; marketPotential: number; complexity: number; revenuePotential: number; overall: number; estimatedInvestmentBand: string };
  estimatedCost: number;
  expectedRevenue: number;
  createdAt: string;
}

export interface NotificationItem {
  _id: string;
  title: string;
  body?: string;
  link?: string;
  type: string;
  isRead: boolean;
  createdAt: string;
}
