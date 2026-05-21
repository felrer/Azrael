---
name: reference-import-docx-to-native-docs
description: Import a local DOCX as a native Google Docs document.
---

# Import DOCX To Native Google Docs

When to read: after creating or locating a local `.docx` file that should become a native Google Docs document.

For new Google Docs creation, create the local document with the `[@documents](plugin://documents@openai-primary-runtime)` plugin first, then follow this import path.

## Native Conversion

Use native Google Docs conversion by default. For `.docx` inputs, the blessed path is the Google Drive plugin document import action, `mcp__codex_apps__google_drive_import_document`, with `upload_mode: "native_google_docs"`. This wraps the Google Drive API v3 `files.create` upload-conversion path by creating the file with the target Google Workspace MIME type `application/vnd.google-apps.document`. Do not preserve the source file type unless the user explicitly asks to keep a Word file in Drive without converting it.

Before import, confirm the Google Drive plugin exposes `mcp__codex_apps__google_drive_import_document`. If the Google Drive plugin is not installed or unavailable, use the plugin-install/user-elicitation flow to ask the user to install `google-drive@openai-curated`. If the plugin is available but the import action is missing, ask the user to reinstall or refresh the Google Drive plugin.

Steps:

1. Confirm the local source path is an absolute path to a `.docx` file.
2. Import the file with the Google Drive connector document import action:

```json
{
  "source_file": "/absolute/path/to/document.docx",
  "title": "Desired Google Doc title",
  "upload_mode": "native_google_docs"
}
```

3. Use the connector function exposed in the current runtime: `mcp__codex_apps__google_drive_import_document(...)`.
4. Verify the import response reports native conversion with MIME type `application/vnd.google-apps.document` and a Google Docs URL or document id.
5. If the desired Google Doc title needs adjustment after import, rename the native Google Doc with `mcp__codex_apps__google_drive_update_file(...)` or the equivalent Drive metadata update tool after upload.
6. Read the imported document with the Google Docs connector and verify that core headings, body text, tables, and other connector-visible content survived conversion.
7. Confirm the Google Docs URL or document id you will return was observed in the completed import response, connector readback, or Drive metadata readback. Do not synthesize or predict a Google Docs URL, and do not return any URL before readback verification succeeds.

## Preservation Mode

Only use a non-native upload when the user explicitly asks to preserve the Word file, keep the source `.docx`, or avoid conversion.

For that explicit preservation request, use `_import_document` with
`upload_mode: "keep_source_file_type"` and make clear that the result is a
Drive-hosted Word file, not a native Google Doc.

## Final Answer

Return the native Google Doc title and link or id only after import completion and connector readback verification.
Use only a link or id observed in the completed import response, connector readback, or Drive metadata readback. If readback fails, do not present the URL as ready.
Do not cite the local `.docx` path in the final answer after a successful native import.
