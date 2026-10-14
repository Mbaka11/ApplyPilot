# Changelog

All published changes are tracked here. ApplyPilot uses Semantic Versioning; `0.x` is still pre-stable. Release tags are immutable.

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
