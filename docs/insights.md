# Insights — 0.9.0

Four features help you see what is going on without adding any cloud service: new-offer markers, tracker statistics, a local AI usage log and adapted answer memory. Everything below is computed or stored on your computer. This page states what each one does, what it records and where its limits are.

## AI usage log

Every AI call made by the local server (cover letter, answers, CV tailoring) appends one line to `data/usage/usage.jsonl`. The `data/` folder is excluded from Git.

**Recorded** (an allow-list; any other field is dropped):

- date and time, task, provider, model and requested effort;
- duration in milliseconds, number of attempts (1 or 2), success or failure;
- input and output tokens and cost in US dollars, **only when the provider reports them**;
- `billing`: `api` only for the Claude CLI when `ANTHROPIC_API_KEY` is set in the environment that started the server (the CLI then bills the API); `subscription` for the Claude CLI without that key; `unknown` for pi, where ApplyPilot cannot tell who bills.

**Never recorded:** prompts, model answers, error messages, cover-letter text, company names, job titles, URLs, profile or CV content, answer-memory content.

Provider differences:

- **Claude Code CLI** reports tokens, cost and the model. With a subscription, nothing is billed per call, so the cost shown is an **estimate**; it is labelled that way in Settings. It is a real charge only when `billing` is `api`; Settings says "Billed cost" only when every counted call is `api`.
- **pi** reports durations only. Its rows show a dash for tokens and no cost, and its `billing` is `unknown`: Settings never labels a pi cost as "billed".
- A cancelled call (Stop) is not counted as a failure and is not logged. The one exception: if the automatic JSON retry is cancelled after a first attempt already completed, that first attempt's tokens and cost are logged (as a failure, 2 attempts), since they were spent.

Retention and control:

- Lines older than **180 days** are dropped, and the file is capped at **5 MB** (oldest lines first). When it passes 90 % of the cap it is trimmed down to 80 %, so the rewrite is rare.
- **Settings → AI usage → Clear usage history** deletes the file (after confirmation). `DELETE /usage` does the same.
- To stop logging, set `usage.enabled: false` in `config.yaml` and restart the server. Existing lines are kept until you clear them.
- A logging error never interrupts a generation.

The log starts empty after the upgrade; nothing is reconstructed from earlier use.

## Tracker statistics

The **Statistics** view (Tracker → **Statistics**, `GET /stats`) is computed on demand from your applications and the discovery catalog. The reply contains numbers only, no names, emails or companies, and no AI is involved.

How the numbers are defined:

- **Identified offers:** catalog entries recognized as individual job links (computed without ranking the catalog or touching the visit marker).
- **Applications created:** all applications in the tracker.
- **Submitted:** applications with a submission date or a status of Submitted, Interview, Offer or Rejected (a response implies a submission).
- **With a response:** applications that have a first response date (`respondedAt`) **or** whose current status is **Interview, Offer or Rejected**. An application with a recorded response that you later set to Abandoned still counts as a response (and as submitted). The interview, offer and rejection counts use the current status only. A rejection counts as a response.
- **Response rate:** with a response divided by submitted.
- **By platform / by CV:** the same counts grouped by the posting's platform and by the selected CV (applications without a CV are grouped as "No CV"). CV names are matched case-insensitively.
- **Median response time:** the median number of days between the submission date and the first response date, over the applications that have both.

Limits to keep in mind:

- **Small samples.** A rate is only shown from **5 submitted applications** (`minSample`); below that you see "n = x". Even above 5, a percentage on a few applications moves a lot with one more reply. The view says so ("Small samples: indicative only").
- **No causality.** Platform and CV tables are descriptive. A CV with a better rate may simply have been used on different postings, in a different period or for different employers. Nothing here tells you what to change.
- **Statuses are manual.** The tracker status is what you set. A missing update looks like "no response", and a status alone is not proof of what the employer did. Ghosting and slow employers are indistinguishable from rejections that were never recorded.
- **Response date caveat.** The first response date (`respondedAt`) is stamped when a status first becomes Interview, Offer or Rejected, **from 0.9.0 on**. Earlier responses have no date, so they count in the rates but are left out of the median ("n" next to it tells how many dates it uses). The stamp is the day you updated the tracker, not necessarily the day the employer wrote. Moving an application back to In progress or Submitted clears the stamp.

## New offers

An offer is **new** when all of these hold:

- its status is still **New** (not saved or hidden), and
- it was first added to the catalog **after your last visit marker** (`lastSeenAt`).

The marker lives in `data/search/meta.json`, apart from the catalog. It moves forward when you **leave the Search tab** (not when you open it), so you can read the badges first. It does not move while a search is running. The Home counter, the **New** badge and the **New since my last visit** filter all use this definition.

- On first launch (or if `meta.json` is missing or corrupt), the marker is set to that moment: the existing catalog is **not** flagged as new, only later discoveries are.
- Re-finding an offer you already have does not make it new again.
- Only offers recognized as individual job links count (the Home counter matches the list shown by **New since my last visit**); listings and unrecognized links are not counted.
- **Run again** uses the last Google or public LinkedIn run recorded in the same file (source and scope). A run that finds nothing is recorded too when it ends (`POST /search/run`), so a changed scope is remembered. Manual imports do not overwrite it. It is a single bounded run started by your click, with the same limits and consent as a manual run.

## Adapted answer memory

Answers you give to recurring questions are remembered locally (`data/`), including short text areas of up to 300 characters. A remembered answer is marked **adaptable** when it is longer than 60 characters, belongs to a text area, or mentions the company it was written for. Older memory files without the flag get it computed when read, without being rewritten.

When such a question appears again:

- **AI on:** the remembered text, the question, the field's maximum length and the previous company are sent with the usual answers request. The model must keep only facts found in your profile or CV, replace the old company and position with the current ones, respect the length, never invent facts, figures, tools or dates, and answer with nothing plus a note when the answer no longer applies. The reply is cut to the field's maximum length, confidence is capped at **0.8**, and it is **always flagged for review** (orange) with an "Adapted from {company}" chip. If the old company's name is still in the text, the note says so.
- **AI off** (or the call fails, or the model declines): the remembered value is filled as it was, orange, with "Remembered answer for {company}: review it" and an "adapt" chip.
- **Your edits win.** If you changed the field before the adapted text arrives, the adapted text is dropped and your value stays. The comparison ignores whitespace and a cut made by the page's maximum length.
- **If the model says the answer no longer applies**, the remembered text stays and the note shows the model's reason in orange ("The AI thinks this answer no longer applies: ...").
- **Only your own words are remembered.** An answer filled from memory or by the AI and left untouched is not saved again for the current company; it is saved when you edit or type it yourself.
- Choice controls (selects, radios, checkboxes) keep their previous matching rules; adaptation applies to text fields.

Privacy: the remembered text is sent to your configured AI provider only for this adaptation, as with any AI answer, and only when **Let the AI answer remaining questions** is on. Passwords, signatures and consent controls are never remembered or adapted. ApplyPilot still never submits a form, and you review every adapted answer yourself.
