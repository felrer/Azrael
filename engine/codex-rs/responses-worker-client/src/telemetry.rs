use crate::ipc::Endpoint;
use crate::protocol::Frame;
use codex_api::ApiError;
use codex_api::RemoteSsePoll;
use codex_api::RemoteWebsocketEvent;
use codex_api::RequestTelemetry;
use codex_api::SseTelemetry;
use codex_api::WebsocketTelemetry;
use codex_responses_worker_protocol::WireApiError;
use codex_responses_worker_protocol::WireTransportError;
use serde::Deserialize;
use serde::Serialize;
use std::sync::Arc;
use std::time::Duration;

#[derive(Serialize, Deserialize)]
pub enum Telemetry {
    Request {
        attempt: u64,
        status: Option<u16>,
        error: Option<WireTransportError>,
        duration: Duration,
    },
    Sse {
        result: RemoteSsePoll,
        duration: Duration,
    },
    WsRequest {
        duration: Duration,
        error: Option<WireApiError>,
        reused: bool,
    },
    WsEvent {
        result: RemoteWebsocketEvent,
        duration: Duration,
    },
}
pub struct NetworkTelemetry {
    pub endpoint: Arc<Endpoint>,
    pub id: u64,
}
impl NetworkTelemetry {
    fn emit(&self, value: Telemetry) {
        // Bounded producer queue, with a replacement runtime thread available for
        // cancellation/control while an unusually slow parent drains telemetry.
        tokio::task::block_in_place(|| {
            let _ = self.endpoint.data(Frame::Telemetry {
                generation: self.endpoint.generation(),
                id: self.id,
                value,
            });
        });
    }
}
impl RequestTelemetry for NetworkTelemetry {
    fn on_request(
        &self,
        attempt: u64,
        status: Option<http::StatusCode>,
        error: Option<&codex_client::TransportError>,
        duration: Duration,
    ) {
        self.emit(Telemetry::Request {
            attempt,
            status: status.map(|s| s.as_u16()),
            error: error.map(Into::into),
            duration,
        });
    }
}
impl SseTelemetry for NetworkTelemetry {
    fn on_sse_poll(
        &self,
        result: &Result<
            Option<
                Result<
                    eventsource_stream::Event,
                    eventsource_stream::EventStreamError<codex_client::TransportError>,
                >,
            >,
            tokio::time::error::Elapsed,
        >,
        duration: Duration,
    ) {
        self.emit(Telemetry::Sse {
            result: RemoteSsePoll::capture(result),
            duration,
        });
    }
}
impl WebsocketTelemetry for NetworkTelemetry {
    fn on_ws_request(&self, duration: Duration, error: Option<&ApiError>, connection_reused: bool) {
        self.emit(Telemetry::WsRequest {
            duration,
            error: error.map(Into::into),
            reused: connection_reused,
        });
    }
    fn on_ws_event(
        &self,
        result: &Result<
            Option<
                Result<
                    tokio_tungstenite::tungstenite::Message,
                    tokio_tungstenite::tungstenite::Error,
                >,
            >,
            ApiError,
        >,
        duration: Duration,
    ) {
        self.emit(Telemetry::WsEvent {
            result: RemoteWebsocketEvent::capture(result),
            duration,
        });
    }
}

#[derive(Default)]
pub struct Observers {
    pub request: Option<Arc<dyn RequestTelemetry>>,
    pub sse: Option<Arc<dyn SseTelemetry>>,
    pub websocket: Option<Arc<dyn WebsocketTelemetry>>,
}
impl Observers {
    pub fn dispatch(&self, value: Telemetry, age: Duration) -> Result<(), String> {
        match value {
            Telemetry::Request {
                attempt,
                status,
                error,
                duration,
            } => {
                if let Some(observer) = &self.request {
                    let status = status
                        .map(http::StatusCode::from_u16)
                        .transpose()
                        .map_err(|e| e.to_string())?;
                    let error = error
                        .map(|e| e.into_transport_error(age))
                        .transpose()
                        .map_err(|e| e.to_string())?;
                    observer.on_request(attempt, status, error.as_ref(), duration);
                }
            }
            Telemetry::Sse { result, duration } => {
                if let Some(observer) = &self.sse {
                    observer.on_remote_sse_poll(&result, duration);
                }
            }
            Telemetry::WsRequest {
                duration,
                error,
                reused,
            } => {
                if let Some(observer) = &self.websocket {
                    let error = error
                        .map(|e| e.into_api_error(age))
                        .transpose()
                        .map_err(|e| e.to_string())?;
                    observer.on_ws_request(duration, error.as_ref(), reused);
                }
            }
            Telemetry::WsEvent { result, duration } => {
                if let Some(observer) = &self.websocket {
                    observer.on_remote_ws_event(&result, duration);
                }
            }
        }
        Ok(())
    }
}
