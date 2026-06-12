#!/usr/bin/env node
/* Render Yasnovidets HTML journals into premium A4 PDF mini-magazines.
 *
 * Usage:
 *   node scripts/render_pdf.js --all --update-index
 *   node scripts/render_pdf.js --samples
 *   node scripts/render_pdf.js docs/issues/week-2026-w24.html
 *
 * Set YASNO_ARCHIVE_BASE_URL when GitHub Pages is available, for example:
 *   https://<user>.github.io/yasnovidets/
 */
const fs = require("fs");
const https = require("https");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PDF_DIR = path.join(ROOT, "docs", "pdf");
const PDF_CSS = path.join(PDF_DIR, "pdf.css");

function requirePlaywright() {
  try {
    return require("playwright");
  } catch (_) {
    return require(path.join(ROOT, ".out", "pw", "node_modules", "playwright"));
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function toFileUrl(file) {
  return "file:///" + path.resolve(file).replace(/\\/g, "/").replace(/^([A-Za-z]):/, "$1:");
}

function relToRoot(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function htmlTargetUrl(htmlFile) {
  const base = (process.env.YASNO_ARCHIVE_BASE_URL || "").trim();
  const rel = relToRoot(htmlFile);
  if (!base) return rel;
  return base.replace(/\/+$/, "/") + rel.replace(/^docs\//, "");
}

function qrUrl(data) {
  return "https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=1&data=" + encodeURIComponent(data);
}

function fallbackQrDataUri(data) {
  const n = 25;
  const cell = 6;
  const size = n * cell;
  let seed = 0;
  for (const ch of data) seed = ((seed * 31) + ch.charCodeAt(0)) >>> 0;
  const isFinder = (x, y, ox, oy) => x >= ox && x < ox + 7 && y >= oy && y < oy + 7;
  const finder = (ox, oy) => {
    const r = (x, y) => {
      const dx = x - ox, dy = y - oy;
      return dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4);
    };
    return r;
  };
  const f1 = finder(1, 1), f2 = finder(n - 8, 1), f3 = finder(1, n - 8);
  const rects = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let on = false;
      if (isFinder(x, y, 1, 1)) on = f1(x, y);
      else if (isFinder(x, y, n - 8, 1)) on = f2(x, y);
      else if (isFinder(x, y, 1, n - 8)) on = f3(x, y);
      else {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        on = ((seed >>> 27) + x + y) % 3 === 0;
      }
      if (on) rects.push(`<rect x="${x * cell}" y="${y * cell}" width="${cell}" height="${cell}"/>`);
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="#fff"/><g fill="#111">${rects.join("")}</g></svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

function fetchQrDataUri(data) {
  return new Promise((resolve) => {
    const req = https.get(qrUrl(data), { timeout: 5000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        resolve(fallbackQrDataUri(data));
        return;
      }
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        resolve("data:image/png;base64," + buf.toString("base64"));
      });
    });
    req.on("timeout", () => {
      req.destroy();
      resolve(fallbackQrDataUri(data));
    });
    req.on("error", () => resolve(fallbackQrDataUri(data)));
  });
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function slugFor(htmlFile) {
  return path.basename(htmlFile, ".html");
}

function outputFor(htmlFile) {
  const rel = relToRoot(htmlFile);
  const dir = rel.startsWith("docs/samples/") ? "samples" : "issues";
  return path.join(PDF_DIR, dir, slugFor(htmlFile) + ".pdf");
}

function discoverTargets(args) {
  const explicit = args.filter((x) => !x.startsWith("--"));
  if (explicit.length) return explicit.map((x) => path.resolve(ROOT, x));

  const targets = [];
  const addHtmls = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir).sort()) {
      if (name.endsWith(".html")) targets.push(path.join(dir, name));
    }
  };
  if (args.includes("--all") || args.includes("--issues")) addHtmls(path.join(ROOT, "docs", "issues"));
  if (args.includes("--all") || args.includes("--samples")) addHtmls(path.join(ROOT, "docs", "samples"));
  if (!targets.length) addHtmls(path.join(ROOT, "docs", "issues"));
  return targets;
}

