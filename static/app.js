const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
let APPS = [], RESEARCH = null;

/* ---------- navigation ---------- */
$$(".nav-btn").forEach(b => b.addEventListener("click", () => {
  $$(".nav-btn").forEach(x => x.classList.remove("active"));
  b.classList.add("active");
  $$(".view").forEach(v => v.classList.remove("active"));
  $("#view-" + b.dataset.view).classList.add("active");
}));

/* ---------- character counting ---------- */
function attachCounter(inputId, limit) {
  const el = document.getElementById(inputId);
  if (!el) return;
  const update = () => {
    const len = el.value.length;
    const over = len > limit;
    el.classList.toggle("field-over", over);
    $$(`.count-row[data-for="${inputId}"]`).forEach(row => {
      row.innerHTML = over
        ? `<span class="over">⚠ ${len} / ${limit} — ${len - limit} characters OVER the limit</span>`
        : `<span><b>${len}</b> / ${limit} characters</span><span class="ok">${limit - len} remaining</span>` +
          `<span>Words: <b>${countWords(el.value)}</b></span>`;
    });
    const badge = document.querySelector(`[data-badge="${inputId}"]`);
    if (badge) { badge.textContent = `${len} / ${limit}`; badge.classList.toggle("over", over); }
    const bar = document.querySelector(`[data-bar="${inputId}"]`);
    if (bar) { bar.style.width = Math.min(100, len / limit * 100) + "%"; bar.classList.toggle("over", over); }
  };
  el.addEventListener("input", update);
  update();
  return update;
}
function countWords(t) { const m = t.trim().match(/\S+/g); return m ? m.length : 0; }

const refreshers = {};
["f-title", "f-short", "f-long"].forEach(id => {
  const lim = { "f-title": 30, "f-short": 80, "f-long": 4000 }[id];
  refreshers[id] = attachCounter(id, lim);
});
["c-title", "c-short", "c-long"].forEach(id => {
  const lim = { "c-title": 30, "c-short": 80, "c-long": 4000 }[id];
  refreshers[id] = attachCounter(id, lim);
});
function setVal(id, v) { const el = document.getElementById(id); el.value = v || ""; refreshers[id] && refreshers[id](); }

/* general counter */
$("#c-any").addEventListener("input", e => {
  const t = e.target.value;
  $("#g-chars").textContent = t.length;
  $("#g-nospace").textContent = t.replace(/\s/g, "").length;
  $("#g-words").textContent = countWords(t);
  $("#g-sent").textContent = (t.match(/[.!?]+/g) || []).length;
  $("#g-para").textContent = t.trim() ? t.split(/\n\s*\n/).filter(x => x.trim()).length : 0;
  $("#g-spaces").textContent = (t.match(/ /g) || []).length;
});

/* ---------- API helpers ---------- */
async function api(path, opts) {
  // The free host sleeps when idle and can take 1-2 minutes to wake. A waking
  // server shows up as a non-JSON response (the host's wake page), a
  // 502/503/504, or a failed fetch - retry those automatically for ~3 minutes
  // instead of surfacing a blank or confusing error.
  const deadline = Date.now() + 3 * 60 * 1000;
  for (;;) {
    let r = null, data = null, isJson = false;
    try {
      r = await fetch(path, opts);
      try { data = JSON.parse(await r.text()); isJson = true; } catch (e) { isJson = false; }
    } catch (e) {
      r = null; // network failure - the server may still be waking
    }
    if (r && isJson && r.ok) return data;
    const waking = !r || !isJson || r.status === 502 || r.status === 503 || r.status === 504;
    if (waking && Date.now() < deadline) {
      const st = document.querySelector("#research-status");
      if (st) st.textContent = "Server is waking up — this can take 1–2 minutes. Retrying automatically…";
      await new Promise(res => setTimeout(res, 15000));
      continue;
    }
    let m = (data && data.error) || (r && r.statusText) || "";
    if (!m) m = "Server error (status " + (r ? r.status : 0) + ")";
    throw new Error(m);
  }
}
async function download(path, body) {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) { alert("Download failed"); return; }
  const blob = await r.blob();
  const name = (r.headers.get("Content-Disposition") || "").split("filename=")[1] || "sheet.csv";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name.replace(/"/g, ""); a.click();
  URL.revokeObjectURL(a.href);
}
function copyText(t) { navigator.clipboard.writeText(t || ""); }

