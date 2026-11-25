import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '@/context/AuthContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { ToastProvider } from '@/context/ToastContext';
import { ConfirmProvider } from '@/context/ConfirmContext';
import { AppShell } from '@/components/layout/AppShell';
import { ProtectedRoute } from '@/router/ProtectedRoute';

import { Login } from '@/pages/Login';
import { Dashboard } from '@/pages/Dashboard';
import { MyWork } from '@/pages/MyWork';
import { Tasks } from '@/pages/Tasks';
import { TaskDetail } from '@/pages/TaskDetail';
import { Projects } from '@/pages/Projects';
import { ProjectDetail } from '@/pages/ProjectDetail';
import { Clients } from '@/pages/Clients';
import { ClientDetail } from '@/pages/ClientDetail';
import { Sales } from '@/pages/Sales';
import { Employees } from '@/pages/Employees';
import { Training } from '@/pages/Training';
import { Academy } from '@/pages/Academy';
import { CourseDetail } from '@/pages/CourseDetail';
import { IdeaRoom } from '@/pages/IdeaRoom';
import { IdeaDetail } from '@/pages/IdeaDetail';
import { Knowledge } from '@/pages/Knowledge';
import { KnowledgeDetail } from '@/pages/KnowledgeDetail';
import { Meetings } from '@/pages/Meetings';
import { AIAssistant } from '@/pages/AIAssistant';
import { Settings } from '@/pages/Settings';
import { NotFound } from '@/pages/NotFound';
import { Vendors, Sponsors, Skills, Compliance, Documents, Groups } from '@/pages/GenericPages';
import { Marketing } from '@/pages/Marketing';
import { SocialQueue } from '@/pages/SocialQueue';
import { Risks } from '@/pages/Risks';
import { Goals } from '@/pages/Goals';
import { Expenses } from '@/pages/Expenses';
import { ExpenseForm } from '@/pages/ExpenseForm';
import { Invoices } from '@/pages/Invoices';
import { BankAccounts } from '@/pages/BankAccounts';
import { Taxes } from '@/pages/Taxes';
import { Assets } from '@/pages/Assets';
import { Offboarding } from '@/pages/Offboarding';
import { MyReport } from '@/pages/MyReport';
import { MyOffboarding } from '@/pages/MyOffboarding';
import { ThreatIntel } from '@/pages/ThreatIntel';
import { Isms } from '@/pages/Isms';
import { Awareness } from '@/pages/Awareness';
import { PhishLanding } from '@/pages/PhishLanding';
import { DataRequest } from '@/pages/DataRequest';
import { AuditorView } from '@/pages/AuditorView';
import { Incidents, ReportIncident } from '@/pages/Incidents';
import { DataProtection } from '@/pages/DataProtection';
import { Policies } from '@/pages/Policies';
import { AccessControl } from '@/pages/AccessControl';
import { AuditLog } from '@/pages/AuditLog';
import { ReportsCentre } from '@/pages/ReportsCentre';
import { WorkReports } from '@/pages/WorkReports';
import { Intake } from '@/pages/Intake';
import { Reminders } from '@/pages/Reminders';
import { Controls } from '@/pages/Controls';
import { Hub } from '@/pages/Hub';
import { Tickets } from '@/pages/Tickets';
import { Certifications } from '@/pages/Certifications';
import { Security } from '@/pages/Security';
import { PublicInsightsPage } from '@/pages/PublicInsightsPage';
import { PublicArticlePage } from '@/pages/PublicArticlePage';
import { ConsentProvider } from '@/context/ConsentContext';
import { CookieConsent } from '@/components/security/CookieConsent';
import { PublicCoursePage } from '@/pages/PublicCoursePage';
import { Visitors } from '@/pages/Visitors';
import { ImportData } from '@/pages/ImportData';
import { SignDocument } from '@/pages/SignDocument';
import { Signatures } from '@/pages/Signatures';
import { SupplierForm } from '@/pages/SupplierForm';
import { SupplierAssessments } from '@/pages/SupplierAssessments';
import { MyVisitors } from '@/pages/MyVisitors';
import { BookVisit, VisitPass } from '@/pages/BookVisit';

