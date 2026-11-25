import { Notification } from '../models/Notification';

const MENTION_PATTERN = /@\[([^\]]+)\]\(([a-f0-9]{24})\)/g;

/** Extracts the userIds tagged in a piece of text written as @[Name](userId) — the format the MentionTextarea component writes. */
export function extractMentionedUserIds(text: string): string[] {
  if (!text) return [];
  const ids = new Set<string>();
  let match: RegExpExecArray | null;
  const pattern = new RegExp(MENTION_PATTERN);
  while ((match = pattern.exec(text)) !== null) {
    ids.add(match[2]);
  }
  return Array.from(ids);
}

interface NotifyMentionsInput {
  text: string;
  organizationId: string;
  actorId: string;
  actorName: string;
  title: string;
  link: string;
}

/** Notifies every user @-mentioned in `text`, excluding the author themselves. Safe to call on any text — a no-op if nothing is tagged. */
export async function notifyMentions(input: NotifyMentionsInput): Promise<void> {
  const mentioned = extractMentionedUserIds(input.text).filter((id) => id !== input.actorId);
  if (mentioned.length === 0) return;

  await Promise.all(
    mentioned.map((userId) =>
      Notification.create({
        organizationId: input.organizationId,
        userId,
        type: 'mention',
        title: input.title,
        body: input.text.replace(MENTION_PATTERN, '@$1').slice(0, 140),
        link: input.link,
      })
    )
  );
}