async function extractPage(page, htmlFile) {
  await page.goto(toFileUrl(htmlFile), { waitUntil: "networkidle" });
  await page.emulateMedia({ media: "screen" });
  return page.evaluate(() => {
    const text = (el) => (el ? el.innerText.replace(/\s+/g, " ").trim() : "");
    const htmlText = (el) => (el ? el.innerText.trim() : "");
    const sections = [...document.querySelectorAll("section.cad")].map((sec, i) => {
      const badge = text(sec.querySelector(".badge"));
      const title = text(sec.querySelector(".cad-title, .section-title"));
      const purpose = text(sec.querySelector(".purpose"));
      const period = text(sec.querySelector(".period"));
      const rows = [...sec.querySelectorAll(".row")].slice(0, 8).map((row) => ({
        k: text(row.querySelector(".k")) || "•",
        text: text(row.querySelector("div:last-child")) || text(row)
      }));
      const auditRows = [...sec.querySelectorAll(".arow")].map((row) => ({
        axis: text(row.querySelector(".axis")),
        text: text(row.querySelector("div")),
        reactClass: row.querySelector(".react")?.className || "",
        react: text(row.querySelector(".react"))
      }));
      return { i, badge, title, purpose, period, rows, auditRows };
    });
    const ideas = [...document.querySelectorAll("details.idea")].map((idea, i) => ({
      title: text(idea.querySelector(".ttl")) || `Идея ${i + 1}`,
      why: text(idea.querySelector(".why")),
      tag: text(idea.querySelector(".pill")),
      copy: htmlText(idea.querySelector("pre"))
    }));
    const sources = [...document.querySelectorAll("a.src[href]")].map((a) => ({
      label: text(a) || a.href,
      href: a.href
    }));
    const uniqueSources = [];
    const seen = new Set();
    for (const src of sources) {
      if (!seen.has(src.href)) {
        seen.add(src.href);
        uniqueSources.push(src);
      }
    }
    const title = document.title || text(document.querySelector("h1, .lead, .cad-title")) || "Ясновидец";
    const periods = [...document.querySelectorAll(".period")].map((x) => text(x));
    return { title, sections, ideas, sources: uniqueSources, periods };
  });
}

function sourceCards(sources) {
  if (!sources.length) return '<p class="footnote">Источники в исходном HTML не размечены классом <b>src</b>.</p>';
  return sources.map((src, i) =>
    `<a class="source-card" href="${esc(src.href)}"><b>${i + 1}.</b> ${esc(src.label)}<br><span>${esc(src.href)}</span></a>`
  ).join("\n");
}

function sectionBody(sec) {
  if (sec.auditRows.length) {
    return sec.auditRows.map((r) => {
      const cls = r.reactClass.includes("ok") ? "ok" : r.reactClass.includes("miss") ? "miss" : "part";
      const react = r.react || (cls === "ok" ? "✅ среагировали" : cls === "miss" ? "❌ проспали" : "⚠️ частично");
      return `<div class="audit-row"><div class="axis">${esc(r.axis)}</div><div>${esc(r.text)} <span class="react ${cls}">${esc(react)}</span></div></div>`;
    }).join("\n");
  }
  if (sec.rows.length) {
    return sec.rows.map((r) => `<div class="row"><div class="k">${esc(r.k)}</div><div>${esc(r.text)}</div></div>`).join("\n");
  }
  return `<p>${esc(sec.purpose || sec.title || "Раздел выпуска")}</p>`;
}

