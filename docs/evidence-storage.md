# Evidence storage and recovery

Sherlock stores evidence metadata in PostgreSQL and file bytes in a private Vercel Blob store. Production and Preview never use the Function filesystem, `/tmp` or `public/uploads` as evidence storage.

## Architecture

| Concern                                                                | Authoritative location                                                  |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Evidence metadata, original filename, MIME type, size and SHA-256 hash | PostgreSQL `Document` record                                            |
| Evidence bytes                                                         | Private Vercel Blob store                                               |
| User download                                                          | Authenticated `/api/evidence/<document-id>/download` route              |
| Existing links                                                         | Authenticated `/uploads/<stored-name>` lookup, then controlled redirect |
| Local development bytes                                                | Repository-local `uploads/` directory                                   |

Buffered uploads are limited to **4 MB per file**. ZIP attachments use the separate direct-upload flow below. Vercel Functions accept request and response payloads up to 4.5 MB, so the lower application limit leaves room for multipart fields. Downloads are streamed through the authenticated application route.

## Required Vercel setup

The Blob adapter supports private `put()` and `get()` operations with either of these documented credential modes:

1. **OIDC connection (preferred):** connect a private Blob store to the project. The connection supplies `BLOB_STORE_ID`, and Vercel supplies a short-lived OIDC token to the Function runtime.
2. **Existing token connection:** supply `BLOB_READ_WRITE_TOKEN` from a private Blob store connected to the project.

Do not configure undocumented combinations. A manually supplied `VERCEL_OIDC_TOKEN` requires `BLOB_STORE_ID`; do not expose either credential to browser code.

In the Vercel dashboard:

1. Open your project.
2. Open **Storage** and create or connect a Blob store with **Private** access.
3. Use separate private stores and databases for **Production** and **Preview**. Connect **Development** only when local development should use Blob instead of `uploads/`.
4. Confirm the project environment shows `BLOB_STORE_ID` for an OIDC connection, or `BLOB_READ_WRITE_TOKEN` for an existing token connection.
5. Redeploy after changing the store connection or variables.

The upload request performs a production configuration assertion. Missing or incomplete Blob configuration returns `STORAGE_NOT_CONFIGURED`; it never falls back to local or ephemeral storage. An invalid or rejected credential returns `STORAGE_AUTHENTICATION_FAILED`.

## Upload consistency

Sherlock writes bytes to Blob first. It then creates the `Document` and upload audit entry in one PostgreSQL transaction. For a buffered upload, if that transaction fails, Sherlock attempts compensating deletion of the uploaded Blob and returns `DATABASE_FAILURE` without an incomplete document record.

A failed direct ZIP finalisation can leave an unreferenced private object. Reconcile these against committed document records before any cleanup.

The case backup runs after the evidence record commits. A backup failure is logged separately and does not falsely report that the evidence upload failed.

## Existing evidence compatibility

No existing `Document.path` or `Document.filePath` value is rewritten automatically.

| Existing value                                                 | Treatment                                                                  |
| -------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `filePath` begins `vercel-blob:`                               | Read privately through Vercel Blob after authentication and case lookup    |
| Local file under `uploads/` in local development               | Read through the same authenticated route                                  |
| Production `/tmp`, deployment path or other missing local file | Metadata is retained and download returns `STORED_OBJECT_MISSING`          |
| Empty `filePath`                                               | Treated as metadata-only evidence; the UI does not present a download link |

Historical bytes lost with an earlier deployment cannot be reconstructed from PostgreSQL metadata. To repair one, keep the original metadata for audit history, archive the broken evidence record in Sherlock, upload the recovered source file as new evidence, and link it to the same events and person. The archive and upload create separate audit entries. Do not delete the historical record automatically.

## Dry-run diagnostic

The diagnostic never changes or deletes data.

```bash
pnpm diagnose:evidence
pnpm diagnose:evidence -- --check-storage
```

The first command classifies metadata references only. `--check-storage` also authenticates to the configured provider and checks each object. It prints document and case IDs, path types and status; it does not print stored paths, filenames or file contents. Exit code `2` means one or more referenced objects are missing or inaccessible.

## ZIP evidence uploads

Evidence ZIP files are opaque attachments: Sherlock does not open, extract or
inspect their contents. Ordinary evidence formats remain limited to **4 MB**.
ZIP evidence is limited to **500,000,000 bytes (500 MB decimal)** and is sent
directly from the browser to private Vercel Blob with a short-lived,
case/document-scoped multipart authorisation. The application receives only
the control-plane requests and streams the private stored object while
calculating its SHA-256 during finalisation; it never buffers a ZIP in a
Next.js request handler.

The investigation-import preview remains independently limited to 4 MB total;
it does not accept or inspect ZIP evidence.

## Production smoke test

Use a disposable case and two safe test administrator sessions where the application's current access model permits. Sherlock currently has one administrator role with access to every active case; it does not yet model separate per-user case memberships.

1. Sign in and upload a small supported file with known bytes, filename and MIME type.
2. Query its `Document` row and confirm `filePath` starts with `vercel-blob:`, `fileSize` is correct, `contentHash` matches SHA-256 and `path` remains an application path rather than a public Blob URL.
3. Open `/api/evidence/<document-id>/download` while signed in. Confirm the bytes, `Content-Type` and attachment filename match.
4. Open the stored Blob URL directly without credentials. Confirm access is denied.
5. Redeploy the same commit or start a fresh deployment, then download the same document again and compare its SHA-256 hash.
6. Sign out and request both the document-ID route and its legacy `/uploads/...` path. Confirm both return `401` with `AUTHENTICATION_REQUIRED`.
7. Try to upload while linking an event from another case. Confirm `403 CASE_ACCESS_DENIED` and confirm no `Document` or Blob was created.
8. Temporarily test a Preview deployment without a Blob connection. Confirm upload returns `503 STORAGE_NOT_CONFIGURED` and no file appears under `/tmp`.
9. Use a deliberately invalid Preview credential only in a controlled test. Confirm upload/download returns `STORAGE_AUTHENTICATION_FAILED`, then restore the connection.

## Rollback

The `fileSize` migration is additive and defaults existing records to `0`, so the previous application can run with the added column. A code rollback does not move Blob bytes. Keep the private Blob store connected during rollback, and do not delete objects created by the newer version. Re-run the diagnostic after restoring the application version.
