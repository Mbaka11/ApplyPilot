# Per-posting CV tailoring

ApplyPilot can prepare a copy of one of your LaTeX CVs that is tuned to a specific posting. You ask for it explicitly from the Application tab; the copy is only used for forms after you review it and opt in for that application.

## What may change

- The **About** paragraph (a short personal pitch oriented toward the posting).
- The **order and selection of the items** in each skills row (never the spoken-languages row). Items must already exist in that row, at most about 40 % may be dropped, and spelling is identical.

Everything else (experience, projects, dates, GPA, contact details) is copied unchanged. The original CV and PDF are never written.

## Safety checks before LaTeX runs

- The About text must be plain text, within about 125 % of the current length, with **no digits**.
- Technical-looking terms (acronyms, camel case, capitalised mid-sentence names) must already appear in your CV or profile. The posting's company name and title words are allowed.
- Invented skills, removed spoken languages and formatting commands are refused.
- The result must compile to **exactly one page**; otherwise it is discarded and the previous copy stays.
- Concurrent requests, client disconnects and application changes during generation are handled like letter generation: the model process is cancelled and nothing is saved.

## Files and routes

Per application, in `data/applications/<id>/cv-tailored/`: `CV.pdf`, `main.tex`, `report.json` (before/after text, generation provenance, warnings, checks).

- `POST /applications/:id/cv/tailor` with optional `{cvId, instructions}`.
- `GET /applications/:id/cv-tailored` returns the report with `stale` flags (source CV, job or CV selection changed).
- `GET /applications/:id/cv-tailored.pdf` (`?base64=1` returns the neutral upload name).
- `DELETE /applications/:id/cv-tailored`.

## Requirements

- Restart the local server after updating.
- `pdflatex` on `PATH` (MiKTeX or TeX Live), or set `cvTailor.pdflatex` in `config.yaml`.
- The CV source must use the `\sechead{...}` layout with an About block and `	extbf{Label:} & items` skill rows.
- Each attempt uses one normal provider request with the configured model.

## In the panel

The Application tab shows a **CV tailored to the posting** card under the selected CV:

1. **Tailor the CV to this posting** asks for confirmation (it uses your normal pi quota) and can be stopped.
2. **Changes** shows the About text before/after, the reordered skill rows and any model warnings. **Preview** opens the PDF.
3. **Use this tailored CV for this application's forms** is off by default and per copy. When on, both **Fill this page** and **Prepare and attach CV + letter** upload the tailored PDF (same neutral filename) instead of the base PDF.
4. A copy becomes **out of date** when the source CV, the posting or the selected CV changes. It then cannot be newly enabled, and forms refuse to upload it until you regenerate it or switch it off. Nothing is silently replaced by the base CV.
5. **Regenerate** replaces the copy (and switches the opt-in off); **Delete** removes it. The original CV is never touched.

`PUT /applications/:id/cv-tailored/use` with `{"use": true|false}` stores the opt-in.

## Not done yet

Per-role bullet reordering, and choosing between several tailored copies per application.
