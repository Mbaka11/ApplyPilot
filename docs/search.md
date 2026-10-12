# Internship discovery

ApplyPilot 0.5.0 provides **bounded Google result collection + assisted LinkedIn searches**.
It is not an exhaustive job index, a LinkedIn scraper, or an autonomous application agent.

## Workflow

1. Open **Search** and review the keywords, domains, area, term and query budget.
   Defaults include `intern, stagiaire, internship, stage`, AI/ML, software, data,
   technology consulting, Greater Montréal and remote Canada. The term comes from
   the profile's availability, when supplied. All filters are editable.
2. Expand **Preview queries sent to Google** if desired. A smaller budget runs only
   the first queries shown. Local and remote queries are interleaved by domain.
3. **Search Google** creates one new, inactive tab. It reads result cards, not the
   linked pages, and saves them to the local catalog. Keep the panel open.
4. **Stop search** works from every panel tab. Closing the panel also aborts the run.
   Previously accepted batches remain saved. A batch already received by the local
   server may finish saving; Stop is not a rollback.
5. Review the catalog. **Save**, **Hide**, **Restore**, **Delete** and the local text
   filter affect discoveries only. Results and imported text are escaped for display.
6. **Open posting** opens a new tab; it never navigates an existing form. When ready,
   analyze the employer posting through **Application → Analyze this posting**.
   This explicit application workflow, not discovery, creates a tracker record.

A search-created tab is deliberately **left open** after completion, Stop or error.
Use **View search tab** to inspect it and close it yourself when finished. ApplyPilot
never takes another existing tab for a search, and stops if its own tab is closed,
redirected or navigated to a different query. There is no automatic resume after a
challenge, nor automatic result-page pagination.

## LinkedIn is manual

**LinkedIn search** and **LinkedIn · Remote Canada** open prepared links for you to
browse. ApplyPilot does not inject its general content scripts into LinkedIn and
refuses panel-triggered extraction or autofill there. It does not collect account
traffic, read/export cookies, or replay undocumented LinkedIn APIs.

Paste job links under **Manual import** (one per line, at most 50). An optional title
can precede a link, e.g. `Software intern | https://jobs.example.org/internship`.
For **one** link, you can also supply a title, company, location, employer URL and
manually copied description. Supplying an employer URL links those two identities;
it does not fetch either page. Imported text stays in its original language.

Google may return a publicly indexed LinkedIn job link/snippet. Such a discovery is
labelled **Google**, not a claim that ApplyPilot read LinkedIn. Use LinkedIn manually
or provide the employer link yourself. A logged-in session is not permission to scrape;
respect [LinkedIn's agreement](https://www.linkedin.com/legal/user-agreement) and
[automation restrictions](https://www.linkedin.com/help/linkedin/answer/a1341387/prohibition-of-scraping-software?lang=en).

## Limits and failure behavior

- **1–8 queries** per run, one results page per query, **at most 30 cards** per page.
  The generated domain/area combinations may yield fewer queries than the budget.
- At least 1.8 seconds between query pages. Up to 60 DOM observations per page,
  with 500 ms polling; individual Chrome operations and catalog callbacks time out.
- Two consecutive matching snapshots are required for a results batch.
- Consent, sign-in, CAPTCHA, unusual traffic, visible access denial/rate limiting,
  an unrecognized page, a closed tab or changed navigation ends the run. No bypass,
  stealth, cookie handling, alternate endpoint or automatic retry is attempted.
- Collector execution is top-frame/document-bound; the in-page function validates
  the Google host, HTTPS search path and expected query **before reading the DOM**.
- Unsafe schemes, userinfo, obvious private/local hosts, IP literals and unusual ports
  are rejected. Host validation is syntactic, **not DNS-based proof of a public host**.
  The server never fetches result URLs, and only explicit clicks open results.
- Autofill and discovery cannot start simultaneously from the same panel.
- Up to **3,000 jobs / 32 MiB** in the private catalog; bounded import/text/alias sizes.
  A malformed or unsupported catalog fails with HTTP 409 rather than being replaced.
- Google markup, availability, ranking and regional behavior vary. A ready page is
  not proof that every result was collected. Search position and the keyword score
  do not establish eligibility, an open vacancy, remote permission or hiring intent.

## Local data and deduplication

`data/search/discovery.json` is separate from applications and the CSV journal. It
stores schema version 1, saved settings, canonical URLs/aliases, original result or
manual text, source labels, observed query strings, first/last seen times and one of
`new`, `saved`, `hidden`. It is ignored by Git. No search history is sent to pi.

Common tracking parameters/fragments are removed. LinkedIn job IDs and recognizable
Workday requisitions provide stable identities; generic paths and IDs retain case.
Similar titles alone never merge jobs. A manual LinkedIn/employer pair can join
previously separate rows, including transitive alias connections. Up to 20 aliases
are retained; an excessive merge is rejected without a partial write.

Manually supplied, nonempty fields are protected from later Google text. A later
manual import can revise them. When separate rows merge, **hidden wins over saved,
which wins over new**. Queries are bounded to 12 per job. Atomic writes replace the
catalog only after validation of the complete incoming batch.

Existing applications are associated by canonical posting URLs at read time. A
catalog entry can display **Resume application** for a matching tracker record.
Changing or deleting that discovery does not alter the application. URL matching
is deliberately conservative and will not recognize every employer's aliases.

## API contract

The local API retains the existing localhost Host/Origin protection. No endpoint
below fetches a website, invokes pi, creates an application or submits a form.

| Method | Route | Request / behavior |
|---|---|---|
| GET | `/search` | Settings and ranked jobs, with optional existing-application association |
| PUT | `/search/settings` | Validated search settings; unspecified fields retain their defaults/current values |
| POST | `/search/results` | `{items:[{url,title,snippet,query}]}`; 1–100 items, source forced to `google` |
| POST | `/search/import` | `{links,details?}`; one link per line, optional single-job manual details |
| PATCH | `/search/jobs/:id` | `{status:"new"\|"saved"\|"hidden"}` only |
| DELETE | `/search/jobs/:id` | Remove the discovery, never the application |

Settings: `{keywords, categories:["ai","dev","data","consulting"],
scope:"montreal_remote"|"quebec"|"canada", term, maxPages}`. `maxPages` is a query
budget, not a promise of result pagination. Mutation responses include a fresh
catalog; import/result responses also include `added`, `updated`, `merged` counts
for that batch. Unknown IDs return 404; invalid input/limits return 400.

## Privacy and verification

Queries go to **Google**; clicking prepared LinkedIn searches sends those terms to
**LinkedIn**. Search does not call a model and does not include profile contact
information, CVs, GPA or unconfirmed language levels. As with ordinary navigation,
Chrome and the destination may use the current browser session. ApplyPilot neither
reads nor exports its credentials. Avoid placing private data in custom keywords,
URLs or manually pasted descriptions.

Tests cover pure helpers, catalog corruption/capacity/merges, HTTP security and
separation, runner cancellation/navigation, real Chrome parsing of synthetic pages,
and the actual extension UI. In discovery E2E tests, every new tab is held at
`about:blank` until interception is installed: all destination pages are fulfilled
locally. Public screenshots contain fictional jobs. **These tests do not establish
successful collection against live Google or any live employer.**
