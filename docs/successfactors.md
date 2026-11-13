# SuccessFactors: partial form support (local 0.7.0)

Voluntarily exported structural diagnostics confirmed editable ARIA comboboxes, non-native radios and attachment/Add controls built from `span`/`div` elements. Two later exports identified the shared CV/cover-letter dialog and its single native file input. This is **partial support**, not a claim of complete SAP compatibility or verified live uploads.

## Corrected behavior

- Specific graduation-date questions take priority over the generic word “degree”. The current profile month is used; old answer memory cannot replace it with a degree or an invented day.
- Completed-internship counts are left for the candidate. Experience entries are not automatically counted, because the question may refer to a particular degree or credited work terms.
- Optional suffix and second-name fields are skipped when unconfirmed. Required variants need manual input. Program/degree text uses the available FR/EN profile wording for the current language context (posting language, or detected page language when no posting language is set).
- Native and ARIA radio groups are inventoried as one question, with real option labels. Unknown eligibility facts and consent stay manual; rejected choices are flagged.
- The SuccessFactors combobox handler opens an unambiguous sibling button (or ArrowDown) and only clicks a unique, exact normalized option linked by `aria-controls`/`aria-owns`. It never searches an unrelated open list, types a guessed selection, or sends Enter. It checks the value after leaving the field and flags it for review; DOM persistence does not prove server-side saving.
- A source **category** is not a website. Choose the category manually, then rerun to select an exact matching subtype once the site enables that field.
- Existing entries are preserved by default. An old malformed graduation answer or unverified combobox text is flagged, not silently replaced. Late AI answers also respect user-entered values and manual-only fields.

## Prepare and attach CV + cover letter

Use the explicit **Prepare and attach CV + cover letter** action on the SuccessFactors form. Ordinary **Fill this page** remains field-only on this platform, so it cannot unexpectedly generate a letter or start an upload. Clicking a feedback row still only focuses/highlights its control.

1. Analyze the posting in another tab, explicitly resume the correct application and select the intended CV. The posting needs a company, title and substantive description; a generic application-form title is insufficient.
2. Save any edited letter draft. Close any currently open upload dialog: the generic picker alone does not identify whether it belongs to CV or cover letter.
3. Click the document action and confirm the application, CV and destination host. This is a deliberate data-transfer/model action, not an on-load effect.
4. A missing letter is generated with the configured AI model and normal provider quota, then rendered to PDF. An existing letter is reused rather than regenerated; a letter linked to another CV requires review. Failed generation/download stops before any upload.
5. CV and cover letter are attempted in sequence. Each recognized launcher must have a distinct field label/scope, and must open a single new dialog containing one unoccupied PDF-compatible file input. The extension assigns the PDF and dispatches file events; it does **not** click cloud-source, ambiguous confirmation, Save or Submit buttons.
6. The first transfer must close its dialog and show the expected filename in that document's field before the second starts. FileList contents alone do not count as confirmation. Reported transfers remain **review required**: a visible filename is not proof of server-side persistence or the contents of the saved file.

Existing attachments are preserved. A matching filename is skipped, not proof of an identical file version; another file, ambiguous scope, changed form, unsupported input or uncertain transfer stops the sequence. The general overwrite checkbox does not override these document guards. No automatic retry is made after an attempted upload.

**Stop** cancels a pending generation request and prevents later document actions. A PDF renderer already working may finish its temporary render before cleanup; cancelled/changed results are not committed. Stop cannot retract bytes the employer already received. Tab navigation, application/draft changes and CV-file metadata changes also prevent subsequent uploads.

## Still manual

Education/language Add controls, extra attachments, cloud storage providers and unknown dialog confirmation flows remain manual. Follow the language scope, including any exclusion of French, without inventing proficiency levels. Review the generated letter, both uploaded documents and all answers before submitting yourself.

Further diagnostic exports may help when a particular control differs; do not send raw HTML, credentials or an authenticated network trace. The standalone diagnostic still performs no attachment action.

## Activate without losing an open form

Save ApplyPilot panel drafts. This document-preparation batch **does require restarting the local server** to load cancellation and missing-letter safeguards: wait for active generation to finish, stop its console with Ctrl+C, then run `start.cmd` again. No dependency reinstall or configuration change is needed. An older same-version server is detected and cannot run automatic documents.

Reload only ApplyPilot in `chrome://extensions`, close/reopen the panel and explicitly resume the intended application. **Do not refresh SuccessFactors**, restart Chrome or remove/reimport the extension. Keep **Overwrite existing fields** off. The capability check replaces older local scripts without navigating the employer page.

Old incorrect field values are not repaired retrospectively. Correct the specific date/count fields manually, or clear only the incorrect date field before rerunning autofill. Do not enable blanket overwrite to repair two answers.

## Verification scope

`npm run test:successfactors` covers synthetic versions of the observed structures, list/radio behavior and file inputs, including rejected/replaced controls, unrelated lists/inputs, stale plans, cancellation, existing documents and ambiguous dialogs. Server tests cover reuse, cancellation and concurrent edits; the real-extension suite uses a fake model to generate an actual PDF and transfer both files in an isolated browser, with FR/EN feedback and no provider quota.

The raw diagnostic stays under ignored private data. Public fixtures contain fictional names and IDs and no copied authenticated HTML. Corrected interactions have **not yet been validated live** on the user's employer form; missing owner relationships or unfamiliar controls fail to manual review rather than being guessed.
