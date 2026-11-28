import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';
import { findChromePath } from './extract_links.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, 'output');
const FRIENDS_PATH = path.join(OUTPUT_DIR, 'friends.json');
const RESULTS_PATH = path.join(OUTPUT_DIR, 'results.json');

function getArg(name, fallback) {
  const found = process.argv.find(a => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
}

const CHROME_PATH = findChromePath();
const limitVal = getArg('limit', '');
const LIMIT = limitVal ? parseInt(limitVal, 10) : Infinity;
const INPUT_PATH = getArg('input', FRIENDS_PATH);
const SINGLE_URLS = process.argv.filter(a => a.startsWith('--url=')).map(a => a.slice(6));
const MERGE_MODE = process.argv.includes('--merge');

// Lighthouse-style log-normal scoring curve helper (0..100)
function logNormalScore(value, p10, median) {
  if (value == null || !Number.isFinite(value) || value < 0) return null;
  if (value === 0) return 100;
  const skewed = Math.log(median);
  const location = skewed;
  const logRatio = Math.log(p10) - skewed;
  const shape = Math.abs(logRatio) / (Math.SQRT2 * 0.9061938024368232);
  const z = (Math.log(value) - location) / (shape * Math.SQRT2);
  const t = 1 / (1 + 0.3275911 * Math.abs(z));
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erfc = poly * Math.exp(-z * z);
  const cdf = z >= 0 ? 1 - 0.5 * erfc : 0.5 * erfc;
  return Math.round((1 - cdf) * 100);
}

function detectTechStack({ html, headers, globals }) {
  const h = Object.fromEntries(Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), String(v).toLowerCase()]));
  const lowerHtml = (html || '').toLowerCase();
  const tags = [];
  let framework = 'Custom / Static';
  let cdn = null;

  if (h['cf-ray'] || h['server']?.includes('cloudflare')) cdn = 'Cloudflare';
  else if (h['x-vercel-id'] || h['server']?.includes('vercel')) cdn = 'Vercel';
  else if (h['x-nf-request-id'] || h['server']?.includes('netlify')) cdn = 'Netlify';
  else if (h['x-github-request-id'] || h['server']?.includes('github.com')) cdn = 'GitHub Pages';
  else if (h['x-eo-pages'] || h['server']?.includes('edgeone')) cdn = 'EdgeOne';
  else if (h['x-oss-request-id'] || h['via']?.includes('alisdn')) cdn = 'Aliyun CDN';
  else if (h['server']?.includes('esa')) cdn = 'Aliyun ESA';

  const genMatch = lowerHtml.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)["']/i)
    || lowerHtml.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']generator["']/i);
  const gen = genMatch ? genMatch[1] : '';

  if (gen.includes('wordpress') || lowerHtml.includes('/wp-content/') || lowerHtml.includes('/wp-includes/')) {
    framework = 'WordPress';
  } else if (gen.includes('halo') || lowerHtml.includes('/apis/api.halo.run') || lowerHtml.includes('halo-comment') || h['x-halo-cache']) {
    framework = 'Halo';
  } else if (gen.includes('typecho') || lowerHtml.includes('/usr/themes/')) {
    framework = 'Typecho';
  } else if (gen.includes('hexo') || lowerHtml.includes('hexo-theme') || globals.isHexo) {
    framework = 'Hexo';
  } else if (gen.includes('hugo') || lowerHtml.includes('hugo-theme')) {
    framework = 'Hugo';
  } else if (gen.includes('astro') || lowerHtml.includes('astro-island') || lowerHtml.includes('/_astro/')) {
    framework = 'Astro';
  } else if (globals.isNext || lowerHtml.includes('/_next/static/') || lowerHtml.includes('__next_data__') || h['x-powered-by']?.includes('next.js')) {
    framework = 'Next.js';
  } else if (globals.isNuxt || lowerHtml.includes('/_nuxt/') || lowerHtml.includes('__nuxt')) {
    framework = 'Nuxt / Vue';
  } else if (gen.includes('vitepress') || lowerHtml.includes('vpsidebar') || lowerHtml.includes('vp-doc')) {
    framework = 'VitePress';
  } else if (gen.includes('vuepress')) {
    framework = 'VuePress';
  } else if (gen.includes('docusaurus')) {
    framework = 'Docusaurus';
  } else if (gen.includes('ghost') || lowerHtml.includes('/ghost/api/')) {
    framework = 'Ghost';
  } else if (gen.includes('gatsby') || lowerHtml.includes('___gatsby')) {
    framework = 'Gatsby';
  } else if (lowerHtml.includes('__sveltekit')) {
    framework = 'SvelteKit';
  } else if (globals.hasVue || lowerHtml.includes('data-v-')) {
    framework = 'Vue SPA';
  } else if (globals.hasReact) {
    framework = 'React SPA';
  }

  if (gen.includes('neo-blog')) tags.push('neo-blog');
  if (lowerHtml.includes('shiro') || lowerHtml.includes('mx-space')) tags.push('Mix Space');
  if (lowerHtml.includes('butterfly')) tags.push('Butterfly');
  if (lowerHtml.includes('anzhiyu')) tags.push('AnZhiYu');
  if (lowerHtml.includes('fluid')) tags.push('Fluid');
  if (lowerHtml.includes('sakura') || lowerHtml.includes('sakurairo')) tags.push('Sakura');
  if (lowerHtml.includes('argon')) tags.push('Argon');
  if (lowerHtml.includes('tailwindcss') || lowerHtml.includes('--tw-')) tags.push('Tailwind');

  return { framework, cdn, generator: gen || null, tags };
}

