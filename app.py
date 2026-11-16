# ASO Workbench - localhost tool for Talha
# Free, local only. No API keys, no paid services.
# Backend: Flask + google-play-scraper (free) - competitor data + local keyword extraction.
import os, re, json, csv, io, uuid, math, datetime
from collections import Counter
from flask import Flask, request, jsonify, send_file, send_from_directory, abort

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data")
UPLOADS = os.path.join(DATA, "uploads")
try:
    os.makedirs(UPLOADS, exist_ok=True)
except Exception:
    import tempfile
    UPLOADS = os.path.join(tempfile.gettempdir(), "rankrise_uploads")
    os.makedirs(UPLOADS, exist_ok=True)

app = Flask(__name__, static_folder="static", template_folder="templates")

def now():
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M")

# ---------------- keyword engine (all local, free) ----------------
STOP = set("""the a an and or for to of in on with your you our it its is are be can will this that from as at by per all any no not just so do does use using used app apps free download get get more most best new 2024 2025 2026""".split())

# Generic single words that are never useful ASO keywords on their own.
# In strict (app) mode they are always dropped unless they are a core term
# of the target app's title. Multi-word keywords are never blocklisted.
BLOCKLIST = set("""disclaimer only help app use used using get one two way ways also just like make made new best top free pro hd 2024 2025 2026 features feature enjoy welcome thanks thank please note information experience world life daily today""".split())

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

def mark_best(rows):
    """Best-for-ASO score on every keyword + a 'best' flag on the top 20.
    best_score rewards high popularity and low difficulty; GAP keywords
    (missing from the owner's own app) get a +10 bonus."""
    for r in rows:
        r["best_score"] = round(r["popularity"] * (100 - r["difficulty"]) / 100) + (10 if r.get("gap") is True else 0)
        r["best"] = False
    for r in sorted(rows, key=lambda r: (-r["best_score"], -r["popularity"]))[:20]:
        r["best"] = True
    return rows

def extract_keywords(competitors, seed_text, my_text, core_terms=None, strict=False, stats_out=None):
    """Local keyword extraction with estimate scores.
    Popularity/Difficulty here are LOCAL ESTIMATES from competitor behaviour,
    not data from any paid tool.
    strict=True (app mode) additionally drops keywords unrelated to the target
    app: a keyword is related when it contains a core term, appears in the
    titles/short descriptions of 2+ competitors, is used by >= 1/3 of the
    competitors anywhere (min 4 — e.g. "fingerprint scanner" lives in
    descriptions, rarely in titles), or appears in the target's
    own metadata. Generic single words (BLOCKLIST) are always dropped unless
    they are core terms. stats_out, when given, receives {"keywords": dropped}."""
    core_terms = set(core_terms or [])
    dropped_kw = 0
    # --- gap detection: is a keyword ABSENT from the owner's own metadata? ---
    # my_text = the target app's own title + summary + description. When it is
    # empty (pure seed mode) gap stays None - never fabricated.
    my_norm = ""
    if my_text and my_text.strip():
        my_norm = " " + re.sub(r"\s+", " ", clean(my_text).replace("-", " ").replace("/", " ")) + " "

    def is_gap(kw):
        if not my_norm:
            return None
        k_norm = re.sub(r"\s+", " ", kw.replace(":", "").replace("-", " ").replace("/", " ")).strip()
        return (" " + k_norm + " ") not in my_norm

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
                    s = stats.setdefault(g, {"keyword": g, "apps": set(), "title_apps": set(), "ts_apps": set(), "mentions": 0, "weighted": 0, "title_installs": []})
                    s["mentions"] += 1
                    s["weighted"] += weight
                    if g not in seen:
                        s["apps"].add(a.get("appId"))
                    if field in ("title", "summary"):
                        s["ts_apps"].add(a.get("appId"))
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
        if strict and len(s["ts_apps"]) >= 2:
            relevant = True  # rule (b): appears in titles/short descriptions of 2+ competitors
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
        if strict:
            # Blocklist first: a generic single word is always dropped in app
            # mode unless it is one of the target app's own core terms.
            gw = g.replace(":", "").strip()
            if len(gw.split()) == 1 and gw in BLOCKLIST and gw not in core_terms:
                dropped_kw += 1
                continue
            # Related = contains a core term, or shows up in the titles/short
            # descriptions of 2+ selected competitors, or in the target's own text,
            # or is used by >= 1/3 of competitors anywhere (min 4). That last
            # rule rescues description-heavy keywords: "fingerprint scanner"
            # appears in 21/30 Lie Detector competitors' descriptions but
            # rarely in titles, so the old title/short-only rule dropped a
            # top GAP keyword. A keyword used by a third of competitors is
            # topic-related by definition — except a phrase containing a
            # blocklisted word ("entertainment only if", "need help contact"),
            # which is boilerplate, not a keyword. The blocklist check above
            # still wins, so generic noise (disclaimer / only / help) stays out.
            widespread = app_count >= max(4, total // 3) and not (toks & BLOCKLIST)
            related = bool(toks & core_terms) or len(s["ts_apps"]) >= 2 or widespread
            if not related and my_norm:
                k_norm = re.sub(r"\s+", " ", gw.replace("-", " ").replace("/", " ")).strip()
                related = (" " + k_norm + " ") in my_norm
            if not related:
                dropped_kw += 1
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
            "score": score, "suggested_use": use, "gap": is_gap(g),
        })
    if stats_out is not None:
        stats_out["keywords"] = dropped_kw
    rows.sort(key=lambda r: (-r["popularity"], -r["in_titles"], -len(r["keyword"].split()), -r["mentions"]))
    mark_best(rows)
    return rows[:500]

