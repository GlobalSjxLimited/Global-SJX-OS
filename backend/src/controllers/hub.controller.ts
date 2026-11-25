import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { Announcement } from '../models/Announcement';
import { User } from '../models/User';
import { Goal } from '../models/Goal';
import { Idea } from '../models/Idea';
import { excludeDeleted } from '../utils/softDeletePlugin';
import { KnowledgeArticle } from '../models/KnowledgeArticle';
import { Certification } from '../models/Certification';
import { Meeting } from '../models/Meeting';
import { Enrollment } from '../models/Enrollment';
import { Course } from '../models/Course';
import { Project } from '../models/Project';
import { Recognition } from '../models/Security';
import { Notification } from '../models/Notification';
import { cleanHtml } from '../utils/html';
import { stripProtected } from '../middleware/security';
import { notifyMentions } from '../utils/mentions';

/**
 * Upcoming birthdays within the next 30 days, compared by month/day only
 * (dateOfBirth is optional — employees who haven't shared one just don't
 * appear here, nothing is inferred or fabricated).
 */
async function upcomingBirthdays(organizationId: string) {
  const employees = await User.find({ organizationId, dateOfBirth: { $exists: true, $ne: null }, isActive: true }).select('name dateOfBirth avatarUrl');
  const today = new Date();
  const withNextOccurrence = employees.map((e: any) => {
    const dob: Date = e.dateOfBirth;
    let next = new Date(today.getFullYear(), dob.getMonth(), dob.getDate());
    if (next < today) next = new Date(today.getFullYear() + 1, dob.getMonth(), dob.getDate());
    return { id: e._id, name: e.name, avatarUrl: e.avatarUrl, nextBirthday: next };
  });
  const in30Days = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
  return withNextOccurrence.filter((e) => e.nextBirthday <= in30Days).sort((a, b) => a.nextBirthday.getTime() - b.nextBirthday.getTime());
}

export const getHub = asyncHandler(async (req: Request, res: Response) => {
  const orgId = req.user!.organizationId;
  const userId = req.user!.id;
  const now = new Date();
  const in14 = new Date(now.getTime() + 14 * 24 * 3600 * 1000);
  const in60 = new Date(now.getTime() + 60 * 24 * 3600 * 1000);
  const external = ['client', 'vendor', 'training_customer'].includes(req.user!.role);

  const [announcements, newEmployees, companyGoals, allIdeas, birthdays, latestArticles, recognitions, myCerts, certFeedRaw, upcomingMeetings, myEnrollments, openCourses, headcount, activeProjects, eventAnnouncements] = await Promise.all([
    Announcement.find(excludeDeleted({ organizationId: orgId }))
      .sort({ pinned: -1, createdAt: -1 })
      .limit(12)
      .populate('authorId', 'name avatarUrl jobTitle')
      .populate('comments.authorId', 'name'),
    User.find({ organizationId: orgId, isActive: true, dateJoined: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } })
      .select('name jobTitle department avatarUrl dateJoined')
      .sort('-dateJoined'),
    Goal.find(excludeDeleted({ organizationId: orgId, level: 'company' })),
    Idea.find(excludeDeleted({ organizationId: orgId, stage: { $nin: ['Rejected', 'Archived'] } }))
      .sort('-createdAt')
      .limit(50)
      .populate('submittedById', 'name avatarUrl'),
    upcomingBirthdays(orgId),
    KnowledgeArticle.find(excludeDeleted({ organizationId: orgId, status: 'approved' })).select('title summary type categories createdAt publishedToWebsite').sort('-createdAt').limit(5),
    Recognition.find(excludeDeleted({ organizationId: orgId })).sort('-createdAt').limit(8).populate('fromId toId', 'name avatarUrl'),
    Certification.find(excludeDeleted({ organizationId: orgId, employeeId: userId, expiryDate: { $lte: in60 } })).select('name expiryDate provider').sort('expiryDate'),
    Certification.find(excludeDeleted({ organizationId: orgId, employeeId: userId, 'updates.0': { $exists: true } })).select('name updates').populate('updates.authorId', 'name'),
    Meeting.find(excludeDeleted({ organizationId: orgId, date: { $gte: now, $lte: in14 }, status: 'scheduled', $or: [{ participants: userId }, { organizerId: userId }] })).select('title date meetingLink location').sort('date').limit(6),
    Enrollment.find(excludeDeleted({ organizationId: orgId, userId, status: { $in: ['enrolled', 'in_progress'] } })).populate('courseId', 'title').limit(5),
    external ? [] : Course.find(excludeDeleted({ organizationId: orgId, status: 'published' })).select('title category').sort('-createdAt').limit(4),
    User.countDocuments({ organizationId: orgId, isActive: true, role: { $nin: ['client', 'vendor', 'training_customer'] } }),
    Project.countDocuments({ organizationId: orgId, status: 'active' }),
    Announcement.find(excludeDeleted({ organizationId: orgId, category: 'event' })).sort('-createdAt').limit(4).select('title createdAt'),
  ]);

  const trendingIdeas = allIdeas
    .slice()
    .sort((a: any, b: any) => (b.votes?.length || 0) - (a.votes?.length || 0))
    .slice(0, 5);

  const certUpdates = certFeedRaw
    .flatMap((c: any) => c.updates.map((u: any) => ({ ...u.toObject(), certificationName: c.name, certificationId: c._id })))
    .sort((a: any, b: any) => +new Date(b.createdAt) - +new Date(a.createdAt))
    .slice(0, 5);

  const hour = now.getHours();
  res.json({
    success: true,
    data: {
      announcements,
      newEmployees,
      companyGoals,
      trendingIdeas,
      birthdays,
      latestArticles,
      recognitions,
      expiringCertifications: myCerts,
      certUpdates,
      upcomingMeetings,
      myEnrollments,
      suggestedCourses: openCourses,
      events: eventAnnouncements,
      stats: { headcount, activeProjects, openIdeas: allIdeas.length, goalsOnTrack: companyGoals.filter((g: any) => g.status === 'on_track').length },
      greetingPeriod: hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening',
    },
  });
});