/* ---------- My Apps ---------- */
function loadApps() {
  try { APPS = JSON.parse(localStorage.getItem("rankrise_apps") || "[]"); } catch (e) { APPS = []; }
  // Migrate the old single `graphic` field to the `graphics` list.
  APPS.forEach(a => { if (!Array.isArray(a.graphics)) a.graphics = a.graphic ? [a.graphic] : []; });
  renderApps(); fillAppSelects(); updateStats();
}
function persistApps() {
  try { localStorage.setItem("rankrise_apps", JSON.stringify(APPS)); return true; }
  catch (e) { alert("Browser storage is full — remove some images or old apps and try again."); return false; }
}
function stampNow() { return new Date().toISOString().slice(0, 16).replace("T", " "); }

/* ---------- feature graphics: multiple images, file pick or Ctrl+V paste ---------- */
let FORM_GRAPHICS = []; // pending images for the app form, as dataURLs
function compressImage(file) {
  // Shrink to at most 1024x1024 and re-encode (JPEG 0.85; PNG only when the
  // source appears to have transparency) so many images fit in localStorage.
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, 1024 / img.width, 1024 / img.height);
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      let hasAlpha = false;
      try {
        const px = ctx.getImageData(0, 0, w, h).data;
        for (let i = 3; i < px.length; i += 4 * 211) { if (px[i] < 250) { hasAlpha = true; break; } }
      } catch (e) { /* canvas readback unavailable - default to JPEG */ }
      resolve(canvas.toDataURL(hasAlpha ? "image/png" : "image/jpeg", 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read image")); };
    img.src = url;
  });
}
async function addGraphicImage(file) {
  if (!file) return;
  try {
    FORM_GRAPHICS.push(await compressImage(file));
    renderGraphicPreview();
  } catch (e) { /* unreadable image - skip it */ }
}
function renderGraphicPreview() {
  const box = $("#graphic-preview");
  box.innerHTML = "";
  FORM_GRAPHICS.forEach((src, i) => {
    const wrap = document.createElement("span");
    wrap.style.cssText = "display:inline-block;position:relative;margin:4px 10px 4px 0;vertical-align:top;text-align:center";
    const img = document.createElement("img");
    img.src = src;
    img.style.cssText = "display:block;max-height:90px;max-width:180px;border-radius:6px";
    const btn = document.createElement("button");
    btn.type = "button"; btn.textContent = "×"; btn.title = "Remove image";
    btn.style.cssText = "position:absolute;top:-7px;right:-7px;width:20px;height:20px;border-radius:50%;border:none;background:#e5484d;color:#fff;cursor:pointer;line-height:1;font-size:14px;padding:0";
    btn.onclick = () => { FORM_GRAPHICS.splice(i, 1); renderGraphicPreview(); };
    wrap.appendChild(img); wrap.appendChild(btn);
    if (i === 0) {
      const cap = document.createElement("div");
      cap.className = "muted"; cap.textContent = "Feature graphic";
      cap.style.cssText = "font-size:11px;margin-top:2px";
      wrap.appendChild(cap);
    }
    box.appendChild(wrap);
  });
}
const graphicInput = $("#f-graphic");
graphicInput.multiple = true;
graphicInput.addEventListener("change", () => {
  [...graphicInput.files].forEach(addGraphicImage);
  graphicInput.value = ""; // allow picking the same file again later
});
document.addEventListener("paste", e => {
  const view = $("#view-apps");
  if (!view || !view.classList.contains("active")) return;
  const items = (e.clipboardData && e.clipboardData.items) || [];
  const imgs = [];
  for (const it of items) if (it.type && it.type.indexOf("image/") === 0) { const f = it.getAsFile(); if (f) imgs.push(f); }
  if (imgs.length) { e.preventDefault(); imgs.forEach(addGraphicImage); }
});

