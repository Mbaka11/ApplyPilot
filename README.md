# ApplyPilot

[![Version](https://img.shields.io/badge/version-0.4.0-blue)](https://github.com/Mbaka11/ApplyPilot/releases/latest)
![Chrome extension](https://img.shields.io/badge/Chrome-Manifest_V3-green)
![Interface](https://img.shields.io/badge/interface-English_%2F_Fran%C3%A7ais-purple)

**Apply to internships faster, without typing the same information again.** ApplyPilot pairs a Chrome side panel with a small local Node.js server:

- 📄 **Tailored cover letters** — pi reads the posting and your CV source, drafts in the posting’s language and your style, and produces an editable, one-page PDF.
- ✍️ **Form autofill** — Workday is the priority: contact details, addresses, phone numbers, experience, education, dates, eligibility questions, languages and websites. Generic forms, including Greenhouse- and Lever-style pages, are also supported.
- 📎 **Attachments** — select an appropriate French, English or specialized CV; attach it, your cover letter and your configured transcript when relevant.
- 🧠 **Open questions** — generate suggested answers without inventing missing profile facts. AI answers always require review.
- 🗂️ **Application tracker** — status, dates, selected CV and cover letter, plus CSV export.
- 🔁 **Answer memory** — reuse answers to recurring questions on future applications.
- ⚙️ **Profile editor** — update contact details, availability and eligibility answers, with private backups and conflict protection.
- 🔎 **Posting checklist** — identify transcripts, credited internships, GPA thresholds, language requirements, on-site work, checks, pay and deadlines.
- 🌐 **English / Français interface** — switch at any time. The preference is remembered; it does not change posting, CV, answer or cover-letter languages.
- ⏹️ **Stop autofill** — cancel pending pi answers and browser operations, preserve completed fields, and continue on the next step.

> ApplyPilot **never clicks Submit**. It fills, highlights what needs review, and leaves submission to you.

<p align="center"><img src="docs/panneau.png" width="320" alt="ApplyPilot English side panel with the visible version and cover-letter editor"> &nbsp; <img src="docs/remplissage-workday.png" width="460" alt="English Workday fixture filled with fictional candidate details"></p>

*Screenshots use fictional candidates, employers and postings. They are not evidence of a real application or submission.*

## How it works

```text
 Chrome                                    Your computer
 ┌───────────────────────────────┐         ┌───────────────────────────────────────┐
 │ Job posting / application form│         │ ApplyPilot server (127.0.0.1)         │
 │   ↑ fills browser fields      │         │ • profile.yaml                        │
 │ ApplyPilot side panel ────────┼── HTTP ►│ • CV folder (.pdf + .tex)             │
 │   analyze · letter · autofill │         │ • pi --print → letters and answers    │
 └───────────────────────────────┘         │ • headless Chrome → cover-letter PDFs │
                                           │ • data/ → tracker and answer memory   │
                                           └───────────────────────────────────────┘
```

The extension does not directly read your local files or call the model. The local server reads your profile and CVs, invokes [pi](https://pi.dev) non-interactively with your existing authentication, renders PDFs with Chrome, and maintains the tracker. **No additional API key is required**, but your configured provider’s usage limits and costs still apply.

Cover letters use **HTML → Chrome PDF**, not LaTeX. Existing LaTeX CV sources help the model understand your CV; the extension does not regenerate your CVs.

## Installation

Requirements:

- **Node.js 20+**
- **Google Chrome** or a compatible Chromium browser such as Edge
- **[pi](https://pi.dev)** installed and authenticated with a model provider; alternatively, set `llm.command` in `config.yaml`

1. **Clone the repository.**
   ```sh
   git clone https://github.com/Mbaka11/ApplyPilot.git
   cd ApplyPilot
   ```
2. **Start the server.** Double-click `start.cmd` on Windows, or run `./start.sh` on macOS/Linux.
   - Dependencies install on the first run.
   - `config.yaml` and `profile.yaml` are created from the example files.
   - Keep the terminal open while applying.
3. **Configure your files and profile.**
   - In `config.yaml`, set `cvDir` to your CV folder. For `X.pdf`, ApplyPilot also looks for `X/main.tex` or `X.tex`. Describe variant languages and keywords in `cvs`.
   - In the extension’s **Profile** tab, edit your contact details, address, availability and eligibility answers, then click **Save profile**.
   - Edit `profile.yaml` for detailed experience, education and language names. Manual changes are detected automatically.
   - Optionally place one or two previous letters as `.txt` in `data/style/` for style guidance.
4. **Load the extension.**
   - Open `chrome://extensions` and enable **Developer mode**.
   - Click **Load unpacked** and select **`ApplyPilot/extension/`**, not the project root.
   - Pin ApplyPilot. Clicking its icon opens the side panel.

### Update without losing an open form

1. Update your local checkout, for example with `git pull --ff-only`.
2. Restart the local server if the release changes it.
3. In `chrome://extensions`, click **↻ Reload** on ApplyPilot’s card. **Do not remove and reimport it.**
4. Close and reopen the ApplyPilot panel. Check the **version beside its name**.
5. Click **Fill this page**. Updated scripts are reinjected into the existing tab without navigating or reloading Workday.

Leave **Overwrite existing fields** unchecked. **Do not press F5 on a form with unsaved entries.** If the server version differs from the extension, its connection badge asks you to restart it.

## Usage

1. Open a posting and click **Analyze this posting**. The application remains active as you move through form steps. The recommended CV is preselected (★).
2. **Generate cover letter**; allow roughly 20–60 seconds. Review the draft and warnings, edit it in the panel, then click **Update PDF**. You can choose French or English independently of the interface.
3. Click **Apply / sign in**, then **Fill this page** on each step:
   - 🟩 **Green:** filled from your profile.
   - 🟧 **Orange:** review needed, including eligibility answers, AI suggestions and manual consent checks.
   - 🟥 **Red:** missing information or an unsupported control. Complete it yourself or update your profile.

   Click a result to jump to its field.
4. Review the page, go to the next step and run autofill again. **Submit on the employer’s website yourself.** Only after receiving confirmation, click **I have submitted ✓**. This button only updates the tracker and asks for confirmation; it does not send a form.
5. Track applications in **Tracker** and export CSV. The server also updates `data/candidatures.csv`.

An incorrect submission mark can be reversed by selecting **In progress** in the tracker; the erroneous submission date is cleared.

### Stop a blocked autofill

Click **Stop** while autofill or pi answers are running. The panel immediately becomes available, the request is aborted, the owned pi process is terminated, and completed fields remain intact. Stop does not undo values already entered.

Changing tabs, navigating, or changing Workday steps cancels the previous run. Late answers cannot be written into a different step. Waiting for AI answers also stops after 90 seconds; retry or disable **Let pi answer remaining questions** to continue manually.

### Interface language

Choose **English** or **Français** below the header. On first use, a French browser defaults to French; other browser languages default to English. Your explicit choice is saved locally.

Switching language changes system labels, dates, status displays, confirmations and feedback. It preserves unsaved profile fields, server URL edits, letter drafts and instructions. It does **not** translate or save your profile values, employer content, remembered answers, CVs or cover letters. Existing tracker status identifiers remain compatible.

### Workday notes

- **Autofill with Resume:** attach your CV, let Workday parse it, then use ApplyPilot to complete the remaining fields.
- **Apply Manually:** ApplyPilot can add experience and education entries when those sections are empty.
- Workday accounts are generally **employer-specific**. An account on one employer’s portal does not unlock another portal.
- **Apply / sign in** reuses a valid browser session. An already open form is activated without reloading it.
- On a sign-in page, autofill supplies **email only**. Use Chrome’s password manager for passwords; account creation, CAPTCHA, email verification and MFA remain manual. ApplyPilot does not store passwords.

**Focus-dependent fields:** when the side panel has focus, Workday may display a value without committing it. ApplyPilot synchronizes focus/blur events so the website can record the field. Background-page fixtures cover this behavior.

**Skills:** ApplyPilot targets selectable leaves, re-queries React-recreated controls and verifies persistent selected pills, including collapsed lists. Typed searches, highlighted options and hidden ARIA announcements are not treated as saved skills. Existing selections are preserved and missing skills are added without duplicates, even when overwrite is off. Unselected skills remain flagged; AI cannot invent substitutes for failed widgets.

**Professional locations:** experience fields use `experience[].location`, independently of the home city in `identity.address.city`. A missing professional location is not inferred from the home address.

### Answer memory

Answers not covered by your profile are remembered when you click Next, or **Remember my answers**. Manage them in **Profile**. Sensitive controls such as passwords and signatures are excluded.

### Profile editing

The editor saves only modified fields to `profile.yaml` and first creates a private copy in `data/backups/profile/`. If another editor changed the file, ApplyPilot refuses to overwrite it and preserves your draft. Use **Reload** to explicitly discard that draft and read the latest file.

The editor includes credited-internship status, language levels and the transcript PDF path. Windows Explorer’s **Copy as path** is accepted. **Blank / I will answer myself** means an unknown answer stays unknown.

Editing a profile does not update existing CV PDFs or cover letters. Keep study and availability dates consistent; use **Update PDF** for an existing letter.

<details><summary>Profile editor preview (fictional data)</summary><img src="docs/profil.png" width="360" alt="ApplyPilot profile editor in English with fictional contact information"></details>

## Privacy and safety

- **Local-first storage:** the server binds to `127.0.0.1` and checks `Host` and `Origin` to reject website-originated API requests.
- `profile.yaml`, `config.yaml`, `data/`, credentials and test outputs are excluded from Git.
- **AI is not offline:** relevant posting, profile, CV and letter information is sent to the provider configured in pi to generate text. Its privacy policy and usage limits apply.
- Passwords, CAPTCHA, signatures and consent controls are never completed automatically.
- Unknown eligibility answers are not guessed. AI output is always marked for review.
- ApplyPilot never submits applications. A tracker status alone is not proof of an employer submission.

## Limitations

Sites vary. Unusual widgets can remain incomplete and need manual input. Workday is the priority, but fixtures cannot replace validation on a real employer form. Always review eligibility, attachments and generated text before submitting.

## Configuration reference

| Key | Purpose |
|---|---|
| `cvDir`, `cvs[]` | CV folder; language, display name and keywords for each variant |
| `llm.model`, `llm.letterThinking` | pi model (blank uses its default) and reasoning level |
| `letter.paper`, `letter.showHeader` | Letter/A4 paper and contact header |
| `letter.fileNameFr` / `fileNameEn` | PDF filenames, e.g. `{first}_{last}_Cover_Letter_{company}.pdf` |
| `fill.attachLetterWithCv` | Also attach the letter in a CV field when it accepts multiple files |
| `fill.cvFileName` | Neutral upload name, default `{first}_{last}_CV.pdf`; does not expose a targeted variant’s filename |

See [`config.example.yaml`](config.example.yaml) and [`profile.example.yaml`](profile.example.yaml). Values and matching rules can be bilingual regardless of the selected interface language.

## Version management

The extension header, this README badge, server package, content scripts and lockfile use the same release number. The connection badge identifies a mismatched server version. See the [changelog](CHANGELOG.md) and [GitHub releases](https://github.com/Mbaka11/ApplyPilot/releases).

We use **Semantic Versioning**:

- **Patch** (`0.4.0 → 0.4.1`): backward-compatible fixes or documentation-only releases.
- **Minor** (`0.4.x → 0.5.0`): new backward-compatible features.
- **Major** (`1.x → 2.0.0`): incompatible changes after a stable `1.0.0`; while on `0.x`, incompatible changes increment the minor version and are called out explicitly.

Each published batch of changes gets a new version, not every intermediate file edit. Released tags are not moved or reused.

```sh
# From the repository root:
node scripts/version.mjs check
node scripts/version.mjs bump patch   # or minor / major
# Document changes in CHANGELOG.md, then:
cd server
npm test
# Commit, tag vX.Y.Z, and publish matching release notes.
```

The bump command synchronizes release metadata and opens a changelog section. It does not commit, push or create a release for you. Tests reject mismatched versions.

## Troubleshooting

| Problem | What to do |
|---|---|
| **Server offline** | Run `start.cmd`, then click the connection badge |
| Extension/server versions differ | Restart the server; reload the extension and reopen its panel |
| Update appears to do nothing | Reload ApplyPilot in `chrome://extensions`, close/reopen the panel and retry; do not reload an unsaved form |
| pi answers are taking too long | Click **Stop**; fill the next step or turn off AI |
| Workday says City is required despite showing a value | Reload the extension, not Workday, and run autofill again |
| Skills search is typed but nothing is selected | Update ApplyPilot and retry: only verified pills count as selected |
| No profile editor | Restart the server and reload the extension |
| Workday asks you to sign in again | Check the Chrome profile and employer portal; the session may have expired |
| Cannot write a PDF | Close the file in Acrobat or another PDF reader |
| pi authentication error | Run `pi` in a terminal and check `/login` |
| Excel displays incorrect accents | CSV uses `;` and UTF-8 with BOM; import it as a text/CSV file if needed |

## Tests

```sh
cd server
npm test                     # version, i18n, cancellation, server, content and extension tests
# Optional: real generation using your authenticated provider (uses quota):
set APPLYPILOT_TEST_LLM=1 && npm run test:server   # Windows
```

Default tests use fictional profiles, simulated employer forms and a fake pi CLI. They check English/French preferences and drafts, actual subprocess cancellation, late-answer rejection, focus, asynchronous selection, recreated controls, collapsed pills and reinjection without navigation. They never use real candidate data or contact an employer to submit anything.

## Project layout

```text
extension/          Chrome MV3 extension: side panel and content scripts
  content/          DOM, extraction, field inventory, widgets, matching, Workday, commands
  sidepanel/        UI, localization and navigation
server/src/         Local server: configuration, CVs, pi, letters/PDFs, tracker and memory
scripts/            Icons and release-version synchronization
tests/              Server, content, end-to-end and cancellation fixtures
config.example.yaml
profile.example.yaml
```
