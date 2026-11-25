/* eslint-disable no-console */
import bcrypt from 'bcryptjs';
import { connectDB } from '../config/db';
import { env } from '../config/env';
import mongoose from 'mongoose';

import { Organization } from '../models/Organization';
import { User } from '../models/User';
import { Client } from '../models/Client';
import { Vendor } from '../models/Vendor';
import { Project } from '../models/Project';
import { Task } from '../models/Task';
import { Opportunity } from '../models/Opportunity';
import { Certification } from '../models/Certification';
import { Course } from '../models/Course';
import { Enrollment } from '../models/Enrollment';
import { Skill, EmployeeSkill } from '../models/Skill';
import { Goal } from '../models/Goal';
import { Idea } from '../models/Idea';
import { Meeting } from '../models/Meeting';
import { Risk } from '../models/Risk';
import { ComplianceItem } from '../models/ComplianceItem';
import { KnowledgeArticle } from '../models/KnowledgeArticle';
import { Ticket } from '../models/Ticket';
import { Document } from '../models/Document';
import { Campaign } from '../models/Campaign';
import { Announcement } from '../models/Announcement';
import { Group } from '../models/Group';
import { AssignmentSubmission } from '../models/AssignmentSubmission';
import { QuizAttempt } from '../models/QuizAttempt';
import { CoursePost } from '../models/CoursePost';
import { SecurityControl, SecurityRequirement, OutsourcedReview, Recognition } from '../models/Security';
import { ensureSecurityControls } from '../services/securityControls.seed';
import { ensureGovernanceDefaults, seedDemoProcessing } from '../services/governance.seed';
import { RoleModuleConfig, UserSession, Counter, ReminderLog } from '../models/Access';
import { ActivityLog } from '../models/ActivityLog';
import { Notification } from '../models/Notification';
import { AuditSeal, Policy, PolicyAcknowledgement, AccessReview, Obligation, ReportSchedule, DataSubjectRequest, Incident, ProcessingActivity } from '../models/Governance';
import { BankAccount, ExchangeRate, TaxRate, TaxRecord, ServiceItem, Invoice, computeInvoice } from '../models/Finance';
import { ExpenseClaim, computeExpenseClaim } from '../models/Expense';
import { Asset, AssetEvent } from '../models/Asset';
import { appendEvent } from '../utils/assetAudit';
import { encryptField, blindIndex, last4 } from '../utils/crypto';

async function wipeExisting() {
  const collections: Array<{ deleteMany: (filter: Record<string, unknown>) => Promise<unknown> }> = [
    Organization, User, Client, Vendor, Project, Task, Opportunity, Certification, Course, Enrollment,
    Skill, EmployeeSkill, Goal, Idea, Meeting, Risk, ComplianceItem, KnowledgeArticle, Ticket, Document, Campaign, Announcement, Group,
    AssignmentSubmission, QuizAttempt, CoursePost, SecurityControl, SecurityRequirement, OutsourcedReview, Recognition,
    RoleModuleConfig, UserSession, Counter, ReminderLog, ActivityLog, Notification, AuditSeal, Policy, PolicyAcknowledgement, AccessReview, Obligation, ReportSchedule, DataSubjectRequest, Incident, ProcessingActivity,
    BankAccount, ExchangeRate, TaxRate, TaxRecord, ServiceItem, Invoice, ExpenseClaim, Asset, AssetEvent,
  ];
  await Promise.all(collections.map((m) => m.deleteMany({})));
  console.log('[seed] cleared existing collections');
}

