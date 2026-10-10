CREATE TABLE root_resume_reservations_new (
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
    completion_tasks_json TEXT NOT NULL DEFAULT '[]',
    reason TEXT NOT NULL,
    final_output_json_schema TEXT,
    wake_reason TEXT CHECK (
        wake_reason IS NULL
        OR wake_reason IN ('deadline', 'agents_completed', 'work_completed', 'user_input', 'manual')
    ),
    last_error TEXT,
    wait_started_at_ms INTEGER,
    wait_ended_at_ms INTEGER
);

INSERT INTO root_resume_reservations_new (
    id, root_thread_id, originating_turn_id, root_turn_id, call_id, resume_turn_id,
    resume_at_ms, created_at_ms, updated_at_ms, revision, state, agent_tasks_json,
    reason, final_output_json_schema, wake_reason, last_error,
    wait_started_at_ms, wait_ended_at_ms
)
SELECT id, root_thread_id, originating_turn_id, root_turn_id, call_id, resume_turn_id,
    resume_at_ms, created_at_ms, updated_at_ms, revision, state, agent_tasks_json,
    reason, final_output_json_schema, wake_reason, last_error,
    wait_started_at_ms, wait_ended_at_ms
FROM root_resume_reservations;

DROP TABLE root_resume_reservations;
ALTER TABLE root_resume_reservations_new RENAME TO root_resume_reservations;

CREATE UNIQUE INDEX root_resume_one_active_per_root
    ON root_resume_reservations(root_thread_id)
    WHERE state IN ('preparing', 'waiting', 'claimed', 'blocked');

CREATE INDEX root_resume_active_due
    ON root_resume_reservations(resume_at_ms, created_at_ms, id)
    WHERE state IN ('preparing', 'waiting', 'claimed', 'blocked');
