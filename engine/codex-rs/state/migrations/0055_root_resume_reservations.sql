CREATE TABLE root_resume_reservations (
    id TEXT PRIMARY KEY,
    root_thread_id TEXT NOT NULL,
    originating_turn_id TEXT NOT NULL,
    root_turn_id TEXT NOT NULL,
    call_id TEXT NOT NULL,
    resume_turn_id TEXT NOT NULL,
    resume_at_ms INTEGER NOT NULL,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    revision INTEGER NOT NULL,
    state TEXT NOT NULL CHECK (
        state IN ('preparing', 'waiting', 'claimed', 'resumed', 'cancelled', 'blocked')
    ),
    agent_tasks_json TEXT NOT NULL,
    reason TEXT NOT NULL,
    final_output_json_schema TEXT,
    wake_reason TEXT CHECK (
        wake_reason IS NULL
        OR wake_reason IN ('deadline', 'agents_completed', 'user_input', 'manual')
    ),
    last_error TEXT
);

CREATE UNIQUE INDEX root_resume_one_active_per_root
    ON root_resume_reservations(root_thread_id)
    WHERE state IN ('preparing', 'waiting', 'claimed', 'blocked');

CREATE INDEX root_resume_active_due
    ON root_resume_reservations(resume_at_ms, created_at_ms, id)
    WHERE state IN ('preparing', 'waiting', 'claimed', 'blocked');
