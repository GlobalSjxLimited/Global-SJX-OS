import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { Task } from '../models/Task';
import { Project } from '../models/Project';
import { Client } from '../models/Client';
import { Document } from '../models/Document';
import { KnowledgeArticle } from '../models/KnowledgeArticle';
import { User } from '../models/User';
import { Course } from '../models/Course';
import { Idea } from '../models/Idea';
import { Meeting } from '../models/Meeting';
import { Group } from '../models/Group';
import { excludeDeleted } from '../utils/softDeletePlugin';
import { escapeRegex } from '../utils/escapeRegex';

const router = Router();
router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q || q.length < 2) return res.json({ success: true, data: [] });

    const orgId = req.user!.organizationId;
    const rx = { $regex: escapeRegex(q), $options: 'i' };

    const [tasks, projects, clients, documents, articles, people, courses, ideas, meetings, groups] = await Promise.all([
      Task.find(excludeDeleted({ organizationId: orgId, title: rx })).limit(5).select('title status'),
      Project.find(excludeDeleted({ organizationId: orgId, name: rx })).limit(5).select('name status'),
      Client.find(excludeDeleted({ organizationId: orgId, name: rx })).limit(5).select('name industry'),
      Document.find(excludeDeleted({ organizationId: orgId, title: rx })).limit(5).select('title category'),
      KnowledgeArticle.find(excludeDeleted({ organizationId: orgId, title: rx })).limit(5).select('title type'),
      User.find({ organizationId: orgId, name: rx }).limit(5).select('name jobTitle'),
      Course.find(excludeDeleted({ organizationId: orgId, title: rx })).limit(5).select('title category'),
      Idea.find(excludeDeleted({ organizationId: orgId, title: rx })).limit(5).select('title stage'),
      Meeting.find(excludeDeleted({ organizationId: orgId, title: rx })).limit(5).select('title status'),
      Group.find(excludeDeleted({ organizationId: orgId, name: rx })).limit(5).select('name'),
    ]);

    // Person and Meeting/Group results link to their list page rather than a
    // per-record URL — there's no dedicated detail route for those yet, and a
    // link that 404s is worse than one that lands you on the right list.
    const results = [
      ...tasks.map((t) => ({ type: 'Task', id: t._id, label: t.title, meta: t.status, link: `/tasks/${t._id}` })),
      ...projects.map((p) => ({ type: 'Project', id: p._id, label: p.name, meta: p.status, link: `/projects/${p._id}` })),
      ...clients.map((c) => ({ type: 'Client', id: c._id, label: c.name, meta: c.industry, link: `/clients/${c._id}` })),
      ...documents.map((d) => ({ type: 'Document', id: d._id, label: d.title, meta: d.category, link: `/documents?highlight=${d._id}` })),
      ...articles.map((a) => ({ type: 'Knowledge', id: a._id, label: a.title, meta: a.type, link: `/knowledge/${a._id}` })),
      ...people.map((u) => ({ type: 'Person', id: u._id, label: u.name, meta: u.jobTitle, link: `/employees` })),
      ...courses.map((c) => ({ type: 'Course', id: c._id, label: c.title, meta: c.category, link: `/training/${c._id}` })),
      ...ideas.map((i) => ({ type: 'Idea', id: i._id, label: i.title, meta: i.stage, link: `/ideas/${i._id}` })),
      ...meetings.map((m) => ({ type: 'Meeting', id: m._id, label: m.title, meta: m.status, link: `/meetings` })),
      ...groups.map((g) => ({ type: 'Group', id: g._id, label: g.name, meta: undefined, link: `/groups` })),
    ];

    res.json({ success: true, data: results });
  })
);

export default router;