async function runLighthouse(url) {
  let chrome;
  try {
    chrome = await chromeLauncher.launch({
      ...(CHROME_PATH ? { chromePath: CHROME_PATH } : {}),
      chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
    });
    const options = {
      logLevel: 'error',
      output: 'json',
      onlyCategories: ['performance'],
      port: chrome.port,
      formFactor: 'desktop',
      screenEmulation: {
        mobile: false,
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
        disabled: false
      },
      throttlingMethod: 'provided',
      maxWaitForLoad: 25000
    };
    const runnerResult = await lighthouse(url, options);
    const lhr = runnerResult.lhr;
    if (lhr.runtimeError && lhr.runtimeError.code) {
      return { error: lhr.runtimeError.message || lhr.runtimeError.code };
    }
    const audits = lhr.audits;
    return {
      score: Math.round((lhr.categories.performance?.score ?? 0) * 100),
      fcp: Math.round(audits['first-contentful-paint']?.numericValue ?? 0),
      lcp: Math.round(audits['largest-contentful-paint']?.numericValue ?? 0),
      tbt: Math.round(audits['total-blocking-time']?.numericValue ?? 0),
      cls: Number((audits['cumulative-layout-shift']?.numericValue ?? 0).toFixed(3)),
      si: Math.round(audits['speed-index']?.numericValue ?? 0),
      ttfb: Math.round(audits['server-response-time']?.numericValue ?? 0),
      totalBytes: Math.round((audits['total-byte-weight']?.numericValue ?? 0) / 1024),
      domSize: Math.round(audits['dom-size']?.numericValue ?? 0),
      finalUrl: lhr.finalDisplayedUrl || url
    };
  } catch (err) {
    return { error: err.message?.slice(0, 120) || 'Lighthouse failed' };
  } finally {
    if (chrome) {
      try { await chrome.kill(); } catch {}
    }
  }
}

