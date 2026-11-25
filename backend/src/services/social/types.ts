export interface PublishInput {
  /** page / business account / organisation id on the platform */
  externalId: string;
  token: string;
  text: string;
  link?: string;
  /** publicly reachable image addresses (short-lived signed links to our own files) */
  imageUrls: string[];
}
export interface PublishResult { externalId: string; url?: string }
export type Http = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json: () => Promise<any>; text: () => Promise<string> }>;

export interface SocialAdapter {
  platform: string;
  /** Why this adapter cannot post this content (so it goes to the manager by hand instead), or null when it can. */
  cannotPublish(i: Omit<PublishInput, 'token'>): string | null;
  publish(i: PublishInput, http?: Http): Promise<PublishResult>;
}

/** Platform error with the access token scrubbed out so it can never reach a log, a screen or the database. */
export class SocialError extends Error {
  constructor(message: string, public status?: number) { super(message); }
}
export const scrub = (text: string, token: string) => (token ? String(text).split(token).join('[token]') : String(text)).slice(0, 500);

export const defaultHttp: Http = (url, init) => fetch(url, init as any) as any;

/** Calls a platform endpoint, turning failures into a readable SocialError (never containing the token). */
export async function call(http: Http, url: string, token: string, init: { method?: string; headers?: Record<string, string>; body?: string }) {
  let res;
  try { res = await http(url, init); } catch (e: any) { throw new SocialError(scrub(`Could not reach the platform: ${e?.message || e}`, token)); }
  let data: any = null;
  const raw = await res.text().catch(() => '');
  try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
  if (!res.ok) {
    const msg = data?.error?.message || data?.message || raw || `HTTP ${res.status}`;
    throw new SocialError(scrub(`The platform refused the post: ${msg}`, token), res.status);
  }
  return data;
}
export const form = (o: Record<string, string | undefined>) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined) as [string, string][]).toString();