# ---------------- pages ----------------
@app.route("/")
def home():
    return send_from_directory("templates", "index.html")

@app.route("/api/ping")
def ping():
    return jsonify({"ok": True})

# ---------------- Competitor research ----------------
YEAR_RE = re.compile(r"\b(?:19|20)\d{2}\b")

def normalize_title(t):
    """Lowercase, drop year tokens and punctuation, collapse spaces - for title matching."""
    t = YEAR_RE.sub(" ", (t or "").lower())
    t = re.sub(r"[^a-z0-9]+", " ", t)
    return re.sub(r"\s+", " ", t).strip()

def title_similarity(a, b):
    """0..1 similarity between two normalized titles (token overlap, containment bonus)."""
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    sa, sb = set(a.split()), set(b.split())
    jacc = len(sa & sb) / max(1, len(sa | sb))
    contain = 0.85 if (a in b or b in a) else 0.0
    return max(jacc, contain)

def derive_title_phrases(title):
    """Build Play Store search phrases from an app title, year tokens stripped.
    'Lie Detector Test - Prank 2026' -> ['lie detector test prank', 'lie detector test',
    'lie detector prank', ...]. Also includes every contiguous 2- and 3-word
    window of the title ('hair clipper', 'clipper prank'): a single-segment
    title otherwise yields only its full phrase, and a niche's biggest apps
    often rank under the shorter windows, never under the full phrase."""
    no_year = YEAR_RE.sub(" ", title or "")
    segments = re.split(r"[-:|/–—]+", no_year)
    seg_words = []
    for seg in segments:
        w = tokens(seg)
        if w:
            seg_words.append(w)
    phrases = []
    def add(words):
        p = " ".join(words).strip()
        if p and p not in phrases:
            phrases.append(p)
    all_words = [w for seg in seg_words for w in seg]
    if len(all_words) >= 2:
        add(all_words)
    for w in seg_words:
        if len(w) >= 2:
            add(w)
    if len(seg_words) >= 2:
        first = seg_words[0]
        for other in seg_words[1:]:
            add(first + other)
            add(first[:2] + other)
            add(first[:3] + other)
    # Contiguous 3- then 2-word windows of the whole title, left to right.
    for size in (3, 2):
        for i in range(len(all_words) - size + 1):
            add(all_words[i:i + size])
    if not phrases and all_words:
        add(all_words)
    return phrases

