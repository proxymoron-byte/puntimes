// Punbot: turns posts in a private Slack channel into entries on the site.
//
// Post in #puntimes         -> creates src/content/entries/<date>-<slug>.md (+ comic images)
// Edit that Slack post      -> updates the entry
// Delete it, or reply "undo" in its thread -> removes the entry
//
// Secrets (wrangler secret put …): SLACK_SIGNING_SECRET, SLACK_BOT_TOKEN, GITHUB_TOKEN
// Vars (wrangler.toml): GITHUB_REPO, GITHUB_BRANCH, SLACK_CHANNEL_ID, SLACK_USER_ID, SITE_URL, TIMEZONE

import { parseSlackPost, toMarkdown, slugify } from '../../shared/chat-format.js';
import bundledCast from '../../shared/cast.json';

const ENTRIES = 'src/content/entries';
const UNDO = /^(undo|delete|unpublish|remove)\W*$/i;

export default {
  async fetch(req, env, ctx) {
    if (req.method !== 'POST') return new Response('Punbot is running.', { status: 200 });
    const raw = await req.text();
    if (!(await verifySlack(req, raw, env.SLACK_SIGNING_SECRET))) return new Response('bad signature', { status: 401 });

    const body = JSON.parse(raw);
    if (body.type === 'url_verification') return new Response(body.challenge);
    if (req.headers.get('x-slack-retry-num')) return new Response('ok'); // already handling the first delivery

    if (body.type === 'event_callback' && body.event?.type === 'message') {
      ctx.waitUntil(route(body.event, env).catch((err) => {
        console.error(err);
        const ts = body.event.thread_ts || body.event.ts || body.event.message?.ts;
        return say(env, ts, `Couldn't do that: ${err.message}`).catch(() => {});
      }));
    }
    return new Response('ok');
  },
};

