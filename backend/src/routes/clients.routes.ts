import { stripProtected } from '../middleware/security';
import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { Client } from '../models/Client';
import { Project } from '../models/Project';
import { Opportunity } from '../models/Opportunity';
import { Ticket } from '../models/Ticket';
import { Meeting } from '../models/Meeting';
import { Document } from '../models/Document';
import { excludeDeleted } from '../utils/softDeletePlugin';
import { z } from 'zod';
import { verifyOrgUpload } from '../services/fileCheck';
import { audit } from '../services/audit.service';
import { escapeRegex } from '../utils/escapeRegex';

const router = Router();
router.use(requireAuth);

const manageClients = requireRole('sales', 'coo', 'ceo');

/** A client cannot be created without a way to reach them: name, e-mail, phone, office address, state and country. */
const req_ = (label: string) => z.string({ required_error: `${label} is required` }).trim().min(1, `${label} is required`).max(300);
export const clientCreateSchema = z.object({
  name: req_('Client name'),
  email: z.string({ required_error: 'E-mail is required' }).trim().toLowerCase().email('Enter a valid e-mail address').max(200),
  phone: z.string({ required_error: 'Phone is required' }).trim().min(5, 'Enter a valid phone number').max(40).regex(/^[+()\d][\d\s().-]{3,}$/, 'Enter a valid phone number'),
  address: req_('Office address'),
  state: req_('State'),
  country: req_('Country'),
}).passthrough();
/** On update the same rules apply to any of those fields that are being changed, so old records can still be edited bit by bit. */
export const clientUpdateSchema = clientCreateSchema.partial().passthrough();
export const REQUIRED_CLIENT_FIELDS = ['name', 'email', 'phone', 'address', 'state', 'country'] as const;
/** Empty optional fields (e.g. no industry chosen) are left out instead of being saved as blank text. */
const dropBlank = (o: Record<string, any>) => Object.fromEntries(Object.entries(o).filter(([k, v]) => !(v === '' && !(REQUIRED_CLIENT_FIELDS as readonly string[]).includes(k))));
const missingFields = (c: any) => REQUIRED_CLIENT_FIELDS.filter((f) => !String(c?.[f] ?? '').trim());
const manageContracts = requireRole('sales', 'coo', 'ceo', 'finance');
const contactZ = z.object({ name: z.string().trim().min(1, 'Contact name is required').max(120), title: z.string().trim().max(120).optional(), email: z.string().trim().email('Enter a valid e-mail address').max(200).optional().or(z.literal('')).transform((v) => v || undefined), phone: z.string().trim().max(40).optional(), isPrimary: z.boolean().optional() });

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { q, industry, status } = req.query as Record<string, string>;
    let filter: Record<string, unknown> = { organizationId: req.user!.organizationId };
    if (industry) filter.industry = industry;
    if (status) filter.status = status;
    if (q) filter.name = { $regex: escapeRegex(q), $options: 'i' };
    filter = excludeDeleted(filter);
    if (req.query.state) filter.state = req.query.state;
    if (req.query.country) filter.country = req.query.country;
    const clients = await Client.find(filter).populate('accountOwnerId', 'name avatarUrl').sort('name');
    res.json({ success: true, data: clients.map((c: any) => ({ ...c.toObject(), missingFields: missingFields(c) })) });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const client = await Client.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId })).populate('accountOwnerId', 'name avatarUrl email');
    if (!client) throw ApiError.notFound('Client not found');

    const [projects, opportunities, tickets, meetings, documents] = await Promise.all([
      Project.find(excludeDeleted({ organizationId: req.user!.organizationId, clientId: client._id })).select('name status health'),
      Opportunity.find(excludeDeleted({ organizationId: req.user!.organizationId, clientId: client._id })).select('title stage value probability'),
      Ticket.find(excludeDeleted({ organizationId: req.user!.organizationId, clientId: client._id })).select('subject status priority'),
      Meeting.find(excludeDeleted({ organizationId: req.user!.organizationId, clientId: client._id })).sort('-date').limit(10),
      Document.find(excludeDeleted({ organizationId: req.user!.organizationId, relatedClientId: client._id })),
    ]);

    res.json({ success: true, data: { client, projects, opportunities, tickets, meetings, documents } });
  })
);

