# Changelog

All published changes are tracked here. ApplyPilot uses Semantic Versioning; `0.x` is still pre-stable. Release tags are immutable.




## [0.9.0] — 2026-11-13

Insights release: you see what is new, how your applications perform, what the AI costs, and your remembered answers adapt to each posting. The only new model input is your own remembered answer text, sent when the AI adapts it; nothing goes to a third party.

### Added
- Search: a **Location** filter for saved listings (Montréal, Toronto, Canada anywhere, United States, remote, unknown location), derived from the displayed location, title and snippet. A listing can belong to several groups; Canada includes Montréal and Toronto.
- New-offer markers: listings first seen since your last visit to Search carry a **New** badge. Home shows a counter (click it to open Search on the new offers) and the **State** filter gains **New since my last visit**. The counter only counts individual job links, like the list it opens. Leaving the Search tab marks everything as seen. `GET /search` returns a `meta` block, `POST /search/seen` records the visit; markers live in `data/search/meta.json`, apart from the catalog.
- **Run again** on Home: one click re-runs the last Google or public LinkedIn search with the same source and scope, bounded exactly like a manual run and never in the background. A finished run is recorded even when it finds nothing (`POST /search/run`). Manual imports do not replace the re-runnable search.
- Tracker **Statistics** view (`GET /stats`): funnel (identified offers, applications created, submitted, with a response), interviews/offers/rejections, response rate (a recorded response still counts if the application is later abandoned), breakdowns by platform and by CV, and a median response delay. Rates are hidden below 5 submitted applications (shown as "n = x") and no causal reading is offered. See [docs/insights.md](docs/insights.md).
- **AI usage log**: every AI call appends a counters-only line to `data/usage/usage.jsonl` (date, task, provider, model, effort, duration, attempts, success, and tokens/cost when the CLI reports them). Prompts, answers, company names and profile data are never recorded. Kept 180 days and at most 5 MB (trimmed to 80 % when it fills). `billing` is `api` only for the Claude CLI with `ANTHROPIC_API_KEY`; pi calls are `unknown` and never labelled as billed. New Settings card (24 h / 7 days / 30 days, by task and by model) with **Clear usage history**; `GET /usage` and `DELETE /usage`; opt out with `usage.enabled: false` in `config.yaml`.
- **Adapted answer memory**: long remembered answers (over 60 characters, text areas, or answers that mention the original company) are adapted to the current posting. With AI on, the model rewrites them from your profile and CV only, keeps the field's maximum length, caps confidence at 0.8 and always flags the result for review ("Adapted from {company}"). With AI off, the remembered value is filled as-is with an orange "Remembered answer: review it" note and an **adapt** chip. A field you edited yourself is never overwritten, and an answer filled from memory or by the AI and left untouched is not remembered again as yours. If the model says an answer no longer applies, its reason is shown in orange. `POST /answers` accepts `memoryAnswers` and returns adapted ones.

### Changed
- Answer memory now also stores short text areas (up to 300 characters), previously ignored. Existing memory files are read as before; the adaptable flag is computed on read without rewriting them.
- Applications moved to Interview, Offer or Rejected get a `respondedAt` date (the first response; cleared if you move back to In progress or Submitted).
- The README and the documentation describe the stepper and bottom action bar introduced in 0.8.0, and the CV card now documented in the Documents step.

### Upgrade notes
- The **median response delay** only covers status changes made from this version on; earlier responses have no response date and are left out of the median (the other statistics still count them).
- On first launch the existing catalog is **not** flagged as new: the first visit marker is set to that moment, and only offers found afterwards count.
- The usage log starts empty; nothing is reconstructed from the past. Disable it with `usage.enabled: false` (restart the server) or clear it from Settings.
- The answer memory now stores short text areas, so some previously unremembered answers will start appearing in Profile after your next application.
- Restart the server, reload ApplyPilot in `chrome://extensions` and reopen the panel (the usual update steps).

## [0.8.0] — 2026-11-13

0.7.0 was never published, so its section below is still unreleased and ships together with 0.8.0. The latest public release remains 0.6.0.

### Added
- Search locations: Greater Toronto and United States scopes, plus a new default "Montréal + Canada first, then Toronto and United States" scope. Montréal and remote-Canada queries always come first; Toronto and the US each get one all-domain query only from spare budget (1 per 4 queries), and ranking scores Montréal above the rest of Canada above other locations. Saved search settings keep their scope.
- Claude Code CLI provider (`llm.provider: claude`): letters, open-question answers and CV tailoring run `claude -p` non-interactively with no tools, no session persistence, no CLAUDE.md/skills/hooks/MCP (`--safe-mode`, `--strict-mcp-config`) and a short fixed system prompt, using your existing Claude login. Default model `claude-sonnet-5-5`, requested effort `medium` per task (`llm.claude.effort.letter/answers/tailor`). The effective effort is not reported by the CLI. `--bare` is never used. JSON schemas constrain the three task outputs, and generation provenance records the requested and observed model and the reported cost; no reasoning is stored.
- `/health` reports the active provider, availability, CLI version, model and effort, neutral to the provider. Existing fields are kept for the 0.7 extension.
- Side panel: Settings view (header gear) with interface language, server URL and read-only provider/model/effort from `/health`; Profile moves to a header icon.
- Application tab as a four-step stepper (Posting, Documents, Autofill, Submission) with one open step and one-line summaries; a sticky bottom action bar shows the main action of the current context; secondary tools (such as the form diagnostic) sit under "Advanced tools".
- One-line AI provenance (model, effort, cost) with details behind an info tooltip; shorter warnings, with the "never submits" rule kept next to the Submit step.
- Design tokens, uniform components and dark mode following the browser setting; new screenshots in `docs/prototype/`.

### Changed
- The side panel code is split into modules (state, API, tabs, UI, one module per view) with no behaviour change.
- Interface wording says "the AI" or shows the configured model instead of hard-coding pi.
- The language selector moved from below the header to Settings. Stop for autofill and search now lives in the bottom action bar instead of the header.
- The previous `llm.command`, `llm.model`, `llm.letterThinking` and `llm.answersThinking` keys are still read as pi settings when `llm.pi` is absent.

### Upgrade notes
- **Provider auto-selection.** Without an explicit `llm.provider`, a `config.yaml` that already configures pi (flat keys `llm.command`, `llm.model`, `llm.letterThinking` or `llm.answersThinking`, or a customised `llm.pi.*`) stays on pi. Claude is chosen automatically only when no pi setting is present and the `claude` binary is found. Set `llm.provider: claude` to switch deliberately.
- **Claude Code required for the Claude provider.** Install it, run `claude` once and sign in with `/login`. It needs a version that supports `--effort` and `--safe-mode`; 0.8.0 was verified with Claude Code 2.1.323 and 2.1.325. No `npm ci` is needed (no new dependency); restart the server and reload the extension.
- **Billing.** If `ANTHROPIC_API_KEY` is set in the environment that starts the server, the Claude CLI bills the API instead of your subscription. Unset it to use the subscription.
- Letters already generated keep their original attribution. pi remains supported and optional.


## [0.7.0] — Unreleased local update

### Search updates
- Search opens sorted by newest publication date; relevance/oldest-first options remain, and unknown publication dates stay last.
- Explicit FR/EN Clear catalog action removes all discoveries (including saved/hidden links), with confirmation, exact private backup and an ID-snapshot guard against concurrent additions/removals. Application records, CVs, letters and search settings are preserved.

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
