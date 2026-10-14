# Internship discovery — 0.6.0

Version 0.5.0 used Google collection and manual LinkedIn links. Version 0.6.0 adds
an **experimental** public LinkedIn HTTP connector, without treating that surface
as an authorized, officially supported or reliable API. See [the investigation and
verification boundaries](prototype.md).

## Workflow

1. Start from **Home → Find internships** or **Search**. Expand **Search filters**
   for keywords, AI/ML/software/data/consulting domains, geography, term and budget.
   Defaults remain editable; only the availability term comes from the profile.
2. **Preview exact queries** lists both sources. Budgets are 1–8 queries, not
   pagination. Local and remote queries are interleaved by domain.
3. Choose **Search Google** or the explicit **LinkedIn · prototype** action.
   Keep the panel open. The latter displays parsed job cards without opening a tab.
4. **Stop search** is available across panel tabs. Closing the panel also stops
   it. Stop cancels pending work and prevents subsequent queries, but does not roll
   back batches already accepted by the local server.
5. Review **identified job links** by default. Filter status, text, platform and
   discovery method. Inspect unknown links or old listing pages in separate views.
6. Save/hide/restore/delete affects discoveries only. **Open posting** creates a new
   browser tab, not an application. Analyze the employer posting explicitly to
   create an application; resuming an existing application is also explicit.

Search never navigates, reloads or closes a pre-existing application tab. It does
not invoke pi, generate application documents, fill forms or submit anything.

## Link quality, platform and provenance

A link classifier recognizes individual URLs on LinkedIn, Indeed and several ATS
surfaces, and separates recognizable search/listing pages. Unrecognized URLs stay
**unverified**, not silently promoted to jobs or deleted.

- Google queries favor ATS/job-specific paths. Recognized listing URLs are skipped
  before importing a collected batch. Unknown URLs may be saved for manual review,
  but are not in the default job-only view.
- Existing catalog rows are retained. Changing views is not a destructive cleanup.
- URL classification does **not** verify whether a job exists, remains open, matches
  the term, offers remote work or accepts the candidate.
- **Platform** describes destinations/aliases: LinkedIn, Indeed, employer, etc.
- **Discovery method** describes evidence: Google, public LinkedIn prototype, manual.
  A Google snippet linking to LinkedIn does not become direct LinkedIn evidence.
- Both dimensions survive alias merging. Badges use local text marks, not external
  logo requests or an assertion of affiliation.
- An explicitly linked aggregator listing cannot displace a known individual
  posting as the primary opening destination.

The lexical score is a ranking aid only. Dates from the public cards are shown when
valid; otherwise the UI shows the observation date, without calling it a posting date.

## Bounded source behavior

### Google

- One newly created inactive tab, owned by the current run; left open for inspection.
- At most 30 cards per page, one page per generated query, no automatic result visits.
- At least 1.8 seconds between query pages; bounded readiness observations and calls.
- The host, path, query and document identity are checked before DOM reading. Two
  stable result snapshots are required before import.
- Consent, sign-in, CAPTCHA, unusual traffic, denial, navigation, tab closure or
  unrecognized markup stops the run. No bypass or automatic resume.

### Experimental public LinkedIn

- One fixed HTTPS endpoint:
  `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search`.
- **Anonymous GET only**, credentials omitted, no browser/session attachment, no
  caller-supplied target or authentication headers, no redirects, retries, detail
  crawling, login refresh or pagination (`start=0`). An identifying ApplyPilot user
  agent is used; no fingerprint spoofing or proxy rotation.
- One request at a time; 2.5-second server minimum between starts, 2.6-second panel
  delay between completed requests; 15-second deadline; 512 KiB decoded-body limit.
- HTML is parsed inertly with pinned `parse5@8.0.0`, not loaded into a browser or
  injected into the panel. At most 25 validated, deduplicated cards per response.
- IDs must match canonical LinkedIn job links. Title, company, location and date
  are plain text; scripts, markup and credentials are not retained.
- Access denials, redirects, 429/999 and recognized challenges stop immediately.
  A minimum five-minute pause applies, extended by a longer `Retry-After` header.
  There is **no scheduled retry**. Restarting a stopped run is a separate user action.
- Changed/unrecognized responses fail without inventing cards. API replies contain
  bounded status/time/size/hash evidence, not raw HTML.