def derive_core_terms(title):
    """Core terms of a target app: the content words of its title (years and
    numbers stripped, stopwords/generic words removed) plus its title phrases.
    Returns (words_set, phrases_list)."""
    no_year = YEAR_RE.sub(" ", title or "")
    words = set()
    for tok in tokens(no_year):
        if tok in STOP or tok.isdigit() or len(tok) < 2:
            continue
        words.add(tok)
    return words, derive_title_phrases(title)

def competitor_keywords(comp):
    """Top 15 keywords of ONE app, from its own title (weight 5), short
    description (3) and long description (1) - the same tokens()/ngrams()
    machinery as extract_keywords, but single-app, so no popularity or
    difficulty. Generic single words (STOP / BLOCKLIST) are dropped."""
    stats = {}
    fields = [(5, comp.get("title") or ""), (3, comp.get("summary") or ""), (1, comp.get("description") or "")]
    for weight, text in fields:
        for n in (1, 2, 3):
            for g in ngrams(text, n):
                if len(g) < 3:
                    continue
                if n == 1 and (g in STOP or g in BLOCKLIST):
                    continue
                stats[g] = stats.get(g, 0) + weight
    ranked = sorted(stats.items(), key=lambda kv: (-kv[1], -len(kv[0].split()), kv[0]))
    return [g for g, _ in ranked[:15]]

def fetch_details(hits, lang, country, gp_app):
    """Fetch full Play Store details for search hits -> competitor dicts."""
    competitors = []
    for h in hits:
        try:
            det = gp_app(h["appId"], lang=lang, country=country)
        except Exception:
            det = h
        title = det.get("title") or h.get("title") or ""
        summary = det.get("summary") or h.get("summary") or ""
        description = det.get("description") or ""
        comp = {
            "appId": det.get("appId") or h.get("appId"),
            "title": title,
            "summary": summary,
            "description": description,
            "icon": det.get("icon") or h.get("icon") or "",
            "header_image": det.get("headerImage") or "",
            "screenshots": (det.get("screenshots") or [])[:3],
            "installs": det.get("installs") or h.get("installs") or "",
            "realInstalls": det.get("realInstalls") or 0,
            "score": det.get("score") or h.get("score") or 0,
            "ratings": det.get("ratings") or 0,
            "developer": det.get("developer") or "",
            "title_len": len(title),
            "short_len": len(summary),
            "long_len": len(description),
            "updated": det.get("updated") or "",
            "version": det.get("version") or "",
            "url": det.get("url") or f"https://play.google.com/store/apps/details?id={h.get('appId')}",
        }
        comp["keywords"] = competitor_keywords(comp)
        competitors.append(comp)
    return competitors

def find_target_candidates(gp_search, app_name, phrases, lang, country):
    """ALL apps whose normalized title exactly matches the requested name.
    Several different apps can share one title ('Hair Clipper Prank' has at
    least four, from different developers), so an exact title alone does NOT
    identify the owner's app. Returns candidate dicts with the fields the
    frontend picker shows."""
    name_n = normalize_title(app_name)
    out, seen = [], set()
    for q in [app_name] + phrases[:2]:
        try:
            hits = gp_search(q, lang=lang, country=country, n_hits=30)
        except Exception:
            hits = []
        for h in hits:
            aid = h.get("appId")
            if not aid or aid in seen:
                continue
            seen.add(aid)
            if normalize_title(h.get("title") or "") == name_n:
                out.append({
                    "appId": aid,
                    "title": h.get("title") or "",
                    "developer": h.get("developer") or "",
                    "installs": h.get("installs") or "",
                    "realInstalls": h.get("realInstalls") or 0,
                    "score": h.get("score") or 0,
                    "icon": h.get("icon") or "",
                    "summary": h.get("summary") or "",
                })
    return out

