// Turns an entry's Markdown body into chat messages for the website.
// No dependencies, so it runs in Node and Astro alike.

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
    if (/^\s*>/.test(line)) { // "> text" always continues the previous bubble (e.g. quoting someone)
      const t = line.replace(/^\s*>\s?/, '');
      if (msgs.length && msgs[msgs.length - 1].who) msgs[msgs.length - 1].text += '\n' + t; else msgs.push({ who: null, text: t });
      continue;
    }
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
  // a bubble that is only `![alt](path)` shows that picture
  for (const m of msgs) {
    const img = m.who && m.text.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
    if (img) Object.assign(m, { text: '', image: { alt: img[1], src: img[2] } });
  }
  // mark runs so consecutive bubbles from one speaker only show the name once
  msgs.forEach((m, i) => { m.cont = i > 0 && msgs[i - 1].who && m.who && msgs[i - 1].who.id === m.who.id; });
  return msgs;
}

export function slugify(s) {
  return String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}
