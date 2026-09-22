// Shared by the website (to render entries) and the Slack worker (to create them).
// No dependencies, so it runs in Node, Astro and Cloudflare Workers alike.

/** Build a lookup from any alias (lowercased) to a cast member. */
export function castIndex(cast) {
  const idx = new Map();
  for (const p of cast) {
    for (const n of [p.id, p.name, ...(p.aliases || [])]) idx.set(norm(n), p);
    if (p.me) idx.set('me', p);
  }
  return idx;
}

const norm = (s) => String(s).trim().toLowerCase().replace(/^[~@]/, '');

/**
 * Entry body -> messages. Body lines look like `lev: some text`.
 * A line without a known `speaker:` prefix continues the previous message.
 */
export function parseBody(body, cast) {
  const idx = castIndex(cast);
  const msgs = [];
  for (const raw of String(body || '').split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    if (/^\s*\(.*\)\s*$/.test(line)) { msgs.push({ who: null, text: line.trim().slice(1, -1) }); continue; } // (stage direction)
    const m = line.match(/^\s*([^:\n]{1,32}):\s?(.*)$/);
    const who = m && (idx.get(norm(m[1])) || (/^[\p{L}][\p{L} .'-]{0,20}$/u.test(m[1].trim()) ? m[1].trim() : null));
    if (who) {
      const person = typeof who === 'string' ? { id: slugify(who), name: who, unknown: true } : who;
      msgs.push({ who: person, text: m[2] });
    } else if (msgs.length) {
      msgs[msgs.length - 1].text += '\n' + line.trim();
    } else {
      msgs.push({ who: null, text: line.trim() }); // narration / stage direction
    }
  }
  // mark runs so consecutive bubbles from one speaker only show the name once
  msgs.forEach((m, i) => { m.cont = i > 0 && msgs[i - 1].who && m.who && msgs[i - 1].who.id === m.who.id; });
  return msgs;
}

// ---------- turning a Slack post into an entry ----------

// [21/09/2026, 10:12:03] Lev: text        (WhatsApp iOS)
// 21/09/2026, 10:12 - Lev: text            (WhatsApp Android)
const WA = /^‎?\[?(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4}),?\s+\d{1,2}[:.]\d{2}(?:[:.]\d{2})?(?:\s?[APap]\.?[Mm]\.?)?\]?\s?(?:-\s)?([^:]{1,40}):\s?(.*)$/;
// Lev, [21.09.26 10:12]                    (Telegram desktop copy; text on following lines)
const TG = /^([^,\[\n]{1,40}),\s\[(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})\s+\d{1,2}:\d{2}(?::\d{2})?\]$/;

const year4 = (y) => (y.length === 2 ? '20' + y : y);
const iso = (d, m, y) => `${year4(y)}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Decode Slack's escaping: &amp; &lt; &gt; and <url|label> links. */
export function unslack(text) {
  return String(text || '')
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2 ($1)')
    .replace(/<(https?:[^>]+)>/g, '$1')
    .replace(/<mailto:[^|>]+\|([^>]+)>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/**
 * Parse a message posted to #puntimes.
 *   line 1:  title (optional if the next lines are chat lines)
 *   line 2:  optional meta: #tags  groan:4  date:2026-09-21  via:whatsapp
 *   rest:    chat lines (`lev: …`, `me: …`) or pasted WhatsApp/Telegram lines
 * Returns { title, date, tags, groan, via, lines: [{speakerId|name, text}], caption }
 */
export function parseSlackPost(text, cast, fallbackDate) {
  const idx = castIndex(cast);
  const lines = unslack(text).split(/\r?\n/).map((l) => l.replace(/‎/g, '').trimEnd());
  const out = { title: '', date: '', tags: [], groan: null, via: '', lines: [], caption: '' };

  const isMeta = (l) => /(^|\s)(#[\p{L}\p{N}_-]+|groan:\s?\d|date:\s?\d{4}-\d{2}-\d{2}|via:\s?\S+)/u.test(l) &&
    l.split(/\s+/).every((t) => /^(#[\p{L}\p{N}_-]+|groan:\s?\d|\d|date:\S*|via:\S*)$/u.test(t) || t === '');
  const speakerOf = (l) => {
    const m = l.match(/^\s*([^:]{1,32}):\s?(.*)$/);
    if (!m) return null;
    const p = idx.get(norm(m[1]));
    if (p) return [p, m[2]];
    // a capitalised single name that isn't in the cast yet (e.g. "Ivo: hi")
    const n = m[1].trim();
    return /^\p{Lu}[\p{L}'-]{0,19}$/u.test(n) ? [{ id: slugify(n), name: n, unknown: true }, m[2]] : null;
  };

  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  // title: first line if it isn't itself a chat line
  if (i < lines.length && !speakerOf(lines[i]) && !WA.test(lines[i]) && !TG.test(lines[i]) && !isMeta(lines[i])) {
    out.title = lines[i].trim().replace(/^#+\s*/, '').replace(/^\*(.*)\*$/, '$1');
    i++;
  }
  // meta lines
  while (i < lines.length && (!lines[i].trim() || isMeta(lines[i]))) {
    for (const t of lines[i].trim().split(/\s+/)) {
      if (t.startsWith('#')) out.tags.push(t.slice(1).toLowerCase());
      else if (/^groan:/.test(t)) out.groan = Math.max(0, Math.min(5, parseInt(t.slice(6), 10)));
      else if (/^date:/.test(t)) out.date = t.slice(5);
      else if (/^via:/.test(t)) out.via = t.slice(4).toLowerCase();
    }
    i++;
  }
  // body
  let firstDate = '';
  let tgSpeaker = null;
  const push = (who, txt) => {
    const p = idx.get(norm(who));
    out.lines.push({ id: p ? p.id : slugify(who) || 'someone', name: p ? p.name : who.trim(), known: !!p, text: txt });
  };
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) { tgSpeaker = null; continue; }
    let m;
    if ((m = l.match(WA))) {
      const [, d, mo, y, who, txt] = m;
      firstDate ||= iso(d, mo, y); out.via ||= 'whatsapp';
      if (/^<?(media omitted|image omitted|sticker omitted)>?$/i.test(txt.trim())) continue;
      push(who, txt); tgSpeaker = null; continue;
    }
    if ((m = l.match(TG))) {
      const [, who, d, mo, y] = m;
      firstDate ||= iso(d, mo, y); out.via ||= 'telegram';
      tgSpeaker = who; continue;
    }
    if (tgSpeaker) { push(tgSpeaker, l.trim()); tgSpeaker = null; continue; }
    if (/^\(.*\)$/.test(l.trim())) { out.lines.push({ aside: true, text: l.trim().slice(1, -1) }); continue; }
    const s = speakerOf(l);
    if (s) { out.lines.push({ id: s[0].id, name: s[0].name, known: !s[0].unknown, text: s[1] }); continue; }
    if (out.lines.length) out.lines[out.lines.length - 1].text += '\n' + l.trim();
    else out.caption += (out.caption ? '\n' : '') + l.trim();
  }
  out.date ||= firstDate || fallbackDate;
  if (!out.title) {
    const first = out.lines.find((l) => !l.aside)?.text || out.caption || 'Untitled';
    out.title = first.split('\n')[0].slice(0, 60);
  }
  return out;
}

/** Entry object -> markdown file contents. */
export function toMarkdown(e) {
  const q = (s) => JSON.stringify(String(s));
  const fm = ['---', `title: ${q(e.title)}`, `date: ${e.date}`];
  if (e.tags?.length) fm.push(`tags: [${e.tags.map(q).join(', ')}]`);
  if (e.groan != null) fm.push(`groan: ${e.groan}`);
  if (e.via) fm.push(`via: ${q(e.via)}`);
  if (e.images?.length) fm.push(`images: [${e.images.map(q).join(', ')}]`);
  if (e.caption) fm.push(`caption: ${q(e.caption)}`);
  if (e.slack_ts) fm.push(`slack_ts: ${q(e.slack_ts)}`);
  fm.push('---', '');
  const body = (e.lines || []).map((l) => l.aside ? `(${l.text})` : `${l.known ? l.id : l.name}: ${l.text.replace(/\n/g, '\n  ')}`).join('\n');
  return fm.join('\n') + body + '\n';
}

export function slugify(s) {
  return String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}
