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
        <button class="btn small" data-act="score">📊 ASO Score</button>
        <button class="btn small" data-act="counter">🔢 Counter</button>
        <button class="btn small" data-act="del">🗑</button>
      </div>
    </div>`;
  div.querySelector("h3").textContent = a.name;
  div.querySelector(".seed-line").textContent = (a.country || "US") + (a.seed ? " • Seed: " + a.seed : "") + (a.pkg ? " • 📦 " + a.pkg : "");
  div.querySelector(".t").textContent = (a.title || "—") + ` (${(a.title || "").length}/30)`;
  div.querySelector('[data-act="edit"]').onclick = () => fillForm(a);
  div.querySelector('[data-act="del"]').onclick = () => { if (confirm("Delete " + a.name + "?")) { APPS = APPS.filter(x => x.id !== a.id); persistApps(); loadApps(); } };
  div.querySelector('[data-act="research"]').onclick = () => { selectResearchApp(a); document.querySelector('[data-view="research"]').click(); };
  div.querySelector('[data-act="score"]').onclick = () => openAudit(a);
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
  [["#r-app", "— manual —"], ["#c-app", "— choose app —"], ["#rank-app", "— choose saved app —"]].forEach(([sel, placeholder]) => {
    const el = $(sel); if (!el) return; const keep = el.value;
    el.innerHTML = '<option value="">' + placeholder + "</option>";
    APPS.forEach(a => { const o = document.createElement("option"); o.value = a.id; o.textContent = a.name; el.appendChild(o); });
    el.value = keep;
  });
}
function fillForm(a) {
  $("#f-id").value = a.id; $("#f-name").value = a.name || ""; $("#f-package").value = a.package || "";
  $("#app-pkg").value = a.pkg || a.package || "";
  $("#f-seed").value = a.seed || ""; $("#f-country").value = a.country || "US";
  setVal("f-title", a.title); setVal("f-short", a.short_desc); setVal("f-long", a.long_desc);
  FORM_GRAPHICS = (Array.isArray(a.graphics) && a.graphics.length) ? [...a.graphics] : (a.graphic ? [a.graphic] : []);
  renderGraphicPreview();
  $("#app-form-title").textContent = "Editing: " + a.name;
  window.scrollTo({ top: 0, behavior: "smooth" });
}
$("#clear-form").onclick = () => {
  $("#f-id").value = ""; $("#f-name").value = ""; $("#f-package").value = ""; $("#app-pkg").value = ""; $("#f-seed").value = "";
  setVal("f-title", ""); setVal("f-short", ""); setVal("f-long", "");
  $("#f-graphic").value = ""; FORM_GRAPHICS = []; renderGraphicPreview(); $("#app-form-title").textContent = "Add / edit app";
};
$("#save-app").onclick = () => {
  const pkgVal = $("#app-pkg").value.trim();
  const data = { name: $("#f-name").value, package: pkgVal || $("#f-package").value, pkg: pkgVal, seed: $("#f-seed").value,
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
  $("#r-count").value = "50"; // app mode: pull every competitor that can be found
  RESEARCH_MY = a;
}
let RESEARCH_MY = null;
$("#r-app").addEventListener("change", e => {
  const a = APPS.find(x => x.id === e.target.value);
  if (a) selectResearchApp(a); else RESEARCH_MY = null;
});
function loadAppPkgMap() {
  try { return JSON.parse(localStorage.getItem("rr_app_pkg") || "{}"); } catch (e) { return {}; }
}
function resolveResearchAppId(my, override) {
  // A package ID pins the research to exactly the owner's app. Priority:
  // an explicit pick (target picker) > the saved app's Package ID > a
  // package remembered for this app name by an earlier picker choice.
  if (override) return override;
  if (!my) return "";
  if (my.pkg) return my.pkg;
  return loadAppPkgMap()[(my.name || "").toLowerCase()] || "";
}
async function doResearch(appIdOverride) {
  const seed = $("#r-seed").value.trim();
  const my = RESEARCH_MY;
  const appName = my ? (my.name || "") : "";
  if (!seed && !appName) { alert("Please enter a seed keyword first"); return; }
  const extra = $("#r-extra").value.split(",").map(s => s.trim()).filter(Boolean);
  $("#research-status").textContent = "Fetching competitors from Play Store… (this can take 30–60 seconds)";
  $("#run-research").disabled = true;
  try {
    const body = { seed, app_name: appName, extra_seeds: extra, country: $("#r-country").value, count: +$("#r-count").value,
      my_text: my ? (my.title + " " + my.short_desc + " " + my.long_desc) : "" };
    const appId = resolveResearchAppId(my, appIdOverride);
    if (appId) body.app_id = appId;
    RESEARCH = await api("/api/research", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body) });
    let doneMsg = "Done ✓ — " + RESEARCH.competitors.length + " competitors, " + RESEARCH.keywords.length + " keywords";
    if (RESEARCH.keywords_total_unique && RESEARCH.keywords_total_unique > RESEARCH.keywords.length) {
      doneMsg += " (" + RESEARCH.keywords_total_unique + " unique keywords found — showing the top " + RESEARCH.keywords.length + ")";
    }
    if (RESEARCH.dropped && (RESEARCH.dropped.competitors || RESEARCH.dropped.keywords)) {
      doneMsg += " Filtered out " + (RESEARCH.dropped.competitors || 0) + " off-topic apps and " + (RESEARCH.dropped.keywords || 0) + " unrelated keywords.";
    }
    if (RESEARCH.target_ambiguous) {
      doneMsg += " Several apps share this name — pick YOUR app in the strip above the results so the numbers are exactly yours.";
    }
    $("#research-status").textContent = doneMsg;
    renderResearch();
    saveLastResearch();
    saveTracker();
  } catch (e) {
    $("#research-status").textContent = "Error: " + e.message;
  }
  $("#run-research").disabled = false;
}
$("#run-research").onclick = () => doResearch("");

/* ---------- Accuracy update: same-name target picker ---------- */
function renderTargetPicker() {
  const panel = $("#target-picker");
  if (!panel) return;
  const cands = (RESEARCH && RESEARCH.target_candidates) || [];
  if (!RESEARCH || cands.length < 2) { panel.classList.add("hidden"); panel.innerHTML = ""; return; }
  panel.classList.remove("hidden");
  panel.innerHTML = "";
  const chosenId = (RESEARCH.target || {}).appId || "";
  const buildButtons = (box) => {
    cands.forEach(c => {
      const btn = document.createElement("button");
      btn.className = "cand-btn";
      if (c.icon) { const img = document.createElement("img"); img.src = c.icon; img.alt = ""; btn.appendChild(img); }
      const mid = document.createElement("span");
      const t = document.createElement("div"); t.textContent = c.title || c.appId;
      const d = document.createElement("div"); d.className = "cb-dev"; d.textContent = c.developer || "";
      mid.appendChild(t); mid.appendChild(d);
      btn.appendChild(mid);
      const meta = document.createElement("span");
      meta.className = "cb-meta";
      meta.textContent = (c.installs || "") + (c.score ? " · ★ " + (+c.score).toFixed(1) : "") + (c.appId === chosenId ? " · current pick" : "");
      btn.appendChild(meta);
      btn.onclick = () => chooseCandidate(c);
      box.appendChild(btn);
    });
  };
  if (RESEARCH.target_ambiguous) {
    const h = document.createElement("h2");
    h.textContent = "⚠ Several apps share this name — pick YOUR app:";
    panel.appendChild(h);
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "The results below were calculated against the biggest app with this name. Pick your own app and the research re-runs against exactly your app.";
    panel.appendChild(p);
    buildButtons(panel);
  } else {
    const td = RESEARCH.target_details || {};
    const line = document.createElement("p");
    line.style.margin = "0";
    const dev = (RESEARCH.target || {}).developer || td.developer || "";
    line.innerHTML = "Identified your app as: <b></b>";
    line.querySelector("b").textContent = dev + (td.installs ? " · " + td.installs + " installs" : "");
    const ch = document.createElement("button");
    ch.className = "btn small";
    ch.style.marginLeft = "10px";
    ch.textContent = "Wrong app? Change";
    line.appendChild(ch);
    panel.appendChild(line);
    const box = document.createElement("div");
    box.className = "hidden";
    panel.appendChild(box);
    buildButtons(box);
    ch.onclick = () => box.classList.toggle("hidden");
  }
}
function chooseCandidate(c) {
  const my = RESEARCH_MY;
  if (my) {
    my.pkg = c.appId;
    const saved = APPS.find(x => x.id === my.id);
    if (saved) saved.pkg = c.appId;
    persistApps(); renderApps(); fillAppSelects();
  } else if (RESEARCH && RESEARCH.target) {
    const map = loadAppPkgMap();
    map[(RESEARCH.target.title || "").toLowerCase()] = c.appId;
    try { localStorage.setItem("rr_app_pkg", JSON.stringify(map)); } catch (e) { /* storage full - the re-run below still uses the pick */ }
  }
  doResearch(c.appId);
}
function renderResearch() {
  if (!RESEARCH) return;
  updateStats();
  renderTargetPicker();
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
  renderCompare();
}
function renderKeywords() {
  if (!RESEARCH) return;
  $("#kw-count").textContent = RESEARCH.keywords.length + " keywords" +
    (RESEARCH.keywords_total_unique && RESEARCH.keywords_total_unique > RESEARCH.keywords.length
      ? " of " + RESEARCH.keywords_total_unique + " unique found" : "");
  const kb = $("#kw-table tbody"); kb.innerHTML = "";
  RESEARCH.keywords.forEach((k, i) => {
    const tr = document.createElement("tr");
    tr.dataset.kw = k.keyword;
    tr.dataset.gap = k.gap === true ? "1" : "0";
    tr.innerHTML = `<td><input type="checkbox" ${i < 60 ? "checked" : ""}></td><td class="kk"></td>
      <td>${k.gap === true ? '<span class="badge">GAP</span>' : ""}</td>
      <td><b>${k.popularity}</b></td><td>${k.difficulty}</td><td>${k.apps_count}</td><td>${k.in_titles}</td><td>${k.mentions}</td><td>${k.suggested_use}</td>`;
    const kk = tr.querySelector(".kk");
    kk.textContent = k.keyword;
    if (k.best) {
      const b = document.createElement("span");
      b.className = "badge"; b.textContent = "⭐ BEST"; b.style.marginLeft = "6px";
      kk.appendChild(b);
    }
    kb.appendChild(tr);
  });
  renderTopPicks();
  applyKwFilters();
}
function renderTopPicks() {
  const el = $("#top-picks");
  if (!el) return;
  if (!RESEARCH || !RESEARCH.keywords.length) { el.textContent = ""; return; }
  const top = RESEARCH.keywords.slice()
    .sort((a, b) => ((b.best_score || 0) - (a.best_score || 0)) || (b.popularity - a.popularity))
    .slice(0, 5);
  el.textContent = top.length ? "⭐ Top picks for ASO: " + top.map(k => k.keyword).join(", ") : "";
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
        app_title: (RESEARCH.target || {}).title || "",
        target_text: RESEARCH.target_text || "",
        my_text: RESEARCH.target_text || (my ? (my.title + " " + my.short_desc + " " + my.long_desc) : "") }) });
    RESEARCH.keywords = data.keywords || [];
    RESEARCH.keywords_total_unique = data.keywords_total_unique;
    renderKeywords();
    updateStats();
    let doneMsg = "Done ✓ — keywords rebuilt from " + selected.length + " selected competitors: " + RESEARCH.keywords.length + " keywords";
    if (data.dropped && data.dropped.keywords) {
      doneMsg += " Filtered out " + data.dropped.keywords + " unrelated keywords.";
    }
    $("#research-status").textContent = doneMsg;
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
$("#select-best").onclick = () => {
  if (!RESEARCH) return;
  const bestSet = new Set(RESEARCH.keywords.filter(k => k.best).map(k => k.keyword));
  $$("#kw-table tbody tr").forEach(tr => {
    const cb = tr.querySelector("input");
    if (cb) cb.checked = bestSet.has(tr.dataset.kw);
  });
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

/* ---------- Tools: last-research persistence (for ASO Score) ---------- */
function saveLastResearch() {
  // App mode only: remember the top keywords for the target app so the
  // ASO Score audit can measure this app's listing against them later.
  if (!RESEARCH || !RESEARCH.target || !RESEARCH.target.appId) return;
  let all = {};
  try { all = JSON.parse(localStorage.getItem("rr_last_research") || "{}"); } catch (e) { all = {}; }
  const top = RESEARCH.keywords.slice()
    .sort((a, b) => ((b.best_score || 0) - (a.best_score || 0)) || (b.popularity - a.popularity))
    .slice(0, 40)
    .map(k => ({ keyword: k.keyword, popularity: k.popularity, gap: k.gap === true, best: !!k.best }));
  all[RESEARCH.target.appId] = { ts: Date.now(), appName: RESEARCH.target.title || "", keywords: top };
  try { localStorage.setItem("rr_last_research", JSON.stringify(all)); } catch (e) { /* storage full - audit stays partial */ }
}

/* ---------- Tools: Competitor Compare ---------- */
function instNum(x) {
  if (!x) return 0;
  if (x.realInstalls) return +x.realInstalls;
  return parseInt(String(x.installs || "0").replace(/[^0-9]/g, ""), 10) || 0;
}
function fiveStarPct(x) {
  const h = x && x.histogram;
  if (!Array.isArray(h) || h.length < 5) return "–";
  const tot = h.reduce((a, b) => a + (+b || 0), 0);
  if (!tot) return "–";
  return Math.round((+h[4] || 0) / tot * 100) + "%";
}
function fmtUpdated(v) {
  if (v === null || v === undefined || v === "") return "";
  let d;
  if (typeof v === "number") d = new Date(v < 1e12 ? v * 1000 : v);
  else if (/^\d+$/.test(String(v).trim())) { const n = +v; d = new Date(n < 1e12 ? n * 1000 : n); }
  else d = new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10);
}
function renderCompare() {
  const wrap = $("#compare-wrap");
  if (!wrap) return;
  const td = RESEARCH && RESEARCH.target_details;
  if (!td) { wrap.classList.add("hidden"); return; }
  wrap.classList.remove("hidden");
  const top = RESEARCH.competitors.slice().sort((a, b) => instNum(b) - instNum(a)).slice(0, 8);
  const tb = $("#compare-table tbody"); tb.innerHTML = "";
  const addRow = (x, own) => {
    const tr = document.createElement("tr");
    if (own) tr.className = "your-row";
    const appCell = document.createElement("td");
    appCell.textContent = x.title || x.appId || "";
    if (own) {
      const b = document.createElement("span");
      b.className = "badge"; b.textContent = "YOUR APP"; b.style.marginLeft = "6px";
      appCell.appendChild(b);
    }
    tr.appendChild(appCell);
    const cells = [
      x.installs || "—",
      x.score ? (+x.score).toFixed(1) : "",
      x.ratings ? (+x.ratings).toLocaleString("en-US") : "0",
      x.reviews ? (+x.reviews).toLocaleString("en-US") : "0",
      fiveStarPct(x),
      x.title_len != null ? x.title_len : (x.title || "").length,
      x.short_len != null ? x.short_len : "",
      x.long_len != null ? x.long_len : "",
      fmtUpdated(x.updated),
    ];
    cells.forEach(v => { const c = document.createElement("td"); c.textContent = v; tr.appendChild(c); });
    tb.appendChild(tr);
  };
  addRow(td, true);
  top.forEach(c => addRow(c, false));
  let insight = "";
  if (top.length) {
    const longer = top.filter(c => (c.long_len || 0) > (td.long_len || 0)).length;
    insight = longer + " of the top " + top.length + " competitors have a longer long description than your app (yours: " + (td.long_len || 0) + " characters).";
    const biggest = top[0];
    if (biggest && instNum(biggest) > instNum(td)) {
      insight += " The biggest competitor, " + (biggest.title || biggest.appId) + ", has " + (biggest.installs || "far more") +
        " installs vs your " + (td.installs || "—") + " — closing that gap starts with the GAP keywords above.";
    }
  }
  $("#compare-insight").textContent = insight;
}

/* ---------- Tools: Keyword Rank Checker ---------- */
function loadRankHistory() {
  try { return JSON.parse(localStorage.getItem("rr_rank_history") || "{}"); } catch (e) { return {}; }
}
function persistRankHistory(h) {
  try { localStorage.setItem("rr_rank_history", JSON.stringify(h)); } catch (e) { /* storage full - history just won't persist */ }
}
function rankChange(prev, cur) {
  if (!prev) return { text: "first check", cls: "rank-same" };
  const p = prev.rank, c = cur;
  if (p == null && c == null) return { text: "= still not found", cls: "rank-same" };
  if (p == null) return { text: "▲ entered at #" + c, cls: "rank-up" };
  if (c == null) return { text: "▼ dropped out (was #" + p + ")", cls: "rank-down" };
  if (c < p) return { text: "▲ " + (p - c) + " (was #" + p + ")", cls: "rank-up" };
  if (c > p) return { text: "▼ " + (c - p) + " (was #" + p + ")", cls: "rank-down" };
  return { text: "= same (#" + c + ")", cls: "rank-same" };
}
$("#rank-app").addEventListener("change", e => {
  const a = APPS.find(x => x.id === e.target.value);
  if (!a) return;
  // Pre-fill the package ID from the saved app's Package ID; failing that,
  // from the last research target recorded for this app's name (Tracker
  // data), or a package remembered by an earlier target-picker choice.
  let pkg = a.pkg || a.package || "";
  if (!pkg) {
    try {
      const tr = loadTracker();
      const hit = Object.values(tr).find(en => (en.appName || "").toLowerCase() === (a.name || "").toLowerCase());
      if (hit && hit.target && hit.target.appId) pkg = hit.target.appId;
    } catch (err) { /* tracker unreadable - fall through */ }
  }
  if (!pkg) pkg = loadAppPkgMap()[(a.name || "").toLowerCase()] || "";
  if (pkg) $("#rank-package").value = pkg;
});
$("#rank-use-best").onclick = () => {
  if (!RESEARCH || !RESEARCH.keywords || !RESEARCH.keywords.length) {
    $("#rank-status").textContent = "Run a keyword research first, then this fills in its best keywords.";
    return;
  }
  const best = RESEARCH.keywords.filter(k => k.best).slice(0, 10).map(k => k.keyword);
  if (!best.length) { $("#rank-status").textContent = "No best keywords in the last research."; return; }
  $("#rank-keywords").value = best.join("\n");
  $("#rank-status").textContent = best.length + " best keywords filled in ✓ — now press Check ranks.";
};
$("#rank-check").onclick = async () => {
  const selApp = APPS.find(x => x.id === $("#rank-app").value);
  let appId = $("#rank-package").value.trim();
  if (!appId && selApp) appId = (selApp.pkg || selApp.package || "").trim();
  if (!appId) { alert("Choose a saved app that has a package ID, or type the package ID"); return; }
  const keywords = $("#rank-keywords").value.split("\n").map(s => s.trim()).filter(Boolean).slice(0, 10);
  if (!keywords.length) { alert("Enter at least one keyword — one per line"); return; }
  const btn = $("#rank-check");
  btn.disabled = true;
  $("#rank-status").textContent = "Checking your Play Store ranks…";
  try {
    const data = await api("/api/rank", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: appId, keywords, country: $("#rank-country").value }) });
    const hist = loadRankHistory();
    hist[appId] = hist[appId] || {};
    const tb = $("#rank-table tbody"); tb.innerHTML = "";
    (data.results || []).forEach(r => {
      const key = (r.keyword || "").toLowerCase();
      const arr = hist[appId][key] || [];
      const prev = arr.length ? arr[arr.length - 1] : null;
      const ch = rankChange(prev, r.rank);
      arr.push({ ts: Date.now(), rank: r.rank });
      hist[appId][key] = arr;
      const tr = document.createElement("tr");
      const c1 = document.createElement("td"); c1.textContent = r.keyword;
      const c2 = document.createElement("td");
      c2.innerHTML = r.rank ? "<b>#" + r.rank + "</b>" : "";
      if (!r.rank) c2.textContent = "Not in top " + r.scanned;
      const c3 = document.createElement("td");
      const sp = document.createElement("span"); sp.className = ch.cls; sp.textContent = ch.text;
      c3.appendChild(sp);
      const c4 = document.createElement("td"); c4.textContent = r.top_app || "";
      tr.appendChild(c1); tr.appendChild(c2); tr.appendChild(c3); tr.appendChild(c4);
      tb.appendChild(tr);
    });
    persistRankHistory(hist);
    $("#rank-table-wrap").classList.remove("hidden");
    renderRankSerps(data.results || [], appId);
    $("#rank-status").textContent = "Done ✓ — ranks checked for " + (data.results || []).length + " keywords";
  } catch (e) {
    $("#rank-status").textContent = "Error: " + e.message;
  }
  btn.disabled = false;
};

/* ---------- AppTweak pack: SERP preview under the Rank Checker ---------- */
function renderRankSerps(results, ownId) {
  const box = $("#rank-serps");
  if (!box) return;
  box.innerHTML = "";
  results.forEach(r => {
    const tops = r.top_results || [];
    if (!tops.length) return;
    const h = document.createElement("h3");
    h.style.margin = "18px 0 6px";
    h.textContent = "Top 10 right now — “" + r.keyword + "”";
    box.appendChild(h);
    const strip = document.createElement("div");
    strip.className = "serp-strip";
    tops.forEach((a, i) => {
      const el = document.createElement("div");
      el.className = "serp-app" + (a.appId === ownId ? " own" : "");
      if (a.icon) { const img = document.createElement("img"); img.src = a.icon; img.alt = ""; el.appendChild(img); }
      const tx = document.createElement("div");
      const t1 = document.createElement("div");
      t1.className = "serp-title";
      t1.textContent = (i + 1) + ". " + (a.title || a.appId);
      const t2 = document.createElement("div");
      t2.className = "serp-meta";
      t2.textContent = (a.installs || "") + (a.score ? " · ★ " + (+a.score).toFixed(1) : "") + (a.appId === ownId ? " · YOUR APP" : "");
      tx.appendChild(t1); tx.appendChild(t2);
      el.appendChild(tx);
      strip.appendChild(el);
    });
    box.appendChild(strip);
  });
}

/* ---------- AppTweak pack: latest reviews of the owner's app ---------- */
$("#reviews-load").onclick = async () => {
  const appId = (RESEARCH_MY && (RESEARCH_MY.pkg || RESEARCH_MY.package)) ||
    (RESEARCH && RESEARCH.target_details && RESEARCH.target_details.appId) ||
    (RESEARCH && RESEARCH.target && RESEARCH.target.appId) || "";
  if (!appId) { $("#reviews-status").textContent = "Run research for one of your apps first."; return; }
  const btn = $("#reviews-load");
  btn.disabled = true;
  $("#reviews-status").textContent = "Loading reviews…";
  try {
    const d = await api("/api/reviews", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: appId, country: (RESEARCH && RESEARCH.country) || "US" }) });
    const box = $("#reviews-list");
    box.innerHTML = "";
    const revs = d.reviews || [];
    if (!revs.length) box.innerHTML = '<p class="muted">No reviews found for this app yet.</p>';
    revs.forEach(r => {
      const div = document.createElement("div");
      div.className = "review-item";
      const head = document.createElement("div");
      head.className = "review-head";
      const n = Math.max(0, Math.min(5, Math.round(r.rating || 0)));
      head.textContent = (r.author || "Anonymous") + " · " + "★".repeat(n) + "☆".repeat(5 - n) +
        (r.date ? " · " + String(r.date).slice(0, 10) : "");
      div.appendChild(head);
      if (r.text) {
        const p = document.createElement("p");
        p.className = "review-text";
        p.textContent = r.text;
        div.appendChild(p);
      }
      box.appendChild(div);
    });
    $("#reviews-status").textContent = "Done ✓ — " + revs.length + " latest reviews";
  } catch (e) {
    $("#reviews-status").textContent = "Error: " + e.message;
  }
  btn.disabled = false;
};

/* ---------- Tools: ASO Score / Listing Audit ---------- */
function normText(t) {
  return " " + (t || "").toLowerCase().replace(/[-/]/g, " ").replace(/\s+/g, " ").trim() + " ";
}
function kwIn(kw, hayNorm) {
  const k = (kw || "").toLowerCase().replace(/:/g, "").replace(/[-/]/g, " ").replace(/\s+/g, " ").trim();
  return !!k && hayNorm.includes(" " + k + " ");
}
function openAudit(a) {
  const title = a.title || "", short = a.short_desc || "", long = a.long_desc || "";
  const fullNorm = normText(title + " " + short + " " + long);
  const titleNorm = normText(title);
  const graphics = Array.isArray(a.graphics) ? a.graphics : (a.graphic ? [a.graphic] : []);
  const fmtPts = n => String(Math.round(n * 10) / 10);
  const parts = [];
  const pTitle = Math.min(10, title.length / 30 * 10);
  const pShort = Math.min(10, short.length / 80 * 10);
  const pLong = Math.min(10, Math.min(long.length, 2000) / 2000 * 10);
  const pGraphic = graphics.length ? 10 : 0;
  const pGraphics3 = graphics.length >= 3 ? 5 : 0;
  parts.push({ label: "Title length", val: pTitle, max: 10 });
  parts.push({ label: "Short description length", val: pShort, max: 10 });
  parts.push({ label: "Long description length", val: pLong, max: 10 });
  let saved = null;
  try {
    const all = JSON.parse(localStorage.getItem("rr_last_research") || "{}");
    saved = a.package ? all[a.package] : null;
  } catch (e) { saved = null; }
  let pCoverage = null, pTitleKw = null, missing = [];
  if (saved && saved.keywords && saved.keywords.length) {
    const top20 = saved.keywords.slice(0, 20);
    const top5 = saved.keywords.slice(0, 5);
    const present = top20.filter(k => kwIn(k.keyword, fullNorm)).length;
    pCoverage = top20.length ? present / top20.length * 50 : 0;
    pTitleKw = top5.some(k => kwIn(k.keyword, titleNorm)) ? 5 : 0;
    missing = saved.keywords.slice(0, 10).filter(k => !kwIn(k.keyword, fullNorm));
  }
  parts.push({ label: "Keyword coverage (top 20 research keywords)", val: pCoverage, max: 50 });
  parts.push({ label: "A top-5 keyword in the title", val: pTitleKw, max: 5 });
  parts.push({ label: "Feature graphic set", val: pGraphic, max: 10 });
  parts.push({ label: "3 or more graphics", val: pGraphics3, max: 5 });
  const partial = pCoverage === null;
  const total = pTitle + pShort + pLong + pGraphic + pGraphics3 + (partial ? 0 : pCoverage + pTitleKw);
  const maxTotal = partial ? 45 : 100;
  $("#audit-title").textContent = "ASO Score — " + a.name;
  $("#audit-score").textContent = Math.round(total);
  $("#audit-bar").style.width = Math.min(100, total / maxTotal * 100) + "%";
  $("#audit-note").textContent = partial
    ? "Partial score — run Keyword Research for this app to unlock the full 100-point score. (This is " + Math.round(total) + " of the 45 points available without research.)"
    : "Full 100-point score — your listing measured against the last keyword research for this app (" + (saved.appName || a.name) + ").";
  const bd = $("#audit-breakdown"); bd.innerHTML = "";
  parts.forEach(p => {
    const div = document.createElement("div");
    div.className = "audit-part";
    const num = document.createElement("div");
    num.className = "ap-num";
    num.textContent = p.val === null ? "—" : fmtPts(p.val) + " / " + p.max;
    const lab = document.createElement("div");
    lab.className = "ap-label";
    lab.textContent = p.label + (p.val === null ? " — needs research" : "");
    div.appendChild(num); div.appendChild(lab);
    bd.appendChild(div);
  });
  const sugg = [];
  missing.forEach(k => {
    sugg.push("Add '" + k.keyword + "' (popularity " + k.popularity + ")" + (k.gap ? " — GAP keyword" : "") + " — competitors use it, your listing doesn't.");
  });
  if (title.length < 27) sugg.push("Your title uses " + title.length + " of 30 characters — use the full space for a strong keyword.");
  if (short.length < 72) sugg.push("Your short description uses " + short.length + " of 80 characters — add a keyword-rich phrase.");
  if (long.length < 1800) sugg.push("Your long description is " + long.length + " characters — aim for at least 2,000 characters with your main keywords worked in naturally.");
  if (!graphics.length) sugg.push("Add a feature graphic (1024 × 500) — it is the first thing users see on your listing.");
  if (!sugg.length) sugg.push("Your listing looks strong — no major gaps found. 🎉");
  const ul = $("#audit-suggestions"); ul.innerHTML = "";
  sugg.forEach(s => { const li = document.createElement("li"); li.textContent = s; ul.appendChild(li); });
  const panel = $("#audit-panel");
  panel.classList.remove("hidden");
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}
$("#audit-close").onclick = () => $("#audit-panel").classList.add("hidden");

/* ---------- Final update: Competitor Tracker ---------- */
function loadTracker() {
  try { return JSON.parse(localStorage.getItem("rr_tracker") || "{}"); } catch (e) { return {}; }
}
/* ---------- AppTweak pack: tracker change badges (vs previous snapshot) ---------- */
function snapOf(x) {
  if (!x) return null;
  return {
    installs: x.installs || "",
    score: x.score || 0,
    ratings: x.ratings || 0,
    title: x.title || "",
    short_len: x.short_len != null ? x.short_len : (x.summary || "").length,
    long_len: x.long_len != null ? x.long_len : (x.description || "").length,
  };
}
function diffChips(prev, cur) {
  const out = [];
  if (!prev || !cur) return out;
  if (prev.score && cur.score && Math.abs(prev.score - cur.score) >= 0.005) {
    out.push({ text: "★ " + (+prev.score).toFixed(2) + " → " + (+cur.score).toFixed(2), cls: cur.score > prev.score ? "diff-up" : "diff-down" });
  }
  if ((prev.ratings || 0) !== (cur.ratings || 0)) {
    out.push({ text: "Ratings " + (prev.ratings || 0).toLocaleString("en-US") + " → " + (cur.ratings || 0).toLocaleString("en-US"), cls: (cur.ratings || 0) > (prev.ratings || 0) ? "diff-up" : "diff-down" });
  }
  if (prev.installs && cur.installs && prev.installs !== cur.installs) {
    out.push({ text: "Installs " + prev.installs + " → " + cur.installs, cls: "diff-note" });
  }
  if ((prev.title || "") !== (cur.title || "")) {
    out.push({ text: "Title changed", cls: "diff-note" });
  }
  if ((prev.short_len || 0) !== (cur.short_len || 0)) {
    out.push({ text: "Short desc " + (prev.short_len || 0) + " → " + (cur.short_len || 0) + " chars", cls: "diff-note" });
  }
  if ((prev.long_len || 0) !== (cur.long_len || 0)) {
    out.push({ text: "Long desc " + (prev.long_len || 0) + " → " + (cur.long_len || 0) + " chars", cls: "diff-note" });
  }
  return out;
}
function renderDiffs(box, prev, cur) {
  const ds = diffChips(prev, cur);
  if (!ds.length) return;
  const line = document.createElement("div");
  line.className = "diff-line";
  const lab = document.createElement("span");
  lab.className = "diff-label";
  lab.textContent = "Since last research:";
  line.appendChild(lab);
  ds.forEach(d => {
    const s = document.createElement("span");
    s.className = "diff-chip " + d.cls;
    s.textContent = d.text;
    line.appendChild(s);
  });
  box.appendChild(line);
}
function saveTracker() {
  // App mode only: keep the full competitor set (copy, keywords, graphics,
  // screenshots) plus the untapped ideas for the Tracker page. Storage can
  // be full (long descriptions are big) - fail silently, research must
  // never break because of this.
  if (!RESEARCH || !RESEARCH.target || !RESEARCH.target.appId || !RESEARCH.target_details) return;
  try {
    const all = loadTracker();
    // Keep the previous snapshot's key numbers so the Tracker can show
    // what changed since the last research (badges). First-time tracking
    // has no prev, so no badges are shown.
    const old = all[RESEARCH.target.appId];
    let prev = null;
    if (old) {
      prev = { target: snapOf(old.target), competitors: {} };
      (old.competitors || []).forEach(c => { if (c.appId) prev.competitors[c.appId] = snapOf(c); });
    }
    all[RESEARCH.target.appId] = {
      ts: Date.now(),
      appName: RESEARCH.target.title || (RESEARCH_MY || {}).name || "",
      country: RESEARCH.country || "US",
      target: RESEARCH.target_details,
      competitors: RESEARCH.competitors || [],
      untapped: RESEARCH.untapped || [],
      prev: prev,
    };
    localStorage.setItem("rr_tracker", JSON.stringify(all));
  } catch (e) { /* storage full - tracker data just won't persist */ }
}
let TRACKER_APP = "";
function renderTracker() {
  const all = loadTracker();
  const ids = Object.keys(all).sort((a, b) => (all[b].ts || 0) - (all[a].ts || 0));
  const empty = $("#t-empty"), content = $("#t-content");
  if (!ids.length) {
    empty.classList.remove("hidden");
    content.classList.add("hidden");
    return;
  }
  empty.classList.add("hidden");
  content.classList.remove("hidden");
  if (!TRACKER_APP || !all[TRACKER_APP]) TRACKER_APP = ids[0]; // most recent by default
  const sel = $("#t-app");
  sel.innerHTML = "";
  ids.forEach(id => {
    const o = document.createElement("option");
    o.value = id;
    o.textContent = all[id].appName || id;
    sel.appendChild(o);
  });
  sel.value = TRACKER_APP;
  const entry = all[TRACKER_APP];
  renderTrackerTarget(entry);
  renderTrackerCategory(entry);
  renderTrackerUntapped(entry);
  renderTrackerCards(entry);
}
function renderTrackerTarget(entry) {
  const box = $("#t-target");
  box.innerHTML = "";
  const t = entry.target || {};
  if (t.header_image) {
    const img = document.createElement("img");
    img.className = "t-banner";
    img.src = t.header_image;
    img.alt = "";
    box.appendChild(img);
  }
  const meta = document.createElement("div");
  meta.className = "t-target-meta";
  const h = document.createElement("h3");
  h.textContent = t.title || entry.appName || "";
  meta.appendChild(h);
  const chip = (label, val) => {
    if (val === "" || val === null || val === undefined) return;
    const s = document.createElement("span");
    s.className = "meta-chip";
    s.innerHTML = label + " <b></b>";
    s.querySelector("b").textContent = val;
    meta.appendChild(s);
  };
  chip("Installs", t.installs);
  chip("Rating", t.score ? (+t.score).toFixed(2) : "");
  chip("Ratings", t.ratings ? (+t.ratings).toLocaleString("en-US") : "");
  chip("Category", t.genre);
  chip("Updated", fmtUpdated(t.updated));
  box.appendChild(meta);
  renderDiffs(box, entry.prev && entry.prev.target, snapOf(t));
}
function renderTrackerUntapped(entry) {
  const box = $("#t-untapped");
  box.innerHTML = "";
  const ideas = entry.untapped || [];
  $("#t-untapped-count").textContent = ideas.length + " ideas";
  if (!ideas.length) {
    box.innerHTML = '<p class="muted">No untapped ideas from the last research for this app — every phrase and combination is already used by a competitor.</p>';
    return;
  }
  ideas.forEach(u => {
    const row = document.createElement("div");
    row.className = "untapped-row";
    const kw = document.createElement("span");
    kw.className = "kw";
    kw.textContent = u.keyword;
    const tag = document.createElement("span");
    tag.className = "src-tag";
    tag.textContent = u.source === "your-unique" ? "ONLY IN YOUR APP" : "NEW COMBO";
    const btn = document.createElement("button");
    btn.className = "btn small";
    btn.textContent = "Check competition";
    const res = document.createElement("span");
    btn.onclick = async () => {
      btn.disabled = true;
      res.textContent = "Checking…";
      try {
        const d = await api("/api/untapped_check", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keyword: u.keyword, country: entry.country || "US" }) });
        res.innerHTML = "";
        const lvl = document.createElement("span");
        lvl.className = "lvl lvl-" + d.level;
        lvl.textContent = d.level === "low" ? "Low competition" : d.level === "medium" ? "Medium competition" : "High competition";
        res.appendChild(lvl);
        const det = document.createElement("span");
        det.className = "muted";
        det.textContent = " — strongest of the top apps has " + (+d.top_installs).toLocaleString("en-US") + " installs (" + d.apps_found + " apps found)";
        res.appendChild(det);
      } catch (e) {
        res.textContent = "Could not check: " + e.message;
      }
      btn.disabled = false;
    };
    row.appendChild(kw); row.appendChild(tag); row.appendChild(btn); row.appendChild(res);
    box.appendChild(row);
  });
}
function renderTrackerCards(entry) {
  const box = $("#t-cards");
  box.innerHTML = "";
  const comps = entry.competitors || [];
  $("#t-comp-count").textContent = comps.length + " apps";
  comps.forEach(c => {
    const card = document.createElement("div");
    card.className = "tracker-card";
    if (c.header_image) {
      const b = document.createElement("img");
      b.className = "tc-banner";
      b.src = c.header_image;
      b.alt = "";
      b.loading = "lazy";
      card.appendChild(b);
    }
    const body = document.createElement("div");
    body.className = "tracker-body";
    const head = document.createElement("div");
    head.className = "tracker-head";
    if (c.icon) {
      const ic = document.createElement("img");
      ic.src = c.icon;
      ic.alt = "";
      head.appendChild(ic);
    }
    const ht = document.createElement("div");
    const h3 = document.createElement("h3");
    h3.textContent = c.title || c.appId || "";
    const dev = document.createElement("div");
    dev.className = "dev";
    dev.textContent = c.developer || "";
    ht.appendChild(h3); ht.appendChild(dev);
    head.appendChild(ht);
    body.appendChild(head);
    const meta = document.createElement("div");
    meta.className = "t-target-meta";
    const chip = (label, val) => {
      if (val === "" || val === null || val === undefined) return;
      const s = document.createElement("span");
      s.className = "meta-chip";
      s.innerHTML = label + " <b></b>";
      s.querySelector("b").textContent = val;
      meta.appendChild(s);
    };
    chip("Installs", c.installs);
    chip("Rating", c.score ? (+c.score).toFixed(1) : "");
    chip("Ratings", c.ratings ? (+c.ratings).toLocaleString("en-US") : "");
    const link = document.createElement("a");
    link.href = c.url || ("https://play.google.com/store/apps/details?id=" + (c.appId || ""));
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "Open in Play Store ↗";
    meta.appendChild(link);
    body.appendChild(meta);
    renderDiffs(body, entry.prev && entry.prev.competitors && entry.prev.competitors[c.appId], snapOf(c));
    const addText = (label, text, clamp) => {
      if (!text) return;
      const lab = document.createElement("div");
      lab.className = "tc-label";
      lab.textContent = label;
      const div = document.createElement("div");
      div.className = "tc-text" + (clamp ? " clamp4" : "");
      div.textContent = text;
      body.appendChild(lab);
      body.appendChild(div);
      if (clamp && text.length > 400) {
        const tog = document.createElement("button");
        tog.className = "btn small";
        tog.style.marginTop = "6px";
        tog.textContent = "Show more";
        tog.onclick = () => {
          const open = div.classList.toggle("open");
          tog.textContent = open ? "Show less" : "Show more";
        };
        body.appendChild(tog);
      }
    };
    addText("Title", c.title, false);
    addText("Short description", c.summary, false);
    addText("Long description", c.description, true);
    if (c.keywords && c.keywords.length) {
      const lab = document.createElement("div");
      lab.className = "tc-label";
      lab.textContent = "Its keywords";
      body.appendChild(lab);
      const chips = document.createElement("div");
      chips.className = "kw-chips";
      c.keywords.forEach(k => {
        const s = document.createElement("span");
        s.className = "kw-chip";
        s.textContent = k;
        chips.appendChild(s);
      });
      body.appendChild(chips);
    }
    if (c.screenshots && c.screenshots.length) {
      const lab = document.createElement("div");
      lab.className = "tc-label";
      lab.textContent = "Screenshots";
      body.appendChild(lab);
      const shots = document.createElement("div");
      shots.className = "tc-shots";
      c.screenshots.slice(0, 3).forEach(src => {
        const im = document.createElement("img");
        im.src = src;
        im.alt = "";
        im.loading = "lazy";
        shots.appendChild(im);
      });
      body.appendChild(shots);
    }
    card.appendChild(body);
    box.appendChild(card);
  });
}
/* ---------- AppTweak pack: category top chart (Tracker view) ---------- */
function renderTrackerCategory(entry) {
  const list = $("#t-cat-list");
  if (list) list.innerHTML = "";
  const badge = $("#t-cat-count");
  if (badge) badge.textContent = "";
  const st = $("#t-cat-status");
  if (st) st.textContent = "";
  const note = $("#t-cat-note");
  const t = (entry && entry.target) || {};
  if (note) {
    note.textContent = t.genre
      ? "The current top free apps in this app's Play Store category (" + t.genre + ") — a live chart, fetched only when you ask."
      : "Run Keyword Research for this app again to record its Play Store category, then this chart can load.";
  }
}
$("#t-cat-load").onclick = async () => {
  const entry = loadTracker()[TRACKER_APP];
  if (!entry) return;
  const status = $("#t-cat-status");
  const genreId = (entry.target || {}).genreId || "";
  if (!genreId) { status.textContent = "No category recorded for this app yet — re-run its research first."; return; }
  const btn = $("#t-cat-load");
  btn.disabled = true;
  status.textContent = "Loading the category chart…";
  try {
    const d = await api("/api/category_top", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ genreId, country: entry.country || "US" }) });
    const box = $("#t-cat-list");
    box.innerHTML = "";
    if (d.unavailable) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = d.unavailable;
      box.appendChild(p);
      status.textContent = "";
      btn.disabled = false;
      return;
    }
    const apps = d.apps || [];
    $("#t-cat-count").textContent = apps.length + " apps";
    apps.forEach((a, i) => {
      const row = document.createElement("div");
      row.className = "cat-row";
      const rk = document.createElement("span");
      rk.className = "cat-rank";
      rk.textContent = "#" + (i + 1);
      row.appendChild(rk);
      if (a.icon) { const img = document.createElement("img"); img.src = a.icon; img.alt = ""; row.appendChild(img); }
      const tx = document.createElement("div");
      const t1 = document.createElement("div");
      t1.style.fontWeight = "600";
      t1.textContent = a.title || a.appId;
      const t2 = document.createElement("div");
      t2.className = "muted";
      t2.style.fontSize = "12.5px";
      t2.textContent = a.developer || "";
      tx.appendChild(t1); tx.appendChild(t2);
      row.appendChild(tx);
      const meta = document.createElement("span");
      meta.className = "cat-meta";
      meta.textContent = (a.installs || "") + (a.score ? " · ★ " + (+a.score).toFixed(1) : "");
      row.appendChild(meta);
      box.appendChild(row);
    });
    status.textContent = "Done ✓";
  } catch (e) {
    status.textContent = "Error: " + e.message;
  }
  btn.disabled = false;
};

const trackerNavBtn = document.querySelector('[data-view="tracker"]');
if (trackerNavBtn) trackerNavBtn.addEventListener("click", renderTracker);
$("#t-app").addEventListener("change", e => { TRACKER_APP = e.target.value; renderTracker(); });
$("#t-goto-research").onclick = () => document.querySelector('[data-view="research"]').click();

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
