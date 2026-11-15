import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBody } from './chat-format.js';
const cast = JSON.parse(readFileSync(new URL('./cast.json', import.meta.url)));

test('speakers by id, alias, me and an unknown name', () => {
  const msgs = parseBody('r: a\nl: b\nme: c\nIvo: d', cast);
  assert.deepEqual(msgs.map((m) => m.who.id), ['renn', 'lev', 'renn', 'ivo']);
  assert.equal(msgs[3].who.unknown, true);
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

test('a bubble with only ![alt](path) becomes a picture', () => {
  const msgs = parseBody('carl: hi\nrenn: ![Happy Thursday greeting card](/media/2024/happy-thursday.jpg)\nrenn: see ![x](y) here', cast);
  assert.deepEqual(msgs[1].image, { alt: 'Happy Thursday greeting card', src: '/media/2024/happy-thursday.jpg' });
  assert.equal(msgs[1].text, '');
  assert.equal(msgs[2].image, undefined);
});
