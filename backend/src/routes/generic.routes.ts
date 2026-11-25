import { Router } from 'express';
import { z } from 'zod';
import { ApiError } from '../utils/ApiError';
import { buildCrudRouter } from '../factories/crudRouter';
import { Vendor } from '../models/Vendor';
import { Sponsor } from '../models/Sponsor';
import { Document } from '../models/Document';
import { Certification } from '../models/Certification';
import { Course } from '../models/Course';
import { Skill, EmployeeSkill } from '../models/Skill';
import { Goal } from '../models/Goal';
import { Lead } from '../models/Campaign';
import { Report } from '../models/Report';
import { Risk } from '../models/Risk';
import { ComplianceItem } from '../models/ComplianceItem';

const vendorBase: Router = buildCrudRouter(Vendor, {
  entityName: 'Vendor',
  searchableFields: ['name', 'email', 'contacts.name', 'products'],
  populate: 'certifications',
});

/** A vendor needs a way to reach them: an e-mail or a phone for the company, and every named contact needs a valid address. */
const emailOk = z.string().trim().email('Enter a valid e-mail address').max(200);
const vendorZ = z.object({
  name: z.string().trim().min(2, 'Vendor name is required').max(200),
  email: z.union([emailOk, z.literal('')]).optional(),
  phone: z.string().trim().max(40).optional(),
  address: z.string().trim().max(400).optional(),
  website: z.string().trim().max(300).optional(),
  contacts: z.array(z.object({ name: z.string().trim().min(1, 'Every contact needs a name').max(120), title: z.string().trim().max(120).optional(), email: z.union([emailOk, z.literal('')]).optional(), phone: z.string().trim().max(40).optional(), isPrimary: z.boolean().optional() }).passthrough()).max(40).optional(),
}).passthrough();
const validateVendor = (isCreate: boolean) => (req: any, _res: any, next: any) => {
  try {
    const d = (isCreate ? vendorZ : vendorZ.partial()).parse(req.body || {});
    if (isCreate && !(d.email || d.phone) && !(d.contacts || []).some((c: any) => c.email || c.phone)) throw ApiError.badRequest('Add contact details: an e-mail or phone for the vendor, or at least one contact person with theirs.');
    if (Array.isArray(req.body?.contacts)) req.body.contacts = req.body.contacts.map((c: any, i: number) => ({ ...c, email: c.email || undefined, isPrimary: c.isPrimary ?? i === 0 }));
    for (const k of ['email', 'phone', 'address', 'website']) if (req.body?.[k] === '') delete req.body[k];
    next();
  } catch (e) { next(e); }
};
export const vendorsRouter: Router = Router();
vendorsRouter.post('/', validateVendor(true));
vendorsRouter.patch('/:id', validateVendor(false));
vendorsRouter.use(vendorBase);

export const sponsorsRouter: Router = buildCrudRouter(Sponsor, {
  entityName: 'Sponsor',
  searchableFields: ['name', 'relatedEvent'],
});

export const documentsRouter: Router = buildCrudRouter(Document, {
  entityName: 'Document',
  searchableFields: ['title', 'description'],
  populate: 'ownerId',
});

export const certificationsRouter: Router = buildCrudRouter(Certification, {
  entityName: 'Certification',
  searchableFields: ['name', 'provider'],
  populate: 'employeeId',
  defaultSort: 'expiryDate',
});

export const coursesRouter: Router = buildCrudRouter(Course, {
  entityName: 'Course',
  searchableFields: ['title', 'category', 'provider'],
  writeRoles: ['hr', 'coo', 'ceo'],
});


export const skillsRouter: Router = buildCrudRouter(Skill, {
  entityName: 'Skill',
  searchableFields: ['name', 'category'],
});

export const employeeSkillsRouter: Router = buildCrudRouter(EmployeeSkill, {
  entityName: 'EmployeeSkill',
  populate: ['userId', 'skillId'],
});

export const goalsRouter: Router = buildCrudRouter(Goal, {
  entityName: 'Goal',
  searchableFields: ['title'],
  populate: 'ownerId',
});

export const leadsRouter: Router = buildCrudRouter(Lead, {
  entityName: 'Lead',
  searchableFields: ['name', 'company', 'email'],
});

export const reportsRouter: Router = buildCrudRouter(Report, {
  entityName: 'Report',
  searchableFields: ['title'],
  populate: 'generatedById',
});

export const risksRouter: Router = buildCrudRouter(Risk, {
  entityName: 'Risk',
  searchableFields: ['title', 'description'],
  populate: 'ownerId',
});

export const complianceRouter: Router = buildCrudRouter(ComplianceItem, {
  entityName: 'ComplianceItem',
  searchableFields: ['title', 'framework'],
  populate: 'ownerId',
  defaultSort: 'nextReviewDate',
});