async function seed() {
  // Environment separation (A.8.31): this script DELETES every collection.
  if (env.appEnv === 'production') {
    console.error('[seed] refused: APP_ENV=production. The seed script never runs against production.');
    process.exit(1);
  }
  if (env.appEnv !== 'development' && env.appEnv !== 'test' && !env.allowSeed) {
    console.error(`[seed] refused: APP_ENV=${env.appEnv}. Set ALLOW_SEED=true to confirm you intend to wipe "${env.dbName}".`);
    process.exit(1);
  }
  // Test information (A.8.33): the seed only ever writes fictional data.
  await connectDB();
  await wipeExisting();

  const org = await Organization.create({
    name: 'Global SJX Limited',
    slug: 'global-sjx',
    isInternal: true,
    plan: 'internal',
    industry: 'Information Technology',
    country: 'Nigeria',
    primaryColor: '#C22FD4',
  });

  const pw = await bcrypt.hash(env.seedAdminPassword, 10);

  const [ceo, coo, hr, sales1, sales2, pm1, pm2, eng1, eng2, eng3, finance] = await Promise.all([
    User.create({ organizationId: org._id, name: 'Sina Joseph', email: env.seedAdminEmail, passwordHash: pw, role: 'ceo', jobTitle: 'Managing Partner / CEO', department: 'Executive', dateJoined: new Date('2016-01-10') }),
    User.create({ organizationId: org._id, name: 'Ngozi Eze', email: 'ngozi.eze@globalsjxltd.com', passwordHash: pw, role: 'coo', jobTitle: 'Chief Operating Officer', department: 'Operations', dateJoined: new Date('2018-03-01') }),
    User.create({ organizationId: org._id, name: 'Amaka Obi', email: 'amaka.obi@globalsjxltd.com', passwordHash: pw, role: 'hr', jobTitle: 'Head of HR', department: 'HR', dateJoined: new Date('2019-06-15') }),
    User.create({ organizationId: org._id, name: 'Tunde Bakare', email: 'tunde.bakare@globalsjxltd.com', passwordHash: pw, role: 'sales', jobTitle: 'Senior Account Manager', department: 'Sales', dateJoined: new Date('2020-02-01') }),
    User.create({ organizationId: org._id, name: 'Chiamaka Nwosu', email: 'chiamaka.nwosu@globalsjxltd.com', passwordHash: pw, role: 'sales', jobTitle: 'Account Manager', department: 'Sales', dateJoined: new Date('2021-09-01') }),
    User.create({ organizationId: org._id, name: 'Emeka Chukwu', email: 'emeka.chukwu@globalsjxltd.com', passwordHash: pw, role: 'project_manager', jobTitle: 'Senior Project Manager', department: 'Advisory', dateJoined: new Date('2019-01-20') }),
    User.create({ organizationId: org._id, name: 'Folake Adeyemi', email: 'folake.adeyemi@globalsjxltd.com', passwordHash: pw, role: 'project_manager', jobTitle: 'Project Manager', department: 'Payments', dateJoined: new Date('2021-04-12') }),
    User.create({ organizationId: org._id, name: 'David Okafor', email: 'david.okafor@globalsjxltd.com', passwordHash: pw, role: 'engineer', jobTitle: 'Cybersecurity Engineer', department: 'Cybersecurity', dateJoined: new Date('2022-01-10') }),
    User.create({ organizationId: org._id, name: 'Blessing Umeh', email: 'blessing.umeh@globalsjxltd.com', passwordHash: pw, role: 'engineer', jobTitle: 'Payments Integration Engineer', department: 'Payments', dateJoined: new Date('2022-05-03') }),
    User.create({ organizationId: org._id, name: 'Ibrahim Sule', email: 'ibrahim.sule@globalsjxltd.com', passwordHash: pw, role: 'engineer', jobTitle: 'Cloud Infrastructure Engineer', department: 'Cloud & Infrastructure', dateJoined: new Date('2023-02-14') }),
    User.create({ organizationId: org._id, name: 'Grace Effiong', email: 'grace.effiong@globalsjxltd.com', passwordHash: pw, role: 'finance', jobTitle: 'Finance Manager', department: 'Finance', dateJoined: new Date('2020-08-01') }),
  ]);

  const admin = await User.create({
    organizationId: org._id,
    name: 'System Administrator',
    email: `admin+super@globalsjxltd.com`,
    passwordHash: pw,
    role: 'super_admin',
    jobTitle: 'Platform Administrator',
    department: 'Operations',
    dateJoined: new Date(),
  });

  console.log(`[seed] super admin: admin+super@globalsjxltd.com / ${env.seedAdminPassword}`);
  console.log(`[seed] CEO login: ${env.seedAdminEmail} / ${env.seedAdminPassword}`);

  // ---- Clients (from the real Global SJX client roster) ----
  const clientNames: Array<{ name: string; industry: string }> = [
    { name: 'FirstBank of Nigeria', industry: 'Banking & Financial Services' },
    { name: 'Sterling Bank', industry: 'Banking & Financial Services' },
    { name: 'Wema Bank', industry: 'Banking & Financial Services' },
    { name: 'ProvidusBank', industry: 'Banking & Financial Services' },
    { name: 'FCMB', industry: 'Banking & Financial Services' },
    { name: 'Coronation Merchant Bank', industry: 'Banking & Financial Services' },
    { name: 'CSCS', industry: 'Banking & Financial Services' },
    { name: 'Ogun State Government', industry: 'Government' },
    { name: '21st Century Technologies', industry: 'Technology & IT-Enabled Services' },
    { name: 'FSDH Holding Company', industry: 'Banking & Financial Services' },
  ];
  const clients = [];
  for (const [i, c] of clientNames.entries()) {
    const client = await Client.create({
      organizationId: org._id,
      name: c.name,
      industry: c.industry,
      country: 'Nigeria',
      contacts: [{ name: `Contact Person ${i + 1}`, title: 'Head of IT', email: `contact${i + 1}@example.com`, isPrimary: true }],
      servicesPurchased: ['Cybersecurity & Digital Trust', 'Payments & Financial Technology'],
      contracts: [
        {
          title: `${c.name} — Master Services Agreement`,
          value: 15_000_000 + i * 2_000_000,
          currency: 'NGN',
          startDate: new Date('2024-01-01'),
          endDate: new Date(Date.now() + (30 + i * 15) * 24 * 60 * 60 * 1000),
          status: 'active',
        },
      ],
      revenue: 20_000_000 + i * 3_500_000,
      renewalDate: new Date(Date.now() + (30 + i * 15) * 24 * 60 * 60 * 1000),
      accountOwnerId: i % 2 === 0 ? tunde1(sales1) : sales2._id,
      status: 'active',
      lastActivityAt: new Date(Date.now() - i * 10 * 24 * 60 * 60 * 1000),
    });
    clients.push(client);
  }
  function tunde1(u: any) { return u._id; }

  // ---- Vendors (real Global SJX technology partners) ----
  const vendorNames = [
    { name: 'Wibmo', products: ['ACCOSA IVS', 'Trident FRM', 'Tridentity', 'Areion Token Hub', 'Digion'] },
    { name: 'WinMagic', products: ['SecureDoc Enterprise Server Management'] },
    { name: 'eG Innovations', products: ['eG Business Application Performance Monitoring'] },
    { name: 'Finonyx', products: ['Digital Banking Solutions'] },
    { name: 'Lera Technologies', products: ['Eficaz', 'EficazRT'] },
    { name: 'SMSAM Systems', products: ['Cybersecurity Solutions'] },
  ];
  const vendors = [];
  for (const v of vendorNames) {
    vendors.push(
      await Vendor.create({
        organizationId: org._id,
        name: v.name,
        products: v.products,
        partnerLevel: 'Gold',
        contacts: [{ name: `${v.name} Partner Manager`, email: `partners@${v.name.toLowerCase().replace(/\s/g, '')}.com` }],
        renewalDate: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
        revenue: 8_000_000,
        performanceRating: 4,
        status: 'active',
      })
    );
  }

  // ---- Projects ----
  const project1 = await Project.create({
    organizationId: org._id,
    name: 'EMV 3-D Secure Rollout — FirstBank',
    overview: 'Deploy ACCOSA IVS EMV 3-D Secure with Risk Based Authentication across FirstBank digital card channels.',
    clientId: clients[0]._id,
    practice: 'Payments & Financial Technology',
    projectManagerId: pm2._id,
    team: [eng2._id, eng3._id],
    budget: 45_000_000,
    revenue: 52_000_000,
    currency: 'NGN',
    startDate: new Date('2026-04-01'),
    endDate: new Date('2026-11-30'),
    status: 'active',
    health: 'on_track',
    milestones: [
      { title: 'Requirements & risk assessment', dueDate: new Date('2026-05-01'), status: 'completed', completedAt: new Date('2026-04-28') },
      { title: 'ACS integration', dueDate: new Date('2026-07-15'), status: 'completed', completedAt: new Date('2026-07-10') },
      { title: 'RBA rule tuning', dueDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), status: 'in_progress' },
      { title: 'Go-live', dueDate: new Date('2026-11-15'), status: 'pending' },
    ],
  });

  const project2 = await Project.create({
    organizationId: org._id,
    name: 'Enterprise Server Encryption — ProvidusBank',
    overview: 'SecureDoc endpoint and server encryption deployment across ProvidusBank data centers.',
    clientId: clients[3]._id,
    practice: 'Cybersecurity & Digital Trust',
    projectManagerId: pm1._id,
    team: [eng1._id],
    budget: 22_000_000,
    revenue: 26_000_000,
    currency: 'NGN',
    startDate: new Date('2026-06-01'),
    endDate: new Date('2026-10-01'),
    status: 'active',
    health: 'at_risk',
    milestones: [
      { title: 'Endpoint encryption pilot', dueDate: new Date('2026-07-01'), status: 'completed', completedAt: new Date('2026-06-29') },
      { title: 'Server encryption rollout', dueDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), status: 'overdue' },
    ],
  });

  const project3 = await Project.create({
    organizationId: org._id,
    name: 'Fraud Management Platform — Sterling Bank',
    overview: 'Trident FRM implementation with Tridentity authentication integration.',
    clientId: clients[1]._id,
    practice: 'Payments & Financial Technology',
    projectManagerId: pm2._id,
    team: [eng2._id],
    budget: 30_000_000,
    revenue: 34_000_000,
    currency: 'NGN',
    startDate: new Date('2026-02-01'),
    endDate: new Date('2026-08-30'),
    status: 'active',
    health: 'on_track',
    milestones: [{ title: 'Case management setup', dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), status: 'in_progress' }],
  });

  // ---- Tasks ----
  const now = new Date();
  const taskSeed = [
    { title: 'Tune RBA risk rules for high-value transactions', owner: eng2._id, project: project1._id, priority: 'high', status: 'in_progress', due: new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000) },
    { title: 'Review server encryption rollout blockers', owner: eng1._id, project: project2._id, priority: 'urgent', status: 'open', due: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000) },
    { title: 'Prepare FirstBank go-live checklist', owner: pm2._id, project: project1._id, priority: 'high', status: 'open', due: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000) },
    { title: 'Configure Trident FRM case management queues', owner: eng2._id, project: project3._id, priority: 'medium', status: 'in_progress', due: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000) },
    { title: 'Draft Q3 board update deck', owner: coo._id, project: undefined, priority: 'medium', status: 'open', due: new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000) },
    { title: 'Follow up with ProvidusBank on encryption timeline', owner: pm1._id, project: project2._id, priority: 'urgent', status: 'open', due: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000) },
    { title: 'Onboard new cybersecurity engineer', owner: hr._id, project: undefined, priority: 'medium', status: 'open', due: new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000) },
    { title: 'Renew Wibmo partnership contract', owner: coo._id, project: undefined, priority: 'high', status: 'open', due: new Date(now.getTime() + 20 * 24 * 60 * 60 * 1000) },
  ];
  for (const t of taskSeed) {
    await Task.create({
      organizationId: org._id,
      title: t.title,
      ownerId: t.owner,
      projectId: t.project,
      priority: t.priority,
      status: t.status,
      dueDate: t.due,
      department: 'Delivery',
    });
  }

  // ---- Sales pipeline ----
  const oppSeed = [
    { title: 'Card Tokenization — FCMB', client: clients[4]._id, stage: 'Negotiation', value: 28_000_000, probability: 75, sales: sales1._id },
    { title: 'Cybersecurity Assessment — CSCS', client: clients[6]._id, stage: 'Proposal', value: 18_000_000, probability: 55, sales: sales2._id },
    { title: 'Cloud Infrastructure Modernization — Ogun State', client: clients[7]._id, stage: 'Discovery', value: 60_000_000, probability: 35, sales: sales1._id },
    { title: 'Digital Onboarding — FSDH', client: clients[9]._id, stage: 'Qualified', value: 15_000_000, probability: 20, sales: sales2._id },
    { title: 'Application Performance Monitoring — Coronation', client: clients[5]._id, stage: 'Lead', value: 9_000_000, probability: 10, sales: sales1._id },
    { title: 'EMV 3-D Secure Renewal — FirstBank', client: clients[0]._id, stage: 'Closed Won', value: 52_000_000, probability: 100, sales: sales1._id },
  ];
  for (const o of oppSeed) {
    await Opportunity.create({
      organizationId: org._id,
      title: o.title,
      clientId: o.client,
      stage: o.stage,
      value: o.value,
      probability: o.probability,
      expectedCloseDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      salespersonId: o.sales,
      productsServices: ['Payments & Financial Technology'],
      nextAction: 'Schedule technical deep-dive',
      nextActionDate: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
      stageHistory: [{ stage: o.stage, changedAt: new Date() }],
      ...(o.stage === 'Closed Won' ? { closedAt: new Date(), winReason: 'Renewal — trusted delivery' } : {}),
    });
  }

  // ---- Certifications ----
  const certSeed = [
    { name: 'PCI-DSS QSA', provider: 'PCI Security Standards Council', employee: eng1._id, expiry: new Date(now.getTime() + 25 * 24 * 60 * 60 * 1000) },
    { name: 'CISSP', provider: 'ISC2', employee: eng1._id, expiry: new Date(now.getTime() + 400 * 24 * 60 * 60 * 1000) },
    { name: 'Wibmo Certified Integration Partner', provider: 'Wibmo', employee: eng2._id, expiry: new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000) },
    { name: 'AWS Certified Solutions Architect', provider: 'Amazon Web Services', employee: eng3._id, expiry: new Date(now.getTime() + 200 * 24 * 60 * 60 * 1000) },
    { name: 'PRINCE2 Practitioner', provider: 'AXELOS', employee: pm1._id, expiry: new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000) },
  ];
  for (const c of certSeed) {
    await Certification.create({
      organizationId: org._id,
      name: c.name,
      provider: c.provider,
      employeeId: c.employee,
      dateObtained: new Date('2023-01-15'),
      expiryDate: c.expiry,
      cost: 1500,
      currency: 'USD',
    });
  }

  // ---- Skills + Courses + Enrollments ----
  const skillNames = ['EMV 3-D Secure', 'Fraud Risk Management', 'Cloud Security', 'Server Encryption', 'Project Delivery', 'Application Performance Monitoring'];
  const skills = [];
  for (const s of skillNames) skills.push(await Skill.create({ organizationId: org._id, name: s, category: 'Technical' }));

  await EmployeeSkill.create({ organizationId: org._id, userId: eng2._id, skillId: skills[0]._id, proficiency: 'advanced' });
  await EmployeeSkill.create({ organizationId: org._id, userId: eng1._id, skillId: skills[3]._id, proficiency: 'expert' });

  const courseSeed = [
    { title: 'EMV 3-D Secure Fundamentals', category: 'Payments', type: 'vendor', provider: 'Wibmo', deliveryMode: 'virtual', maxStudents: 25 },
    { title: 'PCI-DSS Compliance Essentials', category: 'Cybersecurity', type: 'external', provider: 'PCI SSC', deliveryMode: 'virtual', maxStudents: 30 },
    { title: 'Cloud Security Architecture', category: 'Cloud', type: 'internal', provider: 'Global SJX Academy', deliveryMode: 'hybrid', maxStudents: 15 },
    { title: 'Project Delivery for Technology Advisors', category: 'Project Management', type: 'academy', provider: 'Global SJX Academy', deliveryMode: 'virtual', maxStudents: 40 },
    { title: 'AI Adoption for Enterprises', category: 'AI', type: 'academy', provider: 'Global SJX Academy', deliveryMode: 'physical', maxStudents: 20 },
  ];
  const courses = [];
  for (const c of courseSeed) {
    courses.push(
      await Course.create({
        organizationId: org._id,
        title: c.title,
        category: c.category as any,
        type: c.type as any,
        provider: c.provider,
        durationHours: 8,
        cost: 150000,
        currency: 'NGN',
        deliveryMode: c.deliveryMode as any,
        maxStudents: c.maxStudents,
        isPublicOnAcademy: c.type === 'academy',
        status: 'published',
        createdById: hr._id,
      })
    );
  }
  await Enrollment.create({ organizationId: org._id, courseId: courses[0]._id, userId: eng2._id, status: 'in_progress', progressPercent: 60 });
  await Enrollment.create({ organizationId: org._id, courseId: courses[2]._id, userId: eng3._id, status: 'completed', progressPercent: 100, completedAt: new Date(), certificateIssued: true });

  // ---- Goals / OKRs ----
  const companyGoal = await Goal.create({
    organizationId: org._id,
    title: 'Grow annual recurring revenue from payments practice by 30%',
    level: 'company',
    ownerId: ceo._id,
    quarter: '2026-Q3',
    keyResults: [{ description: 'Close 5 new payments engagements', targetValue: 5, currentValue: 2, unit: 'deals' }],
    progressPercent: 40,
    status: 'on_track',
  });
  await Goal.create({
    organizationId: org._id,
    title: 'Deliver FirstBank EMV 3-D Secure rollout on schedule',
    level: 'team',
    department: 'Payments',
    ownerId: pm2._id,
    parentGoalId: companyGoal._id,
    quarter: '2026-Q3',
    keyResults: [{ description: 'Milestones completed on time', targetValue: 4, currentValue: 2, unit: 'milestones' }],
    progressPercent: 50,
    status: 'on_track',
  });

  // ---- Idea Room ----
  await Idea.create({
    organizationId: org._id,
    title: 'AI-assisted PCI-DSS gap assessment tool',
    problem: 'Manual PCI-DSS gap assessments take weeks and are inconsistent across engagements.',
    proposedSolution: 'Build an internal tool that scores a client environment against PCI-DSS controls using a guided questionnaire and generates a remediation roadmap automatically.',
    targetCustomer: 'Banking and fintech clients undergoing PCI-DSS certification',
    businessValue: 'Cuts assessment time by an estimated 60% and standardizes deliverable quality across engagements.',
    estimatedCost: 3_500_000,
    expectedRevenue: 25_000_000,
    resourcesNeeded: 'Two engineers, one compliance SME, six weeks',
    strategicAlignment: 'Directly supports the Cybersecurity & Digital Trust practice and the technology advisory practice.',
    submittedById: eng1._id,
    stage: 'Under Review',
    votes: [ceo._id, coo._id, eng2._id],
    links: [{ label: 'PCI-DSS v4.0 requirements reference', url: 'https://www.pcisecuritystandards.org', addedById: eng1._id }],
    comments: [{ authorId: coo._id, body: 'Strong idea — let\'s scope a two-week prototype before committing full resourcing.' }],
  });

  // ---- Groups ----
  await Group.create({
    organizationId: org._id,
    name: 'Payments Practice',
    description: 'Everyone actively delivering payments engagements — quick way to loop in the whole practice.',
    memberIds: [pm2._id, eng2._id, sales1._id],
    createdById: coo._id,
  });

  // ---- Course content (modules, assignment, update) on one Academy course ----
  const projectDeliveryCourse = courses[3];
  projectDeliveryCourse.modules.push(
    { title: 'Foundations of technology project delivery', description: 'Scoping, governance and the Global SJX delivery method.', body: 'Covers the Understand → Design → Implement → Optimize approach used across every Global SJX engagement.', order: 1 },
    { title: 'Managing client risk and change', description: 'Practical risk registers and change control for technology advisory engagements.', order: 2 }
  );
  projectDeliveryCourse.assignments.push({
    title: 'Draft a project charter',
    description: 'Using the provided template, draft a one-page charter for a hypothetical payments modernization engagement.',
    dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    maxScore: 100,
  });
  projectDeliveryCourse.updates.push({ authorId: hr._id, body: 'Welcome to the cohort! Office hours are Thursdays 3pm WAT.' });
  projectDeliveryCourse.quizzes.push({
    title: 'Delivery method knowledge check',
    description: 'Quick check on the Understand → Design → Implement → Optimize approach.',
    dueDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
    questions: [
      { text: 'What is the first stage of the Global SJX delivery method?', options: ['Design', 'Understand', 'Implement', 'Optimize'], correctIndex: 1, points: 1 },
      { text: 'Which stage focuses on continuous performance measurement?', options: ['Understand', 'Design', 'Implement', 'Optimize'], correctIndex: 3, points: 1 },
    ],
  });
  await projectDeliveryCourse.save();

  // ---- Meetings ----
  await Meeting.create({
    organizationId: org._id,
    title: 'FirstBank — Go-live readiness review',
    participants: [pm2._id, eng2._id, eng3._id],
    externalParticipants: [{ name: 'FirstBank IT Lead', email: 'contact1@example.com' }],
    meetingLink: 'https://meet.google.com/example-placeholder',
    clientId: clients[0]._id,
    projectId: project1._id,
    organizerId: pm2._id,
    date: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000),
    agenda: 'Review outstanding RBA tuning items and confirm go-live date.',
    status: 'scheduled',
    actionItems: [{ description: 'Finalize RBA rule thresholds', assigneeId: eng2._id, dueDate: new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000) }],
  });

  // ---- Risks ----
  await Risk.create({
    organizationId: org._id,
    title: 'ProvidusBank encryption rollout behind schedule',
    category: 'project',
    relatedProjectId: project2._id,
    ownerId: pm1._id,
    severity: 'high',
    impact: 'medium',
    mitigationPlan: 'Add a second engineer to the rollout and renegotiate the milestone date with the client.',
    status: 'open',
  });

  // ---- Compliance ----
  await ComplianceItem.create({
    organizationId: org._id,
    title: 'Annual PCI-DSS internal control review',
    framework: 'PCI-DSS',
    ownerId: coo._id,
    reviewFrequency: 'annually',
    lastReviewedAt: new Date('2025-11-01'),
    nextReviewDate: new Date(now.getTime() + 40 * 24 * 60 * 60 * 1000),
    status: 'in_progress',
  });

  // ---- Knowledge base ----
  await KnowledgeArticle.create({
    organizationId: org._id,
    title: 'SOP: EMV 3-D Secure client onboarding checklist',
    type: 'SOP',
    content: '<h2>Purpose</h2><p>Standard operating procedure for onboarding a new EMV 3-D Secure client.</p><ul><li>Risk assessment</li><li>ACS integration</li><li>RBA rule configuration</li><li>Go-live sign-off</li></ul>',
    summary: 'Standard operating procedure for onboarding a new EMV 3-D Secure client.',
    categories: ['Payments', 'Onboarding', 'SOPs'],
    tags: ['EMV', '3-D Secure', 'payments', 'onboarding'],
    authorId: pm2._id,
    status: 'approved',
  });

  await KnowledgeArticle.create({
    organizationId: org._id,
    title: 'Why strong customer authentication matters for African banks',
    type: 'Case Study',
    content: '<h2>Overview</h2><p>Card-not-present fraud continues to rise across the region. Strong customer authentication, delivered through <strong>EMV 3-D Secure</strong> and risk-based authentication, reduces fraud while keeping checkout friction low.</p><ul><li>Risk-based decisioning</li><li>Frictionless approvals for low-risk payments</li><li>Step-up challenges only when needed</li></ul>',
    summary: 'How risk-based authentication reduces card-not-present fraud without hurting conversion.',
    categories: ['Insights', 'Payments', 'Cybersecurity'],
    tags: ['fraud', 'authentication'],
    authorId: ceo._id,
    status: 'approved',
    publishedToWebsite: true,
    publishedAt: new Date(),
    publishedById: ceo._id,
  });

  await KnowledgeArticle.create({
    organizationId: org._id,
    title: 'Secure Development Policy',
    type: 'Policy',
    summary: 'How Global SJX builds, tests, outsources and releases software securely (ISO/IEC 27001:2022 A.8.25–A.8.31, A.8.33).',
    categories: ['Information Security', 'Policies'],
    tags: ['ISO 27001', 'secure development', 'SDLC'],
    content: '<h2>Scope</h2><p>Applies to all software developed in-house or by suppliers, and to applications we acquire.</p><h2>Rules</h2><ul><li>All changes go through pull request, review and CI (type-check, tests, dependency audit, secret scan).</li><li>Security requirements are specified and <strong>approved</strong> before development or acquisition.</li><li>Secure engineering principles: defence in depth, least privilege, fail closed, tenant isolation, auditability.</li><li>Secure coding standard SC-01 to SC-10 applies to every change.</li><li>Security testing runs on every pull request, weekly, before release and annually (penetration test).</li><li>Outsourced development is registered, owned and reviewed at least every six months.</li><li>Development, test, staging and production are separated; production data is never used for testing.</li></ul><p>The full policy is in <code>docs/SECURE_DEVELOPMENT.md</code> and the live controls register is under <strong>Information Security</strong>.</p>',
    authorId: ceo._id,
    status: 'approved',
  });

  await Recognition.create({ organizationId: org._id, fromId: coo._id, toId: eng1._id, value: 'Excellence', message: 'Outstanding work hardening the ACS deployment ahead of go-live. Thank you!' });

  // ---- Security programme (ISO 27001:2022 Annex A) ----
  await ensureSecurityControls(String(org._id), String(ceo._id));
  await SecurityRequirement.create({
    organizationId: org._id,
    application: 'GLOBAL SJX OS',
    title: 'All privileged actions must be recorded in the audit log',
    description: '<p>Authentication events, role changes, publishing and security decisions must be written to the audit log with actor and timestamp.</p>',
    category: 'logging',
    priority: 'must',
    status: 'approved',
    requestedById: eng1._id,
    approvedById: ceo._id,
    approvedAt: new Date(),
  });
  await OutsourcedReview.create({
    organizationId: org._id,
    supplier: 'Example Dev Partner Ltd (fictional)',
    scope: 'Mobile app front-end development',
    contractRef: 'SUP-2026-001',
    securityClausesInPlace: true,
    ndaSigned: true,
    rightToAudit: true,
    status: 'active',
    riskRating: 'medium',
    ownerId: coo._id,
    lastReviewAt: new Date(),
    nextReviewAt: new Date(Date.now() + 120 * 24 * 3600 * 1000),
  });

  // ---- Support tickets ----
  await Ticket.create({
    organizationId: org._id,
    subject: 'RBA false-positive rate higher than expected',
    description: 'FirstBank has flagged an elevated false-positive rate on the new RBA engine post go-live testing.',
    clientId: clients[0]._id,
    requesterId: pm2._id,
    assigneeId: eng2._id,
    priority: 'high',
    status: 'in_progress',
    category: 'technical',
  });

  // ---- Marketing ----
  await Campaign.create({
    organizationId: org._id,
    name: 'Q3 Cybersecurity Risk Report — content series',
    type: 'content',
    channel: 'LinkedIn + blog',
    ownerId: coo._id,
    startDate: new Date('2026-07-01'),
    endDate: new Date('2026-09-30'),
    status: 'live',
    budget: 2_000_000,
    leadsGenerated: 34,
  });

  // ---- Company Hub announcements ----
  await Announcement.create({
    organizationId: org._id,
    title: 'FirstBank EMV 3-D Secure rollout enters final phase',
    body: 'RBA rule tuning is underway and we are on track for the November go-live. Great work from the payments delivery team.',
    category: 'news',
    authorId: coo._id,
    pinned: true,
  });
  await Announcement.create({
    organizationId: org._id,
    title: 'Welcome to Global SJX OS',
    body: 'This is the new internal operating system for the company — tasks, projects, clients, training and more all live here now. Start with My Work to see what is on your plate today.',
    category: 'announcement',
    authorId: ceo._id,
    pinned: true,
  });
  await Announcement.create({
    organizationId: org._id,
    title: 'Q3 all-hands recap',
    body: 'Thank you to everyone who joined the Q3 all-hands. Slides and the recording have been added to the Knowledge Base under Company Documents.',
    category: 'event',
    authorId: hr._id,
  });

  /* ---------------- Finance, ISMS and data-protection demo data (all fictional) ---------------- */
  await ensureGovernanceDefaults(String(org._id));
  await seedDemoProcessing(String(org._id), String(ceo._id));
  await ExchangeRate.create({ organizationId: org._id, currency: 'USD', rate: 1550, rateDate: new Date(), source: 'CBN (demo)', createdById: finance._id });
  await TaxRate.create([
    { organizationId: org._id, kind: 'VAT', name: 'Standard VAT', rate: 7.5, isDefault: true },
    { organizationId: org._id, kind: 'WHT', name: 'WHT — consultancy / professional', rate: 10, isDefault: true },
    { organizationId: org._id, kind: 'WHT', name: 'WHT — rent', rate: 10 },
    { organizationId: org._id, kind: 'WHT', name: 'WHT — contracts / supplies', rate: 5 },
  ]);
  await ServiceItem.create([
    { organizationId: org._id, name: 'Managed Security Operations (monthly)', type: 'Managed Services', defaultUnitFee: 2500000 },
    { organizationId: org._id, name: 'PCI DSS readiness consultation (per day)', type: 'Consultation', defaultUnitFee: 450000 },
    { organizationId: org._id, name: 'Security awareness training (per session)', type: 'Training', defaultUnitFee: 600000 },
  ]);
  const demoAcct = '0123456789';
  const bank = await BankAccount.create({ organizationId: org._id, bankName: 'Demo Bank Plc', accountName: 'Global SJX Limited', accountNumberEnc: encryptField(demoAcct), accountNumberHash: blindIndex(demoAcct), accountLast4: last4(demoAcct), purpose: 'collections', status: 'active', createdById: finance._id, approvedById: coo._id, approvedAt: new Date() });
  const demoClient = await Client.findOne({ organizationId: org._id });
  if (demoClient) {
    const inv: any = new Invoice({ organizationId: org._id, invoiceNo: 'INV-DEMO-0001', clientId: demoClient._id, bankAccountId: bank._id, invoiceType: 'Managed Services', currency: 'NGN', items: [{ description: 'Managed Security Operations — current month', quantity: 1, unitFee: 2500000 }], issueDate: new Date(Date.now() - 40 * 86400000), dueDate: new Date(Date.now() - 10 * 86400000), status: 'sent', createdById: finance._id, approvedById: coo._id, approvedAt: new Date(), sentAt: new Date(), vatRate: 7.5, whtRate: 5, payments: [] });
    computeInvoice(inv);
    await inv.save();
  }
  const claim: any = new ExpenseClaim({
    organizationId: org._id, claimNo: 'EXP-DEMO-0001', title: 'Client workshop — Abuja', purpose: 'Two-day on-site workshop', submittedById: eng1._id, submittedByName: eng1.name, status: 'submitted', submittedAt: new Date(Date.now() - 3 * 86400000),
    items: [
      { category: 'Travel & Transport', description: 'Return flights Lagos–Abuja', vendor: 'Air Peace', date: new Date(Date.now() - 6 * 86400000), amount: 185000, boughtBy: { kind: 'employee', employeeId: eng1._id, name: eng1.name }, paymentMode: 'paid_personally' },
      { category: 'Accommodation', description: 'Hotel — 2 nights', vendor: 'Transcorp Hilton', date: new Date(Date.now() - 6 * 86400000), amount: 240000, tax: { vatEnabled: true, vatRate: 7.5 }, boughtBy: { kind: 'employee', employeeId: eng1._id, name: eng1.name }, paymentMode: 'awaiting_disbursement' },
      { category: 'Meals & Entertainment', description: 'Team lunch', date: new Date(Date.now() - 5 * 86400000), amount: 32000, boughtBy: { kind: 'other', name: 'Ibrahim (driver)' }, paymentMode: 'paid_personally' },
    ],
  });
  computeExpenseClaim(claim);
  claim.settlement = { required: true };
  await claim.save();
  const mkAsset = async (a: any) => { const x = await Asset.create({ organizationId: org._id, createdBy: 'seed', ...a }); await appendEvent({ asset: x, action: 'created', actor: { id: String(ceo._id), name: ceo.name, role: 'ceo' }, note: 'seed' }); return x; };
  await mkAsset({ assetId: 'GSJX/HW/0001', title: 'Engineering laptop — Dell Latitude', category: 'hardware', classification: 'Confidential', confidentiality: 'High', integrity: 'Medium', availability: 'Medium', owner: 'Head of Engineering', custodian: 'IT', location: 'Lagos HQ', assignedToId: eng1._id, acquisitionDate: new Date(Date.now() - 1500 * 86400000), expectedLifeMonths: 48, reviewCycleMonths: 12, lastReviewedAt: new Date(Date.now() - 400 * 86400000), lifecycleStatus: 'active' });
  await mkAsset({ assetId: 'GSJX/INF/0001', title: 'Client contracts repository', category: 'information', classification: 'Restricted', confidentiality: 'High', integrity: 'High', availability: 'Medium', owner: 'COO', custodian: 'IT', location: 'Cloud', reviewCycleMonths: 6, lastReviewedAt: new Date(), backupSchedule: 'Daily, 30-day retention', lifecycleStatus: 'active' });
  await mkAsset({ assetId: 'GSJX/SW/0001', title: 'Endpoint protection licences (50 seats)', category: 'software', classification: 'Internal', owner: 'Security lead', custodian: 'IT', location: 'Vendor portal', licenseExpiryDate: new Date(Date.now() + 25 * 86400000), reviewCycleMonths: 12, lastReviewedAt: new Date(), acquisitionDate: new Date(Date.now() - 340 * 86400000), expectedLifeMonths: 12, lifecycleStatus: 'active' });
  await Incident.create({ organizationId: org._id, reference: 'INC-DEMO-0001', title: 'Phishing email reported by Finance', description: 'A credential-harvesting email impersonating the bank was reported. No credentials entered.', category: 'phishing', severity: 'medium', status: 'contained', reportedById: finance._id, assigneeId: eng1._id, containedAt: new Date(), timeline: [{ at: new Date(), byName: finance.name, text: 'Reported' }] });
  await DataSubjectRequest.create({ organizationId: org._id, reference: 'DSR-DEMO-0001', type: 'access', requester: { name: 'Demo Requester', email: 'requester@example.com', relationship: 'client' }, dueAt: new Date(Date.now() + 12 * 86400000), status: 'in_progress', identityVerified: true, assigneeId: hr._id, timeline: [{ at: new Date(), text: 'Logged' }] });

  console.log('[seed] complete');
  console.log(`[seed] organization: ${org.name} (${org._id})`);
  console.log(`[seed] users created: ${[ceo, coo, hr, sales1, sales2, pm1, pm2, eng1, eng2, eng3, finance, admin].length}`);
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('[seed] failed', err);
  process.exit(1);
});
