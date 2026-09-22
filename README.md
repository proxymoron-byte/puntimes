# Pun Times with Phriends

A small static site for the banter: chat-bubble entries, comics, and a Slack bot that publishes them.

- **Site:** Astro, built by GitHub Actions and hosted on GitHub Pages (free).
- **Entries:** one Markdown file each in `src/content/entries/`.
- **Cast and colours:** `shared/cast.json`. **Site settings:** `shared/site.json`.
- **Slack bot ("Punbot"):** a Cloudflare Worker in `worker/`. Post in `#puntimes` and the bot commits the entry here.

## Writing an entry

Post it in `#puntimes` in Slack, or add a file here by hand:

```md
---
title: "The cheese situation"
date: 2026-09-21
tags: ["food", "pun-duel"]
groan: 4          # groan-o-meter, 0–5 (optional)
via: "whatsapp"   # optional
---
lev: I've started making my own cheese
renn: and how's that going
(three hours later)
lev: it's been a grate learning experience
```

- `name: text` is one bubble. Names are matched against the ids, names and aliases in `cast.json`, and `me` always means you.
- A line without a name continues the previous bubble.
- `(text in brackets)` becomes a small centred stage direction.
- Comics: add `images: ["comics/2026/file.png", …]` (files go in `public/comics/…`) and, optionally, a `caption`.

### In Slack

```
The cheese situation
#food #pun-duel groan:4

lev: I've started making my own cheese
me: and how's that going
```

- The first line is the title. The second line holds optional tags, `groan:N`, `date:YYYY-MM-DD` and `via:…`.
- Lines copied from WhatsApp (`[21/09/2026, 10:12] Lev: …`) or Telegram (`Lev, [21.09.26 10:12]`) can be pasted as they are. The date is taken from the chat.
- Attach images to make a comic. Any text after the title becomes the caption.
- **Edit** the Slack post to update the entry. **Delete** it, or reply `undo` in its thread, to take the entry down.
- A post starting with `//` is ignored, so you can leave notes to yourself in the channel.

## Setup (one time)

### 1. GitHub repo and Pages
1. Create an empty repo called `puntimes` and push this folder to it.
2. Go to repo **Settings → Pages → Source** and choose **GitHub Actions**.
3. Every push to `main` then builds the site and deploys it to `https://<you>.github.io/puntimes/`.
4. Custom domain (optional): add it under Settings → Pages. Then set the repo **variables** `SITE_URL=https://yourdomain` and `BASE_PATH=/`.

### 2. GitHub token for the bot
Create a **fine-grained personal access token** (Settings → Developer settings) with:
- access to **only the `puntimes` repository**
- **Contents: Read and write**

### 3. Cloudflare Worker
```sh
cd worker
npm install
npx wrangler login
# edit wrangler.toml: GITHUB_REPO, SITE_URL (fill in the Slack IDs after step 4)
npx wrangler secret put GITHUB_TOKEN
npx wrangler deploy     # prints https://punbot.<your-subdomain>.workers.dev
```

### 4. Slack app
1. Go to <https://api.slack.com/apps>, choose **Create New App → From a manifest**, pick your workspace and paste `worker/slack-manifest.yml`. Put your worker URL in `request_url` first.
2. **Install to workspace.** Then copy the **Bot User OAuth Token** (`xoxb-…`) and the **Signing Secret** (under Basic Information):
   ```sh
   npx wrangler secret put SLACK_BOT_TOKEN
   npx wrangler secret put SLACK_SIGNING_SECRET
   ```
3. Create the private channel `#puntimes` and type `/invite @Punbot` in it.
4. Put the channel ID and your member ID in `wrangler.toml`, then run `npx wrangler deploy` again.
5. Under **Event Subscriptions**, check that the Request URL shows as *Verified*. If it doesn't, click *Retry*.

Only posts from `SLACK_USER_ID` in `SLACK_CHANNEL_ID` are published.

## Local development
```sh
npm install
npm run dev     # http://localhost:4321
npm test        # parser tests
```

## Privacy
`shared/site.json → "unlisted": true` adds `noindex` and a blocking `robots.txt`, so search engines stay away. The site is still reachable by anyone who has the link. Set it to `false` when you're ready to be found.