function appCard(a, target) {
  const div = document.createElement("div");
  div.className = "app-card";
  div.innerHTML = `
    ${a.graphic ? `<img class="graphic" src="${a.graphic}">` : `<div class="no-graphic">📱</div>`}
    <div class="app-card-body">
      <h3></h3><p class="seed-line"></p><p>Title: <span class="t"></span></p><p>Updated: ${a.updated || ""}</p>
      <div class="btn-row">
        <button class="btn small" data-act="edit">✏ Edit</button>
        <button class="btn small" data-act="research">🔎 Research</button>
        <button class="btn small" data-act="counter">🔢 Counter</button>
        <button class="btn small" data-act="del">🗑</button>
      </div>
    </div>`;
  div.querySelector("h3").textContent = a.name;
  div.querySelector(".seed-line").textContent = (a.country || "US") + (a.seed ? " • Seed: " + a.seed : "");
  div.querySelector(".t").textContent = (a.title || "—") + ` (${(a.title || "").length}/30)`;
  div.querySelector('[data-act="edit"]').onclick = () => fillForm(a);
  div.querySelector('[data-act="del"]').onclick = () => { if (confirm("Delete " + a.name + "?")) { APPS = APPS.filter(x => x.id !== a.id); persistApps(); loadApps(); } };
  div.querySelector('[data-act="research"]').onclick = () => { selectResearchApp(a); document.querySelector('[data-view="research"]').click(); };
  div.querySelector('[data-act="counter"]').onclick = () => { loadIntoCounter(a); document.querySelector('[data-view="counter"]').click(); };
  target.appendChild(div);
}
function renderApps() {
  const list = $("#apps-list"); list.innerHTML = "";
  const dash = $("#dash-apps"); dash.innerHTML = "";
  if (!APPS.length) { list.innerHTML = '<p class="muted">No apps saved yet. Add your first app above.</p>'; dash.innerHTML = '<p class="muted">No apps yet.</p>'; return; }
  APPS.forEach(a => appCard(a, list));
  APPS.slice(0, 3).forEach(a => appCard(a, dash));
}
function fillAppSelects() {
  [["#r-app"], ["#c-app"]].forEach(([sel]) => {
    const el = $(sel); const keep = el.value;
    el.innerHTML = '<option value="">' + (sel === "#r-app" ? "— manual —" : "— choose app —") + "</option>";
    APPS.forEach(a => { const o = document.createElement("option"); o.value = a.id; o.textContent = a.name; el.appendChild(o); });
    el.value = keep;
  });
}
function fillForm(a) {
  $("#f-id").value = a.id; $("#f-name").value = a.name || ""; $("#f-package").value = a.package || "";
  $("#f-seed").value = a.seed || ""; $("#f-country").value = a.country || "US";
  setVal("f-title", a.title); setVal("f-short", a.short_desc); setVal("f-long", a.long_desc);
  FORM_GRAPHICS = (Array.isArray(a.graphics) && a.graphics.length) ? [...a.graphics] : (a.graphic ? [a.graphic] : []);
  renderGraphicPreview();
  $("#app-form-title").textContent = "Editing: " + a.name;
  window.scrollTo({ top: 0, behavior: "smooth" });
}
$("#clear-form").onclick = () => {
  $("#f-id").value = ""; $("#f-name").value = ""; $("#f-package").value = ""; $("#f-seed").value = "";
  setVal("f-title", ""); setVal("f-short", ""); setVal("f-long", "");
  $("#f-graphic").value = ""; FORM_GRAPHICS = []; renderGraphicPreview(); $("#app-form-title").textContent = "Add / edit app";
};
$("#save-app").onclick = () => {
  const data = { name: $("#f-name").value, package: $("#f-package").value, seed: $("#f-seed").value,
    country: $("#f-country").value, title: $("#f-title").value, short_desc: $("#f-short").value, long_desc: $("#f-long").value };
  if (!data.name.trim()) { alert("App name is required"); return; }
  const id = $("#f-id").value || ("app" + Date.now().toString(36));
  const existing = APPS.find(x => x.id === id);
  const item = Object.assign({}, existing || {}, data, { id, updated: stampNow() });
  item.graphics = [...FORM_GRAPHICS];
  item.graphic = FORM_GRAPHICS[0] || ""; // first image stays the thumbnail / feature graphic
  item.graphic_info = FORM_GRAPHICS.length ? FORM_GRAPHICS.length + (FORM_GRAPHICS.length === 1 ? " image" : " images") : "";
  if (existing) APPS = APPS.map(x => x.id === id ? item : x); else APPS.unshift(item);
  if (!persistApps()) return; // persistApps alerts when browser storage is full
  $("#f-id").value = id;
  renderGraphicPreview();
  $("#save-msg").textContent = "Saved \u2713 " + (item.graphic_info || "");
  $("#f-graphic").value = "";
  $("#app-form-title").textContent = "Editing: " + item.name;
  renderApps(); fillAppSelects(); updateStats();
};