def _candidate_score(cand, my_text):
    """How likely an exact-title candidate is the owner's own app, judged
    against the metadata the owner saved for it (my_text = their title +
    short + long description). A candidate whose own short description
    appears verbatim inside my_text is decisive - only the real app can
    match that. Otherwise the token overlap between the candidate's
    title+summary and my_text decides."""
    if not my_text:
        return 0
    summary = cand.get("summary") or ""
    if summary and _phrase_in(summary, _norm_blob(my_text)):
        return 1000
    cand_words = set(tokens((cand.get("title") or "") + " " + summary))
    return len(cand_words & set(tokens(my_text)))

def enrich_candidate_summaries(candidates, gp_app, lang, country):
    """Search hits carry no short description in this scraper version (their
    'summary' is empty; their 'description' is a long-description snippet),
    so fetch each candidate's real summary from its store details. Without
    it, same-title candidates are indistinguishable - they all share the
    title, so title-only scoring always ties and the biggest app wins."""
    for c in candidates:
        if c.get("summary"):
            continue
        try:
            det = gp_app(c["appId"], lang=lang, country=country)
        except Exception:
            det = None
        if det:
            c["summary"] = det.get("summary") or ""
    return candidates

def select_target(candidates, my_text):
    """Pick among exact-title candidates. Returns (chosen, ambiguous).
    A single candidate, or a clear my_text winner, is unambiguous; with no
    clear winner the highest-installs candidate is used but flagged
    ambiguous so the owner can correct it in the picker."""
    if len(candidates) == 1:
        return candidates[0], False
    if my_text:
        scored = sorted(candidates, key=lambda c: -_candidate_score(c, my_text))
        top = _candidate_score(scored[0], my_text)
        second = _candidate_score(scored[1], my_text)
        if top > second and top > 0:
            return scored[0], False
    return sorted(candidates, key=lambda c: -parse_installs(c))[0], True

def find_target_fuzzy(gp_search, app_name, phrases, lang, country):
    """Fallback when no app carries the exact title: the closest title
    match across the same searches, or None if nothing is plausible."""
    name_n = normalize_title(app_name)
    best, best_score = None, 0.0
    seen = set()
    for q in [app_name] + phrases[:2]:
        try:
            hits = gp_search(q, lang=lang, country=country, n_hits=30)
        except Exception:
            hits = []
        for h in hits:
            aid = h.get("appId")
            if not aid or aid in seen:
                continue
            seen.add(aid)
            s = title_similarity(name_n, normalize_title(h.get("title") or ""))
            if s > best_score:
                best, best_score = h, s
    return best if best_score >= 0.4 else None

def title_relevance(comp_title, core_words, phrases):
    """How strongly a competitor title matches the target app's title phrases."""
    ct = clean(comp_title)
    score = 0
    for p in phrases:
        if p and p in ct:
            score += 10 + len(p.split())
    score += 3 * len(set(tokens(ct)) & core_words)
    return score

def competitor_relevance(comp_title, core_terms, phrases):
    """Strict relevance of a candidate competitor to the target app.
    A title-phrase match counts most, then the number of distinct core terms
    in the competitor's title. 0 = no phrase and no core term (off-topic)."""
    ct = normalize_title(comp_title)
    if not ct:
        return 0
    score = 0
    for p in phrases:
        pn = normalize_title(p)
        if pn and len(pn.split()) >= 2 and pn in ct:
            score += 100 + 10 * len(pn.split())
    score += 10 * len(set(ct.split()) & core_terms)
    return score

