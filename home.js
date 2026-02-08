/* home.js — kokugo-dojo portal (STATUS BAR + MISSION BRIEF)
   - Reads localStorage: hklobby.v1.cardCounts (read-only)
   - Fetches cards-hub cards-manifest.json + source CSVs to compute totals
   - Fetches ./whatsnew.json (optional) for mission brief
   - Safe-by-default: if anything fails, UI shows "--" and does not break the page
*/

(() => {
  "use strict";

  // =========================
  // Config
  // =========================
  const CFG = {
    STORAGE_KEY_COUNTS: "hklobby.v1.cardCounts",

    // cards-hub
    CARDS_HUB_BASE: "https://naoki496.github.io/cards-hub/",
    CARDS_MANIFEST_URL: "https://naoki496.github.io/cards-hub/cards-manifest.json",

    // kokugo-dojo (this repo)
    WHATSNEW_URL: "./whatsnew.json",

    // DOM ids (if missing, will be created)
    STATUS_CONTAINER_ID: "statusBar",
    MISSION_CONTAINER_ID: "missionBrief",

    // caching (session only)
    SESSION_CACHE_KEY: "hk.portal.cache.v1",

    FETCH_TIMEOUT_MS: 7000,
    MAX_WHATSNEW_ITEMS: 6,
  };

  // =========================
  // Tiny helpers
  // =========================
  const $ = (sel, root = document) => root.querySelector(sel);

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function fmtPct(num) {
    if (!Number.isFinite(num)) return "--";
    return `${Math.round(num)}%`;
  }

  function fmtCount(a, b) {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return `-- / --`;
    return `${a} / ${b}`;
  }

  async function fetchWithTimeout(url, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
      return res;
    } finally {
      clearTimeout(t);
    }
  }

  async function fetchJson(url) {
    const res = await fetchWithTimeout(url, CFG.FETCH_TIMEOUT_MS);
    if (!res.ok) throw new Error(`fetch failed: ${res.status} ${url}`);
    return await res.json();
  }

  async function fetchText(url) {
    const res = await fetchWithTimeout(url, CFG.FETCH_TIMEOUT_MS);
    if (!res.ok) throw new Error(`fetch failed: ${res.status} ${url}`);
    return await res.text();
  }

  function toAbsUrlMaybe(url) {
    try {
      // absolute
      return new URL(url).toString();
    } catch {
      // relative to cards-hub
      try {
        return new URL(url, CFG.CARDS_HUB_BASE).toString();
      } catch {
        return String(url);
      }
    }
  }

  function safeJsonParse(raw, fallback) {
    try {
      const obj = JSON.parse(raw);
      return obj ?? fallback;
    } catch {
      return fallback;
    }
  }

  // Basic CSV parser (enough for your manifests: no heavy quoting required)
  function parseCsv(text) {
    const lines = String(text)
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n")
      .filter((l) => l.trim().length > 0);

    if (!lines.length) return [];

    const header = lines[0].split(",").map((h) => h.trim());
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(","); // simple split (cards.csv is simple)
      const row = {};
      for (let c = 0; c < header.length; c++) {
        row[header[c]] = (cols[c] ?? "").trim();
      }
      rows.push(row);
    }
    return rows;
  }

  function loadCounts() {
    try {
      const raw = localStorage.getItem(CFG.STORAGE_KEY_COUNTS);
      if (!raw) return {};
      const obj = JSON.parse(raw);
      return obj && typeof obj === "object" ? obj : {};
    } catch {
      return {};
    }
  }

  // =========================
  // DOM: ensure containers
  // =========================
  function ensureContainers() {
    let status = document.getElementById(CFG.STATUS_CONTAINER_ID);
    let mission = document.getElementById(CFG.MISSION_CONTAINER_ID);

    // If missing, create minimal sections near top of body
    if (!status) {
      status = document.createElement("section");
      status.id = CFG.STATUS_CONTAINER_ID;
      status.style.margin = "14px 0";
      status.style.padding = "0 0";
    }
    if (!mission) {
      mission = document.createElement("section");
      mission.id = CFG.MISSION_CONTAINER_ID;
      mission.style.margin = "14px 0";
      mission.style.padding = "0 0";
    }

    // Insert order: status -> mission, placed after first major block (best effort)
    const anchor =
      document.querySelector("main") ||
      document.querySelector(".container") ||
      document.body;

    // If they already exist somewhere else, do not move them.
    if (!document.getElementById(CFG.STATUS_CONTAINER_ID)) anchor.prepend(status);
    if (!document.getElementById(CFG.MISSION_CONTAINER_ID)) anchor.insertBefore(mission, status.nextSibling);

    return { statusEl: status, missionEl: mission };
  }

  // =========================
  // cards-hub totals: categorize by source
  // =========================
  function classifySourceKey(meta) {
    const hay = `${meta?.id ?? ""} ${meta?.key ?? ""} ${meta?.title ?? ""} ${meta?.name ?? ""} ${meta?.csv ?? ""}`.toLowerCase();
    if (hay.includes("kobun")) return "kobun";
    if (hay.includes("bungakusi") || hay.includes("bungaku")) return "bungakusi";
    return "other";
  }

  function getManifestSources(manifest) {
    // Try several shapes safely
    if (Array.isArray(manifest?.sources)) return manifest.sources;
    if (Array.isArray(manifest?.datasets)) return manifest.datasets;
    if (Array.isArray(manifest?.items)) return manifest.items;

    // Single flat fields fallback (rare)
    const maybe = [];
    for (const k of Object.keys(manifest || {})) {
      const v = manifest[k];
      if (v && typeof v === "object" && (v.csv || v.url)) maybe.push({ id: k, ...v });
    }
    return maybe;
  }

  async function computeTotalsFromCardsHub() {
    // session cache
    const cached = safeJsonParse(sessionStorage.getItem(CFG.SESSION_CACHE_KEY), null);
    if (cached?.totals && cached?.at && Date.now() - cached.at < 5 * 60 * 1000) {
      return cached.totals;
    }

    const manifest = await fetchJson(CFG.CARDS_MANIFEST_URL);
    const sources = getManifestSources(manifest);

    // If manifest has explicit csv list, use it. Otherwise fall back to common names.
    const csvTargets = [];

    for (const s of sources) {
      const csv = s.csv || s.url || s.path;
      if (!csv) continue;
      csvTargets.push({
        sourceKey: classifySourceKey(s),
        csvUrl: toAbsUrlMaybe(csv),
        meta: s,
      });
    }

    // Fallback if nothing found
    if (!csvTargets.length) {
      // You can add more defaults here if needed
      throw new Error("cards-manifest.json: sources/csv not found");
    }

    const idSets = {
      kobun: new Set(),
      bungakusi: new Set(),
      other: new Set(),
    };

    // Load each CSV (cards.csv-like), collect ids
    await Promise.all(
      csvTargets.map(async (t) => {
        try {
          const txt = await fetchText(t.csvUrl);
          const rows = parseCsv(txt);
          for (const r of rows) {
            const id = String(r.id ?? "").trim();
            if (!id) continue;
            (idSets[t.sourceKey] ?? idSets.other).add(id);
          }
        } catch (e) {
          console.warn("[home.js] CSV load failed:", t.csvUrl, e);
        }
      })
    );

    const totals = {
      kobun: idSets.kobun.size,
      bungakusi: idSets.bungakusi.size,
      other: idSets.other.size,
      all: idSets.kobun.size + idSets.bungakusi.size + idSets.other.size,
      // Keep id sets for owned split
      _sets: {
        kobun: Array.from(idSets.kobun),
        bungakusi: Array.from(idSets.bungakusi),
        other: Array.from(idSets.other),
      },
    };

    sessionStorage.setItem(CFG.SESSION_CACHE_KEY, JSON.stringify({ totals, at: Date.now() }));
    return totals;
  }

  function computeOwned(countsObj, totals) {
    const counts = countsObj || {};
    const ownedAll = Object.keys(counts).filter((k) => (counts[k] ?? 0) > 0).length;

    // If totals includes sets, split precisely
    const setK = new Set(totals?._sets?.kobun || []);
    const setB = new Set(totals?._sets?.bungakusi || []);
    const setO = new Set(totals?._sets?.other || []);

    let ownedK = 0, ownedB = 0, ownedO = 0;

    for (const [id, n] of Object.entries(counts)) {
      if (!(Number(n) > 0)) continue;
      if (setK.has(id)) ownedK++;
      else if (setB.has(id)) ownedB++;
      else if (setO.has(id)) ownedO++;
      else {
        // Unknown id: treat as "other" but do not inflate totals
        ownedO++;
      }
    }

    return {
      kobun: ownedK,
      bungakusi: ownedB,
      other: ownedO,
      all: ownedAll,
    };
  }

  // =========================
  // Render
  // =========================
  function renderStatus(statusEl, { owned, totals }) {
    // percent (avoid div0)
    const pctK = totals.kobun ? (owned.kobun / totals.kobun) * 100 : NaN;
    const pctB = totals.bungakusi ? (owned.bungakusi / totals.bungakusi) * 100 : NaN;
    const pctA = totals.all ? (owned.all / totals.all) * 100 : NaN;

    // Minimal HTML; styling will be handled by your existing CSS later
    statusEl.innerHTML = `
      <div class="hk-status">
        <div class="hk-status-head">
          <div class="hk-status-title">STATUS</div>
          <div class="hk-status-sub">端末内の進捗（localStorage）</div>
        </div>

        <div class="hk-kpis">
          <div class="hk-kpi">
            <div class="hk-kpi-label">古文</div>
            <div class="hk-kpi-value">${esc(fmtCount(owned.kobun, totals.kobun))}</div>
            <div class="hk-kpi-note">${esc(fmtPct(pctK))}</div>
          </div>

          <div class="hk-kpi">
            <div class="hk-kpi-label">文学史</div>
            <div class="hk-kpi-value">${esc(fmtCount(owned.bungakusi, totals.bungakusi))}</div>
            <div class="hk-kpi-note">${esc(fmtPct(pctB))}</div>
          </div>

          <div class="hk-kpi hk-kpi-strong">
            <div class="hk-kpi-label">合計</div>
            <div class="hk-kpi-value">${esc(fmtCount(owned.all, totals.all))}</div>
            <div class="hk-kpi-note">${esc(fmtPct(pctA))}</div>
          </div>
        </div>

        <div class="hk-status-actions">
          <a class="hk-btn" href="https://naoki496.github.io/kobun-quiz/">BLITZ QUEST：古文</a>
          <a class="hk-btn" href="https://naoki496.github.io/bungakusi-quiz/">BLITZ QUEST：文学史</a>
          <a class="hk-btn" href="https://naoki496.github.io/cards-hub/">カード図鑑</a>
        </div>
      </div>
    `;
  }

  function renderMission(missionEl, items) {
    const list = (items || []).slice(0, CFG.MAX_WHATSNEW_ITEMS);
    const body = list.length
      ? list
          .map((x) => {
            const date = x.date ? `<div class="hk-m-date">${esc(x.date)}</div>` : "";
            const title = x.title ? `<div class="hk-m-title">${esc(x.title)}</div>` : `<div class="hk-m-title">UPDATE</div>`;
            const text = x.body ? `<div class="hk-m-body">${esc(x.body)}</div>` : "";
            const link = x.href ? `<a class="hk-m-link" href="${esc(x.href)}">OPEN</a>` : "";
            return `<div class="hk-m-item">${date}${title}${text}${link}</div>`;
          })
          .join("")
      : `<div class="hk-m-empty">更新情報はまだありません。</div>`;

    missionEl.innerHTML = `
      <div class="hk-mission">
        <div class="hk-mission-head">
          <div class="hk-mission-title">MISSION BRIEF</div>
          <div class="hk-mission-sub">What’s New</div>
        </div>
        <div class="hk-m-list">${body}</div>
      </div>
    `;
  }

  function renderFallback(statusEl, missionEl, err) {
    console.warn("[home.js] fallback:", err);

    statusEl.innerHTML = `
      <div class="hk-status">
        <div class="hk-status-head">
          <div class="hk-status-title">STATUS</div>
          <div class="hk-status-sub">読み込み失敗（-- 表示）</div>
        </div>
        <div class="hk-kpis">
          <div class="hk-kpi"><div class="hk-kpi-label">古文</div><div class="hk-kpi-value">-- / --</div><div class="hk-kpi-note">--</div></div>
          <div class="hk-kpi"><div class="hk-kpi-label">文学史</div><div class="hk-kpi-value">-- / --</div><div class="hk-kpi-note">--</div></div>
          <div class="hk-kpi hk-kpi-strong"><div class="hk-kpi-label">合計</div><div class="hk-kpi-value">-- / --</div><div class="hk-kpi-note">--</div></div>
        </div>
        <div class="hk-status-actions">
          <a class="hk-btn" href="https://naoki496.github.io/kobun-quiz/">BLITZ QUEST：古文</a>
          <a class="hk-btn" href="https://naoki496.github.io/bungakusi-quiz/">BLITZ QUEST：文学史</a>
          <a class="hk-btn" href="https://naoki496.github.io/cards-hub/">カード図鑑</a>
        </div>
      </div>
    `;

    missionEl.innerHTML = `
      <div class="hk-mission">
        <div class="hk-mission-head">
          <div class="hk-mission-title">MISSION BRIEF</div>
          <div class="hk-mission-sub">What’s New</div>
        </div>
        <div class="hk-m-list">
          <div class="hk-m-empty">whatsnew.json が未配置、または読み込みに失敗しました。</div>
        </div>
      </div>
    `;
  }

  // =========================
  // Boot
  // =========================
  async function boot() {
    const { statusEl, missionEl } = ensureContainers();

    // First render mission (non-blocking)
    (async () => {
      try {
        const data = await fetchJson(CFG.WHATSNEW_URL);
        if (Array.isArray(data)) renderMission(missionEl, data);
        else if (Array.isArray(data?.items)) renderMission(missionEl, data.items);
        else renderMission(missionEl, []);
      } catch (e) {
        // mission is optional; show empty quietly
        renderMission(missionEl, []);
      }
    })();

    // Then render status (data-linked)
    try {
      const countsObj = loadCounts();
      const totals = await computeTotalsFromCardsHub();
      const owned = computeOwned(countsObj, totals);
      renderStatus(statusEl, { owned, totals });
    } catch (e) {
      renderFallback(statusEl, missionEl, e);
    }
  }

  // DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
