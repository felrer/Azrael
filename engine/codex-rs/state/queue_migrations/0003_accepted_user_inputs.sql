CREATE TABLE accepted_user_inputs (
    receipt_id TEXT PRIMARY KEY NOT NULL,
    thread_id TEXT NOT NULL,
    client_id TEXT,
    turn_id TEXT NOT NULL,
    acceptance_order INTEGER NOT NULL CHECK (acceptance_order >= 0),
    payload_json TEXT,
    payload_sha256 TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('pending', 'consumed')),
    CHECK ((state = 'pending' AND payload_json IS NOT NULL)
        OR (state = 'consumed' AND payload_json IS NULL))
);

CREATE UNIQUE INDEX accepted_user_inputs_client_idx
    ON accepted_user_inputs(thread_id, client_id) WHERE client_id IS NOT NULL;
CREATE INDEX accepted_user_inputs_thread_order_idx
    ON accepted_user_inputs(thread_id, acceptance_order, receipt_id);
