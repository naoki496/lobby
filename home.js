/* home.js (HK LOBBY) — FINAL (syntax-safe)
 * - STATUS BAR: localStorage key = "hklobby.v1.cardCounts"
 * - MISSION BRIEF: ./whatsnew.json (404/invalid safe)
 * - No cards-manifest.json in lobby (do not fetch)
 *
 * Place: /lobby/home.js
 * index.html must have:
 *   <section id="statusBar" ...></section>
 *   <section id="missionBrief" ...></section>
 * and:
 *   <script src="./home.js" defer></script>
 */

(() => {
  "use strict";

  // -------------------------
  // Guard (avoid double init)
  // -------------------------
  if (window.__HK_LOBBY_HOMEJS_LOADED__) return;
  window.__HK_LOBBY_HOMEJS_LOADED__ = true;

  // =========================
  // CONFIG
  // =========================
  const KEY_CARD_COUNTS = "hklobby.v1.cardCounts";
  const WHATSNEW_URL = "./whatsnew.json";

  const RANK_TABLE = [
    { name: "見習い", min: 0 },
    { name: "一人前", min: 10 },
    { name: "職人", min: 30 },
    { name: "達人", min: 60 },
    { name: "神", min: 100 },
  ];

  // =========================
  // DOM IDs
  // =========================
  const IDS = {
    statusBar: "statusBar",
    missionBrief: "missionBrief",

    // injected into status bar
    rank: "statusRank",
    owned: "statusOwned",
    hint: "statusHint",
    detail: "statusDetail",
    reload: "statusReload",
  };

  const el = (id) => document.getElementById(id);

  // =========================
  // Utils
  // =========================
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

  function readJsonFromLocalStorage(key) {
    if (!storageAvailable()) return null;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    try {
      const obj = JSON.parse(raw);
      return obj && typeof obj === "object" ? obj : null;
    } catch {
      return null;
    }
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function writeText(id, text) {
    const node = el(id);
    if (node) node.textContent = text;
  }

  function writeHtml(id, html) {
    const node = el(id);
    if (node) node.innerHTML = html;
  }

  function calcRank(ownedTypes) {
    let cur = RANK_TABLE[0].name;
    for (const row of RANK_TABLE) {
      if (ownedTypes >= row.min) cur = row.name;
    }
    return cur;
  }

  function summarizeCounts(countsObj) {
    const sanitized = {};
    let ownedTypes = 0;
    let ownedTotal = 0;

    for (const [id, rawN] of Object.entries(countsObj || {})) {
      const n = Number(rawN);
      if (!Number.isFinite(n) || n <= 0) continue;
      const k = String(id).trim();
      if (!k) continue;
      const v = Math.floor(n);
      sanitized[k] = v;
      ownedTypes += 1;
      ownedTotal += v;
    }

    return { sanitized, ownedTypes, ownedTotal };
  }

  function topEntries(sanitized, n = 8) {
    return Object.entries(sanitized || {})
      .sort((a, b) => Number(b[1]) - Number(a[1]))
      .slice(0, n);
  }

  // =========================
  // STATUS BAR (inject markup)
  // =========================
  function ensureStatusBarMarkup() {
    const bar = el(IDS.statusBar);
    if (!bar) return null;

    // If already injected (e.g., reload), keep it
    if (bar.querySelector(`#${IDS.rank}`) && bar.querySelector(`#${IDS.reload}`)) return bar;

    bar.innerHTML = `
      <div class="sb-inner">
        <div class="sb-left">
          <div class="sb-title">STATUS</div>
          <div class="sb-kpis">
            <div class="sb-kpi">
              <div class="sb-kpi-label">RANK</div>
              <div id="${IDS.rank}" class="sb-kpi-value">--</div>
            </div>
            <div class="sb-kpi">
              <div class="sb-kpi-label">CARDS</div>
              <div id="${IDS.owned}" class="sb-kpi-value">--</div>
            </div>
          </div>
          <div id="${IDS.hint}" class="sb-hint"></div>
        </div>
        <div class="sb-right">
          <button id="${IDS.reload}" class="sb-btn" type="button" aria-label="再読み込み">↻</button>
        </div>
      </div>
      <div id="${IDS.detail}" class="sb-detail" aria-live="polite"></div>
    `;

    return bar;
  }

  function renderStatusFromLocalStorage() {
    const bar = ensureStatusBarMarkup();
    if (!bar) return;

    if (!storageAvailable()) {
      writeText(IDS.rank, "--");
      writeText(IDS.owned, "--");
      writeText(IDS.hint, "この環境では保存領域にアクセスできません（プライベート設定等）。");
      writeHtml(IDS.detail, `<div class="sb-detail-empty">所持データなし</div>`);
      return;
    }

    const counts = readJsonFromLocalStorage(KEY_CARD_COUNTS) || {};
    const { sanitized, ownedTypes, ownedTotal } = summarizeCounts(counts);

    const rank = calcRank(ownedTypes);
    writeText(IDS.rank, rank);
    writeText(IDS.owned, `${ownedTypes}種 / ${ownedTotal}枚`);

    if (!Object.keys(sanitized).length) {
      writeText(IDS.hint, "まだカードデータがありません。クイズでカードを獲得すると反映されます。");
      writeHtml(IDS.detail, `<div class="sb-detail-empty">所持データなし</div>`);
      return;
    }

    writeText(IDS.hint, "同一端末の学習データを表示中（共通キー）。");

    const chips = topEntries(sanitized, 8)
      .map(([id, n]) => `<span class="sb-chip">#${escapeHtml(id)} ×${escapeHtml(n)}</span>`)
      .join("");

    writeHtml(
      IDS.detail,
      `
        <div class="sb-detail-head">TOP所持</div>
        <div class="sb-chips">${chips}</div>
        <div class="sb-detail-foot">※カード名は図鑑側で解決（ここではIDのみ表示）</div>
      `
    );
  }

  // =========================
  // MISSION BRIEF
  // =========================
  function ensureMissionBriefMarkup() {
    const box = el(IDS.missionBrief);
    if (!box) return null;

    // Always normalize markup (replace placeholder safely)
    box.innerHTML = `
      <div class="wn-head">
        <div class="wn-title">MISSION BRIEF</div>
        <div class="wn-sub">WHAT'S NEW</div>
      </div>
      <div class="wn-body" id="wnBody">
        <div class="wn-item muted">更新情報を読み込み中…</div>
      </div>
    `;
    return box;
  }

  async function loadWhatsNew() {
    const box = ensureMissionBriefMarkup();
    if (!box) return;

    const body = box.querySelector("#wnBody");
    if (!body) return;

    try {
      const res = await fetch(WHATSNEW_URL, { cache: "no-store" });
      if (!res.ok) {
        body.innerHTML = `<div class="wn-item muted">更新情報はまだありません。</div>`;
        return;
      }

      const json = await res.json();
      const items = Array.isArray(json.items) ? json.items : [];

      if (!items.length) {
        body.innerHTML = `<div class="wn-item muted">更新情報はまだありません。</div>`;
        return;
      }

      body.innerHTML = items.slice(0, 6).map((it) => {
        const date = escapeHtml(it.date ?? "");
        const title = escapeHtml(it.title ?? "");
        const txt = escapeHtml(it.body ?? "");
        return `
          <div class="wn-item">
            <div class="wn-date">${date}</div>
            <div class="wn-ttl">${title}</div>
            <div class="wn-txt">${txt}</div>
          </div>
        `;
      }).join("");

    } catch (e) {
      console.warn("[home.js] whatsnew fallback:", e);
      body.innerHTML = `<div class="wn-item muted">更新情報を取得できません</div>`;
    }
  }

  // =========================
  // Events
  // =========================
  function bindEventsOnce() {
    const bar = el(IDS.statusBar);
    if (!bar) return;

    // prevent duplicate binds
    if (bar.__hkBound) return;
    bar.__hkBound = true;

    bar.addEventListener("click", async (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.id === IDS.reload) {
        renderStatusFromLocalStorage();
        await loadWhatsNew();
      }
    });

    window.addEventListener("storage", (e) => {
      if (e && e.key === KEY_CARD_COUNTS) renderStatusFromLocalStorage();
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") renderStatusFromLocalStorage();
    });
  }

  // =========================
  // Boot
  // =========================
  async function boot() {
    renderStatusFromLocalStorage();
    await loadWhatsNew();
    bindEventsOnce();
  }

  document.addEventListener("DOMContentLoaded", () => {
    boot().catch((e) => console.error("[home.js] boot failed:", e));
  });
})();