router.post(
  '/',
  manageClients,
  asyncHandler(async (req, res) => {
    const parsed = clientCreateSchema.parse(req.body);
    if (await Client.exists(excludeDeleted({ organizationId: req.user!.organizationId, name: { $regex: `^${escapeRegex(parsed.name)}$`, $options: 'i' } }))) throw ApiError.conflict('A client with this name already exists');
    const client = await Client.create({ ...dropBlank(stripProtected({ ...req.body, ...parsed })), organizationId: req.user!.organizationId });
    res.status(201).json({ success: true, data: client });
  })
);

router.patch(
  '/:id',
  manageClients,
  asyncHandler(async (req, res) => {
    const parsed = clientUpdateSchema.parse(req.body);
    const client = await Client.findOneAndUpdate(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }), { $set: { ...dropBlank(stripProtected({ ...req.body, ...parsed })), lastActivityAt: new Date() } }, { new: true, runValidators: true });
    if (!client) throw ApiError.notFound('Client not found');
    res.json({ success: true, data: client });
  })
);

router.delete(
  '/:id',
  manageClients,
  asyncHandler(async (req, res) => {
    const client = await Client.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
    if (!client) throw ApiError.notFound('Client not found');

    const [openProjects, openOpps] = await Promise.all([
      Project.countDocuments(excludeDeleted({ organizationId: req.user!.organizationId, clientId: client._id, status: { $in: ['planning', 'active'] } })),
      Opportunity.countDocuments(excludeDeleted({ organizationId: req.user!.organizationId, clientId: client._id, stage: { $nin: ['Won', 'Lost'] } })),
    ]);
    if ((openProjects > 0 || openOpps > 0) && req.query.force !== 'true') {
      throw ApiError.conflict(`This client has ${openProjects} active project(s) and ${openOpps} open opportunity/opportunities. Resolve those first, or pass ?force=true to archive anyway.`);
    }

    await (client as any).softDelete(req.user!.id);
    res.json({ success: true, data: { id: req.params.id, softDeleted: true } });
  })
);

router.post(
  '/:id/restore',
  manageClients,
  asyncHandler(async (req, res) => {
    const client = await Client.findOne({ _id: req.params.id, organizationId: req.user!.organizationId, isDeleted: true });
    if (!client) throw ApiError.notFound('Deleted client not found');
    await (client as any).restore();
    res.json({ success: true, data: client });
  })
);

router.post(
  '/:id/communications',
  asyncHandler(async (req, res) => {
    const client = await Client.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
    if (!client) throw ApiError.notFound('Client not found');
    client.communications.push({ ...req.body, authorId: req.user!.id } as any);
    client.lastActivityAt = new Date();
    await client.save();
    res.status(201).json({ success: true, data: client.communications[client.communications.length - 1] });
  })
);

router.post(
  '/:id/contacts',
  asyncHandler(async (req, res) => {
    const client = await Client.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
    if (!client) throw ApiError.notFound('Client not found');
    client.contacts.push(contactZ.parse(req.body) as any);
    await client.save();
    res.status(201).json({ success: true, data: client.contacts[client.contacts.length - 1] });
  })
);

router.patch(
  '/:id/contacts/:contactId',
  asyncHandler(async (req, res) => {
    const client = await Client.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
    if (!client) throw ApiError.notFound('Client not found');
    const contact = (client.contacts as any).id(req.params.contactId);
    if (!contact) throw ApiError.notFound('Contact not found');
    Object.assign(contact, contactZ.partial().parse(req.body));
    await client.save();
    res.json({ success: true, data: contact });
  })
);

router.delete(
  '/:id/contacts/:contactId',
  asyncHandler(async (req, res) => {
    const client = await Client.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
    if (!client) throw ApiError.notFound('Client not found');
    (client.contacts as any).pull({ _id: req.params.contactId });
    await client.save();
    res.json({ success: true, data: { id: req.params.contactId } });
  })
);

// Contracts carry legal/financial weight, so they get their own narrower guard
// than general client editing (sales/coo/ceo/finance rather than sales/coo/ceo).
const dateZ = z.preprocess((v) => (v === '' || v === null ? undefined : v), z.coerce.date().optional());
const contractZ = z.object({
  title: z.string().trim().min(2, 'Contract title is required').max(250),
  reference: z.string().trim().max(80).optional(),
  value: z.coerce.number().min(0).default(0),
  currency: z.string().max(5).default('NGN'),
  startDate: dateZ, endDate: dateZ, signedOn: dateZ,
  status: z.enum(['draft', 'sent', 'signed', 'active', 'expired', 'terminated']).default('draft'),
  signedByClient: z.string().trim().max(160).optional(),
  signedByUs: z.string().trim().max(160).optional(),
  notes: z.string().max(5000).optional(),
});
const contractRules = (c: { startDate?: Date; endDate?: Date; status?: string; signedDocument?: any }) => {
  if (c.startDate && c.endDate && c.endDate < c.startDate) throw ApiError.badRequest('The contract end date is before its start date');
  if (['signed', 'active'].includes(c.status || '') && !c.signedDocument?.url) throw ApiError.badRequest('Attach the signed contract (PDF, up to 10 MB) before marking it signed or active.');
};

