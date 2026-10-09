CREATE TABLE project_usage_daily (
    date TEXT NOT NULL,
    project_id TEXT NOT NULL,
    project_name TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    amount_nano_usd INTEGER NOT NULL CHECK (typeof(amount_nano_usd) = 'integer' AND amount_nano_usd >= 0),
    priced_requests INTEGER NOT NULL CHECK (typeof(priced_requests) = 'integer' AND priced_requests >= 0),
    unpriced_requests INTEGER NOT NULL CHECK (typeof(unpriced_requests) = 'integer' AND unpriced_requests >= 0),
    PRIMARY KEY (date, project_id, provider, model)
) WITHOUT ROWID;