async function runPlaywrightChecks(browser, url) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);

  await page.addInitScript(() => {
    window.__perfMetrics = { cls: 0, maxEventDuration: 0, lcp: 0, fcp: 0 };
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) window.__perfMetrics.cls += entry.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
    } catch {}
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.name === 'first-contentful-paint') window.__perfMetrics.fcp = entry.startTime;
        }
      }).observe({ type: 'paint', buffered: true });
    } catch {}
    try {
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        if (entries.length) window.__perfMetrics.lcp = entries[entries.length - 1].startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch {}
  });

  let respHeaders = {};
  let mainStatus = 0;
  try {
    const response = await page.goto(url, { waitUntil: 'load', timeout: 22000 });
    mainStatus = response ? response.status() : 0;
    respHeaders = response ? response.headers() : {};
    await page.waitForTimeout(1200);
  } catch (err) {
    await context.close();
    return { error: `Home load failed: ${err.message?.slice(0, 100)}` };
  }

  const homeInfo = await page.evaluate(() => {
    const html = document.documentElement.outerHTML.slice(0, 120000);
    const globals = {
      isNext: Boolean(window.__NEXT_DATA__ || window.__next_f),
      isNuxt: Boolean(window.__NUXT__),
      isHexo: Boolean(window.GLOBAL_CONFIG || window.btf || window.anzhiyu),
      hasVue: Boolean(window.Vue || document.querySelector('[data-v-]')),
      hasReact: Boolean(window.__REACT_DEVTOOLS_GLOBAL_HOOK__ || document.querySelector('#__next, #root'))
    };

    const origin = location.origin;
    const anchors = Array.from(document.querySelectorAll('a[href]'));
    const candidates = [];
    const excludeRe = /\/(links|friends|about|tags|categories|category|tag|archives?|page|rss|atom|feed|search|login|admin|contact|privacy|terms|sponsor|donate|bangumi|movies|music|moments|talk|shuoshuo)(\/|$)/i;
    const articleRe = /\/(posts?|articles?|blogs?|p|archives\/\d+|20\d{2}\/\d{2}|20\d{2}\/|note|notes|essay)\/[^\/#?]+/i;

    for (const a of anchors) {
      let href;
      try {
        const u = new URL(a.getAttribute('href'), origin);
        if (u.origin !== origin) continue;
        if (u.pathname === '/' || u.pathname === location.pathname) continue;
        if (/\.(xml|json|png|jpg|jpeg|webp|svg|pdf|zip|css|js)$/i.test(u.pathname)) continue;
        href = u.href;
      } catch { continue; }

      const rect = a.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const inArticle = Boolean(a.closest('article, .post, .post-card, .article-card, [class*="post"], [class*="article"]'));
      const pathStr = new URL(href).pathname;
      if (excludeRe.test(pathStr) && !articleRe.test(pathStr)) continue;

      let score = 0;
      if (articleRe.test(pathStr)) score += 50;
      if (inArticle) score += 30;
      if (pathStr.split('/').filter(Boolean).length >= 2) score += 15;
      if (a.innerText.trim().length > 6) score += 10;
      if (score > 0) {
        candidates.push({ href, score, text: a.innerText.trim().slice(0, 40) });
      }
    }
    candidates.sort((a, b) => b.score - a.score);

    const buttons = Array.from(document.querySelectorAll('button, [role="button"]')).filter(b => {
      const r = b.getBoundingClientRect();
      return r.width > 12 && r.height > 12 && r.top >= 0 && r.top < 800 && !b.disabled;
    });
    const toggleBtn = buttons.find(b => /theme|dark|light|mode|search|menu|切换|主题|搜索|菜单/i.test(b.getAttribute('aria-label') || b.title || b.innerText || b.className || ''));
    const hasInteractiveBtn = Boolean(toggleBtn || buttons[0]);

    return {
      html,
      globals,
      title: document.title,
      articleUrl: candidates[0]?.href || null,
      hasInteractiveBtn
    };
  });

  const tech = detectTechStack({
    html: homeInfo.html,
    headers: respHeaders,
    globals: homeInfo.globals
  });

  let uiClickMs = null;
  if (homeInfo.hasInteractiveBtn) {
    try {
      uiClickMs = await page.evaluate(async () => {
        const buttons = Array.from(document.querySelectorAll('button, [role="button"]')).filter(b => {
          const r = b.getBoundingClientRect();
          return r.width > 12 && r.height > 12 && r.top >= 0 && r.top < 800 && !b.disabled;
        });
        const btn = buttons.find(b => /theme|dark|light|mode|search|menu|切换|主题|搜索|菜单/i.test(b.getAttribute('aria-label') || b.title || b.innerText || b.className || '')) || buttons[0];
        if (!btn) return null;
        return await new Promise(resolve => {
          const start = performance.now();
          btn.click();
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              resolve(Math.round(performance.now() - start));
            });
          });
          setTimeout(() => resolve(Math.round(performance.now() - start)), 1500);
        });
      });
    } catch {}
  }

  let article = null;
  let navClickMs = null;
  if (homeInfo.articleUrl) {
    try {
      const navResult = await page.evaluate((targetHref) => {
        const links = Array.from(document.querySelectorAll('a[href]'));
        const el = links.find(a => {
          try { return new URL(a.getAttribute('href'), location.origin).href === targetHref; } catch { return false; }
        });
        if (!el) return false;
        el.scrollIntoView({ block: 'center' });
        return true;
      }, homeInfo.articleUrl);

      const navStart = Date.now();
      if (navResult) {
        await Promise.all([
          page.waitForURL(u => u.href !== url && !u.href.endsWith('#'), { timeout: 15000 }).catch(() => {}),
          page.evaluate((targetHref) => {
            const el = Array.from(document.querySelectorAll('a[href]')).find(a => {
              try { return new URL(a.getAttribute('href'), location.origin).href === targetHref; } catch { return false; }
            });
            if (el) el.click();
          }, homeInfo.articleUrl)
        ]);
        await page.waitForLoadState('domcontentloaded', { timeout: 12000 }).catch(() => {});
        await page.waitForTimeout(800);
        navClickMs = Date.now() - navStart;
      }

      const artPage = await context.newPage();
      artPage.setDefaultTimeout(15000);
      await artPage.addInitScript(() => {
        window.__artPerf = { cls: 0, lcp: 0, fcp: 0 };
        try {
          new PerformanceObserver(l => {
            for (const e of l.getEntries()) if (!e.hadRecentInput) window.__artPerf.cls += e.value;
          }).observe({ type: 'layout-shift', buffered: true });
          new PerformanceObserver(l => {
            for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') window.__artPerf.fcp = e.startTime;
          }).observe({ type: 'paint', buffered: true });
          new PerformanceObserver(l => {
            const es = l.getEntries();
            if (es.length) window.__artPerf.lcp = es[es.length - 1].startTime;
          }).observe({ type: 'largest-contentful-paint', buffered: true });
        } catch {}
      });

      let artBytes = 0;
      let artReqs = 0;
      artPage.on('response', r => {
        artReqs++;
        const len = parseInt(r.headers()['content-length'] || '0', 10);
        if (Number.isFinite(len)) artBytes += len;
      });

      await artPage.goto(homeInfo.articleUrl, { waitUntil: 'load', timeout: 20000 });
      await artPage.waitForTimeout(1200);

      const artMetrics = await artPage.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0];
        const ttfb = nav ? Math.round(nav.responseStart - nav.requestStart) : 0;
        const domReady = nav ? Math.round(nav.domContentLoadedEventEnd - nav.fetchStart) : 0;
        const loadTime = nav ? Math.round(nav.loadEventEnd - nav.fetchStart) : 0;
        return {
          ttfb,
          domReady,
          loadTime,
          fcp: Math.round(window.__artPerf.fcp || domReady),
          lcp: Math.round(window.__artPerf.lcp || loadTime || domReady),
          cls: Number((window.__artPerf.cls || 0).toFixed(3)),
          domSize: document.querySelectorAll('*').length
        };
      });

      const fcpScore = logNormalScore(artMetrics.fcp, 900, 1800) ?? 50;
      const lcpScore = logNormalScore(artMetrics.lcp, 1200, 2500) ?? 50;
      const ttfbScore = logNormalScore(artMetrics.ttfb, 200, 600) ?? 50;
      const clsScore = logNormalScore(Math.max(artMetrics.cls, 0.001), 0.1, 0.25) ?? 100;
      const artScore = Math.round(fcpScore * 0.25 + lcpScore * 0.4 + ttfbScore * 0.2 + clsScore * 0.15);

      article = {
        url: homeInfo.articleUrl,
        ...artMetrics,
        transferKB: Math.round(artBytes / 1024),
        requests: artReqs,
        score: artScore
      };
      await artPage.close();
    } catch (err) {
      article = { url: homeInfo.articleUrl, error: err.message?.slice(0, 80) };
    }
  }

  const inpSamples = [];
  if (uiClickMs !== null) {
    inpSamples.push(logNormalScore(Math.max(uiClickMs, 16), 50, 200) ?? 80);
  }
  if (navClickMs !== null) {
    inpSamples.push(logNormalScore(Math.max(navClickMs, 100), 600, 1800) ?? 70);
  }
  const interactionScore = inpSamples.length
    ? Math.round(inpSamples.reduce((a, b) => a + b, 0) / inpSamples.length)
    : null;

  await context.close();
  return {
    status: mainStatus,
    title: homeInfo.title,
    tech,
    article,
    interaction: {
      uiClickMs,
      navClickMs,
      score: interactionScore
    }
  };
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const friends = SINGLE_URLS.length > 0
    ? SINGLE_URLS.map(u => {
        const normalized = /^https?:\/\//i.test(u) ? u : `https://${u}`;
        return { name: new URL(normalized).host, url: normalized, desc: '' };
      })
    : JSON.parse(fs.readFileSync(INPUT_PATH, 'utf8')).slice(0, LIMIT);

  console.log(`Loaded ${friends.length} sites to benchmark.`);

  const browser = await chromium.launch({
    ...(CHROME_PATH ? { executablePath: CHROME_PATH } : {}),
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
  });

  const existing = (MERGE_MODE && fs.existsSync(RESULTS_PATH))
    ? JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8')).results || []
    : [];
  const results = [];

  for (let i = 0; i < friends.length; i++) {
    const site = friends[i];
    console.log(`[${i + 1}/${friends.length}] Testing ${site.name} (${site.url}) ...`);

    const pw = await runPlaywrightChecks(browser, site.url);
    const lh = !pw.error ? await runLighthouse(site.url) : { error: pw.error };

    const homeScore = (lh && !lh.error) ? lh.score : null;
    const artScore = (pw.article && !pw.article.error) ? pw.article.score : null;
    const intScore = pw.interaction?.score ?? null;

    let compositeScore = null;
    if (homeScore !== null) {
      let totalWeight = 0.5;
      let weightedSum = homeScore * 0.5;
      if (artScore !== null) { totalWeight += 0.3; weightedSum += artScore * 0.3; }
      if (intScore !== null) { totalWeight += 0.2; weightedSum += intScore * 0.2; }
      compositeScore = Math.round(weightedSum / totalWeight);
    }

    const item = {
      name: site.name,
      url: site.url,
      desc: site.desc,
      reachable: !pw.error && (!lh || !lh.error),
      error: pw.error || lh?.error || null,
      tech: pw.tech || { framework: 'Unknown', cdn: null, generator: null, tags: [] },
      home: lh && !lh.error ? lh : null,
      article: pw.article || null,
      interaction: pw.interaction || null,
      compositeScore
    };
    results.push(item);

    console.log(
      `  -> ${item.reachable ? 'OK' : 'FAIL'} | Framework: ${item.tech.framework} | ` +
      `Home: ${homeScore ?? '-'} | Art: ${artScore ?? '-'} | Int: ${intScore ?? '-'} | Total: ${compositeScore ?? '-'}`
    );

    const mergedResults = MERGE_MODE
      ? [...existing.filter(e => !results.some(r => r.url === e.url)), ...results]
      : results;
    fs.writeFileSync(RESULTS_PATH, JSON.stringify({
      generatedAt: new Date().toISOString(),
      environment: `${process.platform} / Chrome Desktop 1440x900 / Provided Network`,
      totalSites: mergedResults.length,
      completedSites: mergedResults.length,
      results: mergedResults
    }, null, 2));
  }

  await browser.close();
  console.log(`Done! Saved results to ${RESULTS_PATH}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
