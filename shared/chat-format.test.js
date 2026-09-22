import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSlackPost, parseBody, toMarkdown } from './chat-format.js';
const cast = JSON.parse(readFileSync(new URL('./cast.json', import.meta.url)));

test('typed post with title, meta and me/lev lines', () => {
  const p = parseSlackPost('The cheese situation\n#food #pun-duel groan:4\n\nlev: I make cheese\nme: how&apos;s it going\nlev: grate &amp; good\nstill grating', cast, '2026-09-22');
  assert.equal(p.title, 'The cheese situation');
  assert.deepEqual(p.tags, ['food', 'pun-duel']);
  assert.equal(p.groan, 4);
  assert.equal(p.date, '2026-09-22');
  assert.deepEqual(p.lines.map((l) => l.id), ['lev', 'renn', 'lev']);
  assert.equal(p.lines[2].text, 'grate & good\nstill grating');
});

test('pasted WhatsApp (iOS + Android) sets date and via', () => {
  const p = parseSlackPost('Boxes\n[02/09/2026, 18:01:22] Renn: 14 boxes\n[02/09/2026, 18:02:03] Lev: box-istential\n02/09/2026, 18:03 - Kabir: lev please\n[02/09/2026, 18:04:00] Lev: <Media omitted>', cast, '2026-09-22');
  assert.equal(p.date, '2026-09-02');
  assert.equal(p.via, 'whatsapp');
  assert.deepEqual(p.lines.map((l) => l.id), ['renn', 'lev', 'kabir']);
});

test('pasted Telegram and unknown speaker', () => {
  const p = parseSlackPost('Lev, [21.09.26 10:12]\nhello\nIvo, [21.09.26 10:13]\nhi', cast, 'x');
  assert.equal(p.date, '2026-09-21');
  assert.equal(p.title, 'hello');
  assert.deepEqual(p.lines.map((l) => [l.id, l.known]), [['lev', true], ['ivo', false]]);
});

test('round trip: markdown body renders the same speakers', () => {
  const p = parseSlackPost('T\nlev: a\nIvo: b\nme: c\n(pause)', cast, '2026-01-01');
  const md = toMarkdown(p);
  const body = md.split('---\n').slice(2).join('---\n');
  const msgs = parseBody(body, cast);
  assert.deepEqual(msgs.map((m) => m.who?.id), ['lev', 'ivo', 'renn', undefined]);
  assert.match(md, /^title: "T"$/m);
});

test('stage directions in body', () => {
  const msgs = parseBody('lev: hi\n(three hours later)\nrenn: hi', cast);
  assert.equal(msgs[1].who, null);
});

test('"> " lines continue the previous bubble', () => {
  const msgs = parseBody('kabir: she said\n> her: no\nlev: ok', cast);
  assert.deepEqual(msgs.map((m) => m.who?.id), ['kabir', 'lev']);
  assert.equal(msgs[0].text, 'she said\nher: no');
});
