CREATE TABLE accepted_user_input_reverts (
    thread_id TEXT NOT NULL,
    rollout_id TEXT NOT NULL,
    receipt_id TEXT NOT NULL REFERENCES accepted_user_inputs(receipt_id) ON DELETE CASCADE,
    PRIMARY KEY (thread_id, rollout_id, receipt_id)
);
