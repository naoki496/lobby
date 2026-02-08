/* home.js
 * HK LOBBY / kokugo-dojo - STATUS BAR
 * Reads shared localStorage key: "hklobby.v1.cardCounts"
 * and renders summary (rank, owned cards, breakdown) into DOM.
 *
 * Requirement:
 * - Put this file in kokugo-dojo/ (same directory as index.html)
 * - index.html should have containers with IDs used below,
 *   OR this script will auto-inject a minimal status bar.
 */

(() => {
  "use strict";

  // ===== Shared storage key (COMMON) =====
  const KEY_CARD_COUNTS = "hklobby.v1.cardCounts";

  // Optional: if you ever used other keys, list them here for read-only fallback.
  const FALLBACK_KEYS = [
    // "kobunQuiz.v1.cardCounts",
    // "bungakusiQuiz.v1.cardCounts",
  ];

  // ===== Rank model (simple & deterministic) =====
  // You can tweak thresholds without touching any other part.
  const RANK_TABLE = [
    { name: "見習い", min: 0 },
    { name: "一人前", min: 10 },
    { name: "職人",   min: 30 },
    { name: "達人",   min: 60 },
    { name: "神",     min: 100 },
  ];

  // ===== DOM ids (preferred) =====
  // If these don't exist, a bar will be injected at top of <main> or <body>.
  const DOM_IDS = {
    wrap: "statusBar",
    rank: "statusRank",
    owned: "statusOwned",
    detail: "statusDetail",
    hint: "statusHint",
    reload: "statusReload",
  };

  // ===== Storage safe access =====
  function storageAvailable() {
    try {
      const x = "__storage_test__";
      localStorage.setItem(x, x);
      localStorage.removeItem(x);
      return true;
    } catch {
      return false;
    }
  }

  function readRaw(key) {
    if (!storageAvailable()) return null;
    return localStorage.getItem(key);
  }

  function parseCounts(raw) {
    if (!raw) return null;
    try {
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== "object") return null;
      return obj;
    } catch {
      return null;
    }
  }

  function loadCounts() {
    // 1) Prefer common key
    const primary = parseCounts(readRaw(KEY_CARD_COUNTS));
    if (primary) return { counts: primary, sourceKey: KEY_CARD_COUNTS };

    // 2) Fallback keys (read-only)
    for (const k of FALLBACK_KEYS) {
      const c = parseCounts(readRaw(k));
      if (c) return { counts: c, sourceKey: k };
    }

    return { counts: {}, sourceKey: null };
  }

  // ===== Aggregation =====
  function summarize(countsObj) {
    const ids = Object.keys(countsObj || {});
    let ownedTypes = 0;
    let ownedTotal = 0;

    // sanitize: only finite >=1
    const sanitized = {};
    for (const id of ids) {
      const n = Number(countsObj[id]);
      if (!Number.isFinite(n) || n <= 0) continue;
      sanitized[id] = Math.floor(n);
      ownedTypes += 1;
      ownedTotal += Math.floor(n);
    }

    return { ownedTypes, ownedTotal, sanitized };
  }

  function calcRank(ownedTypes) {
    let cur = RANK_TABLE[0].name;
    for (const row of RANK_TABLE) {
      if (ownedTypes >= row.min) cur = row.name;
    }
    return cur;
  }

  // ===== Rendering =====
  function ensureBar() {
    // If the user already has markup, use it.
    const existing = document.getElementById(DOM_IDS.wrap);
    if (existing) return existing;

    // Otherwise inject a minimal bar (non-destructive)
    const bar = document.createElement("section");
    bar.id = DOM_IDS.wrap;
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", "学習ステータス");

    // Minimal structure; styling is expected to be in style.css
    bar.innerHTML = `
      <div class="sb-inner">
        <div class="sb-left">
          <div class="sb-title">STATUS</div>
          <div class="sb-kpis">
            <div class="sb-kpi">
              <div class="sb-kpi-label">RANK</div>
              <div id="${DOM_IDS.rank}" class="sb-kpi-value">--</div>
            </div>
            <div class="sb-kpi">
              <div class="sb-kpi-label">CARDS</div>
              <div id="${DOM_IDS.owned}" class="sb-kpi-value">--</div>
            </div>
          </div>
          <div id="${DOM_IDS.hint}" class="sb-hint"></div>
        </div>
        <div class="sb-right">
          <button id="${DOM_IDS.reload}" class="sb-btn" type="button">↻</button>
        </div>
      </div>
      <div id="${DOM_IDS.detail}" class="sb-detail" aria-live="polite"></div>
    `;

    // Insert near top of main if exists, else body
    const main = document.querySelector("main");
    if (main) main.prepend(bar);
    else document.body.prepend(bar);

    return bar;
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function setHtml(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function render() {
    ensureBar();

    const { counts, sourceKey } = loadCounts();
    const { ownedTypes, ownedTotal, sanitized } = summarize(counts);

    const rank = calcRank(ownedTypes);
    setText(DOM_IDS.rank, rank);
    setText(DOM_IDS.owned, `${ownedTypes}種 / ${ownedTotal}枚`);

    // Hint text
    if (!storageAvailable()) {
      setText(DOM_IDS.hint, "この環境では保存領域にアクセスできません（プライベート設定等）。");
    } else if (!sourceKey) {
      setText(
        DOM_IDS.hint,
        "まだカードデータがありません。kobun-quiz / bungakusi-quiz をプレイすると反映されます。"
      );
    } else if (sourceKey !== KEY_CARD_COUNTS) {
      setText(
        DOM_IDS.hint,
        `注意：旧キー（${sourceKey}）から読んでいます。共通キーへ統一すると安定します。`
      );
    } else {
      setText(DOM_IDS.hint, "同一端末の学習データを表示中（共通キー）。");
    }

    // Detail list (top N by count)
    const entries = Object.entries(sanitized)
      .sort((a, b) => Number(b[1]) - Number(a[1]))
      .slice(0, 8);

    const detailHtml = entries.length
      ? `
        <div class="sb-detail-head">TOP所持</div>
        <div class="sb-chips">
          ${entries
            .map(([id, n]) => `<span class="sb-chip">#${escapeHtml(id)} ×${escapeHtml(n)}</span>`)
            .join("")}
        </div>
        <div class="sb-detail-foot">※カード名は図鑑側で解決（ここではIDのみ表示）</div>
      `
      : `<div class="sb-detail-empty">所持データなし</div>`;

    setHtml(DOM_IDS.detail, detailHtml);
  }

  // ===== Bindings =====
  function bind() {
    // Reload button
    const btn = document.getElementById(DOM_IDS.reload);
    if (btn) {
      btn.addEventListener("click", () => {
        render();
      });
    }

    // Update when storage changes (same-origin only)
    window.addEventListener("storage", (e) => {
      if (!e) return;
      if (e.key === KEY_CARD_COUNTS) render();
    });

    // Update when page becomes visible again
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") render();
    });
  }

  // ===== Boot =====
  document.addEventListener("DOMContentLoaded", () => {
    render();
    bind();
  });
})();
