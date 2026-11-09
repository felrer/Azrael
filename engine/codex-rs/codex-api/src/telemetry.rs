use crate::error::ApiError;
use codex_client::Request;
use codex_client::RequestTelemetry;
use codex_client::Response;
use codex_client::RetryPolicy;
use codex_client::StreamResponse;
use codex_client::TransportError;
use codex_client::run_with_retry;
use http::StatusCode;
use std::future::Future;
use std::sync::Arc;
use std::time::Duration;
use tokio::time::Instant;
use tokio_tungstenite::tungstenite::Error;
use tokio_tungstenite::tungstenite::Message;

/// Generic telemetry.
pub trait SseTelemetry: Send + Sync {
    /// Network-side observation transported from the bundled Responses worker.
    fn on_remote_sse_poll(&self, _result: &RemoteSsePoll, _duration: Duration) {}
    fn on_sse_poll(
        &self,
        result: &Result<
            Option<
                Result<
                    eventsource_stream::Event,
                    eventsource_stream::EventStreamError<TransportError>,
                >,
            >,
            tokio::time::error::Elapsed,
        >,
        duration: Duration,
    );
}

/// Telemetry for Responses WebSocket transport.
pub trait WebsocketTelemetry: Send + Sync {
    /// Network-side observation transported from the bundled Responses worker.
    fn on_remote_ws_event(&self, _result: &RemoteWebsocketEvent, _duration: Duration) {}
    fn on_ws_request(&self, duration: Duration, error: Option<&ApiError>, connection_reused: bool);

    fn on_ws_event(
        &self,
        result: &Result<Option<Result<Message, Error>>, ApiError>,
        duration: Duration,
    );
}

/// Serializable collector inputs, distinct from local native error objects and IPC timings.
#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub enum RemoteSsePoll {
    Event { kind: String, error: Option<String> },
    Error { category: String, message: String },
    End,
    Timeout,
}
impl RemoteSsePoll {
    pub fn capture<E: std::fmt::Display>(
        result: &Result<
            Option<Result<eventsource_stream::Event, eventsource_stream::EventStreamError<E>>>,
            tokio::time::error::Elapsed,
        >,
    ) -> Self {
        match result {
            Ok(Some(Ok(e))) => {
                let failure = if e.data.trim() == "[DONE]" {
                    None
                } else {
                    match serde_json::from_str::<serde_json::Value>(&e.data) {
                        Ok(value) if e.event == "response.failed" => Some(value.to_string()),
                        Ok(value) if e.event == "response.output_item.done" => {
                            serde_json::from_value::<codex_protocol::models::ResponseItem>(value)
                                .err()
                                .map(|_| "failed to parse response.output_item.done".to_string())
                        }
                        Ok(_) => None,
                        Err(error) => Some(error.to_string()),
                    }
                };
                Self::Event {
                    kind: e.event.clone(),
                    error: failure,
                }
            }
            Ok(Some(Err(e))) => Self::Error {
                category: match e {
                    eventsource_stream::EventStreamError::Utf8(_) => "utf8",
                    eventsource_stream::EventStreamError::Parser(_) => "parser",
                    eventsource_stream::EventStreamError::Transport(_) => "transport",
                }
                .into(),
                message: e.to_string(),
            },
            Ok(None) => Self::End,
            Err(_) => Self::Timeout,
        }
    }
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub enum RemoteWebsocketEvent {
    Data {
        kind: Option<String>,
        success: bool,
        timing: Option<serde_json::Value>,
    },
    Ping,
    Pong,
    Binary,
    Close,
    Frame,
    TransportError(String),
    End,
    ApiError(String),
}
impl RemoteWebsocketEvent {
    pub fn capture(result: &Result<Option<Result<Message, Error>>, ApiError>) -> Self {
        match result {
            Ok(Some(Ok(Message::Text(text)))) => {
                match serde_json::from_str::<serde_json::Value>(text) {
                    Ok(value) => {
                        let kind = value
                            .get("type")
                            .and_then(|v| v.as_str())
                            .map(str::to_string);
                        let success = kind.as_deref() != Some("response.failed");
                        let timing = (kind.as_deref() == Some("responsesapi.websocket_timing"))
                            .then_some(value);
                        Self::Data {
                            kind,
                            success,
                            timing,
                        }
                    }
                    Err(_) => Self::Data {
                        kind: Some("parse_error".into()),
                        success: false,
                        timing: None,
                    },
                }
            }
            Ok(Some(Ok(Message::Ping(_)))) => Self::Ping,
            Ok(Some(Ok(Message::Pong(_)))) => Self::Pong,
            Ok(Some(Ok(Message::Binary(_)))) => Self::Binary,
            Ok(Some(Ok(Message::Close(_)))) => Self::Close,
            Ok(Some(Ok(Message::Frame(_)))) => Self::Frame,
            Ok(Some(Err(e))) => Self::TransportError(e.to_string()),
            Ok(None) => Self::End,
            Err(e) => Self::ApiError(e.to_string()),
        }
    }
}

pub(crate) trait WithStatus {
    fn status(&self) -> StatusCode;
}

fn http_status(err: &TransportError) -> Option<StatusCode> {
    match err {
        TransportError::Http { status, .. } => Some(*status),
        _ => None,
    }
}

impl WithStatus for Response {
    fn status(&self) -> StatusCode {
        self.status
    }
}

impl WithStatus for StreamResponse {
    fn status(&self) -> StatusCode {
        self.status
    }
}

pub(crate) async fn run_with_request_telemetry<T, F, Fut>(
    policy: RetryPolicy,
    telemetry: Option<Arc<dyn RequestTelemetry>>,
    make_request: impl FnMut() -> Request,
    send: F,
) -> Result<T, TransportError>
where
    T: WithStatus,
    F: Clone + Fn(Request) -> Fut,
    Fut: Future<Output = Result<T, TransportError>>,
{
    // Wraps `run_with_retry` to attach per-attempt request telemetry for both
    // unary and streaming HTTP calls.
    run_with_retry(policy, make_request, move |req, attempt| {
        let telemetry = telemetry.clone();
        let send = send.clone();
        async move {
            let start = Instant::now();
            let result = send(req).await;
            if let Some(t) = telemetry.as_ref() {
                let (status, err) = match &result {
                    Ok(resp) => (Some(resp.status()), None),
                    Err(err) => (http_status(err), Some(err)),
                };
                t.on_request(attempt, status, err, start.elapsed());
            }
            result
        }
    })
    .await
}
