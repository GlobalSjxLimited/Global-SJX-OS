import { SocialAdapter, Http, PublishInput, PublishResult, call, form, defaultHttp } from './types';

const G = 'https://graph.facebook.com/v21.0';
const FORM = { 'Content-Type': 'application/x-www-form-urlencoded' };

/** Facebook Page: text, link, one photo, or several photos in a single post. Needs a Page access token with pages_manage_posts. */
export const facebook: SocialAdapter = {
  platform: 'facebook',
  cannotPublish: (i) => (!i.externalId ? 'The Facebook Page id is missing on the account.' : null),
  async publish(i: PublishInput, http: Http = defaultHttp): Promise<PublishResult> {
    const page = encodeURIComponent(i.externalId);
    let id: string;
    if (i.imageUrls.length === 0) {
      const r = await call(http, `${G}/${page}/feed`, i.token, { method: 'POST', headers: FORM, body: form({ message: i.text, link: i.link, access_token: i.token }) });
      id = r?.id;
    } else if (i.imageUrls.length === 1) {
      const r = await call(http, `${G}/${page}/photos`, i.token, { method: 'POST', headers: FORM, body: form({ url: i.imageUrls[0], caption: i.text, access_token: i.token }) });
      id = r?.post_id || r?.id;
    } else {
      const ids: string[] = [];
      for (const u of i.imageUrls) {
        const r = await call(http, `${G}/${page}/photos`, i.token, { method: 'POST', headers: FORM, body: form({ url: u, published: 'false', access_token: i.token }) });
        if (!r?.id) throw new Error('Facebook did not accept one of the pictures.');
        ids.push(r.id);
      }
      const body = new URLSearchParams({ message: i.text, access_token: i.token });
      ids.forEach((x, n) => body.append(`attached_media[${n}]`, JSON.stringify({ media_fbid: x })));
      const r = await call(http, `${G}/${page}/feed`, i.token, { method: 'POST', headers: FORM, body: body.toString() });
      id = r?.id;
    }
    if (!id) throw new Error('Facebook did not return a post id.');
    return { externalId: id, url: `https://www.facebook.com/${id}` };
  },
};
