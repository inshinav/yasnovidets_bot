#!/usr/bin/env node
/* QA for Yasnovidets PDF layer.
 *
 * It checks:
 * - demo PDFs exist and have a PDF header;
 * - source mobile HTML has no horizontal scroll;
 * - generated PDF preview has cover, TOC, QR, period badges, audit, sources;
 * - print CSS protects cards from mid-page breaks.
 *
 * Run after `node scripts/render_pdf.js --samples --debug-html --update-index`.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DEMOS = [
  "day-pulse",
  "week-svodka",
  "month-obzor",
  "quarter-stratsrez",
  "half-razvorot",
  "year-wrapped"
];

function requirePlaywright() {
  try {
    return require("playwright");
  } catch (_) {
    return require(path.join(ROOT, ".out", "pw", "node_modules", "playwright"));
  }
}

function fileUrl(file) {
  return "file:///" + path.resolve(file).replace(/\\/g, "/");
}

function assert(condition, message, failures) {
  if (!condition) failures.push(message);
}

async function main() {
  const failures = [];
  const css = fs.readFileSync(path.join(ROOT, "docs", "pdf", "pdf.css"), "utf8");
  assert(css.includes("break-inside: avoid"), "PDF CSS must keep cards from splitting with break-inside: avoid", failures);
  assert(css.includes("@page") && css.includes("size: A4"), "PDF CSS must define A4 @page", failures);

  for (const slug of DEMOS) {
    const pdf = path.join(ROOT, "docs", "pdf", "samples", slug + ".pdf");
    assert(fs.existsSync(pdf), `${slug}: PDF is missing`, failures);
    if (fs.existsSync(pdf)) {
      const magic = fs.readFileSync(pdf).subarray(0, 5).toString("ascii");
      assert(magic === "%PDF-", `${slug}: PDF does not open as a PDF header`, failures);
      assert(fs.statSync(pdf).size > 50000, `${slug}: PDF looks suspiciously small`, failures);
    }
  }

  const { chromium } = requirePlaywright();
  const browser = await chromium.launch();
  try {
    for (const slug of DEMOS) {
      const source = path.join(ROOT, "docs", "samples", slug + ".html");
      const preview = path.join(ROOT, ".out", "pdf-preview", slug + ".html");
      assert(fs.existsSync(preview), `${slug}: debug PDF preview is missing`, failures);

      const mobile = await browser.newPage({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true
      });
      await mobile.goto(fileUrl(source), { waitUntil: "load" });
      const mobileMetrics = await mobile.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        clipped: [...document.querySelectorAll(".card *")].filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.right > document.documentElement.clientWidth + 2 && !el.closest(".tblwrap");
        }).length
      }));
      assert(mobileMetrics.scrollWidth <= mobileMetrics.clientWidth + 1, `${slug}: mobile HTML has horizontal scroll`, failures);
      assert(mobileMetrics.clipped === 0, `${slug}: mobile HTML has clipped non-table elements`, failures);
      await mobile.close();

      if (fs.existsSync(preview)) {
        const page = await browser.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 1 });
        await page.goto(fileUrl(preview), { waitUntil: "load" });
        const report = await page.evaluate(() => {
          const txt = (selector) => document.querySelector(selector)?.innerText || "";
          const periods = [...document.querySelectorAll(".period")].map((x) => x.innerText);
          return {
            cover: !!document.querySelector(".cover"),
            tocLinks: [...document.querySelectorAll(".toc-row[href^='#']")].length,
            qr: !!document.querySelector(".qr-box img[src]"),
            hasScan: txt("#scan").includes("30"),
            hasActions: txt("#actions").length > 0,
            periodMain: periods.some((p) => p.includes("собрано")),
            periodAudit: periods.some((p) => p.includes("аудит")),
            audit: !!document.querySelector(".badge.audit") || document.body.innerText.includes("Аудит"),
            sources: document.querySelectorAll(".source-card[href]").length,
            clickableSources: [...document.querySelectorAll(".source-card[href]")].every((a) => a.href),
            clipped: [...document.querySelectorAll(".section-card *, .source-card *")].filter((el) => {
              const r = el.getBoundingClientRect();
              return r.width > 0 && r.right > document.documentElement.clientWidth + 2;
            }).length
          };
        });
        assert(report.cover, `${slug}: PDF preview has no cover`, failures);
        assert(report.tocLinks >= 4, `${slug}: PDF preview has no clickable TOC`, failures);
        assert(report.qr, `${slug}: PDF preview has no QR`, failures);
        assert(report.hasScan, `${slug}: PDF preview has no 30-second scan`, failures);
        assert(report.hasActions, `${slug}: PDF preview has no team actions block`, failures);
        assert(report.periodMain, `${slug}: PDF preview has no collected period badge`, failures);
        assert(report.periodAudit, `${slug}: PDF preview has no audit period badge`, failures);
        assert(report.audit, `${slug}: PDF preview has no audit section`, failures);
        assert(report.sources >= 1, `${slug}: PDF preview has no sources`, failures);
        assert(report.clickableSources, `${slug}: PDF preview sources are not clickable`, failures);
        assert(report.clipped === 0, `${slug}: PDF preview has clipped content`, failures);
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }

  if (failures.length) {
    console.error(JSON.stringify({ ok: false, failures }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, checked: DEMOS.length, demos: DEMOS }, null, 2));
}

main().catch((err) => {
  console.error("PDF_QA_FAILED:", err.message);
  process.exit(1);
});
