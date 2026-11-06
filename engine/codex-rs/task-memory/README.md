# Task memory store

`dispatch` accepts strict JSON requests for one existing absolute `work_dir`.
The caller owns actor identity and authorizes each filesystem path and access mode.
This store does not grant agent authority or emit task-completion notifications.
It supports local Windows, Linux and macOS filesystems; remote stores are excluded.

## Disk layout (schema 1)

- `mem/owner.json`: schema version and creating root session identity (provenance).
- `mem/store.lock`: OS advisory lock, held for each complete request; shared for readers and exclusive for writers.
- `mem/entries/<canonical-uuid>/<revision>.json`: immutable full entry snapshots.
- `.pending-<uuid>`: exact authorized temporary name in the commit directory.
  Normal failures remove these through tempfile ownership; abrupt termination can
  leave them. They are ignored during revision scans and never automatically deleted.

There is no mutable latest pointer. The highest positive numbered revision is
current. Commits sync the temporary file then persist without overwriting an
existing revision. Interrupted first commits can leave an empty entry directory
or pending files without a committed revision. Unfiltered lists expose these as
`{"id":"<uuid>","incomplete":true}`, with no inferred kind, author or body.
Kind-filtered lists omit them because their kind is unknown. Reads and updates
fail clearly for these entries; listing never deletes or adopts their data.
All access checks reject detected symlink/reparse ancestors;
these checks are not a defense against a malicious process replacing paths between
inspection and filesystem operations. Locks coordinate cooperating store callers.

## Requests

- `{"action":"init"}`: root only; idempotently establishes schema and creation provenance.
- `{"action":"list","limit":20,"offset":0,"kind":"finding"}`: optional
  pagination and kind filter; stable ID order; metadata summaries omit all bodies.
- `{"action":"read","id":"<uuid>","revision":1}`: exact historical revision;
  omit revision to read current.
- `{"action":"write","expected_revision":0,"kind":"finding","title":"...",
  "body":"...","evidence":["file::symbol"],"scope":"..."}`: creates an entry.
  Optional `id` addresses an existing entry; updates require its current
  `expected_revision`. Optional `uncertainty` is a string. Unknown fields fail.
  Success returns only `id`, `revision`, `kind`, `title`, `author_session_id`,
  `updated_at_ms` and `stored:true`; bodies and evidence are not echoed. Use
  explicit `read` to retrieve complete stored content.

Kinds: `context`, `finding`, `task`. Only root writes context. All entries can only
be updated by the original author session, including when the requester is root;
kind is immutable. Identity, UUID, revision and timestamp are tool-owned. New IDs are always tool-assigned; supplied IDs require a positive expected revision.
Memory belongs to the explicitly selected work directory and survives root session
replacement. Local filesystem authorization is the access boundary; the creating
root identity is provenance, not an admission restriction. A replacement root can
read or initialize the existing store and create its own context referring to old
entries. Initialization preserves creation provenance and never transfers entry
authorship; another session's entries cannot be silently overwritten.

Limits are UTF-8 bytes: title 256, body 16384, scope 2048, uncertainty 2048;
evidence has at most 16 nonempty references of at most 512 bytes each. Title, body
and scope must be nonempty. Serialized files are at most 32768 bytes; list limit
is 1..=100 (default 20). Revision and entry scans are bounded to 10000 items.
Errors do not claim success; lock contention returns a busy error for caller retry.
Read requests open the existing advisory lock read-only and never create it. No deletion API
or automatic cleanup/retention policy is provided.

Tests retain direct filesystem checks for future accidental removal of revision,
role, ownership, CAS, strict-argument and path-authorization boundaries.

