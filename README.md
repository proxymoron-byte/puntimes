# Pun Times with Phriends

A small static site for the banter: chat-bubble entries and comics.

- **Site:** Astro, built by GitHub Actions and hosted on GitHub Pages (free). Every push to `main` deploys it.
- **Entries:** one Markdown file each in `src/content/entries/`.
- **Cast and colours:** `shared/cast.json`. **Site settings:** `shared/site.json`.

## Adding an entry

Send the exchange to Claude in the app and it commits the file here. Or add a file by hand:

```md
---
date: 2026-09-21
tags: ["food", "pun-duel"]   # optional
groan: 4                     # groan-o-meter, 0–5 (optional)
via: "whatsapp"              # optional
---
lev: I've started making my own cheese
renn: and how's that going
(three hours later)
lev: it's been a grate learning experience
```

- Name the file `YYYY-MM-DD-slug.md`. The slug becomes the URL: `/<year>/<slug>/`.
- `title` is optional. Use one only when a word or two sums the exchange up, like `title: "chic."`. Untitled entries show their first line in the archive and the browser tab.
- `date` can include a time (`"2026-11-15T12:05:00+01:00"`) to order several entries from the same day. Newer entries come first on the site.
- `name: text` is one bubble. Names are matched against the ids, names and aliases in `cast.json`, and `me` always means you.
- A line without a name continues the previous bubble.
- `(text in brackets)` becomes a small centred stage direction.
- Comics: add `images: ["comics/2026/file.png", …]` (files go in `public/comics/…`) and, optionally, a `caption`.

## Hosting

1. In the repo, **Settings → Pages → Source** is set to **GitHub Actions**.
2. Every push to `main` builds the site and deploys it to `https://<you>.github.io/puntimes/`.
3. Custom domain (optional): add it under Settings → Pages. Then set the repo **variables** `SITE_URL=https://yourdomain` and `BASE_PATH=/`.

## Local development
```sh
npm install
npm run dev     # http://localhost:4321
npm test        # parser tests
```

## Privacy
`shared/site.json → "unlisted": true` adds `noindex` and a blocking `robots.txt`, so search engines stay away. The site is still reachable by anyone who has the link. Set it to `false` when you're ready to be found.