router.post(
  '/:id/contracts',
  manageContracts,
  asyncHandler(async (req, res) => {
    const client = await Client.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
    if (!client) throw ApiError.notFound('Client not found');
    const d = contractZ.parse(req.body);
    contractRules({ ...d, status: ['signed', 'active'].includes(d.status) ? 'draft' : d.status });
    client.contracts.push({ ...d, status: ['signed', 'active'].includes(d.status) ? 'draft' : d.status } as any);
    client.lastActivityAt = new Date();
    await client.save();
    res.status(201).json({ success: true, data: client.contracts[client.contracts.length - 1] });
  })
);

router.patch(
  '/:id/contracts/:contractId',
  manageContracts,
  asyncHandler(async (req, res) => {
    const client = await Client.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
    if (!client) throw ApiError.notFound('Client not found');
    const contract = (client.contracts as any).id(req.params.contractId);
    if (!contract) throw ApiError.notFound('Contract not found');
    const d = contractZ.partial().parse(req.body);
    contractRules({ startDate: d.startDate ?? contract.startDate, endDate: d.endDate ?? contract.endDate, status: d.status && d.status !== contract.status ? d.status : undefined, signedDocument: contract.signedDocument });
    Object.assign(contract, d);
    client.lastActivityAt = new Date();
    await client.save();
    res.json({ success: true, data: contract });
  })
);

/** Attach the signed copy: an uploaded file (PDF, Word or image), 10 MB at most — checked on disk, not on the browser's word. */
router.post(
  '/:id/contracts/:contractId/signed-document',
  manageContracts,
  asyncHandler(async (req, res) => {
    const client = await Client.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
    if (!client) throw ApiError.notFound('Client not found');
    const contract = (client.contracts as any).id(req.params.contractId);
    if (!contract) throw ApiError.notFound('Contract not found');
    const b = z.object({ name: z.string().trim().min(1).max(200), url: z.string().min(1).max(500) }).parse(req.body);
    const f = verifyOrgUpload(req.user!.organizationId, b.url);
    if (!['.pdf', '.doc', '.docx', '.png', '.jpg', '.jpeg', '.webp'].includes(f.ext)) throw ApiError.badRequest('A signed contract must be a PDF, Word document or scan (image).');
    contract.signedDocument = { name: b.name, url: b.url, size: f.size, uploadedById: req.user!.id, uploadedByName: req.user!.name, uploadedAt: new Date() };
    if (!contract.signedOn) contract.signedOn = new Date();
    client.lastActivityAt = new Date();
    await client.save();
    await audit(req, 'contract.signed_document_attached', 'Client', String(client._id), { module: 'clients', severity: 'medium', summary: `Signed copy of "${contract.title}" attached for ${client.name}` });
    res.json({ success: true, data: contract });
  })
);

router.delete(
  '/:id/contracts/:contractId/signed-document',
  manageContracts,
  asyncHandler(async (req, res) => {
    const client = await Client.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
    const contract = client && (client.contracts as any).id(req.params.contractId);
    if (!client || !contract) throw ApiError.notFound('Contract not found');
    if (['signed', 'active'].includes(contract.status)) throw ApiError.badRequest('Change the contract status first: a signed or active contract must keep its signed copy.');
    contract.signedDocument = undefined;
    await client.save();
    await audit(req, 'contract.signed_document_removed', 'Client', String(client._id), { module: 'clients', severity: 'medium', summary: `Signed copy of "${contract.title}" removed for ${client.name}` });
    res.json({ success: true, data: contract });
  })
);

router.delete(
  '/:id/contracts/:contractId',
  manageContracts,
  asyncHandler(async (req, res) => {
    const client = await Client.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
    if (!client) throw ApiError.notFound('Client not found');
    (client.contracts as any).pull({ _id: req.params.contractId });
    await client.save();
    res.json({ success: true, data: { id: req.params.contractId } });
  })
);

export default router;
