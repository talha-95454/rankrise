# ASO Workbench - localhost tool for Talha
# Free, local only. No API keys, no paid services.
# Backend: Flask + google-play-scraper (free) - competitor data + local keyword extraction.
import os, re, json, csv, io, uuid, math, datetime
from collections import Counter
from flask import Flask, request, jsonify, send_file, send_from_directory, abort

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data")
UPLOADS = os.path.join(DATA, "uploads")
os.makedirs(UPLOADS, exist_ok=True)

app = Flask(__name__, static_folder="static", template_folder="templates")

def now():
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M")

# ---------------- keyword engine (all local, free) ----------------
STOP = set("""the a an and or for to of in on with your you our it its is are be can will this that from as at by per all any no not just so do does use using used app apps free download get get more most best new 2024 2025 2026""".split())

def clean(t):
    return re.sub(r"\s+", " ", (t or "").lower())

def tokens(text):
    return re.findall(r"[a-z0-9][a-z0-9\-/]*", clean(text))

def ngrams(text, n):
    w = tokens(text)
    out = []
    for i in range(len(w) - n + 1):
        g = w[i:i + n]
        if any(x in STOP for x in g):
            continue
        out.append(" ".join(g))
    return out

def parse_installs(a):
    ri = a.get("realInstalls")
    if ri:
        return int(ri)
    s = (a.get("installs") or "0").replace(",", "").replace("+", "")
    try:
        return int(s)
    except Exception:
        return 0

def extract_keywords(competitors, seed_text, my_text):
    """Local keyword extraction with estimate scores.
    Popularity/Difficulty here are LOCAL ESTIMATES from competitor behaviour,
    not data from any paid tool."""
    core = set()
    for t in (seed_text or "", my_text or ""):
        for tok in tokens(t):
            if tok not in STOP and len(tok) > 2:
                core.add(tok)
    # words that show up in many competitor titles are also core signals
    title_word_count = Counter()
    for a in competitors:
        for tok in set(tokens(a.get("title") or "")):
            if tok not in STOP:
                title_word_count[tok] += 1
    for tok, c in title_word_count.items():
        if c >= 3 and len(tok) > 2:
            core.add(tok)

    stats = {}
    for a in competitors:
        fields = [("title", 5, a.get("title") or ""), ("summary", 3, a.get("summary") or ""), ("desc", 1, a.get("description") or "")]
        seen = set()
        for field, weight, text in fields:
            for n in (1, 2, 3):
                for g in ngrams(text, n):
                    toks = set(g.replace(":", "").split())
                    if len(g) < 3:
                        continue
                    s = stats.setdefault(g, {"keyword": g, "apps": set(), "title_apps": set(), "mentions": 0, "weighted": 0, "title_installs": []})
                    s["mentions"] += 1
                    s["weighted"] += weight
                    if g not in seen:
                        s["apps"].add(a.get("appId"))
                    if field == "title":
                        s["title_apps"].add(a.get("appId"))
                        s["title_installs"].append(parse_installs(a))
                    seen.add(g)

    total = max(1, len(competitors))
    rows = []
    for g, s in stats.items():
        toks = set(g.replace(":", "").split())
        app_count = len(s["apps"]); title_count = len(s["title_apps"])
        relevant = bool(toks & core) or title_count >= 2 or app_count >= 4
        n_words = len(g.split())
        if n_words == 3 and app_count < 3 and title_count == 0:
            relevant = False
        if n_words == 2 and app_count < 2 and title_count == 0 and not (toks & core):
            relevant = False
        if not relevant:
            continue
        # --- local popularity estimate (0-100) ---
        apps_ratio = app_count / total
        title_ratio = title_count / total
        popularity = round(apps_ratio * 55 + title_ratio * 35 + min(10, s["mentions"] / total * 10))
        popularity = max(3, min(97, popularity))
        # --- local difficulty estimate (0-100): strong apps targeting it in title = harder ---
        if s["title_installs"]:
            avg_log = sum(math.log10(max(10, x)) for x in s["title_installs"]) / len(s["title_installs"])  # ~3..8
            strength = max(0.0, min(1.0, (avg_log - 3) / 5))
        else:
            strength = 0.15
        difficulty = round(title_ratio * 45 + strength * 40 + min(15, app_count))
        difficulty = max(2, min(96, difficulty))
        score = s["weighted"] + app_count * 4 + title_count * 6
        if score < 14 and title_count == 0:
            continue
        if title_count >= 3:
            use = "Title"
        elif app_count >= max(4, total // 3):
            use = "Short description"
        else:
            use = "Long description"
        rows.append({
            "keyword": g, "popularity": popularity, "difficulty": difficulty,
            "apps_count": app_count, "in_titles": title_count, "mentions": s["mentions"],
            "score": score, "suggested_use": use,
        })
    rows.sort(key=lambda r: (-r["popularity"], -r["in_titles"], -len(r["keyword"].split()), -r["mentions"]))
    return rows[:250]

# ---------------- pages ----------------
@app.route("/")
def home():
    return send_from_directory("templates", "index.html")

# ---------------- Competitor research ----------------
@app.route("/api/research", methods=["POST"])
def research():
    d = request.get_json(force=True)
    seed = (d.get("seed") or "").strip()
    if not seed:
        return jsonify({"error": "Seed keyword is required"}), 400
    country = (d.get("country") or "US").strip().lower()
    lang = (d.get("lang") or "en").strip()
    n = int(d.get("count") or 20)
    n = max(5, min(30, n))
    my_text = d.get("my_text") or ""
    extra_seeds = [s.strip() for s in (d.get("extra_seeds") or []) if s.strip()]
    try:
        from google_play_scraper import search as gp_search, app as gp_app
    except Exception as e:
        return jsonify({"error": f"google-play-scraper not available: {e}"}), 500

    seen, results = set(), []
    for term in [seed] + extra_seeds:
        try:
            hits = gp_search(term, lang=lang, country=country, n_hits=n)
        except Exception:
            hits = []
        for h in hits:
            aid = h.get("appId")
            if aid and aid not in seen:
                seen.add(aid)
                results.append(h)
    competitors = []
    for h in results[:n]:
        try:
            det = gp_app(h["appId"], lang=lang, country=country)
        except Exception:
            det = h
        competitors.append({
            "appId": det.get("appId") or h.get("appId"),
            "title": det.get("title") or h.get("title") or "",
            "summary": det.get("summary") or h.get("summary") or "",
            "description": det.get("description") or "",
            "icon": det.get("icon") or h.get("icon") or "",
            "installs": det.get("installs") or h.get("installs") or "",
            "realInstalls": det.get("realInstalls") or 0,
            "score": det.get("score") or h.get("score") or 0,
            "ratings": det.get("ratings") or 0,
            "developer": det.get("developer") or "",
            "url": det.get("url") or f"https://play.google.com/store/apps/details?id={h.get('appId')}",
        })
    if not competitors:
        return jsonify({"error": "No competitor apps found. Check the seed keyword / internet and try again."}), 404
    keywords = extract_keywords(competitors, seed + " " + " ".join(extra_seeds), my_text)
    payload = {"seed": seed, "country": country.upper(), "created": now(),
               "competitors": competitors, "keywords": keywords}
    return jsonify(payload)

# ---------------- Sheets ----------------
def sheet_rows(body):
    country = (body.get("country") or "US").upper()
    rows = []
    for k in body.get("keywords") or []:
        if isinstance(k, str):
            rows.append([country, k, "", "", ""])
        else:
            rows.append([country, k.get("keyword", ""), k.get("popularity", ""), k.get("difficulty", ""), k.get("apps_count", "")])
    rows.sort(key=lambda r: (-(r[2] if isinstance(r[2], (int, float)) else 0), str(r[1])))
    return rows

@app.route("/api/sheet/final.csv", methods=["POST"])
def final_csv():
    body = request.get_json(force=True)
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["Country", "Keyword", "Popularity", "Difficulty", "Apps Count"])
    w.writerows(sheet_rows(body))
    name = re.sub(r"[^a-z0-9]+", "_", (body.get("app_name") or "app").lower()).strip("_") + "_final_keywords.csv"
    return send_file(io.BytesIO(out.getvalue().encode("utf-8")), as_attachment=True, download_name=name, mimetype="text/csv")

