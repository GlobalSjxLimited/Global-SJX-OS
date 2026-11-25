import { facebook } from './facebook';
import { instagram } from './instagram';
import { linkedin } from './linkedin';
import { SocialAdapter } from './types';

/** Platforms the app can post to itself. Everything else is posted by hand from the social media manager's queue. */
const ADAPTERS: Record<string, SocialAdapter> = { facebook, instagram, linkedin };
export const adapterFor = (platform: string): SocialAdapter | undefined => ADAPTERS[platform];
export * from './types';
