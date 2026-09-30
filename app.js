/* SOC 2 Evidence Checklist - app.js
 * Static, offline-capable. All state lives in localStorage.
 * Readiness aid only. Not an audit, attestation, CPA opinion, or legal advice.
 */

"use strict";

var EVIDENCE_KEY = "soc2evidence";
var CALC_KEY = "soc2calc";
var STATUS_MISSING = "missing";
var STATUS_PROGRESS = "progress";
var STATUS_COLLECTED = "collected";

/* ---------- pure logic (testable in node) ---------- */

function itemKey(criterionId, idx) {
  return criterionId + "::" + idx;
}

function getItemState(state, key) {
  var it = state && state.items ? state.items[key] : undefined;
  if (!it) return { status: STATUS_MISSING, note: "" };
  return {
    status: it.status === STATUS_PROGRESS || it.status === STATUS_COLLECTED ? it.status : STATUS_MISSING,
    note: typeof it.note === "string" ? it.note : ""
  };
}

// Pull criterion ids marked "implemented" out of a Readiness Calculator payload.
// Accepted shapes:
//   { criteria: { "CC1.1": "implemented", ... } }
//   { criteria: { "CC1.1": { status: "implemented" }, ... } }
//   { status:   { "CC1.1": "implemented", ... } }
function extractImplementedIds(payload) {
  var out = {};
  if (!payload || typeof payload !== "object") return out;
  var buckets = [];
  if (payload.criteria && typeof payload.criteria === "object") buckets.push(payload.criteria);
  if (payload.status && typeof payload.status === "object") buckets.push(payload.status);
  buckets.forEach(function (b) {
    Object.keys(b).forEach(function (id) {
      var v = b[id];
      var s = typeof v === "string" ? v : (v && typeof v.status === "string" ? v.status : "");
      if (String(s).toLowerCase() === "implemented") out[id] = true;
    });
  });
  return out;
}

function inScopeCriteria(criteria, scope) {
  var s = {};
  (scope || []).forEach(function (c) { s[c] = true; });
  return criteria.filter(function (c) { return s[c.category]; });
}

function computeProgress(criteria, scope, state) {
  var scoped = inScopeCriteria(criteria, scope);
  var perCategory = {};
  var totalCollected = 0, totalItems = 0;
  scoped.forEach(function (c) {
    var cat = perCategory[c.category] || (perCategory[c.category] = { collected: 0, total: 0 });
    c.typical_evidence.forEach(function (ev, i) {
      var st = getItemState(state, itemKey(c.id, i));
      cat.total += 1;
      totalItems += 1;
      if (st.status === STATUS_COLLECTED) {
        cat.collected += 1;
        totalCollected += 1;
      }
    });
  });
  Object.keys(perCategory).forEach(function (k) {
    var p = perCategory[k];
    p.pct = p.total ? Math.round((p.collected / p.total) * 100) : 0;
  });
  return {
    perCategory: perCategory,
    overall: {
      collected: totalCollected,
      total: totalItems,
      pct: totalItems ? Math.round((totalCollected / totalItems) * 100) : 0
    }
  };
}

// Criteria the calculator calls Implemented but that have zero collected evidence.
function computeUnproven(criteria, scope, state, implementedIds) {
  var out = {};
  inScopeCriteria(criteria, scope).forEach(function (c) {
    if (!implementedIds[c.id]) return;
    var anyCollected = c.typical_evidence.some(function (ev, i) {
      return getItemState(state, itemKey(c.id, i)).status === STATUS_COLLECTED;
    });
    if (!anyCollected) out[c.id] = true;
  });
  return out;
}