@app.route("/api/sheet/final.xlsx", methods=["POST"])
def final_xlsx():
    from openpyxl import Workbook
    body = request.get_json(force=True)
    wb = Workbook()
    ws = wb.active
    tab = re.sub(r"[\[\]\:\*\?\/\\]", " ", (body.get("app_name") or "App"))[:31].strip() or "App"
    ws.title = tab
    ws.append(["Country", "Keyword", "Popularity", "Difficulty", "Apps Count"])
    for r in sheet_rows(body):
        ws.append(r)
    for col, width in zip("ABCDE", (10, 42, 13, 12, 12)):
        ws.column_dimensions[col].width = width
    buf = io.BytesIO(); wb.save(buf); buf.seek(0)
    name = re.sub(r"[^a-z0-9]+", "_", (body.get("app_name") or "app").lower()).strip("_") + "_final_keywords.xlsx"
    return send_file(buf, as_attachment=True, download_name=name,
                     mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")

@app.route("/api/sheet/all.csv", methods=["POST"])
def all_csv():
    body = request.get_json(force=True)
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["Keyword", "Popularity (local estimate)", "Difficulty (local estimate)", "Apps Count", "In Titles", "Mentions", "Suggested Use"])
    for k in body.get("keywords") or []:
        w.writerow([k.get("keyword", ""), k.get("popularity", ""), k.get("difficulty", ""), k.get("apps_count", ""),
                    k.get("in_titles", ""), k.get("mentions", ""), k.get("suggested_use", "")])
    return send_file(io.BytesIO(out.getvalue().encode("utf-8")), as_attachment=True,
                     download_name="all_keywords.csv", mimetype="text/csv")

@app.route("/api/sheet/competitors.csv", methods=["POST"])
def comp_csv():
    body = request.get_json(force=True)
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["App", "Title", "Short Description", "Long Description", "Installs", "Rating", "Play Store URL"])
    for c in body.get("competitors") or []:
        w.writerow([c.get("appId", ""), c.get("title", ""), c.get("summary", ""), c.get("description", ""),
                    c.get("installs", ""), c.get("score", ""), c.get("url", "")])
    return send_file(io.BytesIO(out.getvalue().encode("utf-8")), as_attachment=True,
                     download_name="competitors.csv", mimetype="text/csv")

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "7860"))
    print(f"\n  RankRise - ASO Studio (public) running on port {port}\n")
    app.run(host="0.0.0.0", port=port, debug=False)