**Live evidence is mixed:** the initial anonymous probe returned HTTP 200 and ten
individual links. A later connector validation returned HTTP 429 and was stopped.
Structured parsing and the integrated UI have been verified with synthetic fixtures,
not with a successful subsequent live connector run. Do not infer production readiness.

LinkedIn's [agreement](https://www.linkedin.com/legal/user-agreement) and
[automation restrictions](https://www.linkedin.com/help/linkedin/answer/a1341387/prohibition-of-scraping-software?lang=en)
remain relevant. A public response or logged-in session is not blanket authorization.
No authenticated internal API, official partner access or account automation is included.

## Manual import and browser boundary

**Manual import / External browsing** provides prepared LinkedIn browser searches and
URL imports. These are separate from the public connector. Paste one link per line,
at most 50, optionally preceded by a title. Single-link details can include company,
location, an employer alias and manually copied text. Neither linked page is fetched.

Google/LinkedIn browser pages, including their embedded frames, remain excluded from
general extraction and autofill. Imported descriptions retain their original language.
The server never fetches arbitrary imported/result URLs. Syntactic host filtering is
not DNS-based proof that a hostname is public; only explicit clicks open these URLs.

## Private persistence and compatibility

`data/search/discovery.json` is independent of applications and the CSV journal and
is ignored by Git. Schema 2 adds the `linkedin-public` source and optional posting
date. Reads accept schemas 1 and 2 and do not write or migrate anything.

**Before the first schema-1 mutation**, the exact original bytes are saved in
`data/backups/search/discovery-v1-*.json`. The successful mutation writes schema 2
atomically. Old 0.5.0 readers reject schema 2; rolling back requires restoring the
appropriate private v1 backup while the server is stopped, rather than relabelling
new data as v1. Keep newer discoveries separately if rolling back.

Bounds remain 3,000 jobs / 32 MiB, 20 aliases and 12 query strings per job. Corrupt
or unsupported catalogs return 409 and are not replaced. Entire batches are validated
before a catalog write. Similar titles do not establish identity; canonical URLs,
LinkedIn IDs, recognizable Workday requisitions and explicit aliases do.

Manual nonempty fields override automated fields, including direct public LinkedIn
cards. Transitive merges retain aliases/provenance and the most restrictive discovery
state: hidden > saved > new. Existing applications are associated at read time; no
catalog mutation changes or deletes one.

## Local API

All routes retain localhost Host/Origin protection. **Only `/search/linkedin` below
performs a remote request**, and only to its fixed public endpoint. None invokes pi,
creates an application or submits a form.

| Method | Route | Behavior |
|---|---|---|
| GET | `/search` | Settings, ranked jobs, derived link quality/platform/provenance, optional application association |
| PUT | `/search/settings` | Validate and persist editable search settings |
| POST | `/search/results` | `{items}`; 1–100 Google results, source forced to `google` |
| POST | `/search/linkedin` | `{settings,index,acknowledgeExperimental:true}`; one public page, validated import, evidence and fresh catalog |
| POST | `/search/import` | `{links,details?}`; manual links and optional single-job details |
| PATCH | `/search/jobs/:id` | `{status:"new"\|"saved"\|"hidden"}` only |
| DELETE | `/search/jobs/:id` | Delete a discovery only |

Settings: `{keywords,categories,scope,term,maxPages}`. Categories are `ai`, `dev`,
`data`, `consulting`; scopes are `montreal_remote`, `quebec`, `canada`. The public
request index must be inside the generated plan. Disconnecting its HTTP request
aborts the upstream operation; already accepted local batches are not rolled back.

## Privacy and tests

Search sends chosen query terms, never CVs, contact fields, GPA or unconfirmed
language levels. Do not put private information in custom terms or pasted URLs.
Google/manual browsing may use an existing browser session, but the server-side
LinkedIn connector does not read, export or use it.

Tests use fictional candidates and local HTTP/Chrome fixtures. The server's fetch
is replaced **only in an explicitly marked isolated test process**. New browser tabs
are intercepted before navigation. Tests cover classification, provenance, migration
backups, corruption/capacity, cancellation, cooldown, failures, exclusion boundaries,
320px layout and unchanged applications/forms. Screenshots are fixtures, not proof
of live relevance or permission to automate a third-party site.
