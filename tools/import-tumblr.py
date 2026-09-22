#!/usr/bin/env python3
"""Convert a Tumblr blog export into Pun Times entries.

Usage:  python3 tools/import-tumblr.py <export-dir>
where <export-dir> contains posts/html/*.html (unzipped posts.zip) and media/.
Writes src/content/entries/*.md and public/comics/tumblr/*; prints a summary.
"""
import html, json, os, re, shutil, sys, unicodedata
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENTRIES = os.path.join(ROOT, 'src/content/entries')
MEDIA_OUT = os.path.join(ROOT, 'public/comics/tumblr')
cast = json.load(open(os.path.join(ROOT, 'shared/cast.json'), encoding='utf-8'))
alias = {}
for p in cast:
    for n in [p['id'], p['name'], *p.get('aliases', [])]:
        alias[n.lower()] = p['id']
for extra in os.environ.get('EXTRA_ALIASES', '').split(','):  # e.g. 'full name=lev', kept out of the repo
    if '=' in extra:
        k, v = extra.split('=', 1); alias[k.strip().lower()] = v.strip()

def text(fragment):
    fragment = re.sub(r'<br\s*/?>', '\n', fragment)
    fragment = re.sub(r'<[^>]+>', '', fragment)
    return re.sub(r'[ \t\r\f\v]+', ' ', html.unescape(fragment)).strip()

def slugify(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-')[:60] or 'entry'

def parse_date(s):
    s = re.sub(r'(\d+)(st|nd|rd|th)', r'\1', s.strip())
    return datetime.strptime(s, '%B %d, %Y %I:%M%p')

def chat_lines(fragment):
    """Split a chat fragment into body lines in the site's `speaker: text` format."""
    out = []
    for raw in re.split(r'<br\s*/?>|</p>|</div>', fragment):
        line = ' '.join(text(raw).split())
        if not line:
            continue
        label, sep, rest = line.partition(':')
        key = label.strip().lower()
        if sep and key in alias:
            out.append(f"{alias[key]}: {rest.strip()}")
        elif sep and re.fullmatch(r"[A-Z][\w'-]{0,19}", label.strip()) and key not in ('me', 'you', 'her', 'him'):
            out.append(f"{label.strip()}: {rest.strip()}")  # someone not in the cast yet
        elif out:
            out.append('> ' + line)  # quoted speech or a line that merely contains a colon
        else:
            out.append(f"({line})")
    return out

def q(s):
    return json.dumps(s, ensure_ascii=False)

def main(src):
    posts_dir = os.path.join(src, 'posts', 'html') if os.path.isdir(os.path.join(src, 'posts')) else os.path.join(src, 'html')
    os.makedirs(ENTRIES, exist_ok=True)
    written, skipped, used = 0, [], set(os.listdir(ENTRIES))
    for fn in sorted(os.listdir(posts_dir)):
        pid = fn.rsplit('.', 1)[0]
        doc = open(os.path.join(posts_dir, fn), encoding='utf-8').read()
        body = doc.split('<body>', 1)[1].split('<div id="footer">', 1)[0]
        ts = re.search(r'id="timestamp">([^<]+)<', doc)
        date = parse_date(ts.group(1)).strftime('%Y-%m-%d') if ts else '2012-01-01'
        h1 = re.search(r'<h1>(.*?)</h1>', body, re.S)
        title = text(h1.group(1)) if h1 else ''
        images = []
        if '<img' in body:
            caption = re.search(r'<div class="caption">(.*?)</div>', body, re.S)
            lines = chat_lines(caption.group(1)) if caption else []
            for i, src_img in enumerate(re.findall(r'<img src="([^"]+)"', body)):
                name = os.path.basename(src_img)
                path = os.path.join(src, 'media', name)
                if os.path.exists(path):
                    os.makedirs(MEDIA_OUT, exist_ok=True)
                    shutil.copy(path, os.path.join(MEDIA_OUT, name))
                    images.append(f'comics/tumblr/{name}')
        elif re.search(r'<(strong|b)>', body) and 'Anonymous:' not in body:
            lines = chat_lines(re.sub(r'<h1>.*?</h1>', '', body, flags=re.S))
        else:
            skipped.append((fn, date, text(body)[:70]))
            continue
        if not lines and not images:
            skipped.append((fn, date, 'empty'))
            continue
        if not title:
            first = next((l.split(': ', 1)[-1] for l in lines if not l.startswith(('(', '>'))), 'untitled')
            title = first[:60].rstrip()
        stem = f"{date}-{slugify(title)}"
        name, n = f"{stem}.md", 2
        while name in used:
            name, n = f"{stem}-{n}.md", n + 1
        used.add(name)
        fm = ['---', f'title: {q(title)}', f'date: {date}', 'via: "tumblr"']
        if images:
            fm.append('images: [' + ', '.join(q(i) for i in images) + ']')
        fm += [f'tumblr_id: {q(pid)}', '---']
        with open(os.path.join(ENTRIES, name), 'w', encoding='utf-8') as f:
            f.write('\n'.join(fm) + '\n' + '\n'.join(lines) + '\n')
        written += 1
    print(f'wrote {written} entries')
    for s in skipped:
        print('skipped', *s)

if __name__ == '__main__':
    main(sys.argv[1])