/* ---------- Research ---------- */
function selectResearchApp(a) {
  $("#r-app").value = a.id; $("#r-seed").value = a.seed || a.title || "";
  $("#r-country").value = a.country || "US";
  RESEARCH_MY = a;
}
let RESEARCH_MY = null;
$("#r-app").addEventListener("change", e => {
  const a = APPS.find(x => x.id === e.target.value);
  if (a) selectResearchApp(a); else RESEARCH_MY = null;
});
$("#run-research").onclick = async () => {
  const seed = $("#r-seed").value.trim();
  const my = RESEARCH_MY;
  const appName = my ? (my.name || "") : "";
  if (!seed && !appName) { alert("Please enter a seed keyword first"); return; }
  const extra = $("#r-extra").value.split(",").map(s => s.trim()).filter(Boolean);
  $("#research-status").textContent = "Fetching competitors from Play Store… (this can take 30–60 seconds)";
  $("#run-research").disabled = true;
  try {
    RESEARCH = await api("/api/research", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seed, app_name: appName, extra_seeds: extra, country: $("#r-country").value, count: +$("#r-count").value,
        my_text: my ? (my.title + " " + my.short_desc + " " + my.long_desc) : "" }) });
    $("#research-status").textContent = "Done ✓ — " + RESEARCH.competitors.length + " competitors, " + RESEARCH.keywords.length + " keywords";
    renderResearch();
  } catch (e) {
    $("#research-status").textContent = "Error: " + e.message;
  }
  $("#run-research").disabled = false;
};
function renderResearch() {
  if (!RESEARCH) return;
  updateStats();
  $("#comp-panel").classList.remove("hidden");
  $("#kw-panel").classList.remove("hidden");
  $("#comp-count").textContent = RESEARCH.competitors.length + " apps";
  const tb = $("#comp-table tbody"); tb.innerHTML = "";
  RESEARCH.competitors.forEach((c, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td><input type="checkbox" class="comp-check" data-idx="${idx}" checked></td><td></td><td class="ct"></td><td>${c.installs || ""}</td><td>${c.score ? (+c.score).toFixed(1) : ""}</td><td class="cs"></td>
      <td><div class="btn-row" style="margin:0">
        <button class="btn small" data-c="title">Title</button>
        <button class="btn small" data-c="summary">Short</button>
        <button class="btn small" data-c="description">Long</button>
      </div></td>`;
    const first = tr.children[1];
    if (c.icon) { const img = document.createElement("img"); img.className = "icon"; img.src = c.icon; first.appendChild(img); }
    const link = document.createElement("a"); link.href = c.url; link.target = "_blank"; link.textContent = c.developer || c.appId; first.appendChild(link);
    const titleLink = document.createElement("a");
    titleLink.href = c.url || ("https://play.google.com/store/apps/details?id=" + (c.appId || ""));
    titleLink.target = "_blank"; titleLink.rel = "noopener";
    titleLink.textContent = c.title || "";
    tr.querySelector(".ct").appendChild(titleLink);
    tr.querySelector(".cs").textContent = c.summary || "";
    tr.querySelector('[data-c="title"]').onclick = () => copyText(c.title);
    tr.querySelector('[data-c="summary"]').onclick = () => copyText(c.summary);
    tr.querySelector('[data-c="description"]').onclick = () => openModal(c.title, c.description);
    tb.appendChild(tr);
  });
  renderKeywords();
}
function renderKeywords() {
  if (!RESEARCH) return;
  $("#kw-count").textContent = RESEARCH.keywords.length + " keywords";
  const kb = $("#kw-table tbody"); kb.innerHTML = "";
  RESEARCH.keywords.forEach((k, i) => {
    const tr = document.createElement("tr");
    tr.dataset.kw = k.keyword;
    tr.dataset.gap = k.gap === true ? "1" : "0";
    tr.innerHTML = `<td><input type="checkbox" ${i < 60 ? "checked" : ""}></td><td class="kk"></td>
      <td>${k.gap === true ? '<span class="badge">GAP</span>' : ""}</td>
      <td><b>${k.popularity}</b></td><td>${k.difficulty}</td><td>${k.apps_count}</td><td>${k.in_titles}</td><td>${k.mentions}</td><td>${k.suggested_use}</td>`;
    tr.querySelector(".kk").textContent = k.keyword;
    kb.appendChild(tr);
  });
  applyKwFilters();
}
$("#reextract").onclick = async () => {
  if (!RESEARCH) return;
  const selected = [];
  $$("#comp-table .comp-check").forEach(cb => { if (cb.checked) selected.push(RESEARCH.competitors[+cb.dataset.idx]); });
  if (!selected.length) { alert("Please tick at least one competitor app first"); return; }
  const btn = $("#reextract");
  btn.disabled = true;
  $("#research-status").textContent = "Re-extracting keywords from " + selected.length + " selected competitors…";
  try {
    const my = RESEARCH_MY;
    const data = await api("/api/extract", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ competitors: selected, country: RESEARCH.country, seed: RESEARCH.seed,
        my_text: RESEARCH.target_text || (my ? (my.title + " " + my.short_desc + " " + my.long_desc) : "") }) });
    RESEARCH.keywords = data.keywords || [];
    renderKeywords();
    updateStats();
    $("#research-status").textContent = "Done ✓ — keywords rebuilt from " + selected.length + " selected competitors: " + RESEARCH.keywords.length + " keywords";
  } catch (e) {
    $("#research-status").textContent = "Error: " + e.message;
  }
  btn.disabled = false;
};
let KW_GAP_ONLY = false;
function applyKwFilters() {
  const q = $("#kw-search").value.toLowerCase();
  $$("#kw-table tbody tr").forEach(tr => {
    const okQ = tr.dataset.kw.includes(q);
    const okG = !KW_GAP_ONLY || tr.dataset.gap === "1";
    tr.style.display = (okQ && okG) ? "" : "none";
  });
}
$("#kw-search").addEventListener("input", applyKwFilters);
$("#kw-gap-toggle").onclick = () => {
  KW_GAP_ONLY = !KW_GAP_ONLY;
  $("#kw-gap-toggle").classList.toggle("primary", KW_GAP_ONLY);
  applyKwFilters();
};
function tickedKeywords() {
  if (!RESEARCH) return [];
  const ticked = new Set();
  $$("#kw-table tbody tr").forEach(tr => { if (tr.querySelector("input").checked) ticked.add(tr.dataset.kw); });
  return RESEARCH.keywords.filter(k => ticked.has(k.keyword))
    .map(k => ({ keyword: k.keyword, popularity: k.popularity, difficulty: k.difficulty, apps_count: k.apps_count }));
}
$("#dl-final-csv").onclick = () => RESEARCH && download("/api/sheet/final.csv", { keywords: tickedKeywords(), country: RESEARCH.country, app_name: (RESEARCH_MY || {}).name || RESEARCH.seed });
$("#dl-final-xlsx").onclick = () => RESEARCH && download("/api/sheet/final.xlsx", { keywords: tickedKeywords(), country: RESEARCH.country, app_name: (RESEARCH_MY || {}).name || RESEARCH.seed });
$("#dl-all").onclick = () => RESEARCH && download("/api/sheet/all.csv", { keywords: RESEARCH.keywords });
$("#dl-competitors").onclick = () => RESEARCH && download("/api/sheet/competitors.csv", { competitors: RESEARCH.competitors });

/* ---------- Counter page ---------- */
function loadIntoCounter(a) {
  $("#c-app").value = a.id;
  setVal("c-title", a.title); setVal("c-short", a.short_desc); setVal("c-long", a.long_desc);
  COUNTER_APP = a;
}
let COUNTER_APP = null;
$("#c-app").addEventListener("change", e => {
  const a = APPS.find(x => x.id === e.target.value);
  if (a) loadIntoCounter(a); else COUNTER_APP = null;
});
$$("[data-copy]").forEach(b => b.onclick = () => copyText(document.getElementById(b.dataset.copy).value));
$("#c-save-back").onclick = () => {
  if (!COUNTER_APP) { $("#c-msg").textContent = "Please select an app above first"; return; }
  const a = APPS.find(x => x.id === COUNTER_APP.id);
  if (a) {
    a.title = $("#c-title").value; a.short_desc = $("#c-short").value; a.long_desc = $("#c-long").value;
    a.updated = stampNow(); persistApps(); renderApps(); fillAppSelects();
  }
  $("#c-msg").textContent = "Saved back to " + COUNTER_APP.name + " \u2713";
};

/* ---------- modal ---------- */
function openModal(title, body) {
  $("#modal-title").textContent = title || "";
  $("#modal-body").textContent = body || "";
  $("#modal").classList.remove("hidden");
}
$("#modal-close").onclick = () => $("#modal").classList.add("hidden");
$("#modal-copy").onclick = () => copyText($("#modal-body").textContent);

/* ---------- stats / init ---------- */
function updateStats() {
  $("#stat-apps").textContent = APPS.length;
  if (RESEARCH) {
    $("#stat-comps").textContent = RESEARCH.competitors.length;
    $("#stat-kws").textContent = RESEARCH.keywords.length;
    $("#stat-seed").textContent = RESEARCH.seed;
  }
}
(async function init() {
  loadApps();
})();

/* ---------- keep-alive: ping the server so the free container stays
   awake while this tab is open (it sleeps after ~15 min idle) ---------- */
fetch("/api/ping").catch(() => {});
setInterval(() => { fetch("/api/ping").catch(() => {}); }, 10 * 60 * 1000);