# ---------------- Untapped keyword suggester (app mode only) ----------------
# Rule-based ideas for keywords NO competitor uses: phrases only the owner's
# own app has, plus new combinations of its title phrases / core terms with
# the modifiers below. There is deliberately no search-volume data behind
# these - they are ideas to test, and /api/untapped_check shows how strong
# the current top apps for a phrase are.
UNTAPPED_MODIFIERS = ["simulator", "scanner", "test", "prank", "funny", "joke", "jokes", "real", "fake", "free", "pro", "hd", "online", "offline", "game", "games", "challenge", "party", "friends", "family", "voice", "sound", "touch", "shock", "electric", "ultimate", "master", "expert", "best", "top", "new", "2026", "detector", "truth", "dare"]

def _norm_blob(t):
    """Normalize text for phrase containment checks, in the same style as
    the gap check in extract_keywords: lowercase, '-' '/' ':' become spaces,
    whitespace collapsed, padded with spaces so matches are whole phrases."""
    return " " + re.sub(r"\s+", " ", clean(t or "").replace("-", " ").replace("/", " ").replace(":", " ")) + " "

def _phrase_in(phrase, blob):
    p = re.sub(r"\s+", " ", (phrase or "").replace(":", "").replace("-", " ").replace("/", " ")).strip()
    return bool(p) and (" " + p + " ") in blob

def build_untapped(competitors, own_text, core_terms, phrases):
    """Keyword ideas that appear in NO competitor's title/summary/description.
    Ranked: title-phrase combos first, then core-word combos, then phrases
    only the owner's own app uses ('your-unique'). Capped at 30."""
    comp_blob = _norm_blob(" ".join(
        " ".join(x for x in [c.get("title") or "", c.get("summary") or "", c.get("description") or ""] if x)
        for c in competitors))
    own_blob = _norm_blob(own_text)
    out, seen = [], set()

    def add(kw, source):
        k = " ".join((kw or "").split()).strip()
        if not k or k in seen:
            return
        seen.add(k)
        out.append({"keyword": k, "source": source})

    def combo_ok(cand):
        # No blocklisted word, unless that word is one of the app's own core
        # terms (e.g. a title that itself contains 'best' or 'test').
        if any(w in BLOCKLIST and w not in core_terms for w in cand.split()):
            return False
        return not _phrase_in(cand, comp_blob) and not _phrase_in(cand, own_blob)

    # (2a) combos from the title phrases - the full title phrase comes first
    # in derive_title_phrases order; modifiers are the outer loop so the
    # ideas spread across all the title's phrases instead of one phrase
    # hogging the whole list.
    phrase_bases = [p for p in phrases if len(p.split()) >= 2]
    for m in UNTAPPED_MODIFIERS:
        for base in phrase_bases:
            if m in base.split():
                continue
            if combo_ok(base + " " + m):
                add(base + " " + m, "combo")
            if combo_ok(m + " " + base):
                add(m + " " + base, "combo")
    # (2b) combos from single core words
    for m in UNTAPPED_MODIFIERS:
        for core in sorted(core_terms):
            if m == core:
                continue
            if combo_ok(core + " " + m):
                add(core + " " + m, "combo")
            if combo_ok(m + " " + core):
                add(m + " " + core, "combo")
    # (1) phrases only the owner's own app uses, most frequent first
    counts = Counter()
    for n in (2, 3):
        for g in ngrams(own_text or "", n):
            counts[g] += 1
    for g, _cnt in counts.most_common():
        if any(w in BLOCKLIST for w in g.split()):
            continue
        if _phrase_in(g, comp_blob):
            continue
        add(g, "your-unique")
    return out[:30]

