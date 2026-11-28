import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, 'output');

function getArg(name, fallback) {
  const found = process.argv.find(a => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
}

export function findChromePath() {
  const custom = getArg('chrome', process.env.CHROME_PATH || '');
  if (custom && fs.existsSync(custom)) return custom;
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

const LINKS_URL = getArg('url', 'https://blog.sfkm.me/links');
const SECTION = getArg('section', '朋友');
const INCLUDE_SELF = !process.argv.includes('--no-self');
const OUT_FILE = getArg('out', path.join(OUTPUT_DIR, 'friends.json'));

async function main() {
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  const executablePath = findChromePath();
  const browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
  });

  try {
    const page = await browser.newPage();
    await page.goto(LINKS_URL, { waitUntil: 'networkidle', timeout: 30000 });
    const data = await page.evaluate((sectionName) => {
      const headings = Array.from(document.querySelectorAll('h2, h3'));
      const targetH = headings.find(h => h.textContent.includes(sectionName));
      if (!targetH) return { error: `Heading "${sectionName}" not found` };
      const sec = targetH.closest('section') || targetH.parentElement?.parentElement;
      if (!sec) return { error: 'Section container not found' };
      const anchors = Array.from(sec.querySelectorAll('a[href^="http"]'));
      const seen = new Set();
      const links = [];
      for (const a of anchors) {
        const url = a.href;
        if (seen.has(url)) continue;
        seen.add(url);
        const lines = a.innerText.split('\n').map(s => s.trim()).filter(Boolean);
        links.push({
          name: lines[0] || url,
          url,
          desc: lines.slice(1).join(' | ')
        });
      }
      return { count: links.length, links };
    }, SECTION);

    if (data.error) {
      throw new Error(data.error);
    }

    const origin = new URL(LINKS_URL).origin;
    const all = INCLUDE_SELF
      ? [{ name: `${new URL(origin).host} (本站)`, url: origin, desc: 'Self' }, ...data.links]
      : data.links;

    fs.writeFileSync(OUT_FILE, JSON.stringify(all, null, 2));
    console.log(`Extracted ${all.length} sites -> ${OUT_FILE}`);
  } finally {
    await browser.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
