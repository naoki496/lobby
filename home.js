/* home.js (HK LOBBY)
 * - STATUS BAR (localStorage: hklobby.v1.cardCounts)
 * - Optional: cards-hub totals (manifest + csv) with multi-schema support
 * - Optional: whatsnew.json loader (404 safe)
 *
 * Put this file in /lobby/home.js
 * Ensure index.html loads: <script src="./home.js" defer></script>
 */

(() => {
  "use strict";

  // =========================
  // CONFIG
  // =========================

  // ✅ 共通キー（ここが “唯一の真実”）
  const KEY_CARD_COUNTS = "hklobby.v1.cardCounts";

  // ✅ cards-hub（同一オリジン配下 /cards-hub/ を想定）
  const CARDS_HUB_BASE = "/cards-hub/";
  const CARDS_MANIFEST_PATH = "cards-manifest.json";

  // ✅ whatsnew（/lobby/whatsnew.json）
  const WHATSNEW_URL = "./whatsnew.json";

  // ===== rank thresholds (by owned unique card types) =====
  const RANK_TABLE = [
    { name: "見習い", min: 0 },
    { name: "一人前", min: 10 },
    { name: "職人", min: 30 },
    { name: "達人", min: 60 },
    { name: "神", min: 100 },
  ];

  // =========================
  // DOM (auto-inject)
  // =========================

  const IDS = {
    bar: "statusBar",
    rank: "statusRank",
    owned: "statusOwned",
    hint: "statusHint",
    detail: "statusDetail",
    reload: "statusReload",
    whatsnew: "whatsNewBox",
  };

  function qs(sel) { return document.querySelector(sel); }
  function el(id) { return document.getElementById(id); }

  function ensureStatusBar() {
    const existing = el(IDS.bar);
if (existing) {
  // ✅ 空なら中身を注入して使う（indexに枠があってもOKにする）
  if (!existing.querySelector(".sb-inner")) {
    existing.innerHTML = `
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
  }
  return existing;
}


    const bar = document.createElement("section");
    bar.id = IDS.bar;
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", "学習ステータス");

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

    // Prefer: .hero or main top. Fallback: body top.
    const hero = qs(".hero") || qs("main");
    if (hero) hero.insertAdjacentElement("afterbegin", bar);
    else document.body.insertAdjacentElement("afterbegin", bar);

    return bar;
  }



  // （保険）missionBrief が無い場合だけ自動生成
  const mount = qs("main") || document.body;
  const box = document.createElement("section");
  box.id = IDS.whatsnew;
  box.className = "wn-box";
  box.setAttribute("role", "region");
  box.setAttribute("aria-label", "MISSION BRIEF");
  box.innerHTML = `
    <div class="wn-head">
      <div class="wn-title">MISSION BRIEF</div>
      <div class="wn-sub">WHAT'S NEW</div>
    </div>
    <div class="wn-body" id="wnBody">
      <div class="wn-item muted">更新情報を読み込み中…</div>
    </div>
  `;
  mount.insertAdjacentElement("afterbegin", box);
  return box;
}


  // =========================
  // UTIL
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

  function writeText(id, text) {
    const node = el(id);
    if (node) node.textContent = text;
  }

  function writeHtml(id, html) {
    const node = el(id);
    if (node) node.innerHTML = html;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
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
  // STATUS: localStorage only (source of truth)
  // =========================

  function renderStatusFromLocalStorage() {
  const bar = document.getElementById("statusBar");
  if (!bar) return;

  bar.innerHTML = `
    <div class="sb-inner">
      <div class="sb-left">
        <div class="sb-title">STATUS</div>
        <div class="sb-kpis">
          <div class="sb-kpi">
            <div class="sb-kpi-label">RANK</div>
            <div id="statusRank" class="sb-kpi-value">--</div>
          </div>
          <div class="sb-kpi">
            <div class="sb-kpi-label">CARDS</div>
            <div id="statusOwned" class="sb-kpi-value">--</div>
          </div>
        </div>
        <div id="statusHint" class="sb-hint"></div>
      </div>
      <div class="sb-right">
        <button id="statusReload" class="sb-btn" type="button">↻</button>
      </div>
    </div>
    <div id="statusDetail" class="sb-detail"></div>
  `;

  ...
}



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
  // OPTIONAL: cards-hub totals (manifest + csv)
  // - This does NOT affect STATUS itself.
  // - It is just "nice-to-have" info or diagnostics.
  // =========================

  function pickFirstString(...vals) {
    for (const v of vals) {
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return null;
  }

  // Multi-schema resolver: find "cards csv path" in many possible keys.
  function resolveCardsCsvPath(manifest) {
  const m = manifest || {};

  // ✅ あなたの実物スキーマ：sources は配列、各要素に cardsCsv
  if (Array.isArray(m.sources) && m.sources.length) {
    const urls = m.sources
      .map((s) => (typeof s?.cardsCsv === "string" ? s.cardsCsv.trim() : ""))
      .filter(Boolean);

    if (urls.length) return urls; // ← 配列で返す
  }

  // 互換：単独キーを持つ場合にも対応（保険）
  const single =
    pickFirstString(
      m?.sources?.csv,
      m?.sources?.cardsCsv,
      m?.csv,
      m?.cardsCsv,
      m?.cards?.csv
    );

  if (single) return [single]; // 統一して配列で返す

  throw new Error("cards-manifest.json: cardsCsv not found (sources array / keys)");
}

  // CSV loader (expects header row)
  async function fetchCsvObjects(csvUrl) {
    const res = await fetch(csvUrl, { cache: "no-store" });
    if (!res.ok) throw new Error(`cards csv fetch failed: ${res.status}`);
    const text = await res.text();

    const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter(l => l.trim().length);
    if (!lines.length) return [];
    const header = splitCsvLine(lines[0]);
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = splitCsvLine(lines[i]);
      const obj = {};
      for (let j = 0; j < header.length; j++) {
        obj[String(header[j] || "").trim()] = String(cols[j] ?? "").trim();
      }
      rows.push(obj);
    }
    return rows;
  }

  // Minimal CSV line splitter (quotes supported)
  function splitCsvLine(line) {
    const out = [];
    let cur = "";
    let inQ = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];

      if (inQ) {
        if (ch === '"') {
          // escaped quote
          if (line[i + 1] === '"') {
            cur += '"';
            i++;
          } else {
            inQ = false;
          }
        } else {
          cur += ch;
        }
      } else {
        if (ch === ",") {
          out.push(cur);
          cur = "";
        } else if (ch === '"') {
          inQ = true;
        } else {
          cur += ch;
        }
      }
    }
    out.push(cur);
    return out;
  }

 async function computeTotalsFromCardsHub() {
  // Optional diagnostics: cards-hub の CSV を合算して総数などを計算する

  const manifestUrl = new URL(
    CARDS_MANIFEST_PATH,
    new URL(CARDS_HUB_BASE, location.origin)
  ).toString();

  const mRes = await fetch(manifestUrl, { cache: "no-store" });
  if (!mRes.ok) throw new Error(`cards-manifest.json fetch failed: ${mRes.status}`);

  const manifest = await mRes.json();

  // ✅ あなたのスキーマに合わせて「複数CSV URL」を取得
  const csvList = resolveCardsCsvPath(manifest); // <- string[] で返ってくる

  // CSV 取得→合算
  let total = 0, s3 = 0, s4 = 0, s5 = 0;

  const perSource = [];

  for (const csvPath of csvList) {
    // 絶対URLならそのまま、相対なら cards-hub base から解決
    const csvUrl = (() => {
      try { return new URL(csvPath).toString(); } catch { /* not absolute */ }
      return new URL(csvPath, new URL(CARDS_HUB_BASE, location.origin)).toString();
    })();

    const rows = await fetchCsvObjects(csvUrl);

    let t = 0, a3 = 0, a4 = 0, a5 = 0;
    for (const r of rows) {
      t++;
      const rarity = Number(r.rarity ?? r.star ?? r.stars ?? r.Rarity ?? "");
      if (rarity === 3) a3++;
      else if (rarity === 4) a4++;
      else if (rarity === 5) a5++;
    }

    total += t; s3 += a3; s4 += a4; s5 += a5;
    perSource.push({ csvUrl, total: t, s3: a3, s4: a4, s5: a5 });
  }

  return { manifestUrl, total, s3, s4, s5, perSource };
}


  // =========================
  // WHAT'S NEW (404 safe)
  // =========================

async function loadWhatsNew() {
  const box = document.getElementById("missionBrief");
  if (!box) return;

  // まず最初に正しい構造で置換
  box.innerHTML = `
    <div class="wn-head">
      <div class="wn-title">MISSION BRIEF</div>
      <div class="wn-sub">WHAT'S NEW</div>
    </div>
    <div class="wn-body" id="wnBody">
      <div class="wn-item muted">更新情報を読み込み中…</div>
    </div>
  `;

  const body = box.querySelector("#wnBody");
  if (!body) return;

  try {
    const res = await fetch("./whatsnew.json", { cache: "no-store" });
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

    body.innerHTML = items.slice(0, 6).map((it) => `
      <div class="wn-item">
        <div class="wn-date">${escapeHtml(it.date)}</div>
        <div class="wn-ttl">${escapeHtml(it.title)}</div>
        <div class="wn-txt">${escapeHtml(it.body)}</div>
      </div>
    `).join("");

  } catch (e) {
    console.warn("[home.js] whatsnew fallback:", e);
    body.innerHTML = `<div class="wn-item muted">更新情報を取得できません</div>`;
  }
}


  // =========================
  // BOOT
  // =========================

  function bindEvents() {
    const btn = el(IDS.reload);
    if (btn) {
      btn.addEventListener("click", async () => {
        try {
          renderStatusFromLocalStorage();
          await loadWhatsNew();
        } catch (_) {}
      });
    }

    // storage update (same-origin only)
    window.addEventListener("storage", (e) => {
      if (e && e.key === KEY_CARD_COUNTS) renderStatusFromLocalStorage();
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") renderStatusFromLocalStorage();
    });
  }

  async function boot() {
    // 1) status (always)
    renderStatusFromLocalStorage();

    // 2) whats new (optional)
    await loadWhatsNew();

    
    bindEvents();
  }

  document.addEventListener("DOMContentLoaded", () => {
    boot().catch((e) => console.error("[home.js] boot failed:", e));
  });

})();
