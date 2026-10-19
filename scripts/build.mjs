// Builds guide/index.html from data/gub.json and refreshes the
// Content-Security-Policy hash for the inline theme-restore script.
// Run with: node scripts/build.mjs   (no dependencies)
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const gub = JSON.parse(read('data/gub.json'));

// The exact inline script used in <head> on every page. Its sha256 hash goes into the CSP.
export const HEAD_SCRIPT =
  "(function(){var d=document.documentElement,t=d.getAttribute('data-default-theme')||'light',f='sm';" +
  "try{var a=localStorage.getItem('pref-theme'),b=localStorage.getItem('pref-font-size');" +
  "if(a==='light'||a==='dark')t=a;if(b==='sm'||b==='md'||b==='lg'||b==='xl')f=b}catch(e){}" +
  "d.setAttribute('data-theme',t);d.setAttribute('data-font-size',f)})();";

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const isUrl = (v) => /^https:\/\/\S+$/.test(String(v));

function detailValue(v) {
  if (isUrl(v)) {
    const label = new URL(v).hostname.replace(/^www\./, '');
    return `<a href="${esc(v)}" rel="noopener" target="_blank">${esc(label)}</a>`;
  }
  return esc(v);
}

function detailsList(details) {
  const rows = Object.entries(details || {})
    .map(([k, v]) => `<div class="dl-row"><dt>${esc(k)}</dt><dd>${detailValue(v)}</dd></div>`)
    .join('\n');
  return rows ? `<dl class="details">\n${rows}\n</dl>` : '';
}

function sourcesList(sources) {
  if (!sources || !sources.length) return '';
  const items = sources
    .map((s) => `<li><a href="${esc(s.url)}" rel="noopener" target="_blank">${esc(s.title)}</a></li>`)
    .join('');
  return `<div class="sources"><p class="sources-label">Sources</p><ul>${items}</ul></div>`;
}

function bodyBlock(body) {
  const lines = body || [];
  const numbered = lines.length > 2 && lines.filter((l) => /^\d+\.\s/.test(l)).length >= 3;
  if (numbered) {
    const items = lines.filter((l) => /^\d+\.\s/.test(l)).map((l) => `<li>${esc(l.replace(/^\d+\.\s/, ''))}</li>`).join('');
    const rest = lines.filter((l) => !/^\d+\.\s/.test(l)).map((l) => `<p>${esc(l)}</p>`).join('');
    return `<ol class="steps">${items}</ol>${rest}`;
  }
  return lines.map((l) => `<p>${esc(l)}</p>`).join('\n');
}

const gyms = gub.entries.filter((e) => e.kind === 'gym');
const topics = gub.entries.filter((e) => e.kind !== 'gym');
const byId = Object.fromEntries(gub.entries.map((e) => [e.id, e]));

const quick = ['pf-fees-fine-print', 'pf-price-29-99', 'pf-black-card-spa']
  .map((id) => byId[id])
  .filter(Boolean)
  .map(
    (e, i) => `<a class="quick-card" href="#${esc(e.id)}">
  <span class="quick-num">0${i + 1}</span>
  <span class="quick-title">${esc(e.title)}</span>
  <span class="quick-text">${esc(e.summary)}</span>
</a>`
  )
  .join('\n');

const costRows = gyms
  .map((e) => {
    const d = e.details || {};
    return `<tr>
  <th scope="row" data-label="Option"><a href="#${esc(e.id)}">${esc(e.title)}</a></th>
  <td data-label="Monthly">${esc(d['Monthly'] || 'Not published')}</td>
  <td data-label="Startup">${esc(d['Startup fee'] || 'Not published')}</td>
  <td data-label="Yearly fee">${esc(d['Annual fee'] || 'Not published')}</td>
  <td data-label="First year">${esc(d['First-year cost'] || 'Not published')}</td>
  <td data-label="Recovery perks">${esc(d['Recovery perks'] || 'Not listed')}</td>
</tr>`;
  })
  .join('\n');

const gymCards = gyms
  .map(
    (e) => `<article class="gym-card" id="${esc(e.id)}">
  <h3>${esc(e.title)}</h3>
  <p class="lede">${esc(e.summary)}</p>
  ${bodyBlock(e.body)}
  ${detailsList(e.details)}
  ${sourcesList(e.sources)}
</article>`
  )
  .join('\n');

const topicCards = topics
  .map(
    (e) => `<article class="topic-card" id="${esc(e.id)}">
  <h3>${esc(e.title)}</h3>
  <p class="lede">${esc(e.summary)}</p>
  ${bodyBlock(e.body)}
  ${detailsList(e.details)}
  ${sourcesList(e.sources)}
</article>`
  )
  .join('\n');

const sizeButtons = `<div class="size-group" role="group" aria-label="Text size">
  <button type="button" class="size-btn s1" data-size-btn="sm" aria-pressed="true" aria-label="Text size small">A</button>
  <button type="button" class="size-btn s2" data-size-btn="md" aria-pressed="false" aria-label="Text size medium">A</button>
  <button type="button" class="size-btn s3" data-size-btn="lg" aria-pressed="false" aria-label="Text size large">A</button>
  <button type="button" class="size-btn s4" data-size-btn="xl" aria-pressed="false" aria-label="Text size extra large">A</button>
</div>`;

