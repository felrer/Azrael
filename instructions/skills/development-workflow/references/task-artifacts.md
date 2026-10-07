# Work Documents

## Sessions And Plans

Each folder holds one work session on a specific target. Start a new folder for a new target or separate session. Keep requirements, feasibility findings, approach, and verification for one task in its current `nn-plan.md`; create the next numbered document only for a distinct follow-up task. Update ongoing work in place.

`development-workflow` maintains the single work document for each task. `design-documentation` maintains the agreed design in its durable owners, and `implementation` records execution evidence in the existing work record. Hand off both the session folder and current document paths without creating a second plan.

## Storage

If the user declines a plan document, use the conversation. Otherwise use `Work directory` under `## Work Artifacts` in the project's `docs/README.md`. Relative paths resolve from the project root; external absolute paths are supported. Apply the relevant path-verification guidance to synchronized storage.

Reuse a known session path. If no storage location is configured, use the conversation rather than inventing a folder. The work directory's README holds usage rules, not a growing session index.

## Commands

Run [work_artifacts.py](../scripts/work_artifacts.py) with Python. Replace `ROOT`, `TITLE`, `BODY`, and `PATH` with actual values:

- New session and first plan: `new-session --project ROOT --title TITLE --plan-file BODY`
- Next plan in an existing session: `new-plan --session PATH --plan-file BODY`
- Resolve work location: `resolve --project ROOT`
- Configure future work location: `configure --project ROOT --directory PATH`

`BODY` is a nonempty UTF-8 file; `PATH` is an existing session folder's absolute path. Use English letters, digits, and hyphens for the target title. Remove temporary body files after use. No need to reread the script for each invocation.

A new session always creates a new folder, even with the same title. By default, choose the first unused two-letter prefix in `AA`, `AB`, … order and folder number `01`. Archived identifiers remain reserved. Use `--category UI` and, if needed, `--number 8` only when the user specifies a code; do not invent category codes from the topic.

The first document is `01-plan.md`. Follow-ups increment the largest number among `<number>-plan.md` and historical `<number>-brief.md` files in that folder. Use at least two digits and do not fill deleted numbers. Ignore unrelated documents.

Creation returns JSON containing `code`, `status`, `session`, `plan_number`, and `plan`. Use the returned paths; never report failed creation as complete. Each invocation creates a new document, so check whether creation succeeded before retrying an ambiguous response. Retry lock conflicts after the existing operation finishes; never remove another operation's lock.

Do not overwrite or rename existing documents during allocation; edit contents with ordinary editing tools. Historical briefs retain their paths, and existing sessions accept follow-up plans by absolute path even after the work location changes. `configure` updates the setting and navigation links without moving existing documents.

## Verification

When changing creation commands or numbering, run `python -B scripts/tests/test_work_artifacts.py` from the development-workflow skill folder. It requires only the Python standard library. Tests use temporary directories and local processes, clean up on exit, and do not modify real work documents. This targeted contract check usually takes seconds and covers new sessions, follow-up numbering, concurrency, existing-data preservation, and configuration.
