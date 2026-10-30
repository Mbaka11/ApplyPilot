# Local form diagnostic (unreleased 0.7.0)

The **Application → Page → Local form diagnostic → Export local diagnostic** action downloads `applypilot-form-diagnostic.json` through Chrome. The local server and pi are not involved. It works without an active application or selected CV.

Save any panel drafts before reloading **only ApplyPilot** in `chrome://extensions`, then close/reopen the panel. Keep the employer form open: do not refresh it, remove/reimport the extension or restart Chrome. This diagnostic uses a standalone isolated-world function and does not require reinjecting the autofill scripts or restarting the server.

## What is included

- Structural element types, native input types, visibility, required/disabled/read-only/multiple flags and popup/expanded state.
- Anonymous local references (`n1`, `n2`, …), parent shapes and ARIA label/control/ownership relationships.
- **Fixed label categories**, such as `resume`, `cover-letter`, `education`, `source` and `internship-count`. Label wording is not exported.
- Only an allowlisted set of known SAP component CSS class names; arbitrary classes, element IDs, names and data attributes are not exported.
- Top document and accessible same-origin frames only, plus truncation/skipped-frame indicators and the extension version.

Unknown labels/components deliberately lose detail. These categories cannot reproduce the exact DOM, reconstruct an account or establish that a widget is supported.

## What is not collected/exported

The collector never accesses control `value`, `files`, `checked`, selected options, cookies, browser storage, network responses or credentials. It does not serialize HTML, option text, user-editable text, page titles, file names, raw IDs/classes, URLs or arbitrary attributes. Hidden/password inputs and CAPTCHA/editable subtrees are omitted. File inputs are included **structurally** even when hidden, without inspecting attachments.

Static label/heading/button text and ARIA labels are reduced to a fixed vocabulary in the isolated world; they are never returned verbatim. This is purpose-built data minimization, **not a general HTML/HAR sanitizer**. Treat the resulting report as private and review it before sharing.

No page clicks, keyboard events, navigation, value changes, attachment operations, submissions, server requests, model calls or extension-storage writes are performed. The only click is on a download link in the extension's own document. The UI reports a download **request**, not guaranteed filesystem completion; verify Chrome's downloads.

## Bounds and races

- At most eight top/same-origin documents; third-party frames, Google and LinkedIn are excluded.
- Per document: at most 6,000 traversed elements, 500 output nodes, eight ancestors and six ARIA targets per relationship. Label text traversal is bounded as well.
- Maximum encoded report: 2 MiB. Oversized reports are not downloaded.
- Capture is bound to probed document IDs and rechecked afterward. Active-tab/URL changes, same-URL reloads or simultaneous autofill discard the report.
- Closed shadow roots, inaccessible frames, controls beyond the limits and dialogs not yet present in the DOM are not observed. The diagnostic never opens dialogs to expose them.

## Investigating SuccessFactors

The current synthetic fixture models upload-dialog buttons, an existing hidden file input, empty education/language sections, source selectors and diploma-related questions. It is **not a saved Bombardier/SAP page** and does not establish real selector compatibility. A voluntarily exported redacted report subsequently confirmed non-native buttons, ARIA comboboxes/radios and closed repeat-entry sections. [Partial fixes](successfactors.md) have synthetic runtime coverage; the private report is not shipped. Two later reports identified the shared CV/cover-letter upload dialog and its single native file input. The [document action](successfactors.md) now has isolated end-to-end coverage; post-selection behavior on the employer site remains unverified. The diagnostic itself still never selects or uploads files.

A report does not select a CV or create a cover letter. Analyze the posting separately and explicitly resume the right application before attaching documents. Do not overwrite, clear or submit an existing form merely to diagnose it.

Keep reports outside version control. To share one with the local coding assistant, move the download into the ignored `data/diagnostics/` directory and provide its path. No automatic upload or public publication occurs. The assistant should request more targeted evidence if this deliberately limited report is insufficient, not infer undocumented widget behavior.

## Tests

```sh
cd server
npm run test:diagnostic
npm run test:e2e
```

Tests use fictional candidates, canary secrets, isolated browser profiles and local HTTP fixtures. They check forbidden getters, no DOM/events/network changes, redaction by construction, bounds, document/origin guards and an actual browser JSON download. They never attach to the user's ordinary Chrome session or consume provider quota.
