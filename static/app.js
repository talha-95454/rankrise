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
  const r = await fetch(path, opts);
  if (!r.ok) { let m = r.statusText; try { m = (await r.json()).error || m; } catch (e) {} throw new Error(m); }
  return r.json();
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
  renderApps(); fillAppSelects(); updateStats();
}
function persistApps() { localStorage.setItem("rankrise_apps", JSON.stringify(APPS)); }
function stampNow() { return new Date().toISOString().slice(0, 16).replace("T", " "); }
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
  $("#graphic-preview").innerHTML = a.graphic ? `<img src="${a.graphic}"><div class="muted">${a.graphic_info || ""}</div>` : "";
  $("#app-form-title").textContent = "Editing: " + a.name;
  window.scrollTo({ top: 0, behavior: "smooth" });
}
$("#clear-form").onclick = () => {
  $("#f-id").value = ""; $("#f-name").value = ""; $("#f-package").value = ""; $("#f-seed").value = "";
  setVal("f-title", ""); setVal("f-short", ""); setVal("f-long", "");
  $("#f-graphic").value = ""; $("#graphic-preview").innerHTML = ""; $("#app-form-title").textContent = "Add / edit app";
};
$("#save-app").onclick = () => {
  const data = { name: $("#f-name").value, package: $("#f-package").value, seed: $("#f-seed").value,
    country: $("#f-country").value, title: $("#f-title").value, short_desc: $("#f-short").value, long_desc: $("#f-long").value };
  if (!data.name.trim()) { alert("App name is required"); return; }
  const id = $("#f-id").value || ("app" + Date.now().toString(36));
  const file = $("#f-graphic").files[0];
  const finish = (graphic, info) => {
    const existing = APPS.find(x => x.id === id);
    const item = Object.assign({}, existing || {}, data, { id, updated: stampNow() });
    if (graphic !== null) { item.graphic = graphic; item.graphic_info = info; }
    if (existing) APPS = APPS.map(x => x.id === id ? item : x); else APPS.unshift(item);
    try { persistApps(); } catch (e) { alert("Browser storage full ho gaya hai - feature graphic chhoti/compress karke try karo"); return; }
    $("#f-id").value = id;
    $("#graphic-preview").innerHTML = item.graphic ? `<img src="${item.graphic}"><div class="muted">${item.graphic_info || ""}</div>` : "";
    $("#save-msg").textContent = "Saved \u2713 " + (item.graphic_info || "");
    $("#f-graphic").value = "";
    $("#app-form-title").textContent = "Editing: " + item.name;
    renderApps(); fillAppSelects(); updateStats();
  };
  if (file) {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => finish(reader.result, img.width + " x " + img.height + "px" + ((img.width === 1024 && img.height === 500) ? " - correct size (1024 x 500)" : " - Play Store size should be 1024 x 500"));
      img.onerror = () => finish(reader.result, "saved");
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  } else finish(null, "");
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
  if (!seed) { alert("Seed keyword likho pehle"); return; }
  const extra = $("#r-extra").value.split(",").map(s => s.trim()).filter(Boolean);
  const my = RESEARCH_MY;
  $("#research-status").textContent = "Fetching competitors from Play Store… (30–60 seconds lag sakte hain)";
  $("#run-research").disabled = true;
  try {
    RESEARCH = await api("/api/research", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seed, extra_seeds: extra, country: $("#r-country").value, count: +$("#r-count").value,
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
  RESEARCH.competitors.forEach(c => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td></td><td class="ct"></td><td>${c.installs || ""}</td><td>${c.score ? (+c.score).toFixed(1) : ""}</td><td class="cs"></td>
      <td><div class="btn-row" style="margin:0">
        <button class="btn small" data-c="title">Title</button>
        <button class="btn small" data-c="summary">Short</button>
        <button class="btn small" data-c="description">Long</button>
      </div></td>`;
    const first = tr.children[0];
    if (c.icon) { const img = document.createElement("img"); img.className = "icon"; img.src = c.icon; first.appendChild(img); }
    const link = document.createElement("a"); link.href = c.url; link.target = "_blank"; link.textContent = c.developer || c.appId; first.appendChild(link);
    tr.querySelector(".ct").textContent = c.title || "";
    tr.querySelector(".cs").textContent = c.summary || "";
    tr.querySelector('[data-c="title"]').onclick = () => copyText(c.title);
    tr.querySelector('[data-c="summary"]').onclick = () => copyText(c.summary);
    tr.querySelector('[data-c="description"]').onclick = () => openModal(c.title, c.description);
    tb.appendChild(tr);
  });
  $("#kw-count").textContent = RESEARCH.keywords.length + " keywords";
  const kb = $("#kw-table tbody"); kb.innerHTML = "";
  RESEARCH.keywords.forEach((k, i) => {
    const tr = document.createElement("tr");
    tr.dataset.kw = k.keyword;
    tr.innerHTML = `<td><input type="checkbox" ${i < 60 ? "checked" : ""}></td><td class="kk"></td>
      <td><b>${k.popularity}</b></td><td>${k.difficulty}</td><td>${k.apps_count}</td><td>${k.in_titles}</td><td>${k.mentions}</td><td>${k.suggested_use}</td>`;
    tr.querySelector(".kk").textContent = k.keyword;
    kb.appendChild(tr);
  });
}
$("#kw-search").addEventListener("input", e => {
  const q = e.target.value.toLowerCase();
  $$("#kw-table tbody tr").forEach(tr => tr.style.display = tr.dataset.kw.includes(q) ? "" : "none");
});
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
  if (!COUNTER_APP) { $("#c-msg").textContent = "Pehle upar se app select karo"; return; }
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