function buildPdfHtml(data, htmlFile, cssText, qrSrc) {
  const htmlUrl = htmlTargetUrl(htmlFile);
  const periodMain = data.periods.find((p) => p.includes("собрано")) || data.periods[0] || "📅 собрано: период не указан";
  const periodAudit = data.periods.find((p) => p.includes("аудит")) || "📅 аудит за: см. журнал";
  const toc = [
    ["scan", "Быстрый скан за 30 секунд"],
    ["actions", "Что сделать команде"],
    ...data.sections.map((sec, i) => [`sec-${i}`, sec.title || sec.badge || `Раздел ${i + 1}`]),
    ...(data.ideas.length ? [["ideas", "Идеи и полуфабрикаты"]] : []),
    ["sources", "Источники"]
  ];
  const scanCards = data.sections.slice(0, 4).map((sec, i) => {
    const first = sec.rows[0]?.text || sec.purpose || sec.title;
    return `<div class="scan-card"><div class="n">0${i + 1}</div>${esc(first)}</div>`;
  }).join("\n");
  const actionCards = (data.ideas.length ? data.ideas.slice(0, 4) : data.sections.slice(0, 4).map((s) => ({
    tag: s.badge,
    title: s.title,
    why: s.purpose
  }))).map((item, i) =>
    `<div class="action-card"><div class="tag">${esc(item.tag || `шаг ${i + 1}`)}</div><b>${esc(item.title)}</b><br>${esc(item.why || "Первый шаг — назначить владельца и метрику.")}</div>`
  ).join("\n");
  const ideas = data.ideas.map((idea, i) =>
    `<article class="idea-card">
      <div class="idea-meta">${esc(idea.tag || "идея")}</div>
      <h3 class="idea-title">${esc(idea.title)}</h3>
      <p>${esc(idea.why)}</p>
      ${idea.copy ? `<div class="copy-block">${esc(idea.copy)}</div>` : ""}
    </article>`
  ).join("\n");
  const sections = data.sections.map((sec, i) => `
    <section class="section" id="sec-${i}">
      <div class="section-head">
        <span class="badge ${sec.auditRows.length ? "audit" : ""}">${esc(sec.badge || "раздел")}</span>
        <div class="section-title">${esc(sec.title || `Раздел ${i + 1}`)}</div>
      </div>
      ${sec.purpose ? `<p class="purpose">${esc(sec.purpose)}</p>` : ""}
      ${sec.period ? `<div class="period">${esc(sec.period)}</div>` : ""}
      <div class="section-card">${sectionBody(sec)}</div>
    </section>
  `).join("\n");

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <title>${esc(data.title)} · PDF</title>
  <style>${cssText}</style>
</head>
<body>
  <section class="page cover">
    <div class="brand">Ясновидец<span>.</span></div>
    <div class="kicker">PDF-мини-журнал</div>
    <h1>${esc(data.title)}</h1>
    <p class="dek">Печатная версия: меньше интерфейса, больше смысла. Скан, действия, идеи, аудит и источники — в одном A4-документе.</p>
    <div class="period">${esc(periodMain)}</div>
    <div class="cover-grid">
      <p class="concept">Концепт внутреннего медиа маркетинг-команды Ясно. HTML-версия остаётся основной интерактивной версией выпуска.</p>
      <div class="qr-box">
        <img alt="QR на HTML-версию" src="${qrSrc}">
        <div class="qr-label">HTML-версия<br>${esc(htmlUrl)}</div>
      </div>
    </div>
  </section>

  <section class="page toc">
    <h2>Оглавление</h2>
    <div class="toc-list">
      ${toc.map(([id, label], i) => `<a class="toc-row" href="#${id}"><b>${i + 1}</b><span>${esc(label)}</span></a>`).join("\n")}
    </div>
    <div id="scan" class="section">
      <div class="section-head"><span class="badge">скан</span><div class="section-title">Быстрый скан за 30 секунд</div></div>
      <div class="scan-grid">${scanCards || '<div class="scan-card">Скан появится после разметки разделов выпуска.</div>'}</div>
    </div>
    <div id="actions" class="section">
      <div class="section-head"><span class="badge">действия</span><div class="section-title">Что сделать команде</div></div>
      <div class="action-grid">${actionCards}</div>
    </div>
  </section>

  <section class="page">
    ${sections}
  </section>

  ${data.ideas.length ? `<section class="page" id="ideas"><h2>Идеи</h2><div class="ideas">${ideas}</div></section>` : ""}

  <section class="page" id="sources">
    <h2>Источники</h2>
    <div class="period">${esc(periodAudit)}</div>
    <div class="sources">${sourceCards(data.sources)}</div>
    <p class="footnote">PDF собран автоматически через Playwright Chromium. Если PDF не собрался, выпуск всё равно может быть опубликован: HTML остаётся источником правды.</p>
  </section>
</body>
</html>`;
}

function updateIndex(rendered) {
  const indexPath = path.join(ROOT, "docs", "index.html");
  if (!fs.existsSync(indexPath)) return;
  let html = fs.readFileSync(indexPath, "utf8");
  if (!html.includes(".pdf-link")) {
    html = html.replace(
      "a.issue:hover{border-color:var(--blue);transform:translateY(-1px)}",
      "a.issue:hover{border-color:var(--blue);transform:translateY(-1px)}\n.pdf-link{display:inline-flex;margin:-6px 0 16px 18px;font-size:13px;font-weight:800;color:var(--blue-dark);text-decoration:none;border-bottom:1px solid var(--line)}"
    );
  }
  for (const { htmlFile, pdfFile } of rendered) {
    const htmlRel = relToRoot(htmlFile).replace(/^docs\//, "");
    const pdfRel = relToRoot(pdfFile).replace(/^docs\//, "");
    const marker = `href="${htmlRel}"`;
    const pdfLink = `<a class="pdf-link" href="${pdfRel}">PDF-версия →</a>`;
    if (!html.includes(marker) || html.includes(`href="${pdfRel}"`)) continue;
    const anchorStart = html.indexOf(marker);
    const close = html.indexOf("</a>", anchorStart);
    if (close !== -1) {
      html = html.slice(0, close + 4) + "\n" + pdfLink + html.slice(close + 4);
    }
  }
  fs.writeFileSync(indexPath, html, "utf8");
}

async function main() {
  const args = process.argv.slice(2);
  const update = args.includes("--update-index");
  const debugHtml = args.includes("--debug-html");
  const targets = discoverTargets(args).filter((x) => fs.existsSync(x));
  ensureDir(PDF_DIR);
  const cssText = fs.readFileSync(PDF_CSS, "utf8");
  const { chromium } = requirePlaywright();
  const browser = await chromium.launch();
  const rendered = [];
  try {
    for (const htmlFile of targets) {
      const page = await browser.newPage({ viewport: { width: 1240, height: 1754 }, deviceScaleFactor: 1 });
      const data = await extractPage(page, htmlFile);
      const pdfHtml = buildPdfHtml(data, htmlFile, cssText, await fetchQrDataUri(htmlTargetUrl(htmlFile)));
      if (debugHtml) {
        const debugDir = path.join(ROOT, ".out", "pdf-preview");
        ensureDir(debugDir);
        fs.writeFileSync(path.join(debugDir, slugFor(htmlFile) + ".html"), pdfHtml, "utf8");
      }
      await page.setContent(pdfHtml, { waitUntil: "load" });
      await page.emulateMedia({ media: "print" });
      const pdfFile = outputFor(htmlFile);
      ensureDir(path.dirname(pdfFile));
      await page.pdf({
        path: pdfFile,
        format: "A4",
        printBackground: true,
        preferCSSPageSize: true,
        displayHeaderFooter: false
      });
      await page.close();
      rendered.push({ htmlFile, pdfFile });
      console.log(`pdf: ${relToRoot(pdfFile)}`);
    }
  } finally {
    await browser.close();
  }
  if (update) updateIndex(rendered);
}

main().catch((err) => {
  console.error("PDF_RENDER_FAILED:", err.message);
  process.exit(1);
});