def research_by_app(app_name, seed, extra_seeds, country, lang, n, my_text, gp_search, gp_app, app_id=""):
    """Accuracy mode: find the owner's app, then research THAT app's own competitors.
    Target identification, in priority order: (1) an explicit package ID is
    fetched directly - the only identification that cannot land on a
    same-named stranger's app; (2) among the apps that share the exact title,
    the one whose own short description matches the owner's saved metadata;
    (3) a single exact-title match; (4) the highest-installs exact match,
    flagged ambiguous so the owner can pick theirs in the UI."""
    phrases = derive_title_phrases(app_name)
    candidates = find_target_candidates(gp_search, app_name, phrases, lang, country)
    # A literal title match (same words, same year, same punctuation - bar
    # case) is a far stronger identity signal than a normalized one:
    # 'Lie Detector Test - Prank 2026' is carried by exactly one app, while
    # seven more share its normalized form with other years/punctuation.
    # When any literal matches exist they become the candidate set; a
    # single literal match identifies the app outright.
    strict = [c for c in candidates
              if (c.get("title") or "").strip().lower() == (app_name or "").strip().lower()]
    if strict:
        candidates = strict
    ambiguous = False
    target_hit = None
    target_det = None
    if app_id:
        try:
            target_det = gp_app(app_id, lang=lang, country=country)
        except Exception:
            target_det = None
        if not target_det or not target_det.get("appId"):
            return jsonify({"error": "Could not fetch the app with package ID '" + app_id + "'. Check the package ID and try again."}), 404
        target_hit = {"appId": target_det.get("appId"),
                      "title": target_det.get("title") or app_name,
                      "developer": target_det.get("developer") or ""}
    elif candidates:
        if len(candidates) >= 2 and my_text:
            enrich_candidate_summaries(candidates, gp_app, lang, country)
        target_hit, ambiguous = select_target(candidates, my_text)
    else:
        target_hit = find_target_fuzzy(gp_search, app_name, phrases, lang, country)
    target_title = (target_hit or {}).get("title") or app_name
    if target_hit:
        phrases = derive_title_phrases(target_title) or phrases
    target_id = (target_hit or {}).get("appId")
    # The target app's OWN metadata (title + summary + description) from the
    # Play Store - this is what gap keywords are measured against.
    target_text = ""
    target_details = None
    if target_hit and target_id:
        det = target_det
        if det is None:
            try:
                det = gp_app(target_id, lang=lang, country=country)
            except Exception:
                det = None
        src = det or target_hit
        target_text = " ".join(x for x in [src.get("title") or "", src.get("summary") or "",
                                           src.get("description") or ""] if x)
        t_title = src.get("title") or target_title
        t_summary = src.get("summary") or ""
        t_desc = src.get("description") or ""
        target_details = {
            "title": t_title,
            "appId": target_id,
            "header_image": src.get("headerImage") or "",
            "developer": src.get("developer") or (target_hit.get("developer") or ""),
            "installs": src.get("installs") or "",
            "realInstalls": src.get("realInstalls") or 0,
            "score": src.get("score") or 0,
            "ratings": src.get("ratings") or 0,
            "title_len": len(t_title),
            "short_len": len(t_summary),
            "long_len": len(t_desc),
            "updated": src.get("updated") or "",
            "version": src.get("version") or "",
        }
    pool, seen = [], set()
    if target_id:
        seen.add(target_id)  # the owner's own app is never its own competitor
    for p in phrases:
        try:
            hits = gp_search(p, lang=lang, country=country, n_hits=30)
        except Exception:
            hits = []
        for h in hits:
            aid = h.get("appId")
            if aid and aid not in seen:
                seen.add(aid)
                pool.append(h)
    core_terms, phrases = derive_core_terms(target_title)
    norm_phrases = []
    for p in phrases:
        pn = normalize_title(p)
        if pn and len(pn.split()) >= 2:
            norm_phrases.append(pn)
    kept, dropped_comp = [], 0
    for h in pool:
        rel = competitor_relevance(h.get("title") or "", core_terms, phrases)
        if rel <= 0:
            dropped_comp += 1  # off-topic: title shares no core term and no phrase
        else:
            # Sort keys: phrase-match tier first (the title literally
            # contains one of the app's search phrases), then how many
            # distinct core terms it carries, then installs - so the big
            # relevant apps of the niche are never cut by the cap.
            ct = normalize_title(h.get("title") or "")
            tier = 1 if any(pn in ct for pn in norm_phrases) else 0
            terms = len(set(ct.split()) & core_terms)
            kept.append((tier, terms, h))
    kept.sort(key=lambda x: (-x[0], -x[1], -parse_installs(x[2])))
    competitors = fetch_details([h for _, _, h in kept[:n]], lang, country, gp_app)
    if not competitors:
        return jsonify({"error": "No competitor apps found. Check the app name / internet and try again."}), 404
    seed_text = " ".join(x for x in [seed, target_title, " ".join(phrases), " ".join(extra_seeds)] if x)
    own_text = target_text or my_text
    kw_stats = {}
    keywords = extract_keywords(competitors, seed_text, own_text,
                                core_terms=core_terms, strict=True, stats_out=kw_stats)
    untapped = build_untapped(competitors, own_text, core_terms, phrases)
    payload = {"seed": seed or target_title, "country": country.upper(), "created": now(),
               "competitors": competitors, "keywords": keywords, "untapped": untapped,
               "dropped": {"competitors": dropped_comp, "keywords": kw_stats.get("keywords", 0)},
               "target_text": own_text or "",
               "target_details": target_details,
               "target_ambiguous": bool(ambiguous),
               "target": {"title": target_title, "appId": target_id,
                          "developer": (target_hit or {}).get("developer") or ""} if target_hit else None}
    if len(candidates) >= 2:
        payload["target_candidates"] = candidates
    return jsonify(payload)