function csvEscape(v) {
  var s = String(v == null ? "" : v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function buildCSV(criteria, scope, state) {
  var lines = ["criterion,criterion_title,category,evidence_item,status,note"];
  inScopeCriteria(criteria, scope).forEach(function (c) {
    c.typical_evidence.forEach(function (ev, i) {
      var st = getItemState(state, itemKey(c.id, i));
      lines.push([c.id, c.title, c.category, ev, st.status, st.note].map(csvEscape).join(","));
    });
  });
  return lines.join("\n") + "\n";
}

function buildMarkdown(criteria, scope, state) {
  var out = ["# SOC 2 Evidence Checklist", ""];
  out.push("> Readiness aid only. Not an audit, attestation, CPA opinion, or legal advice.", "");
  var cats = [];
  inScopeCriteria(criteria, scope).forEach(function (c) {
    if (cats.indexOf(c.category) === -1) cats.push(c.category);
  });
  cats.forEach(function (cat) {
    out.push("## " + cat, "");
    inScopeCriteria(criteria, scope).filter(function (c) { return c.category === cat; }).forEach(function (c) {
      out.push("### " + c.id + " " + c.title, "");
      c.typical_evidence.forEach(function (ev, i) {
        var st = getItemState(state, itemKey(c.id, i));
        var box = st.status === STATUS_COLLECTED ? "[x]" : "[ ]";
        var line = "- " + box + " " + ev + " (" + st.status + ")";
        if (st.note) line += " -- " + st.note;
        out.push(line);
      });
      out.push("");
    });
  });
  return out.join("\n");
}

/* ---------- browser app ---------- */

var DATASET = null;
var STATE = null;
var IMPORTED = {}; // criterion ids implemented in the calculator

function loadState() {
  try {
    var raw = localStorage.getItem(EVIDENCE_KEY);
    if (raw) {
      var s = JSON.parse(raw);
      if (s && typeof s === "object") return { scope: s.scope || ["Security"], items: s.items || {} };
    }
  } catch (e) { /* start fresh */ }
  return { scope: ["Security"], items: {} };
}

function saveState() {
  try { localStorage.setItem(EVIDENCE_KEY, JSON.stringify(STATE)); } catch (e) { /* ignore */ }
}

function readCalcImport() {
  IMPORTED = {};
  try {
    var raw = localStorage.getItem(CALC_KEY);
    if (!raw) return false;
    IMPORTED = extractImplementedIds(JSON.parse(raw));
    return Object.keys(IMPORTED).length > 0;
  } catch (e) { return false; }
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderScope() {
  var box = document.getElementById("scope-toggles");
  box.innerHTML = "";
  Object.keys(DATASET.categories).forEach(function (cat) {
    var meta = DATASET.categories[cat];
    var label = document.createElement("label");
    label.className = "scope-toggle" + (meta.required ? " locked" : "");
    var cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = meta.required || STATE.scope.indexOf(cat) !== -1;
    cb.disabled = !!meta.required;
    cb.addEventListener("change", function () {
      var i = STATE.scope.indexOf(cat);
      if (cb.checked && i === -1) STATE.scope.push(cat);
      if (!cb.checked && i !== -1) STATE.scope.splice(i, 1);
      saveState();
      renderAll();
    });
    label.appendChild(cb);
    var span = document.createElement("span");
    span.textContent = cat + (meta.required ? " (always in scope)" : "");
    label.appendChild(span);
    box.appendChild(label);
  });
}

function renderProgress() {
  var p = computeProgress(DATASET.criteria, STATE.scope, STATE);
  document.getElementById("overall-fill").style.width = p.overall.pct + "%";
  document.getElementById("overall-text").textContent =
    p.overall.collected + " of " + p.overall.total + " evidence items collected (" + p.overall.pct + "%)";
  var cp = document.getElementById("category-progress");
  cp.innerHTML = "";
  Object.keys(p.perCategory).forEach(function (cat) {
    var row = document.createElement("div");
    row.className = "cat-row";
    var name = document.createElement("div");
    name.textContent = cat;
    var bar = document.createElement("div");
    bar.className = "bar";
    var fill = document.createElement("div");
    fill.className = "bar-fill";
    fill.style.width = p.perCategory[cat].pct + "%";
    bar.appendChild(fill);
    var pct = document.createElement("div");
    pct.className = "pct";
    pct.textContent = p.perCategory[cat].collected + "/" + p.perCategory[cat].total + " (" + p.perCategory[cat].pct + "%)";
    row.appendChild(name); row.appendChild(bar); row.appendChild(pct);
    cp.appendChild(row);
  });
}

function renderCriteria() {
  var list = document.getElementById("criteria-list");
  list.innerHTML = "";
  var hideCollected = document.getElementById("hide-collected").checked;
  var q = document.getElementById("search").value.trim().toLowerCase();
  var unproven = computeUnproven(DATASET.criteria, STATE.scope, STATE, IMPORTED);
  var lastCat = null;

  inScopeCriteria(DATASET.criteria, STATE.scope).forEach(function (c) {
    if (q) {
      var hay = (c.id + " " + c.title + " " + c.summary + " " + c.typical_evidence.join(" ")).toLowerCase();
      if (hay.indexOf(q) === -1) return;
    }
    if (c.category !== lastCat) {
      lastCat = c.category;
      var h = document.createElement("h2");
      h.className = "cat-heading";
      h.textContent = c.category;
      list.appendChild(h);
      var d = document.createElement("p");
      d.className = "cat-desc";
      d.textContent = DATASET.categories[c.category].description;
      list.appendChild(d);
    }

    var card = document.createElement("div");
    card.className = "criterion";

    var head = document.createElement("div");
    head.className = "criterion-head";
    var badge = document.createElement("span");
    badge.className = "criterion-id";
    badge.textContent = c.id;
    var title = document.createElement("span");
    title.className = "criterion-title";
    title.textContent = c.title;
    var meta = document.createElement("span");
    meta.className = "criterion-meta";
    meta.textContent = c.series_name + (c.priority === "critical" ? " | Priority: critical" : "");
    head.appendChild(badge); head.appendChild(title); head.appendChild(meta);
    card.appendChild(head);

    var sum = document.createElement("p");
    sum.className = "criterion-summary";
    sum.textContent = c.summary;
    card.appendChild(sum);

    if (unproven[c.id]) {
      var warn = document.createElement("div");
      warn.className = "unproven";
      warn.textContent = "Implemented in the Readiness Calculator, but no evidence collected yet: implemented but unproven.";
      card.appendChild(warn);
    }

    var visible = 0;
    c.typical_evidence.forEach(function (ev, i) {
      var key = itemKey(c.id, i);
      var st = getItemState(STATE, key);
      if (hideCollected && st.status === STATUS_COLLECTED) return;
      visible += 1;

      var row = document.createElement("div");
      row.className = "evidence-item";
      var lab = document.createElement("div");
      lab.className = "evidence-label";
      lab.textContent = ev;
      var controls = document.createElement("div");
      controls.className = "evidence-controls";

      var sel = document.createElement("select");
      sel.className = "status-" + st.status;
      [["missing", "Missing"], ["progress", "In progress"], ["collected", "Collected"]].forEach(function (opt) {
        var o = document.createElement("option");
        o.value = opt[0]; o.textContent = opt[1];
        if (st.status === opt[0]) o.selected = true;
        sel.appendChild(o);
      });
      sel.setAttribute("aria-label", "Status for " + ev);
      sel.addEventListener("change", function () {
        var cur = getItemState(STATE, key);
        STATE.items[key] = { status: sel.value, note: cur.note };
        saveState();
        renderProgress();
        sel.className = "status-" + sel.value;
        renderCriteriaSoft();
      });

      var note = document.createElement("input");
      note.type = "text";
      note.placeholder = "Location / note, e.g. Drive > Security > Access reviews 2026";
      note.value = st.note;
      note.setAttribute("aria-label", "Location or note for " + ev);
      note.addEventListener("change", function () {
        var cur = getItemState(STATE, key);
        STATE.items[key] = { status: cur.status, note: note.value };
        saveState();
      });

      controls.appendChild(sel);
      controls.appendChild(note);
      row.appendChild(lab);
      row.appendChild(controls);
      card.appendChild(row);
    });

    if (visible === 0) return; // all collected and hidden
    list.appendChild(card);
  });
}

// Lightweight refresh after a status change without rebuilding search focus.
function renderCriteriaSoft() {
  var searchEl = document.getElementById("search");
  var active = document.activeElement === searchEl;
  renderCriteria();
  if (active) {
    var el = document.getElementById("search");
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }
}

function renderAll() {
  renderScope();
  renderProgress();
  renderCriteria();
}

function download(name, content, mime) {
  var blob = new Blob([content], { type: mime });
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(function () {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 500);
}

function renderImportBanner(found) {
  var b = document.getElementById("import-banner");
  var unproven = computeUnproven(DATASET.criteria, STATE.scope, STATE, IMPORTED);
  var n = Object.keys(unproven).length;
  if (!found) {
    b.classList.remove("hidden");
    b.textContent = "No Readiness Calculator data found in this browser yet (looked for the \"" + CALC_KEY + "\" key). Use the calculator first, then import.";
    return;
  }
  b.classList.remove("hidden");
  b.textContent = "Imported " + Object.keys(IMPORTED).length + " Implemented " +
    (Object.keys(IMPORTED).length === 1 ? "criterion" : "criteria") +
    " from the Readiness Calculator. " + n + " " +
    (n === 1 ? "is" : "are") + " flagged as implemented but unproven (no evidence collected).";
}

function init() {
  STATE = loadState();
  fetch("data/tsc.json")
    .then(function (r) { return r.json(); })
    .then(function (d) {
      DATASET = d;
      readCalcImport();
      renderAll();
      renderImportBanner(Object.keys(IMPORTED).length > 0);

      document.getElementById("hide-collected").addEventListener("change", renderCriteria);
      document.getElementById("search").addEventListener("input", renderCriteria);
      document.getElementById("import-btn").addEventListener("click", function () {
        var found = readCalcImport();
        renderImportBanner(found);
        renderCriteria();
      });
      document.getElementById("export-csv").addEventListener("click", function () {
        download("soc2-evidence-checklist.csv", buildCSV(DATASET.criteria, STATE.scope, STATE), "text/csv");
      });
      document.getElementById("export-md").addEventListener("click", function () {
        download("soc2-evidence-checklist.md", buildMarkdown(DATASET.criteria, STATE.scope, STATE), "text/markdown");
      });
      document.getElementById("reset-btn").addEventListener("click", function () {
        if (confirm("Clear all evidence checklist data in this browser?")) {
          STATE = { scope: ["Security"], items: {} };
          saveState();
          renderAll();
        }
      });
    })
    .catch(function () {
      document.getElementById("criteria-list").innerHTML =
        "<div class='card'><h2>Could not load dataset</h2><p class='hint'>data/tsc.json failed to load. Check that the file is present next to this app.</p></div>";
    });
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  document.addEventListener("DOMContentLoaded", init);
}
