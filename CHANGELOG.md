# Changelog

All published changes are tracked here. ApplyPilot uses Semantic Versioning; `0.x` is still pre-stable. Release tags are immutable.


## [0.7.0] — Unreleased local update

### Added
- Selected-CV inspector in the Application tab: PDF preview in a new tab, current filename/modification time/size, copyable source path and explicit file-manager action.
- Windows Explorer/macOS Finder selection and Linux folder opening, limited to configured CV IDs. Native actions require the extension origin and explicit confirmation, never a caller-supplied path or command shell.
- Read-only per-CV metadata route and fresh file checks before each inspector action; existing neutral upload filenames are unchanged.
- Isolated file-manager/HTTP/DOM/extension tests, including stale-selection races, escaping, deleted files, failed saves and draft/form preservation.
- Explicit local form-structure diagnostic download: anonymized DOM/ARIA references, fixed label categories and known component classes; no values, files, raw labels/IDs, URLs, account state, server/model calls or page actions. No new extension permissions or backend endpoint.
- Isolated privacy, bounded-output, origin/navigation and real-extension download tests using a synthetic SuccessFactors-like form.
- Partial SuccessFactors adapter: ARIA radio groups, strictly owned exact-option combobox selection and visible manual actions for attachment launchers and education/language Add controls. Unknown dialogs and repeat-entry editing stay manual.
- Capability-based content reinjection updates older local 0.7.0 scripts without reloading employer forms or changing extension permissions.
- Explicit SuccessFactors “Prepare and attach CV + cover letter” action: destination confirmation, current CV checks, missing-letter generation/PDF rendering, sequential upload attempts and scoped visible-filename confirmation. Existing drafts/attachments are not silently replaced; no upload-dialog buttons or application submission are clicked.
- Automatic preparation requires a new server capability advertised by `/health`; the existing letter POST supports `onlyIfMissing: true` to preserve saved letters. Old same-version servers cannot run this workflow until restarted.
- Per-posting CV tailoring (server side, first step): a copy of the chosen LaTeX CV in which only the About paragraph and the order/selection of skill items change, written to the application folder (`cv-tailored/`). The original CV is never written. Every claim must come from the candidate's own CV/profile: digits in the About text, unknown technical terms, invented or heavily dropped skills, formatting commands and over-long text are refused before LaTeX runs; the copy must compile to exactly one page. Routes: `POST /applications/:id/cv/tailor`, `GET /applications/:id/cv-tailored(.pdf)`, `DELETE /applications/:id/cv-tailored`. Reports whether the copy is stale after the source CV, job or selection changes. Needs a restart, `pdflatex` (MiKTeX/TeX Live or `cvTailor.pdflatex`) and one provider call per attempt. The Application tab has a card with confirmation, Stop, a before/after review, preview, regenerate/delete and a per-copy opt-in; only when opted in (and not out of date) do Fill this page and the SuccessFactors document action upload the tailored PDF instead of the base one.
- Isolated unit and HTTP tests with a fake model and a fake LaTeX engine; an offline dry run compiled all three real CVs to one page without any provider call.

### Fixed
- A missing saved CV no longer silently displays the first available variant as selected.
- Preview and folder actions stay disabled while a CV selection is being saved; a failed save restores the stored selection.
- Specific graduation/internship-count questions no longer match the generic degree rule; graduation comes from the current profile, while unknown internship counts remain manual. Optional suffix/second names stay blank, and degree/program text uses the FR/EN profile wording for the active posting/page language context.
- SuccessFactors source categories are no longer populated with a website name. Dropdown text without a verified selection is flagged; nonmatching/unowned lists do not receive typed guesses or Enter.
- Late AI answers cannot override newly entered user text or fields explicitly reserved for manual completion.
- Letter-generation disconnects cancel the owned pi process. Concurrent generation is rejected; late results cannot overwrite a changed letter/CV/job. PDF rendering is staged and checked before committing files, with temporary-file cleanup.

### Verification scope
- Automated native-launch tests simulate the file manager rather than opening real OS windows. A symlink-PDF test is skipped on Windows when the account lacks symlink-creation rights.
- Voluntarily exported, redacted real-page reports informed the SuccessFactors structural fixes and identified the common CV/cover-letter dialog with a native file input. Original reports remain private; runtime fixtures are independently synthetic. The full document sequence works in isolated extension tests, not yet verified on the employer site. Unknown confirmation behavior fails to manual review; repeated-entry contents are not automated.
- This local batch has not been committed, pushed or released. Installation does not migrate or rewrite existing private records. The new document action generates/saves a missing letter only after explicit user confirmation, using the configured provider's normal quota.

## [0.6.0]

### Added
- Neutral Home dashboard with current-page actions, tracking counts and explicit application resumption.
- Job/listing/unknown URL classification, job-only default view, local platform badges and separate platform/discovery-method filters.
- Experimental anonymous LinkedIn guest-HTML connector, fixed destination, inert parsing, bounded requests/body/card counts, cancellation, cooldown and no redirects/retries or account access.
- Letter model/effort preview, reported model provenance from pi JSON events, preserved generation metadata and explicit unknown attribution for legacy letters/effective reasoning levels.
- Schema-2 catalog support with an exact private schema-1 backup on first mutation; reads do not migrate.
- Synthetic HTTP/parser/UI/provenance regressions and English screenshots using fictional data.

