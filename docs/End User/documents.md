# Documents

Documents is a browser and editor for the workspace file roots the operator authorizes. It appears
as a page inside the OpenClaw Control UI. It is not a document database and never copies files into
Falcon Dash — everything you see is the real filesystem.

## What you can do

Browse folders with breadcrumbs, search and sorting. Open supported text files in the editor,
create files and folders, upload by picker or drag and drop, download, and copy a file's path.
Markdown is rendered for preview.

Actions operate on the path currently shown. Confirm the directory and the selection before
anything destructive.

## Deletion is recoverable

Deleted files go to a **durable trash** that survives a page reload — it is stored server-side, not
held in the browser as an undo buffer.

Restoring **never overwrites a file that exists now.** If something has since been created at that
path, the restore is refused and says so rather than silently replacing your current work. The trash
view reports corrupted or unavailable entries with explicit counts instead of hiding them.

## Editing and conflicts

Saves compare content versions and publish through an atomic same-directory replacement. **If the
file changed underneath you, the save is rejected and your input is preserved** with guidance on
recovering — it does not overwrite the newer content, and it does not throw away what you typed.

File content is treated as text, never as trusted markup. Rendered previews contain embedded markup
rather than executing it.

## Safety boundaries

Directory traversal is anchored by file descriptor and rejects: paths containing dot-files or
credential-looking names, symlink components, non-regular files, hard links, and files that are
oversized or binary. Root paths cannot traverse into OpenClaw's own state directory. Read and write
access is gated per root and per actor.

Two limits worth knowing:

- The concurrency model assumes **trusted same-UID writers**. Version checking is not a defense
  against a hostile process editing the same files.
- Filename filtering **cannot find a credential someone pasted into the middle of an otherwise
  ordinary document.** If a root will hold credentials, do not authorize it for Documents.

Directory relocation, binary and media editing, and atomic multi-file transactions are not
supported. Errors and outcomes are always explicit — a gateway problem or filesystem error is
reported as an error, never as an empty folder.

## Related

- [Backend contracts](../Technical/plugin-v4-backend.md)
- [Native Control UI](../Technical/plugin-v4-native-ui.md)
