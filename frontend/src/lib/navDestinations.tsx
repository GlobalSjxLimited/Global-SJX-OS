import {
  LayoutDashboard, ListChecks, FolderKanban, Building2, TrendingUp, Users, GraduationCap,
  ShieldCheck, FileText, Handshake, Megaphone, Lightbulb, BookOpen, BarChart3, ClipboardCheck,
  School, Sparkles, Settings, Target, LifeBuoy, Newspaper, Users2, Lock,
  Receipt, FileSpreadsheet, Landmark, Percent, Boxes, Siren, ScrollText, KeyRound, History, BellRing, FileLock2, Scale, AlertTriangle, Mail, PieChart, UserMinus, Radar, FileBarChart, Bot, DoorOpen, UserCheck, ClipboardList, FileSignature, Upload } from 'lucide-react';

export interface NavDestination {
  label: string;
  to: string;
  icon: React.ReactNode;
  beta?: boolean;
}

export interface NavGroup {
  section?: string;
  items: NavDestination[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { label: 'Dashboard', to: '/', icon: <LayoutDashboard /> },
      { label: 'Global SJX Hub', to: '/hub', icon: <Newspaper /> },
      { label: 'My Work', to: '/my-work', icon: <ListChecks /> },
      { label: 'My report', to: '/my-report', icon: <FileBarChart /> },
      { label: 'Reminders', to: '/reminders', icon: <BellRing /> },
      { label: 'Controls', to: '/controls', icon: <ShieldCheck /> },
      { label: 'Security Awareness', to: '/awareness', icon: <GraduationCap /> },
    ],
  },
  {
    section: 'Delivery',
    items: [
      { label: 'Tasks', to: '/tasks', icon: <ListChecks /> },
      { label: 'My visitors', to: '/my-visitors', icon: <UserCheck /> },
      { label: 'Visitors', to: '/visitors', icon: <DoorOpen /> },
      { label: 'Projects', to: '/projects', icon: <FolderKanban /> },
      { label: 'Meetings', to: '/meetings', icon: <Handshake /> },
      { label: 'Goals & OKRs', to: '/goals', icon: <Target /> },
      { label: 'Work Reports', to: '/work-reports', icon: <PieChart /> },
      { label: 'E-mail to Tasks', to: '/intake', icon: <Mail /> },
    ],
  },
  {
    section: 'Revenue',
    items: [
      { label: 'Clients', to: '/clients', icon: <Building2 /> },
      { label: 'Sales Pipeline', to: '/sales', icon: <TrendingUp /> },
      { label: 'Vendors', to: '/vendors', icon: <Handshake /> },
      { label: 'Sponsors', to: '/sponsors', icon: <Handshake /> },
      { label: 'Marketing', to: '/marketing', icon: <Megaphone /> },
    ],
  },
  {
    section: 'Finance',
    items: [
      { label: 'Expenses', to: '/expenses', icon: <Receipt /> },
      { label: 'Invoices', to: '/invoices', icon: <FileSpreadsheet /> },
      { label: 'Bank Accounts', to: '/accounts', icon: <Landmark /> },
      { label: 'Taxes & Rates', to: '/taxes', icon: <Percent /> },
    ],
  },
  {
    section: 'People',
    items: [
      { label: 'Employees', to: '/employees', icon: <Users /> },
      { label: 'Offboarding', to: '/offboarding', icon: <UserMinus /> },
      { label: 'Groups', to: '/groups', icon: <Users2 /> },
      { label: 'Training', to: '/training', icon: <GraduationCap /> },
      { label: 'Certifications', to: '/certifications', icon: <ShieldCheck /> },
      { label: 'Skills', to: '/skills', icon: <Sparkles /> },
      { label: 'Academy', to: '/academy', icon: <School />, beta: true },
    ],
  },
  {
    section: 'Knowledge & Risk',
    items: [
      { label: 'Documents', to: '/documents', icon: <FileText /> },
      { label: 'Idea Room', to: '/ideas', icon: <Lightbulb /> },
      { label: 'Knowledge Base', to: '/knowledge', icon: <BookOpen /> },
      { label: 'Risks', to: '/risks', icon: <ShieldCheck /> },
      { label: 'Compliance', to: '/compliance', icon: <ClipboardCheck /> },
      { label: 'Support Desk', to: '/tickets', icon: <LifeBuoy /> },
      { label: 'Information Security', to: '/security', icon: <Lock /> },
    ],
  },
  {
    section: 'Security & Compliance',
    items: [
      { label: 'Reports Centre', to: '/reports', icon: <BarChart3 /> },
      { label: 'Assets', to: '/assets', icon: <Boxes /> },
      { label: 'Threat Intelligence', to: '/threat-intel', icon: <Radar /> },
      { label: 'ISMS Automation Hub', to: '/isms', icon: <Bot /> },
      { label: 'Import data', to: '/import', icon: <Upload /> },
      { label: 'E-signatures', to: '/signatures', icon: <FileSignature /> },
      { label: 'Supplier assessments', to: '/supplier-assessments', icon: <ClipboardList /> },
      { label: 'Incidents', to: '/incidents', icon: <Siren /> },
      { label: 'Report an incident', to: '/report-incident', icon: <AlertTriangle /> },
      { label: 'Data Protection', to: '/privacy', icon: <FileLock2 /> },
      { label: 'Policies', to: '/policies', icon: <ScrollText /> },
      { label: 'Access Control', to: '/access', icon: <KeyRound /> },
      { label: 'Audit Log', to: '/audit', icon: <History /> },
    ],
  },
  {
    items: [
      { label: 'SJX AI', to: '/ai', icon: <Sparkles /> },
      { label: 'Settings', to: '/settings', icon: <Settings /> },
    ],
  },
];

export const NAV_DESTINATIONS: NavDestination[] = NAV_GROUPS.flatMap((g) => g.items);
