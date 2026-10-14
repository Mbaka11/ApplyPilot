# 0.6.0 — experimental LinkedIn integration and verification

Version 0.6.0 ships the home, discovery and letter-provenance improvements described
below. **The LinkedIn connector remains an experimental prototype**, not an official
or production-validated integration. Release 0.5.0 and its immutable tag are unchanged.

## What changed

- Google queries favor posting/ATS paths; recognizable listing pages are not imported
  by the collector. Existing listing and unknown links remain available in separate
  catalog views rather than being deleted.
- Local platform badges and separate platform/discovery-method filters retain
  multiple sources when aliases merge. Public posting dates are distinguished from
  discovery dates. None of these fields verifies live vacancy status.
- The experimental public LinkedIn connector can render parsed cards directly in the
  catalog. Its integrated success/failure/cancellation paths are fixture-tested;
  **reliable live access has not been established**.
- Home shows discovery/tracking counts, current-page actions and recent applications.
  A stored ID, a single ongoing application or a matching browser page no longer
  forces resumption. Leaving an application does not change its status.
- Cover-letter settings are visible before/during generation. Reported provider/model,
  requested effort and attempt count are retained afterward. Effective effort is
  unknown because the pi JSON stream does not report it. Legacy letters stay unknown.
- Draft switching/regeneration requires confirmation. User instructions are captured
  before the busy view replaces their input. Manual PDF edits retain attribution;
  concurrent tracker status/notes are not overwritten by delayed generation.

## LinkedIn investigation ledger

The connector was developed as an **anonymous local prototype** and approved for
publication with its limitations explicitly documented.
The `reverse-api-investigation` and `rea-investigation` skills were consulted. These
are instructions, not engines or authorization grants. No REA/RAE engine, MCP server,
logged-in browser attachment or autonomous account workflow was installed or run.

| Item | Evidence / boundary |
|---|---|
| Target | `www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search` |
| Method | Fixed-target GET, no body, no auth or cookies |
| Initial observation | 2026-10-13 18:00:44 UTC: HTTP 200, HTML, 30,584 bytes, ten individual job links, no recognized challenge marker |
| Later connector validation | HTTP 429; stopped immediately, no retry or alternate route |
| Response format | Undocumented HTML fragments; not an official JSON search API |
| Prototype parameters | `keywords`, `location`, `f_E=1`, `start=0`, optional `f_WT=2`; meaning and filtering quality are not guaranteed by a supported contract |
| Parser contract | Numeric `urn:li:jobPosting` ID paired with matching canonical job URL; plain title/company/location and optional ISO date |
| Verification distinction | Initial link detection was observed live. Structured card extraction, UI and failure behavior use synthetic fixtures. The later live extraction attempt was blocked. |
| Prohibited actions | Cookie/session export, account traffic capture, captured-login refresh, stealth, proxy rotation, CAPTCHA/rate-limit bypass, authenticated internal APIs |

The initial response hash and bounded probe report remain in ignored local test
outputs. No raw HAR, credentials, browser profile or candidate records are included
in this documentation or the Git changes.

Public access is not blanket permission to automate. LinkedIn's
[user agreement](https://www.linkedin.com/legal/user-agreement) and
[automation restrictions](https://www.linkedin.com/help/linkedin/answer/a1341387/prohibition-of-scraping-software?lang=en)
apply. Do not advertise an official LinkedIn integration or successful production
reverse engineering based on these observations.

## Verify after updating

1. Save any panel drafts. Restart only the owned idle ApplyPilot server if needed.
2. In `chrome://extensions`, use **Reload ApplyPilot**, then reopen the panel.
   **Do not reload Workday, remove/reimport the extension or restart the user's browser.**
3. Confirm both versions are 0.6.0. Home should not select the last application.
4. Inspect Search's default job view, listing/unknown views, platform badges and
   discovery-method filters. Old catalog rows should still be present.
5. Treat the LinkedIn button as an opt-in experimental request, not a guaranteed
   service. A 429, challenge, redirect or changed response stops the run. Do not use
   repeated attempts or account access as a workaround.
6. Resume an application explicitly. Existing letters should show unknown provenance;
   only a new generation can supply observed metadata. The configured provider may
   consume quota for that real generation; fixture tests do not.

The first schema-1 catalog **write**, not a read, makes an exact private backup and
upgrades to schema 2. Keep this in mind if returning to 0.5.0; see [search.md](search.md).
No existing application status is changed by startup or the home screen.

## Preview images

These English screenshots contain fictional candidates/employers and fake pi/HTTP
responses. They do not establish live LinkedIn success or a submitted application.

- [Home](prototype/home.png)
- [Discovery and source filters](prototype/search.png)
- [Letter model/effort provenance](prototype/letter.png)

## Useful next improvements — not implemented

- Prefer documented public employer/ATS posting feeds where available, with separate
  source contracts, bounds and permission review; do not depend on LinkedIn guest
  availability as the main catalog feed.
- Add explicit posting-recency/deadline filters and stale-link review, clearly
  separating retrieved facts from keyword-based relevance and candidate eligibility.
- Consider per-application draft persistence across extension reloads. Current draft
  protection covers the open panel and tab/language changes, not arbitrary reloads.

Passing local tests does not establish reliable live LinkedIn access or authorize
additional automation. Any expanded access or account integration requires its own
permission review.
