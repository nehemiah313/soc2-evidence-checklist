# SOC 2 Evidence Checklist

A static web app that tracks evidence collection for each AICPA Trust Services
Criterion in your SOC 2 engagement scope. SOC 2 auditors test evidence, not
intentions: this tool shows exactly which proof is missing before the auditor does.

**Live:** https://nehemiah313.github.io/soc2-evidence-checklist/

## What it does

- Scope selector: Security (the Common Criteria) is always in scope; toggle
  Availability, Processing Integrity, Confidentiality, and Privacy to match your
  engagement.
- Per criterion, every suggested evidence item from the dataset gets its own
  status (Missing / In progress / Collected) plus a free-text location/note field
  (e.g. "Google Drive > Security > Access reviews 2026").
- **Import from the Readiness Calculator:** reads the calculator's `soc2calc`
  localStorage key and flags any criterion marked Implemented there that has
  zero collected evidence as "implemented but unproven".
- Per-category and overall progress bars, a "hide collected items" filter, and
  full-text search across criteria and evidence.
- Export to CSV (criterion, evidence item, status, note) and Markdown checklist.
- All state persists in the browser under the `soc2evidence` localStorage key.
  No backend, no tracking, works offline.

## Data contract (for sibling tools)

The Readiness Calculator import expects this shape in localStorage key `soc2calc`:

```json
{ "criteria": { "CC1.1": "implemented", "CC6.6": { "status": "implemented" } } }
```

A top-level `"status"` object with the same mapping is also accepted.

Dataset source: [tsc-dataset](https://github.com/nehemiah313/tsc-dataset)
(61 criteria from the AICPA 2017 Trust Services Criteria, TSP Section 100).

## Files

- `index.html` / `styles.css` / `app.js` - the app
- `data/tsc.json` - machine-readable Trust Services Criteria dataset

## Disclaimer

Readiness aid only. Not an audit, attestation, CPA opinion, or legal advice.

## License

MIT. See LICENSE. Built by AI Tech Pros.
