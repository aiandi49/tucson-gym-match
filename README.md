# Tucson Gym Match

A free, independent guide and AI planner that compares gyms near Tucson, Arizona 85710: real first-year costs (startup fee + 12 months + yearly fee), fine print, and spa perks for Planet Fitness, Chuze Fitness, LA Fitness, the Ott Family YMCA, the City of Tucson's Clements Center and a local lifting gym.

- **`/`** is the Gym Planner engine: a chat that asks one question at a time, ranks options with a fit score, and fills the Top match, Shortlist and Listing details cards.
- **`/guide`** is the full written guide (prices checked October 19, 2026).

## 1. Put it on GitHub with GitHub Desktop

1. Unzip `tucson-gym-match.zip`. You get a folder named `tucson-gym-match` that is already a Git repository (branch `main`, no commits yet).
2. Open GitHub Desktop and choose **File → Add local repository**. Pick the `tucson-gym-match` folder and click **Add repository**.
3. You will see every file as a change. In the Summary box type `Initial commit` and click **Commit to main**.
4. Click **Publish repository**. Keep **Keep this code private** ticked, then click **Publish repository**.
5. On github.com, open the repo's **Settings → Advanced Security** (or **Code security**) and turn on **Secret scanning** and **Push protection**.

## 2. Deploy on Vercel

1. In Vercel, click **Add New → Project**, import the `tucson-gym-match` repository, and keep the defaults. There is no build step; the guide is already built.
2. Before or after the first deploy, open **Settings → Environment Variables** and add `ANTHROPIC_API_KEY` for **Production** (see the checklist below). Redeploy after adding it.
3. Open **Firewall → Rules** (or **Configure**) and add the rate-limit rule described at the end of this file.

The chat answers only after `ANTHROPIC_API_KEY` is set in Vercel and the project is redeployed. Until then it shows a polite "not available" message.

## What works and what would need a bigger build

**Works now**
- The full guide at `/guide`, built from `data/gub.json`.
- The planner at `/`: real conversation, one clarifying question at a time, a tailored recommendation and a "Next step", ranked matches with fit scores, voice input, full-page chat, and a plain-text download of the plan. It reads the guide data on the server and can run a few live web searches to confirm a price.
- Conversation is kept only in the browser tab (sessionStorage) and clears when the tab closes.

**Would need a bigger build**
- Signing up, cancelling or booking at a gym (the planner explains how, but cannot do it).
- Live price feeds from gyms (there are no public APIs; prices come from the guide plus web search).
- Accounts, saved history across devices, emailing a plan, or maps and directions.

## Updating prices

1. Edit `data/gub.json` (each entry has `id`, `title`, `summary`, `body`, `tags`, `details`, `sources`). Update `meta.checked` and `meta.checkedLabel`.
2. Run `node scripts/build.mjs` to rebuild `guide/index.html`. The planner reads the same file, so it updates too.
3. If you change the small inline script in the `<head>` of either page, run the build again; it refreshes the script hash in `vercel.json`.

## Local preview

```
cp .env.example .env.local
node scripts/dev-server.mjs
```

Put your key in `.env.local` (never committed), then open http://localhost:3000. No `npm install` needed; there are no dependencies.

## Files

| Path | What it is |
|---|---|
| `index.html`, `assets/engine.css`, `assets/engine.js` | The Gym Planner (home page) |
| `guide/index.html`, `assets/guide.css` | The guide (generated from `data/gub.json`) |
| `assets/prefs.js` | Text-size selector and theme toggle shared by both pages |
| `data/gub.json` | All guide content; also read by the server |
| `api/chat.js` | Serverless function; the only code that sees the API key |
| `vercel.json` | Security headers, CSP, function settings |
| `scripts/build.mjs`, `scripts/dev-server.mjs` | Guide build and local preview (not deployed) |

## Security

- The Anthropic key is read only inside `api/chat.js` from `process.env.ANTHROPIC_API_KEY`. The browser only ever calls `/api/chat`.
- `/api/chat` accepts POST with JSON only, rejects bodies over 32 KB, caps message count and length, forwards only user and assistant messages, and decides the model, `max_tokens` (16000), effort and tools itself.
- Requests whose `Origin` is not this site get a 403. This blocks other websites from using your planner from their pages; it does not stop scripts, which is why the rate limit and spend cap matter.
- An in-code limiter allows 20 requests per visitor per 10 minutes; the Vercel Firewall rule enforces the same across all instances.
- Upstream calls time out after 55 seconds (the function limit is 60). Errors return plain messages and logs record status codes only.
- Every page sends a strict Content-Security-Policy (only this site plus Google Fonts), HSTS, nosniff, frame and referrer protections, and a Permissions-Policy that allows the microphone only for this site.
- All model and user text is rendered with `textContent`; no `innerHTML`.
- No third-party scripts, analytics or trackers.

## You must do this by hand

- [ ] In the Claude Console, create a workspace just for this project, set a **monthly spend limit** and **spend alerts**, and create a key there.
- [ ] In Vercel, add `ANTHROPIC_API_KEY` (Production only, or a separate low-limit key for Preview), then redeploy.
- [ ] Add the Vercel Firewall rate-limit rule: path `/api/chat`, fixed window 600 seconds, 20 requests, keyed by IP, action 429.
- [ ] Confirm the GitHub repo is **private**, and turn on secret scanning and push protection.
- [ ] If a key was ever pasted into a chat, file or commit, revoke it in the Claude Console and create a new one.

---
Independent guide. Not affiliated with Planet Fitness, Chuze Fitness, LA Fitness, the YMCA or the City of Tucson. Prices change; confirm at the front desk before you sign.
