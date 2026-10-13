CREATE TABLE parent_requests (
    request_id TEXT PRIMARY KEY,
    parent_thread_id TEXT NOT NULL,
    child_thread_id TEXT NOT NULL,
    child_task_id TEXT NOT NULL,
    request_key TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','resolved','cancelled','deferred')),
    created_at_ms INTEGER NOT NULL,
    record_json TEXT NOT NULL,
    UNIQUE(child_thread_id, child_task_id, request_key)
);
CREATE INDEX parent_requests_pending ON parent_requests(parent_thread_id,status,created_at_ms,request_id);
CREATE TABLE parent_response_waits (
    wait_id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL REFERENCES parent_requests(request_id),
    child_task_id TEXT NOT NULL,
    result TEXT,
    record_json TEXT NOT NULL
);
CREATE UNIQUE INDEX parent_response_wait_active ON parent_response_waits(request_id,child_task_id) WHERE result IS NULL;