@app.route("/api/research", methods=["POST"])
def research():
    try:
        return _research_impl()
    except Exception as e:
        return jsonify({"error": str(e)}), 500

def _research_impl():
    d = request.get_json(force=True)
    seed = (d.get("seed") or "").strip()
    app_name = (d.get("app_name") or "").strip()
    if not seed and not app_name:
        return jsonify({"error": "Seed keyword is required"}), 400
    country = (d.get("country") or "US").strip().lower()
    lang = (d.get("lang") or "en").strip()
    raw_count = d.get("count")
    if raw_count is None:
        n = 30 if app_name else 20  # app mode: bring back as many competitors as can be found
    else:
        try:
            n = int(raw_count)
        except Exception:
            n = 20
    n = max(5, min(50, n))
    my_text = d.get("my_text") or ""
    app_id = (d.get("app_id") or "").strip()
    extra_seeds = [s.strip() for s in (d.get("extra_seeds") or []) if s.strip()]
    try:
        from google_play_scraper import search as gp_search, app as gp_app
    except Exception as e:
        return jsonify({"error": f"google-play-scraper not available: {e}"}), 500
    if app_name:
        return research_by_app(app_name, seed, extra_seeds, country, lang, n, my_text, gp_search, gp_app, app_id=app_id)

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
    competitors = fetch_details(results[:n], lang, country, gp_app)
    if not competitors:
        return jsonify({"error": "No competitor apps found. Check the seed keyword / internet and try again."}), 404
    keywords = extract_keywords(competitors, seed + " " + " ".join(extra_seeds), my_text)
    payload = {"seed": seed, "country": country.upper(), "created": now(),
               "competitors": competitors, "keywords": keywords,
               "dropped": {"competitors": 0, "keywords": 0}}
    return jsonify(payload)

# ---------------- Re-extract from a chosen competitor subset ----------------
@app.route("/api/extract", methods=["POST"])
def extract():
    try:
        return _extract_impl()
    except Exception as e:
        return jsonify({"error": str(e)}), 500

