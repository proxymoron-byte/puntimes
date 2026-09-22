import { getCollection, type CollectionEntry } from 'astro:content';
import cast from '../../shared/cast.json';
import site from '../../shared/site.json';
import { parseBody } from '../../shared/chat-format.js';

export { cast, site };
export type Entry = CollectionEntry<'entries'>;

const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');
/** Prefix an internal path with the site's base path. */
export const url = (p = '') => base + p.replace(/^\//, '');

export async function allEntries(): Promise<Entry[]> {
  const list = await getCollection('entries');
  return list.sort((a, b) => b.data.date.getTime() - a.data.date.getTime() || b.id.localeCompare(a.id));
}

export const slugOf = (e: Entry) => e.id.replace(/^\d{4}-\d{2}-\d{2}-/, '');
export const entryPath = (e: Entry) => `${e.data.date.getUTCFullYear()}/${slugOf(e)}/`;
export const messagesOf = (e: Entry) => parseBody(e.body ?? '', cast);
export const isComic = (e: Entry) => e.data.images.length > 0;

/** Cast ids appearing in an entry. */
export function speakersOf(e: Entry): string[] {
  return [...new Set(messagesOf(e).filter((m) => m.who).map((m) => m.who!.id))];
}

export const fmtDate = (d: Date) =>
  d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export const imgSrc = (src: string) => (/^https?:/.test(src) ? src : url(src));
