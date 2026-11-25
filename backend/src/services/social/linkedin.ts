import { SocialAdapter, Http, PublishInput, PublishResult, call, defaultHttp } from './types';

/** LinkedIn organisation page: text, with an optional link. Pictures need LinkedIn's separate upload flow, so those go to the manager by hand. */
export const linkedin: SocialAdapter = {
  platform: 'linkedin',
  cannotPublish: (i) => (!i.externalId ? 'The LinkedIn organisation id is missing on the account.' : i.imageUrls.length ? 'LinkedIn pictures are posted by hand (the picture upload is not connected).' : null),
  async publish(i: PublishInput, http: Http = defaultHttp): Promise<PublishResult> {
    const author = i.externalId.startsWith('urn:') ? i.externalId : `urn:li:organization:${i.externalId}`;
    const share: any = { shareCommentary: { text: i.text }, shareMediaCategory: i.link ? 'ARTICLE' : 'NONE' };
    if (i.link) share.media = [{ status: 'READY', originalUrl: i.link }];
    const r = await call(http, 'https://api.linkedin.com/v2/ugcPosts', i.token, {
      method: 'POST',
      headers: { Authorization: `Bearer ${i.token}`, 'Content-Type': 'application/json', 'X-Restli-Protocol-Version': '2.0.0' },
      body: JSON.stringify({ author, lifecycleState: 'PUBLISHED', specificContent: { 'com.linkedin.ugc.ShareContent': share }, visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' } }),
    });
    const id = r?.id;
    if (!id) throw new Error('LinkedIn did not return a post id.');
    return { externalId: id, url: `https://www.linkedin.com/feed/update/${encodeURIComponent(id)}` };
  },
};
