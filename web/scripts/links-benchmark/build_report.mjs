import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, 'output');
const RESULTS_PATH = path.join(OUTPUT_DIR, 'results.json');
const OUTPUT_HTML = path.join(OUTPUT_DIR, 'benchmark-report.html');

const raw = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8'));

const results = [...raw.results].sort((a, b) => {
  if (a.compositeScore == null && b.compositeScore == null) return 0;
  if (a.compositeScore == null) return 1;
  if (b.compositeScore == null) return -1;
  return b.compositeScore - a.compositeScore;
});

let rank = 1;
for (const r of results) {
  r.rank = r.compositeScore != null ? rank++ : null;
}

const dataJson = JSON.stringify({
  generatedAt: raw.generatedAt,
  environment: raw.environment,
  totalSites: raw.totalSites,
  results
}).replace(/<\/script>/gi, '<\\/script>');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>blog.sfkm.me 友链前端性能 Benchmark 报告</title>
<style>
  :root {
    --bg: #0b0f17;
    --surface: #111827;
    --surface-2: #182235;
    --border: rgba(255, 255, 255, 0.08);
    --text: #f3f4f6;
    --muted: #9ca3af;
    --accent: #38bdf8;
    --green: #22c55e;
    --amber: #f59e0b;
    --red: #ef4444;
    --purple: #a78bfa;
    --radius: 12px;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  .container { max-width: 1440px; margin: 0 auto; padding: 28px 24px 64px; }
  header {
    display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-end;
    gap: 16px; margin-bottom: 24px; padding-bottom: 20px; border-bottom: 1px solid var(--border);
  }
  h1 { margin: 0 0 6px; font-size: 26px; font-weight: 700; letter-spacing: -0.02em; }
  .subtitle { color: var(--muted); font-size: 13px; }
  .meta-badges { display: flex; flex-wrap: wrap; gap: 8px; }
  .badge {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 500;
    background: var(--surface-2); border: 1px solid var(--border); color: var(--muted);
  }
  .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 14px; margin-bottom: 24px; }
  .kpi-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px 18px; }
  .kpi-label { font-size: 12px; color: var(--muted); margin-bottom: 6px; }
  .kpi-value { font-size: 26px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .kpi-sub { font-size: 12px; color: var(--muted); margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .section-title { font-size: 16px; font-weight: 600; margin: 28px 0 12px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .stack-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .stack-card {
    background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
    padding: 14px 16px; cursor: pointer; transition: border-color 0.15s, transform 0.15s, background 0.15s;
  }
  .stack-card:hover { border-color: rgba(56, 189, 248, 0.45); transform: translateY(-1px); }
  .stack-card.active { border-color: var(--accent); background: rgba(56, 189, 248, 0.08); }
  .stack-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .stack-name { font-weight: 600; font-size: 14px; }
  .stack-count { font-size: 12px; color: var(--muted); background: var(--surface-2); padding: 2px 8px; border-radius: 999px; }
  .stack-bar-bg { height: 6px; background: var(--surface-2); border-radius: 999px; overflow: hidden; margin-bottom: 8px; }
  .stack-bar-fill { height: 100%; border-radius: 999px; }
  .stack-stats { display: flex; justify-content: space-between; font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .toolbar {
    display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between;
    margin-bottom: 14px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px 14px;
  }
  .toolbar-left { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .search-input, select {
    background: var(--bg); color: var(--text); border: 1px solid var(--border);
    border-radius: 8px; padding: 7px 12px; font-size: 13px; outline: none;
  }
  .search-input:focus, select:focus { border-color: var(--accent); }
  .btn {
    background: var(--surface-2); color: var(--text); border: 1px solid var(--border);
    border-radius: 8px; padding: 7px 12px; font-size: 13px; cursor: pointer; transition: background 0.15s, border-color 0.15s;
  }
  .btn:hover { border-color: rgba(255,255,255,0.22); }
  .btn.active { background: rgba(56, 189, 248, 0.16); border-color: var(--accent); color: var(--accent); }
  .table-wrap { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { padding: 11px 12px; text-align: left; border-bottom: 1px solid var(--border); white-space: nowrap; }
  th { background: var(--surface-2); color: var(--muted); font-weight: 600; font-size: 12px; cursor: pointer; user-select: none; position: sticky; top: 0; }
  th:hover { color: var(--text); }
  th.sorted { color: var(--accent); }
  tr.data-row { cursor: pointer; transition: background 0.12s; }
  tr.data-row:hover { background: rgba(255, 255, 255, 0.03); }
  tr.data-row.is-self { background: rgba(56, 189, 248, 0.07); }
  tr.data-row.is-self:hover { background: rgba(56, 189, 248, 0.12); }
  .site-cell { display: flex; flex-direction: column; max-width: 240px; }
  .site-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; }
  .site-url { font-size: 11px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; }
  .score-pill { display: inline-flex; align-items: center; justify-content: center; min-width: 38px; padding: 2px 8px; border-radius: 999px; font-weight: 700; font-size: 12px; font-variant-numeric: tabular-nums; }
  .score-good { background: rgba(34, 197, 94, 0.16); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.3); }
  .score-mid { background: rgba(245, 158, 11, 0.16); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); }
  .score-bad { background: rgba(239, 68, 68, 0.16); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }
  .score-na { background: rgba(156, 163, 175, 0.12); color: var(--muted); border: 1px solid var(--border); }
  .fw-tag { display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; background: var(--surface-2); border: 1px solid var(--border); }
  .cdn-tag { font-size: 11px; color: var(--muted); margin-left: 4px; }
  .num { font-variant-numeric: tabular-nums; }
  .muted { color: var(--muted); }
  .detail-row td { background: #0d131f; padding: 16px 20px; white-space: normal; }
  .detail-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; }
  .detail-box { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; }
  .detail-box h4 { margin: 0 0 8px; font-size: 13px; color: var(--accent); }
  .kv { display: flex; justify-content: space-between; font-size: 12px; padding: 3px 0; border-bottom: 1px dashed rgba(255,255,255,0.05); }
  .kv:last-child { border-bottom: none; }
  .group-header-row td { background: rgba(56, 189, 248, 0.08); font-weight: 700; font-size: 13px; color: var(--accent); padding: 9px 14px; }
  .methodology { margin-top: 28px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 18px 20px; font-size: 13px; color: var(--muted); }
  .methodology h3 { margin: 0 0 10px; font-size: 15px; color: var(--text); }
  .methodology ul { margin: 6px 0 0; padding-left: 18px; }
</style>
</head>
<body>
<div class="container">
  <header>
    <div>
      <h1>blog.sfkm.me 友链前端性能 Benchmark</h1>
      <div class="subtitle">覆盖「朋友」分区全部友链及本站自身 · Lighthouse 首屏 + 文章页实测 + 点击交互延迟 + 技术栈分组</div>
    </div>
    <div class="meta-badges" id="metaBadges"></div>
  </header>
  <section class="kpi-grid" id="kpiGrid"></section>
  <div class="section-title">
    <span>按技术栈框架分组概览（点击卡片筛选）</span>
    <button class="btn" id="clearStackFilter" style="display:none">清除技术栈筛选</button>
  </div>
  <section class="stack-grid" id="stackGrid"></section>
  <div class="toolbar">
    <div class="toolbar-left">
      <input type="text" id="searchInput" class="search-input" placeholder="搜索站点名称、域名、框架、CDN..." style="min-width: 240px;" />
      <select id="stackSelect"><option value="ALL">全部技术栈</option></select>
      <button class="btn active" id="viewFlatBtn">综合排行榜</button>
      <button class="btn" id="viewGroupBtn">按技术栈分组</button>
    </div>
    <div class="muted" style="font-size: 12px;" id="countLabel"></div>
  </div>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th data-sort="rank">#</th>
          <th data-sort="name">站点</th>
          <th data-sort="framework">技术栈 / CDN</th>
          <th data-sort="compositeScore" class="sorted">综合得分 ↓</th>
          <th data-sort="homeScore">首屏 LH</th>
          <th data-sort="homeTtfb">首屏 TTFB</th>
          <th data-sort="homeFcp">首屏 FCP</th>
          <th data-sort="homeLcp">首屏 LCP</th>
          <th data-sort="homeTbt">TBT</th>
          <th data-sort="homeCls">CLS</th>
          <th data-sort="artScore">文章页得分</th>
          <th data-sort="artLcp">文章 LCP</th>
          <th data-sort="intScore">交互得分</th>
          <th data-sort="uiClickMs">UI点击</th>
          <th data-sort="navClickMs">跳转耗时</th>
          <th data-sort="totalBytes">首屏体积</th>
        </tr>
      </thead>
      <tbody id="tableBody"></tbody>
    </table>
  </div>
  <section class="methodology">
    <h3>评测方法与打分说明</h3>
    <ul>
      <li><strong>测试环境</strong>：本机真实 Google Chrome (Desktop 1440×900, 真实本地网络直连，无人工节流)，所有站点严格串行评测，避免 CPU/带宽互相抢占导致 TBT 与 LCP 失真。</li>
      <li><strong>综合得分 (0–100)</strong>：<code>首屏 Lighthouse Performance (50%) + 文章页加载性能 (30%) + 点击交互响应 (20%)</code>。若某站点未发现可测文章链接，则按有效权重归一化。</li>
      <li><strong>首屏指标 (Lighthouse)</strong>：基于官方 Lighthouse Performance 审计，采集 FCP、LCP、TBT (Total Blocking Time)、CLS、Speed Index、TTFB 及资源总体积。</li>
      <li><strong>文章页指标</strong>：自动在首页发现最新/首篇同域文章链接并独立打开，测量文章页 TTFB、FCP、LCP、CLS、DOM 节点数与请求体积，并套用 Lighthouse 对数正态曲线打分。</li>
      <li><strong>点击交互指标</strong>：测量两项真实交互：(1) 页面内可交互按钮（主题切换/搜索/菜单等）<code>click → 双 rAF 绘制完成</code>延迟；(2) 点击首页文章链接触发导航/SPA 软路由切换的响应耗时。</li>
      <li><strong>点击表格任意行</strong>可展开该站点的详细检测面板与实测文章 URL。</li>
    </ul>
  </section>
</div>
<script>
const BENCH_DATA = ${dataJson};
const state = { search: '', stack: 'ALL', viewMode: 'flat', sortKey: 'compositeScore', sortDir: 'desc', expanded: new Set() };
function scoreClass(s) { return s == null ? 'score-na' : s >= 90 ? 'score-good' : s >= 50 ? 'score-mid' : 'score-bad'; }
function barColor(s) { return s >= 90 ? '#22c55e' : s >= 70 ? '#38bdf8' : s >= 50 ? '#f59e0b' : '#ef4444'; }
function fmtMs(v) { return v == null ? '-' : v >= 1000 ? (v / 1000).toFixed(2) + 's' : v + 'ms'; }
function fmtNum(v, suffix = '') { return v == null ? '-' : v + suffix; }
function esc(str) { return String(str ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function getSortValue(r, key) {
  switch (key) {
    case 'rank': return r.rank ?? 9999;
    case 'name': return r.name || '';
    case 'framework': return r.tech?.framework || '';
    case 'compositeScore': return r.compositeScore ?? -1;
    case 'homeScore': return r.home?.score ?? -1;
    case 'homeTtfb': return r.home?.ttfb ?? 999999;
    case 'homeFcp': return r.home?.fcp ?? 999999;
    case 'homeLcp': return r.home?.lcp ?? 999999;
    case 'homeTbt': return r.home?.tbt ?? 999999;
    case 'homeCls': return r.home?.cls ?? 999999;
    case 'artScore': return r.article?.score ?? -1;
    case 'artLcp': return r.article?.lcp ?? 999999;
    case 'intScore': return r.interaction?.score ?? -1;
    case 'uiClickMs': return r.interaction?.uiClickMs ?? 999999;
    case 'navClickMs': return r.interaction?.navClickMs ?? 999999;
    case 'totalBytes': return r.home?.totalBytes ?? 999999;
    default: return r.compositeScore ?? -1;
  }
}
function renderMetaAndKPI() {
  const all = BENCH_DATA.results;
  const ok = all.filter(r => r.reachable && r.compositeScore != null);
  const avg = arr => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
  const avgComp = avg(ok.map(r => r.compositeScore));
  const avgHome = avg(ok.map(r => r.home?.score).filter(v => v != null));
  const avgArt = avg(ok.map(r => r.article?.score).filter(v => v != null));
  const avgInt = avg(ok.map(r => r.interaction?.score).filter(v => v != null));
  const selfSite = all.find(r => r.url.includes('blog.sfkm.me'));
  const topSite = ok[0];
  document.getElementById('metaBadges').innerHTML = [
    '<span class="badge">测试时间: ' + new Date(BENCH_DATA.generatedAt).toLocaleString('zh-CN') + '</span>',
    '<span class="badge">环境: ' + esc(BENCH_DATA.environment) + '</span>',
    '<span class="badge">站点: ' + ok.length + ' 可达 / ' + all.length + ' 总计</span>'
  ].join('');
  document.getElementById('kpiGrid').innerHTML = [
    { label: '综合性能均分', value: avgComp, sub: '首屏均分 ' + avgHome + ' · 文章均分 ' + avgArt + ' · 交互均分 ' + avgInt, color: barColor(avgComp) },
    { label: '本站 (blog.sfkm.me)', value: selfSite?.compositeScore ?? 'N/A', sub: selfSite?.rank ? ('综合排名第 ' + selfSite.rank + ' / ' + ok.length + ' · ' + (selfSite.tech?.framework || '')) : '未达', color: 'var(--accent)' },
    { label: '性能榜首', value: topSite?.compositeScore ?? '-', sub: topSite ? (topSite.name + ' (' + topSite.tech?.framework + ')') : '-', color: 'var(--green)' },
    { label: '平均首屏 LCP / TTFB', value: fmtMs(avg(ok.map(r => r.home?.lcp).filter(v => v != null))), sub: '平均 TTFB ' + fmtMs(avg(ok.map(r => r.home?.ttfb).filter(v => v != null))) + ' · FCP ' + fmtMs(avg(ok.map(r => r.home?.fcp).filter(v => v != null))), color: 'var(--purple)' }
  ].map(k => '<div class="kpi-card"><div class="kpi-label">' + esc(k.label) + '</div><div class="kpi-value" style="color:' + k.color + '">' + esc(k.value) + '</div><div class="kpi-sub">' + esc(k.sub) + '</div></div>').join('');
}
function buildStacks() {
  const map = new Map();
  for (const r of BENCH_DATA.results) {
    const fw = r.tech?.framework || 'Unknown';
    if (!map.has(fw)) map.set(fw, []);
    map.get(fw).push(r);
  }
  const stacks = Array.from(map.entries()).map(([name, items]) => {
    const scored = items.filter(i => i.compositeScore != null);
    const avgScore = scored.length ? Math.round(scored.reduce((a, b) => a + b.compositeScore, 0) / scored.length) : 0;
    const avgHome = scored.length ? Math.round(scored.reduce((a, b) => a + (b.home?.score ?? 0), 0) / scored.length) : 0;
    const avgLcp = scored.length ? Math.round(scored.reduce((a, b) => a + (b.home?.lcp ?? 0), 0) / scored.length) : 0;
    return { name, count: items.length, okCount: scored.length, avgScore, avgHome, avgLcp };
  }).sort((a, b) => b.avgScore - a.avgScore || b.count - a.count);
  document.getElementById('stackSelect').innerHTML = '<option value="ALL">全部技术栈 (' + BENCH_DATA.results.length + ')</option>' + stacks.map(s => '<option value="' + esc(s.name) + '">' + esc(s.name) + ' (' + s.count + ')</option>').join('');
  return stacks;
}
function renderStacks(stacks) {
  const grid = document.getElementById('stackGrid');
  grid.innerHTML = stacks.map(s => \`<div class="stack-card \${state.stack === s.name ? 'active' : ''}" data-stack="\${esc(s.name)}"><div class="stack-head"><span class="stack-name">\${esc(s.name)}</span><span class="stack-count">\${s.count} 站</span></div><div class="stack-bar-bg"><div class="stack-bar-fill" style="width:\${s.avgScore}%;background:\${barColor(s.avgScore)}"></div></div><div class="stack-stats"><span>均分 <strong style="color:var(--text)">\${s.okCount ? s.avgScore : '-'}</strong></span><span>首屏 \${s.okCount ? s.avgHome : '-'}</span><span>LCP \${s.okCount ? fmtMs(s.avgLcp) : '-'}</span></div></div>\`).join('');
  grid.querySelectorAll('.stack-card').forEach(el => {
    el.addEventListener('click', () => {
      const target = el.getAttribute('data-stack');
      state.stack = state.stack === target ? 'ALL' : target;
      document.getElementById('stackSelect').value = state.stack;
      renderAll();
    });
  });
  document.getElementById('clearStackFilter').style.display = state.stack === 'ALL' ? 'none' : 'inline-block';
}
function renderRow(r) {
  const isSelf = r.url.includes('blog.sfkm.me');
  const isExpanded = state.expanded.has(r.url);
  const fw = r.tech?.framework || 'Unknown';
  const cdn = r.tech?.cdn;
  const tags = (r.tech?.tags || []).join(', ');
  let mainRow = \`<tr class="data-row \${isSelf ? 'is-self' : ''}" data-url="\${esc(r.url)}"><td class="num muted">\${r.rank ?? '-'}</td><td><div class="site-cell"><span class="site-name">\${esc(r.name)}\${isSelf ? ' ⭐' : ''}</span><a class="site-url" href="\${esc(r.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">\${esc(r.url)}</a></div></td><td><span class="fw-tag">\${esc(fw)}</span>\${cdn ? '<span class="cdn-tag">' + esc(cdn) + '</span>' : ''}</td><td><span class="score-pill \${scoreClass(r.compositeScore)}">\${r.compositeScore ?? 'ERR'}</span></td><td><span class="score-pill \${scoreClass(r.home?.score)}">\${r.home?.score ?? '-'}</span></td><td class="num">\${fmtMs(r.home?.ttfb)}</td><td class="num">\${fmtMs(r.home?.fcp)}</td><td class="num">\${fmtMs(r.home?.lcp)}</td><td class="num">\${fmtMs(r.home?.tbt)}</td><td class="num">\${r.home?.cls ?? '-'}</td><td><span class="score-pill \${scoreClass(r.article?.score)}">\${r.article?.score ?? '-'}</span></td><td class="num">\${fmtMs(r.article?.lcp)}</td><td><span class="score-pill \${scoreClass(r.interaction?.score)}">\${r.interaction?.score ?? '-'}</span></td><td class="num">\${fmtMs(r.interaction?.uiClickMs)}</td><td class="num">\${fmtMs(r.interaction?.navClickMs)}</td><td class="num">\${r.home?.totalBytes != null ? r.home.totalBytes + ' KB' : '-'}</td></tr>\`;
  if (isExpanded) {
    mainRow += \`<tr class="detail-row"><td colspan="16">\${r.error && !r.reachable ? '<div style="color:var(--red);margin-bottom:8px;">错误: ' + esc(r.error) + '</div>' : ''}<div class="detail-grid"><div class="detail-box"><h4>首屏 Lighthouse 详情</h4><div class="kv"><span>Performance Score</span><strong>\${r.home?.score ?? '-'}</strong></div><div class="kv"><span>Speed Index</span><span>\${fmtMs(r.home?.si)}</span></div><div class="kv"><span>TTFB / FCP / LCP</span><span>\${fmtMs(r.home?.ttfb)} / \${fmtMs(r.home?.fcp)} / \${fmtMs(r.home?.lcp)}</span></div><div class="kv"><span>TBT / CLS</span><span>\${fmtMs(r.home?.tbt)} / \${r.home?.cls ?? '-'}</span></div><div class="kv"><span>总传输体积 / DOM 节点</span><span>\${fmtNum(r.home?.totalBytes, ' KB')} / \${fmtNum(r.home?.domSize)}</span></div></div><div class="detail-box"><h4>文章页实测详情</h4>\${r.article && !r.article.error ? \`<div class="kv"><span>实测文章</span><a href="\${esc(r.article.url)}" target="_blank" rel="noopener" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">\${esc(r.article.url)}</a></div><div class="kv"><span>文章得分</span><strong>\${r.article.score}</strong></div><div class="kv"><span>TTFB / FCP / LCP</span><span>\${fmtMs(r.article.ttfb)} / \${fmtMs(r.article.fcp)} / \${fmtMs(r.article.lcp)}</span></div><div class="kv"><span>DOM Ready / Load</span><span>\${fmtMs(r.article.domReady)} / \${fmtMs(r.article.loadTime)}</span></div><div class="kv"><span>请求数 / 体积 / DOM</span><span>\${r.article.requests} / \${r.article.transferKB} KB / \${r.article.domSize}</span></div>\` : '<div class="muted">' + esc(r.article?.error || '首页未发现可测文章链接') + '</div>'}</div><div class="detail-box"><h4>点击交互 & 技术栈指纹</h4><div class="kv"><span>交互综合得分</span><strong>\${r.interaction?.score ?? '-'}</strong></div><div class="kv"><span>UI 按钮 Click-to-Paint</span><span>\${fmtMs(r.interaction?.uiClickMs)}</span></div><div class="kv"><span>文章链接点击跳转</span><span>\${fmtMs(r.interaction?.navClickMs)}</span></div><div class="kv"><span>识别框架 / CDN</span><span>\${esc(fw)} / \${esc(cdn || '未识别')}</span></div><div class="kv"><span>Generator / Tags</span><span>\${esc(r.tech?.generator || '-')} \${tags ? '(' + esc(tags) + ')' : ''}</span></div></div></div></td></tr>\`;
  }
  return mainRow;
}
function renderTable() {
  const q = state.search.trim().toLowerCase();
  let list = BENCH_DATA.results.filter(r => {
    if (state.stack !== 'ALL' && (r.tech?.framework || 'Unknown') !== state.stack) return false;
    if (!q) return true;
    const hay = [r.name, r.url, r.tech?.framework, r.tech?.cdn, ...(r.tech?.tags || [])].join(' ').toLowerCase();
    return hay.includes(q);
  });
  list.sort((a, b) => {
    const va = getSortValue(a, state.sortKey), vb = getSortValue(b, state.sortKey);
    if (typeof va === 'string' && typeof vb === 'string') return state.sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    return state.sortDir === 'asc' ? va - vb : vb - va;
  });
  document.getElementById('countLabel').textContent = '显示 ' + list.length + ' / ' + BENCH_DATA.results.length + ' 个站点（点击行查看详情）';
  const tbody = document.getElementById('tableBody');
  if (state.viewMode === 'grouped') {
    const groups = new Map();
    for (const r of list) { const fw = r.tech?.framework || 'Unknown'; if (!groups.has(fw)) groups.set(fw, []); groups.get(fw).push(r); }
    let html = '';
    for (const [fw, items] of groups.entries()) {
      const scored = items.filter(i => i.compositeScore != null);
      const avg = scored.length ? Math.round(scored.reduce((a, b) => a + b.compositeScore, 0) / scored.length) : '-';
      html += \`<tr class="group-header-row"><td colspan="16">\${esc(fw)} · 共 \${items.length} 站 · 平均综合得分 \${avg}</td></tr>\` + items.map(renderRow).join('');
    }
    tbody.innerHTML = html;
  } else {
    tbody.innerHTML = list.map(renderRow).join('');
  }
  tbody.querySelectorAll('tr.data-row').forEach(row => {
    row.addEventListener('click', () => { const u = row.getAttribute('data-url'); if (state.expanded.has(u)) state.expanded.delete(u); else state.expanded.add(u); renderTable(); });
  });
}
let cachedStacks = [];
function renderAll() { renderStacks(cachedStacks); renderTable(); }
document.getElementById('searchInput').addEventListener('input', e => { state.search = e.target.value; renderTable(); });
document.getElementById('stackSelect').addEventListener('change', e => { state.stack = e.target.value; renderAll(); });
document.getElementById('clearStackFilter').addEventListener('click', () => { state.stack = 'ALL'; document.getElementById('stackSelect').value = 'ALL'; renderAll(); });
document.getElementById('viewFlatBtn').addEventListener('click', () => { state.viewMode = 'flat'; document.getElementById('viewFlatBtn').classList.add('active'); document.getElementById('viewGroupBtn').classList.remove('active'); renderTable(); });
document.getElementById('viewGroupBtn').addEventListener('click', () => { state.viewMode = 'grouped'; document.getElementById('viewGroupBtn').classList.add('active'); document.getElementById('viewFlatBtn').classList.remove('active'); renderTable(); });
document.querySelectorAll('th[data-sort]').forEach(th => {
  th.addEventListener('click', () => {
    const key = th.getAttribute('data-sort');
    if (state.sortKey === key) state.sortDir = state.sortDir === 'desc' ? 'asc' : 'desc';
    else { state.sortKey = key; state.sortDir = ['rank', 'name', 'framework', 'homeTtfb', 'homeFcp', 'homeLcp', 'homeTbt', 'homeCls', 'artLcp', 'uiClickMs', 'navClickMs', 'totalBytes'].includes(key) ? 'asc' : 'desc'; }
    document.querySelectorAll('th[data-sort]').forEach(h => { h.classList.remove('sorted'); h.textContent = h.textContent.replace(/ [↑↓]$/, ''); });
    th.classList.add('sorted'); th.textContent += state.sortDir === 'desc' ? ' ↓' : ' ↑';
    renderTable();
  });
});
renderMetaAndKPI();
cachedStacks = buildStacks();
renderAll();
</script>
</body>
</html>`;

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(OUTPUT_HTML, html, 'utf8');
console.log('Generated HTML report at:', OUTPUT_HTML);
