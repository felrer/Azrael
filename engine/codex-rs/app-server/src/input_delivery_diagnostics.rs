use std::time::Instant;

use codex_app_server_protocol::ClientRequest;
use codex_app_server_protocol::RequestId;
use sha2::Digest;
use sha2::Sha256;

use crate::outgoing_message::ConnectionRequestId;

/// Only hashes and fixed labels cross the diagnostic boundary.
#[derive(Clone)]
pub(crate) struct InputDiagnostics {
    request_ref: String,
    connection: u64,
    method: &'static str,
    thread_ref: Option<String>,
    client_message_hash: Option<String>,
}

pub(crate) fn request_ref(id: &RequestId) -> String {
    let value = match id {
        RequestId::String(value) => value.clone(),
        RequestId::Integer(value) => value.to_string(),
    };
    short_hash(&value)
}

fn full_hash(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}

fn short_hash(value: &str) -> String {
    full_hash(value)[..16].to_owned()
}

impl InputDiagnostics {
    pub(crate) fn new(id: &ConnectionRequestId, method: &str) -> Option<Self> {
        let method = match method {
            "turn/start" => "turn/start",
            "turn/steer" => "turn/steer",
            "thread/resume" => "thread/resume",
            _ => return None,
        };
        Some(Self {
            request_ref: request_ref(&id.request_id),
            connection: id.connection_id.0,
            method,
            thread_ref: None,
            client_message_hash: None,
        })
    }

    pub(crate) fn for_request(id: &ConnectionRequestId, request: &ClientRequest) -> Option<Self> {
        let mut diagnostics = Self::new(id, request.method_name())?;
        let (thread, client) = match request {
            ClientRequest::TurnStart { params, .. } => (
                params.thread_id.as_str(),
                params.client_user_message_id.as_deref(),
            ),
            ClientRequest::TurnSteer { params, .. } => (
                params.thread_id.as_str(),
                params.client_user_message_id.as_deref(),
            ),
            ClientRequest::ThreadResume { params, .. } => (params.thread_id.as_str(), None),
            _ => return None,
        };
        diagnostics.thread_ref = Some(short_hash(thread));
        diagnostics.client_message_hash = client.map(full_hash);
        Some(diagnostics)
    }

    pub(crate) fn stage(&self, stage: &'static str) {
        tracing::info!(target: "azrael_input_delivery", stage, requestRef = %self.request_ref, connection = self.connection,
            method = self.method, threadRef = self.thread_ref.as_deref(),
            clientMessageHash = self.client_message_hash.as_deref(), "input delivery");
    }

    pub(crate) fn native_returned<T, E>(&self, result: &Result<T, E>) {
        let outcome = if result.is_ok() { "success" } else { "error" };
        tracing::info!(target: "azrael_input_delivery", stage = "input.native_call_returned", requestRef = %self.request_ref,
            connection = self.connection, method = self.method, outcome, "input delivery");
    }

    pub(crate) fn handler_panicked(&self) {
        tracing::error!(target: "azrael_input_delivery", stage = "input.handler_panicked", requestRef = %self.request_ref,
            connection = self.connection, method = self.method, threadRef = self.thread_ref.as_deref(),
            clientMessageHash = self.client_message_hash.as_deref(), outcome = "unknown", "input handler panicked");
    }

    pub(crate) fn enqueue_failed(&self) {
        tracing::warn!(target: "azrael_input_delivery", stage = "input.response_enqueue_failed", requestRef = %self.request_ref,
            connection = self.connection, method = self.method, outcome = "channel_closed", "input delivery");
    }
}

/// Observes unwinding or cancellation without intercepting either.
pub(crate) struct HandlerGuard {
    diagnostics: InputDiagnostics,
    started: Instant,
    completed: bool,
}

impl HandlerGuard {
    pub(crate) fn start(diagnostics: InputDiagnostics) -> Self {
        diagnostics.stage("input.handler_started");
        Self {
            diagnostics,
            started: Instant::now(),
            completed: false,
        }
    }

    pub(crate) fn complete(&mut self) {
        self.diagnostics.stage("input.handler_completed");
        self.completed = true;
    }
}

impl Drop for HandlerGuard {
    fn drop(&mut self) {
        if !self.completed {
            tracing::warn!(target: "azrael_input_delivery", stage = "input.handler_abandoned", requestRef = %self.diagnostics.request_ref,
                connection = self.diagnostics.connection, method = self.diagnostics.method,
                panicking = std::thread::panicking(), elapsedMs = self.started.elapsed().as_millis() as u64,
                "input handler abandoned");
        }
    }
}

pub(crate) fn response_route(id: Option<&str>, connection: u64, outcome: &'static str) {
    if let Some(request_ref) = id {
        tracing::debug!(target: "azrael_input_delivery",
            stage = "response_route",
            requestRef = request_ref,
            connection,
            outcome,
            boundary = "writer_queue",
            "transport response route"
        );
    }
}

#[cfg(test)]
#[path = "input_delivery_diagnostics_tests.rs"]
mod tests;
