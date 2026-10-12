# Changelog

All published changes are tracked here. ApplyPilot uses Semantic Versioning; `0.x` is still pre-stable. Release tags are immutable.

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
