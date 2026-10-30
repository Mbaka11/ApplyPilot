# Inspect the selected CV — local 0.7.0 update

This feature is in the local 0.7.0 working tree, not yet a published release.

## Workflow

1. Analyze a posting or explicitly resume an application.
2. Select **CV to attach**. Wait for **CV selected ✓** if you changed it.
3. **Preview CV** opens the original configured PDF through the local server in a
   new Chrome tab. It never navigates or reloads the employer form.
4. **Show in folder** requests Windows Explorer to select that original file, or
   macOS Finder to reveal it. Linux opens the containing folder instead.
5. Expand **File and location** for the full source path, **Copy path** and
   **Refresh file**. The filename, modification time and size help identify the
   variant and whether its source was updated.

The action rechecks the current file rather than trusting a cached path. Selection
changes must finish saving before inspection is available. A rejected save restores
the stored selection. If the saved CV no longer exists, the selector explicitly
shows **Selected CV not found**, not the first remaining variant. Refresh the main
connection badge to rescan the list after moving/adding/restoring a file.

**Important:** this is the current source document, not proof of what is already
attached to an employer form. Replacing a PDF locally or previewing it does not
replace an older upload. Remove/replace that upload on the employer site yourself.
A CV update also does not synchronize structured `profile.yaml` experience fields or
regenerate old letters. Do not reload Workday or enable blanket overwrite just to
inspect a file.

## Local API and file boundary

| Method | Route | Behavior |
|---|---|---|
| GET | `/cvs` | Existing public CV descriptors; no filesystem paths added to the bulk list |
| GET | `/cvs/:id/details` | Exact configured PDF path, fresh metadata and file-manager support/mode |
| GET | `/cvs/:id/pdf` | Existing uncached inline PDF preview; `?base64=1` retains the neutral upload filename |
| POST | `/cvs/:id/reveal` | `{confirm:true}` only, from a valid Chrome extension origin |

All routes retain localhost Host/Origin checks. The native action additionally
requires a `chrome-extension://…` Origin; originless requests, foreign websites,
GET navigation, unconfirmed bodies, extra path fields and unknown IDs cannot launch
it. As elsewhere in ApplyPilot, a valid extension origin is not per-extension
identity authentication; this is not a general-purpose protected filesystem service.

Only a CV listed in the configured CV directory is accepted. Hidden variants are
not exposed. The resolved PDF must remain a regular file directly inside that
resolved directory. Symbolic-link PDFs are not selectable. The client cannot supply
an arbitrary file, folder, executable, URL or command.

The server uses fixed file-manager executables and argument arrays with
`{shell:false}`. Spaces, accents and shell metacharacters in a filename are not
assembled into a command string. Unsupported platforms keep preview/copy available
and refuse native opening. A reported spawn means **folder opening requested**,
not proof that a visible OS window appeared; launch failures offer the copy-path
fallback.

No Chrome `file://` access or additional extension permission is needed. Details
are escaped as text, and old requests cannot display/open a previously selected
CV after the application, server or CV identity changes. Switching languages or
panel tabs does not discard an open letter/profile draft.

## Verification

- Unit tests inspect temporary fictional PDFs and simulate Windows/macOS/Linux
  launches, failure paths, unknown IDs, hidden files and unsafe targets.
- A symbolic-link-PDF test runs only where the OS account can create symlinks;
  lack of that Windows privilege is reported as a skip, not as a passing test.
- Real Chrome DOM tests use injected APIs and cover stale metadata, late preview
  responses, selection changes, escaping, unsupported platforms and deleted files.
- Actual-extension tests exercise HTTP PDF navigation, clipboard text, simulated
  native requests, delayed/rejected CV saves, missing-selection placeholders, FR/EN
  labels, narrow layout and preserved employer forms/letter drafts.
- The isolated test server imports an explicit fixture preload that replaces only
  file-manager launches. The application never imports that test preload.
- Tests do not open real Explorer/Finder windows, rewrite user PDFs, use provider
  quota or access a real employer form. The preview screenshot is fictional.