async function route(ev, env) {
  if (ev.channel !== env.SLACK_CHANNEL_ID) return;
  if (ev.bot_id || ev.subtype === 'bot_message') return;

  if (ev.subtype === 'message_changed') {
    const m = ev.message;
    if (m.subtype === 'tombstone') return unpublish(m.ts, env, { quiet: true }); // deleted post that had replies
    if (m.user !== env.SLACK_USER_ID || m.bot_id || (m.thread_ts && m.thread_ts !== m.ts)) return;
    if (m.text === ev.previous_message?.text) return; // e.g. link unfurls, reply counts
    return publish(m, env, { edit: true });
  }
  if (ev.subtype === 'message_deleted') {
    const prev = ev.previous_message;
    if (!prev || prev.bot_id || (prev.thread_ts && prev.thread_ts !== prev.ts)) return;
    return unpublish(prev.ts, env, { quiet: true });
  }
  if (ev.subtype && ev.subtype !== 'file_share') return;
  if (ev.user !== env.SLACK_USER_ID) return;

  if (/^\s*\/\//.test(ev.text || '')) return; // "// note to self" posts are ignored
  if (ev.thread_ts && ev.thread_ts !== ev.ts) {
    if (UNDO.test((ev.text || '').trim())) return unpublish(ev.thread_ts, env);
    return; // other thread chatter is ignored
  }
  return publish(ev, env, { edit: false });
}

// ---------- publish / unpublish ----------

async function publish(msg, env, { edit }) {
  const cast = await loadCast(env);
  const today = localDate(msg.ts, env.TIMEZONE);
  const post = parseSlackPost(msg.text || '', cast, today);

  let path = null, sha, images = [];
  if (edit) {
    path = await findEntryPath(msg.ts, env);
    if (!path) return; // never published (or already removed)
    const existing = await getFile(env, path);
    sha = existing?.sha;
    images = existing ? frontmatterList(existing.text, 'images') : [];
  }

  const imageFiles = (msg.files || []).filter((f) => /^image\//.test(f.mimetype || ''));
  if (!post.lines.length && !imageFiles.length && !images.length && !post.caption) {
    throw new Error('I didn\'t find any lines to publish. Write them as `lev: …` / `me: …`, paste WhatsApp lines, or attach an image.');
  }
  if (!post.lines.length && (imageFiles.length || images.length) && post.title === (post.caption || '').split('\n')[0].slice(0, 60)) {
    post.caption = post.caption.split('\n').slice(1).join('\n'); // first text line was used as the title
  }

  const slug = slugify(post.title) || 'entry';
  const year = post.date.slice(0, 4);
  path ||= await uniquePath(env, `${ENTRIES}/${post.date}-${slug}`, '.md');

  if (!edit && imageFiles.length) {
    const base = path.split('/').pop().replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, '');
    let n = 1;
    for (const f of imageFiles) {
      const ext = (f.filetype || f.name.split('.').pop() || 'png').toLowerCase().replace('jpeg', 'jpg');
      const rel = `comics/${year}/${base}-${n++}.${ext}`;
      const bytes = await downloadSlackFile(f, env);
      await putFile(env, `public/${rel}`, bytesToB64(bytes), `Add comic panel ${rel}`);
      images.push(rel);
    }
  }

  const md = toMarkdown({ ...post, images, slack_ts: msg.ts });
  await putFile(env, path, bytesToB64(new TextEncoder().encode(md)), `${edit ? 'Update' : 'Add'} entry: ${post.title}`, sha);

  const link = `${env.SITE_URL.replace(/\/?$/, '/')}${year}/${path.split('/').pop().replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, '')}/`;
  const who = [...new Set(post.lines.filter((l) => !l.aside).map((l) => l.name))].join(', ');
  const unknown = [...new Set(post.lines.filter((l) => !l.aside && !l.known).map((l) => l.name))];
  const lines = [
    `${edit ? 'Updated' : 'Published'} *${post.title}*${who ? ` (${who})` : ''}. It'll be live in about a minute:\n${link}`,
    unknown.length ? `Not in the cast yet: ${unknown.join(', ')}. They'll get grey bubbles until you add them to shared/cast.json.` : '',
    edit ? '' : `Reply \`undo\` here to unpublish, or edit your post to update it.\n\`${path}\``,
  ].filter(Boolean);
  await say(env, msg.ts, lines.join('\n'));
}

async function unpublish(threadTs, env, { quiet = false } = {}) {
  const path = await findEntryPath(threadTs, env);
  if (!path) { if (!quiet) await say(env, threadTs, 'I couldn\'t find an entry for this post.'); return; }
  const file = await getFile(env, path);
  if (!file) { if (!quiet) await say(env, threadTs, 'That entry is already gone.'); return; }
  for (const rel of frontmatterList(file.text, 'images')) {
    const img = await getFile(env, `public/${rel}`, { raw: false });
    if (img) await deleteFile(env, `public/${rel}`, img.sha, `Remove comic panel ${rel}`);
  }
  await deleteFile(env, path, file.sha, `Remove entry ${path.split('/').pop()}`);
  if (!quiet) await say(env, threadTs, 'Unpublished. It will disappear from the site in about a minute.');
}

/** The bot's first reply in a post's thread records the entry's path. */
async function findEntryPath(ts, env) {
  const r = await slackGet(env, 'conversations.replies', { channel: env.SLACK_CHANNEL_ID, ts, limit: '50' });
  for (const m of r.messages || []) {
    const hit = m.bot_id && (m.text || '').match(/`(src\/content\/entries\/[^`]+\.md)`/);
    if (hit) return hit[1];
  }
  return null;
}

// ---------- helpers ----------

async function loadCast(env) {
  try {
    const f = await getFile(env, 'shared/cast.json');
    if (f) return JSON.parse(f.text);
  } catch (e) { console.warn('cast.json fallback', e); }
  return bundledCast;
}

function localDate(ts, tz = 'Europe/Madrid') {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(parseFloat(ts) * 1000));
}

function frontmatterList(text, key) {
  const m = text.match(new RegExp(`^${key}:\\s*(\\[.*\\])\\s*$`, 'm'));
  try { return m ? JSON.parse(m[1]) : []; } catch { return []; }
}

async function uniquePath(env, stem, ext) {
  for (let i = 1; i < 50; i++) {
    const p = `${stem}${i > 1 ? '-' + i : ''}${ext}`;
    if (!(await getFile(env, p))) return p;
  }
  throw new Error('Too many entries with this title today.');
}

function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function verifySlack(req, raw, secret) {
  const ts = req.headers.get('x-slack-request-timestamp');
  const sig = req.headers.get('x-slack-signature') || '';
  if (!ts || !secret || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`v0:${ts}:${raw}`));
  const hex = 'v0=' + [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (hex.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

// Slack
async function say(env, threadTs, text) {
  const r = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ channel: env.SLACK_CHANNEL_ID, thread_ts: threadTs, text, unfurl_links: false }),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(`Slack chat.postMessage: ${j.error}`);
}
async function slackGet(env, method, params) {
  const r = await fetch(`https://slack.com/api/${method}?${new URLSearchParams(params)}`, {
    headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}` },
  });
  const j = await r.json();
  if (!j.ok) throw new Error(`Slack ${method}: ${j.error}`);
  return j;
}
async function downloadSlackFile(f, env) {
  const r = await fetch(f.url_private_download || f.url_private, { headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}` } });
  if (!r.ok || (r.headers.get('content-type') || '').includes('text/html')) throw new Error(`couldn't download ${f.name} from Slack (is the files:read scope added?)`);
  return new Uint8Array(await r.arrayBuffer());
}

// GitHub (contents API, token scoped to the one repo with Contents: read & write)
async function gh(env, method, path, body) {
  const r = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path.split('/').map(encodeURIComponent).join('/')}${method === 'GET' ? `?ref=${env.GITHUB_BRANCH || 'main'}` : ''}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'punbot',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify({ branch: env.GITHUB_BRANCH || 'main', ...body }) : undefined,
  });
  if (method === 'GET' && r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub ${method} ${path}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
async function getFile(env, path, { raw = true } = {}) {
  const j = await gh(env, 'GET', path);
  if (!j) return null;
  let text = '';
  if (raw && j.content) text = new TextDecoder().decode(Uint8Array.from(atob(j.content.replace(/\n/g, '')), (c) => c.charCodeAt(0)));
  return { sha: j.sha, text };
}
const putFile = (env, path, content, message, sha) => gh(env, 'PUT', path, { message, content, ...(sha ? { sha } : {}) });
const deleteFile = (env, path, sha, message) => gh(env, 'DELETE', path, { message, sha });