export const reactAnnouncement = asyncHandler(async (req: Request, res: Response) => {
  const emoji = ['👍', '🎉', '❤️', '👏', '🚀'].includes(req.body.emoji) ? req.body.emoji : '👍';
  const a = await Announcement.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
  if (!a) throw ApiError.notFound('Announcement not found');
  const idx = (a.reactions as any[]).findIndex((r) => String(r.userId) === req.user!.id && r.emoji === emoji);
  if (idx >= 0) (a.reactions as any[]).splice(idx, 1);
  else (a.reactions as any[]).push({ userId: req.user!.id, emoji });
  await a.save();
  res.json({ success: true, data: { reactions: a.reactions } });
});

export const commentAnnouncement = asyncHandler(async (req: Request, res: Response) => {
  const body = cleanHtml(String(req.body.body || '')).slice(0, 4000);
  if (!body.trim()) throw ApiError.badRequest('Comment cannot be empty');
  const a = await Announcement.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
  if (!a) throw ApiError.notFound('Announcement not found');
  (a.comments as any[]).push({ authorId: req.user!.id, body, createdAt: new Date() });
  await a.save();
  if (String(a.authorId) !== req.user!.id) {
    await Notification.create({ organizationId: req.user!.organizationId, userId: a.authorId, type: 'system', title: `${req.user!.name} commented on "${a.title}"`, link: '/hub' });
  }
  await notifyMentions({ text: String(req.body.body || ''), organizationId: req.user!.organizationId, actorId: req.user!.id, actorName: req.user!.name, title: `${req.user!.name} mentioned you on the Hub`, link: '/hub' });
  const fresh = await Announcement.findById(a._id).populate('comments.authorId', 'name');
  res.status(201).json({ success: true, data: fresh });
});

export const createRecognition = asyncHandler(async (req: Request, res: Response) => {
  const message = String(req.body.message || '').trim().slice(0, 600);
  if (!message) throw ApiError.badRequest('Please write a message');
  if (!/^[a-f0-9]{24}$/.test(String(req.body.toId))) throw ApiError.badRequest('Choose a colleague to recognise');
  if (String(req.body.toId) === req.user!.id) throw ApiError.badRequest('You cannot recognise yourself');
  const target = await User.findOne({ _id: req.body.toId, organizationId: req.user!.organizationId, isActive: true });
  if (!target) throw ApiError.notFound('Colleague not found');
  const value = ['Excellence', 'Teamwork', 'Innovation', 'Integrity', 'Customer First'].includes(req.body.value) ? req.body.value : 'Teamwork';
  const r = await Recognition.create({ organizationId: req.user!.organizationId, fromId: req.user!.id, toId: target._id, value, message });
  await Notification.create({ organizationId: req.user!.organizationId, userId: target._id, type: 'recognition', title: `${req.user!.name} recognised you for ${value}`, body: message.slice(0, 140), link: '/hub' });
  res.status(201).json({ success: true, data: r });
});

export const createAnnouncement = asyncHandler(async (req: Request, res: Response) => {
  const clean = stripProtected(req.body, ['authorId', 'reactions', 'comments']);
  if (clean.body) clean.body = cleanHtml(clean.body);
  const announcement = await Announcement.create({ ...clean, organizationId: req.user!.organizationId, authorId: req.user!.id });
  res.status(201).json({ success: true, data: announcement });
});

export const updateAnnouncement = asyncHandler(async (req: Request, res: Response) => {
  const announcement = await Announcement.findOneAndUpdate(
    excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }),
    { $set: (() => { const c = stripProtected(req.body, ['authorId', 'reactions', 'comments']); if (c.body) c.body = cleanHtml(c.body); return c; })() },
    { new: true, runValidators: true }
  );
  if (!announcement) throw ApiError.notFound('Announcement not found');
  res.json({ success: true, data: announcement });
});

export const deleteAnnouncement = asyncHandler(async (req: Request, res: Response) => {
  const announcement = await Announcement.findOne(excludeDeleted({ _id: req.params.id, organizationId: req.user!.organizationId }));
  if (!announcement) throw ApiError.notFound('Announcement not found');
  await (announcement as any).softDelete(req.user!.id);
  res.json({ success: true, data: { id: req.params.id, softDeleted: true } });
});