const themeButton = `<button type="button" class="theme-btn" id="theme-toggle" aria-pressed="false" aria-label="Switch to dark theme">
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z" fill="currentColor"/></svg>
  <span class="theme-label">Light</span>
</button>`;

const html = `<!doctype html>
<html lang="en" data-default-theme="light" data-theme="light" data-font-size="sm">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Tucson Gym Guide</title>
<meta name="description" content="${esc(gub.meta.subtitle)}">
<meta name="color-scheme" content="light dark">
<script>${HEAD_SCRIPT}</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Source+Sans+3:wght@400;600;700&display=swap">
<link rel="stylesheet" href="/assets/guide.css">
<link rel="icon" href="/assets/icon.svg" type="image/svg+xml">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-nav">
  <div class="nav-row">
    <a class="brand" href="/" aria-label="Tucson Gym Match home">
      <span class="brand-mark" aria-hidden="true">TG</span>
      <span class="brand-name"><strong>Tucson Gym</strong><span>Guide · 85710</span></span>
    </a>
    <nav class="nav-links" aria-label="Main">
      <a href="/">Gym finder</a>
      <a href="/guide" aria-current="page">Full guide</a>
    </nav>
    <div class="prefs">
      ${sizeButtons}
      ${themeButton}
    </div>
  </div>
</header>

<main id="main">
  <section class="hero">
    <p class="kicker">${esc(gub.meta.area)} · Checked ${esc(gub.meta.checkedLabel)}</p>
    <h1>The real cost of a gym near&nbsp;85710</h1>
    <p class="hero-sub">${esc(gub.meta.subtitle)}</p>
    <div class="quick-grid">
${quick}
    </div>
    <p class="hero-cta"><a class="btn" href="/">Ask the gym finder</a><a class="btn quiet" href="#cost">See the cost table</a></p>
  </section>

  <section class="band" id="cost" aria-labelledby="cost-title">
    <div class="band-head">
      <p class="kicker">Side by side</p>
      <h2 id="cost-title">First-year cost, fees included</h2>
      <p class="band-sub">Startup fee plus twelve months plus the yearly fee, before sales tax. Monthly prices alone hide the real number.</p>
    </div>
    <div class="table-wrap">
      <table class="cost-table">
        <thead><tr><th scope="col">Option</th><th scope="col">Monthly</th><th scope="col">Startup</th><th scope="col">Yearly fee</th><th scope="col">First year</th><th scope="col">Recovery perks</th></tr></thead>
        <tbody>
${costRows}
        </tbody>
      </table>
    </div>
  </section>

  <section class="band alt" aria-labelledby="gyms-title">
    <div class="band-head">
      <p class="kicker">The options</p>
      <h2 id="gyms-title">Gyms in and around 85710</h2>
    </div>
    <div class="gym-grid">
${gymCards}
    </div>
  </section>

  <section class="band" aria-labelledby="answers-title">
    <div class="band-head">
      <p class="kicker">Straight answers</p>
      <h2 id="answers-title">Fees, perks and whether it is worth it</h2>
    </div>
    <div class="topic-grid">
${topicCards}
    </div>
  </section>
</main>

<footer class="site-foot">
  <p class="warn"><strong>Before you sign:</strong> ${esc(gub.meta.note)}</p>
  <p>This is an independent guide. It is not affiliated with Planet Fitness, Chuze Fitness, LA Fitness, the YMCA or the City of Tucson. Gym names belong to their owners.</p>
  <p><a href="/">Back to the gym finder</a></p>
</footer>
<script src="/assets/prefs.js"></script>
</body>
</html>
`;

writeFileSync(path.join(root, 'guide/index.html'), html);

// Verify every page uses the identical inline script, then write its hash into vercel.json.
const hash = 'sha256-' + createHash('sha256').update(HEAD_SCRIPT, 'utf8').digest('base64');
for (const page of ['index.html', 'guide/index.html']) {
  const src = read(page);
  const m = src.match(/<script>([\s\S]*?)<\/script>/);
  if (!m || m[1] !== HEAD_SCRIPT) {
    console.error(`Inline head script in ${page} does not match HEAD_SCRIPT. Copy it exactly.`);
    process.exit(1);
  }
}
const vercelPath = path.join(root, 'vercel.json');
const vercel = JSON.parse(readFileSync(vercelPath, 'utf8'));
for (const rule of vercel.headers) {
  for (const h of rule.headers) {
    if (h.key === 'Content-Security-Policy') {
      h.value = h.value.replace(/'sha256-[^']*'/, `'${hash}'`);
    }
  }
}
writeFileSync(vercelPath, JSON.stringify(vercel, null, 2) + '\n');
console.log('Built guide/index.html with', gyms.length, 'gyms and', topics.length, 'topics. CSP hash:', hash);