### Changed
- Google queries favor individual posting/ATS paths; known listing pages are skipped while existing catalog entries are retained in separate views.
- Startup, reconnection and page detection no longer automatically restore the last or sole ongoing application.
- Application switching and regeneration protect unsaved drafts; leaving a record never marks it submitted.
- Pi output processing discards reasoning blocks and signatures rather than storing a raw event stream.

### Fixed
- Letter instructions are captured before the generation spinner removes the input.
- Generation/manual PDF rendering preserve tracker status and notes edited concurrently.
- Manual PDF edits retain generation attribution, and further edits during a save remain dirty.
- Browser-fixture screenshots bring the target page to the foreground to avoid a background capture stall on Windows.

### Verification and limitations
- An initial public LinkedIn probe returned HTTP 200 and ten individual links; subsequent connector validation received HTTP 429 and stopped. No bypass or retry followed.
- Structured extraction, UI and cancellation/cooldown tests use local fixtures. Live Google relevance and reliable live LinkedIn collection remain unverified.
- LinkedIn remains explicitly experimental. Publishing this version does not establish reliable live access or official API support.

## [0.5.0]

### Added
- Bilingual Search tab with editable internship keywords, AI/software/data/consulting domains, geography, term and query budget.
- Bounded Google result collection in one new inactive tab: up to eight queries, thirty cards per page, Stop available across the panel, no automatic result visits or pagination.
- Assisted LinkedIn search links and manual URL/detail imports, without account automation, cookie reads or LinkedIn content collection.
- Independent private discovery catalog, local filtering, indicative keyword ranking, save/hide/restore/delete actions and existing-application associations.
- URL canonicalization and transitive employer/LinkedIn alias merging, protected manual fields, atomic catalog writes, corruption/capacity validation and dedicated local API routes.
- Synthetic catalog/HTTP/runner/Chrome/extension tests and fictional English search screenshots.

### Changed
- LinkedIn and supported Google domains are excluded from general content-script injection; panel extraction/autofill is also disabled there.
- Search and autofill are mutually exclusive within the panel. Closing the panel stops collection; search tabs remain open for manual inspection.
- UI language and panel-tab switches preserve search/manual-import drafts alongside existing profile and cover-letter drafts.

### Fixed
- Automatic application matching no longer discards a dirty cover-letter draft or instructions when the active page changes.
- Document-bound reinjection excludes Google/LinkedIn frames embedded in an otherwise supported employer page.

### Verification scope
- Google and LinkedIn discovery tests are intercepted locally before navigation. They verify extension behavior, not successful live Google collection or live employer eligibility.

## [0.4.0]

### Added
- Persistent English / Français interface selector, independent of posting and document languages.
- Visible extension version beside ApplyPilot, plus a server-version mismatch warning.
- Stop / Arrêter during autofill and pending pi answers, with immediate UI recovery and actual subprocess cancellation.
- Step-bound autofill sessions: navigation cancels old work and late answers cannot populate another page.
- A 90-second safeguard for pending AI answers, without removing manual retry or non-AI autofill.
- Version synchronization/checking script and regression tests for release metadata.

### Changed
- English README, GitHub description, startup/help guidance and fictional English screenshots.
- UI language changes preserve unsaved profile, server URL, cover-letter and instruction drafts.

### Fixed
- Cancelling a fill no longer leaves the panel locked or incorrectly marks the server offline.
- Closing an answer request also stops its owned pi process; server shutdown cleans up active model subprocesses.

## [0.3.1]

### Fixed
- Workday skills select actual clickable leaves and verify persistent pills, including recreated inputs and collapsed selections.
- Existing skills are preserved; missing skills are added without duplicates or invented AI alternatives.
- C++ is distinguished from C and C#.
- Script reinjection preserves the existing page and unsaved entries.
- Manual submission marking requires confirmation; returning to In progress clears an incorrect submission date.

## [0.3.0]

### Added
- Posting requirements checklist, transcript attachment and Workday language/website sections.
- Credited-internship and language-level profile fields.
- Neutral CV upload filenames and employer-name extraction fallbacks.

### Fixed
- Workday focus/blur synchronization when the side panel has keyboard focus.
- Address/website collisions, duplicate field IDs, checkbox grouping and graduation date formatting.

## [0.2.0]

### Added
- Profile editor with validation, private backups, revision conflict protection and atomic YAML writes.
- Apply / sign in navigation that reuses existing browser tabs and sessions without reloading forms.
- Automatic resumption of the sole application in progress.

## Initial release

- Local Node.js server and Chrome MV3 side panel.
- Posting analysis, CV selection, pi-generated editable cover letters and one-page PDF rendering.
- Conservative form autofill, attachments, application tracking and recurring-answer memory.
