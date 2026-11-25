import { SocialAdapter, Http, PublishInput, PublishResult, call, form, defaultHttp } from './types';

const G = 'https://graph.facebook.com/v21.0';
const FORM = { 'Content-Type': 'application/x-www-form-urlencoded' };

/** Instagram business account (through the Facebook Graph API): one image or a carousel. Instagram cannot post text alone. */
export const instagram: SocialAdapter = {
  platform: 'instagram',
  cannotPublish: (i) => (!i.externalId ? 'The Instagram business account id is missing on the account.' : i.imageUrls.length === 0 ? 'Instagram posts need at least one image.' : null),
  async publish(i: PublishInput, http: Http = defaultHttp): Promise<PublishResult> {
    const ig = encodeURIComponent(i.externalId);
    let creation: string;
    if (i.imageUrls.length === 1) {
      const r = await call(http, `${G}/${ig}/media`, i.token, { method: 'POST', headers: FORM, body: form({ image_url: i.imageUrls[0], caption: i.text, access_token: i.token }) });
      creation = r?.id;
    } else {
      const kids: string[] = [];
      for (const u of i.imageUrls.slice(0, 10)) {
        const r = await call(http, `${G}/${ig}/media`, i.token, { method: 'POST', headers: FORM, body: form({ image_url: u, is_carousel_item: 'true', access_token: i.token }) });
        if (!r?.id) throw new Error('Instagram did not accept one of the pictures.');
        kids.push(r.id);
      }
      const r = await call(http, `${G}/${ig}/media`, i.token, { method: 'POST', headers: FORM, body: form({ media_type: 'CAROUSEL', children: kids.join(','), caption: i.text, access_token: i.token }) });
      creation = r?.id;
    }
    if (!creation) throw new Error('Instagram did not return a media id.');
    const pub = await call(http, `${G}/${ig}/media_publish`, i.token, { method: 'POST', headers: FORM, body: form({ creation_id: creation, access_token: i.token }) });
    if (!pub?.id) throw new Error('Instagram did not publish the post.');
    return { externalId: pub.id };
  },
};