def _extract_impl():
    """Rebuild keywords from exactly the competitors the owner kept ticked.
    Popularity/Difficulty stay the same LOCAL ESTIMATES as /api/research."""
    d = request.get_json(force=True)
    comps = []
    for c in (d.get("competitors") or []):
        if not isinstance(c, dict):
            continue
        comps.append({
            "appId": c.get("appId") or c.get("title") or "",
            "title": c.get("title") or "",
            "summary": c.get("summary") or "",
            "description": c.get("description") or "",
            "installs": c.get("installs") or "",
            "realInstalls": c.get("realInstalls") or 0,
        })
    if not comps:
        return jsonify({"error": "No competitors provided"}), 400
    app_title = (d.get("app_title") or "").strip()
    own_text = d.get("target_text") or d.get("my_text") or ""
    if app_title:
        # App context given: keep only keywords related to that app and drop
        # generic noise, exactly like app-mode research.
        core_terms, _phrases = derive_core_terms(app_title)
        kw_stats = {}
        keywords = extract_keywords(comps, d.get("seed") or "", own_text,
                                    core_terms=core_terms, strict=True, stats_out=kw_stats)
        return jsonify({"keywords": keywords, "dropped": {"keywords": kw_stats.get("keywords", 0)}})
    keywords = extract_keywords(comps, d.get("seed") or "", own_text)
    return jsonify({"keywords": keywords})

# ---------------- Keyword Rank Checker ----------------
@app.route("/api/rank", methods=["POST"])
def rank():
    try:
        return _rank_impl()
    except Exception as e:
        return jsonify({"error": str(e)}), 500

def _rank_impl():
    """For each keyword, run the same Play Store search the research uses and
    report the 1-based position of the owner's app in the ordered results."""
    d = request.get_json(force=True)
    app_id = (d.get("app_id") or "").strip()
    raw_kws = d.get("keywords") or []
    if isinstance(raw_kws, str):
        raw_kws = re.split(r"[\n,]+", raw_kws)
    keywords = [k.strip() for k in raw_kws if isinstance(k, str) and k.strip()][:10]
    if not app_id:
        return jsonify({"error": "app_id (package name) is required"}), 400
    if not keywords:
        return jsonify({"error": "At least one keyword is required"}), 400
    country = (d.get("country") or "US").strip().lower()
    lang = (d.get("lang") or "en").strip()
    try:
        from google_play_scraper import search as gp_search
    except Exception as e:
        return jsonify({"error": f"google-play-scraper not available: {e}"}), 500
    results = []
    for kw in keywords:
        try:
            hits = gp_search(kw, lang=lang, country=country, n_hits=50)
        except Exception:
            hits = []
        rank_pos = None
        for i, h in enumerate(hits):
            if h.get("appId") == app_id:
                rank_pos = i + 1
                break
        results.append({
            "keyword": kw,
            "rank": rank_pos,
            "scanned": len(hits),
            "top_app": (hits[0].get("title") if hits else "") or "",
        })
    return jsonify({"results": results})

# ---------------- Untapped keyword competition check ----------------
@app.route("/api/untapped_check", methods=["POST"])
def untapped_check():
    try:
        return _untapped_check_impl()
    except Exception as e:
        return jsonify({"error": str(e)}), 500

def _untapped_check_impl():
    """How strong is the competition for one untapped keyword idea? Looks at
    the current top 3 Play Store results for the phrase: if even they are
    small apps, the phrase is a low-competition bet."""
    d = request.get_json(force=True)
    keyword = (d.get("keyword") or "").strip()
    if not keyword:
        return jsonify({"error": "keyword is required"}), 400
    country = (d.get("country") or "US").strip().lower()
    lang = (d.get("lang") or "en").strip()
    try:
        from google_play_scraper import search as gp_search
    except Exception as e:
        return jsonify({"error": f"google-play-scraper not available: {e}"}), 500
    try:
        hits = gp_search(keyword, lang=lang, country=country, n_hits=10)
    except Exception:
        hits = []
    top_installs = 0
    for h in hits[:3]:
        top_installs = max(top_installs, parse_installs(h))
    level = "low" if top_installs < 100000 else ("medium" if top_installs < 1000000 else "high")
    return jsonify({"keyword": keyword, "apps_found": len(hits),
                    "top_installs": top_installs, "level": level})

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