export function App() {
  return (
    <ConsentProvider>
    <ThemeProvider>
      <ToastProvider>
        <ConfirmProvider>
          <BrowserRouter>
            <AuthProvider>
              <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/phish/:token" element={<PhishLanding />} />
            <Route path="/data-request" element={<DataRequest />} />
            <Route path="/auditor/:token" element={<AuditorView />} />
            <Route path="/supplier/:token" element={<SupplierForm />} />
            <Route path="/sign/:token" element={<SignDocument />} />
            <Route path="/book-visit" element={<BookVisit />} />
            <Route path="/visit/:code" element={<VisitPass />} />
            <Route path="/academy/public/:id" element={<PublicCoursePage />} />
            <Route path="/insights" element={<PublicInsightsPage />} />
            <Route path="/insights/:id" element={<PublicArticlePage />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <AppShell />
                </ProtectedRoute>
              }
            >
              <Route index element={<Dashboard />} />
              <Route path="hub" element={<Hub />} />
              <Route path="my-work" element={<MyWork />} />

              <Route path="tasks" element={<Tasks />} />
              <Route path="tasks/:id" element={<TaskDetail />} />
              <Route path="projects" element={<Projects />} />
              <Route path="projects/:id" element={<ProjectDetail />} />
              <Route path="meetings" element={<Meetings />} />
              <Route path="goals" element={<Goals />} />
              <Route path="work-reports" element={<WorkReports />} />
              <Route path="intake" element={<Intake />} />

              <Route path="clients" element={<Clients />} />
              <Route path="clients/:id" element={<ClientDetail />} />
              <Route path="sales" element={<Sales />} />
              <Route path="vendors" element={<Vendors />} />
              <Route path="sponsors" element={<Sponsors />} />
              <Route path="marketing" element={<Marketing />} />
              <Route path="social-queue" element={<SocialQueue />} />

              <Route path="employees" element={<Employees />} />
              <Route path="groups" element={<Groups />} />
              <Route path="training" element={<Training />} />
              <Route path="training/:id" element={<CourseDetail />} />
              <Route path="certifications" element={<Certifications />} />
              <Route path="skills" element={<Skills />} />
              <Route path="academy" element={<Academy />} />
              <Route path="academy/:id" element={<CourseDetail />} />

              <Route path="documents" element={<Documents />} />
              <Route path="ideas" element={<IdeaRoom />} />
              <Route path="ideas/:id" element={<IdeaDetail />} />
              <Route path="knowledge" element={<Knowledge />} />
              <Route path="knowledge/:id" element={<KnowledgeDetail />} />
              <Route path="reports" element={<ReportsCentre />} />
              <Route path="reminders" element={<Reminders />} />
              <Route path="controls" element={<Controls />} />
              <Route path="expenses" element={<Expenses />} />
              <Route path="expenses/new" element={<ExpenseForm />} />
              <Route path="expenses/:id/edit" element={<ExpenseForm />} />
              <Route path="invoices" element={<Invoices />} />
              <Route path="accounts" element={<BankAccounts />} />
              <Route path="taxes" element={<Taxes />} />
              <Route path="assets" element={<Assets />} />
              <Route path="offboarding" element={<Offboarding />} />
              <Route path="my-report" element={<MyReport />} />
              <Route path="my-offboarding" element={<MyOffboarding />} />
              <Route path="threat-intel" element={<ThreatIntel />} />
              <Route path="isms" element={<Isms />} />
              <Route path="awareness" element={<Awareness />} />
              <Route path="incidents" element={<Incidents />} />
              <Route path="report-incident" element={<ReportIncident />} />
              <Route path="privacy" element={<DataProtection />} />
              <Route path="supplier-assessments" element={<SupplierAssessments />} />
              <Route path="signatures" element={<Signatures />} />
              <Route path="import" element={<ImportData />} />
              <Route path="visitors" element={<Visitors />} />
              <Route path="my-visitors" element={<MyVisitors />} />
              <Route path="policies" element={<Policies />} />
              <Route path="access" element={<AccessControl />} />
              <Route path="audit" element={<AuditLog />} />
              <Route path="risks" element={<Risks />} />
              <Route path="compliance" element={<Compliance />} />
              <Route path="tickets" element={<Tickets />} />
              <Route path="security" element={<Security />} />

              <Route path="ai" element={<AIAssistant />} />
              <Route path="settings" element={<Settings />} />

              <Route path="*" element={<NotFound />} />
            </Route>
              </Routes>
            </AuthProvider>
          </BrowserRouter>
        </ConfirmProvider>
        <CookieConsent />
      </ToastProvider>
    </ThemeProvider>
    </ConsentProvider>
  );
}
