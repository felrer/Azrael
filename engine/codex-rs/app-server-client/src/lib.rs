//! Shared remote and in-process app-server client facade for CLI surfaces.
//!
//! The default `embedded` feature wraps the in-process app-server behind a single async API
//! used by surfaces like TUI and exec. It centralizes:
//!
//! - Runtime startup and initialize-capabilities handshake.
//! - Typed caller-provided startup identity (`SessionSource` + client name).
//! - Typed and raw request/notification dispatch.
//! - Server request resolution and rejection.
//! - Ordered, lossless event consumption that cannot block request processing.
//! - Bounded graceful shutdown with abort fallback.
//!
//! The facade interposes a worker task between the caller and the underlying
//! embedded in-process client handle,
//! bridging async `mpsc` channels on both sides. Commands and the underlying
//! runtime remain bounded; the local consumer event queue is unbounded so
//! unread notifications cannot prevent request responses from being delivered.

#[cfg(feature = "embedded")]
mod in_process;
mod path;
mod remote;

use std::error::Error;
use std::fmt;
use std::io::Error as IoError;
use std::io::Result as IoResult;
use std::time::Duration;

use codex_app_server_protocol::ClientNotification;
use codex_app_server_protocol::ClientRequest;
use codex_app_server_protocol::JSONRPCErrorError;
use codex_app_server_protocol::RequestId;
use codex_app_server_protocol::Result as JsonRpcResult;
use codex_app_server_protocol::ServerNotification;
use codex_app_server_protocol::ServerRequest;
use codex_utils_absolute_path::AbsolutePathBuf;
use serde::de::DeserializeOwned;

#[cfg(feature = "embedded")]
pub use crate::in_process::DEFAULT_IN_PROCESS_CHANNEL_CAPACITY;
#[cfg(feature = "embedded")]
pub use crate::in_process::EmbeddedNetworkPolicy;
#[cfg(feature = "embedded")]
pub use crate::in_process::EnvironmentManager;
#[cfg(feature = "embedded")]
pub use crate::in_process::ExecServerRuntimeOptions;
#[cfg(feature = "embedded")]
pub use crate::in_process::InProcessAppServerClient;
#[cfg(feature = "embedded")]
pub use crate::in_process::InProcessAppServerRequestHandle;
#[cfg(feature = "embedded")]
pub use crate::in_process::InProcessClientStartArgs;
#[cfg(feature = "embedded")]
pub use crate::in_process::InProcessServerEvent;
#[cfg(feature = "embedded")]
pub use crate::in_process::StateDbHandle;
#[cfg(feature = "embedded")]
pub use crate::in_process::app_server_control_socket_path;
#[cfg(feature = "embedded")]
pub use crate::in_process::build_otel_provider;
#[cfg(feature = "embedded")]
pub use crate::in_process::legacy_core;
pub use crate::path::AppServerPath;
pub use crate::remote::RemoteAppServerClient;
pub use crate::remote::RemoteAppServerConnectArgs;
pub use crate::remote::RemoteAppServerEndpoint;

const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);

/// Raw app-server request result for typed in-process requests.
///
/// Even on the in-process path, successful responses still travel back through
/// the same JSON-RPC result envelope used by socket/stdio transports because
/// `MessageProcessor` continues to produce that shape internally.
pub type RequestResult = std::result::Result<JsonRpcResult, JSONRPCErrorError>;

#[derive(Debug, Clone)]
pub enum AppServerEvent {
    Lagged { skipped: usize },
    ServerNotification(Box<ServerNotification>),
    ServerRequest(Box<ServerRequest>),
    Disconnected { message: String },
}

/// Layered error for typed app-server requests.
///
/// This keeps transport failures, server-side JSON-RPC failures, and response
/// decode failures distinct so callers can decide whether to retry, surface a
/// server error, or treat the response as an internal request/response mismatch.
#[derive(Debug)]
pub enum TypedRequestError {
    Transport {
        method: String,
        source: IoError,
    },
    Server {
        method: String,
        source: JSONRPCErrorError,
    },
    Deserialize {
        method: String,
        source: serde_json::Error,
    },
}

impl fmt::Display for TypedRequestError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Transport { method, source } => {
                write!(f, "{method} transport error: {source}")
            }
            Self::Server { method, source } => {
                write!(
                    f,
                    "{method} failed: {} (code {})",
                    source.message, source.code
                )?;
                if let Some(data) = source.data.as_ref() {
                    write!(f, ", data: {data}")?;
                }
                Ok(())
            }
            Self::Deserialize { method, source } => {
                write!(f, "{method} response decode error: {source}")
            }
        }
    }
}

impl Error for TypedRequestError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Transport { source, .. } => Some(source),
            Self::Server { .. } => None,
            Self::Deserialize { source, .. } => Some(source),
        }
    }
}

// Await transport in a separate statement before calling this: dropping the
// completed future must precede any caller-provided Deserialize implementation.
fn decode_typed_response<T>(
    method: &str,
    response: IoResult<RequestResult>,
) -> Result<T, TypedRequestError>
where
    T: DeserializeOwned,
{
    let response = response.map_err(|source| TypedRequestError::Transport {
        method: method.to_string(),
        source,
    })?;
    let result = response.map_err(|source| TypedRequestError::Server {
        method: method.to_string(),
        source,
    })?;
    serde_json::from_value(result).map_err(|source| TypedRequestError::Deserialize {
        method: method.to_string(),
        source,
    })
}

#[derive(Clone)]
pub enum AppServerRequestHandle {
    #[cfg(feature = "embedded")]
    InProcess(InProcessAppServerRequestHandle),
    Remote(crate::remote::RemoteAppServerRequestHandle),
}

pub enum AppServerClient {
    #[cfg(feature = "embedded")]
    InProcess(InProcessAppServerClient),
    Remote(RemoteAppServerClient),
}

impl AppServerRequestHandle {
    pub async fn request(&self, request: ClientRequest) -> IoResult<RequestResult> {
        match self {
            #[cfg(feature = "embedded")]
            Self::InProcess(handle) => handle.request(request).await,
            Self::Remote(handle) => handle.request(request).await,
        }
    }

    pub async fn request_typed<T>(&self, request: ClientRequest) -> Result<T, TypedRequestError>
    where
        T: DeserializeOwned,
    {
        let method = request.method_name();
        let response = self.request(request).await;
        decode_typed_response(method, response)
    }
}

impl AppServerClient {
    /// App-server platform family, which can differ from the executor's platform.
    /// Older remote servers may omit this metadata.
    pub fn platform_family(&self) -> Option<&str> {
        match self {
            #[cfg(feature = "embedded")]
            Self::InProcess(_) => Some(std::env::consts::FAMILY),
            Self::Remote(client) => client.platform_family(),
        }
    }

    /// App-server operating system as reported at initialization, including unknown values.
    pub fn platform_os(&self) -> Option<&str> {
        match self {
            #[cfg(feature = "embedded")]
            Self::InProcess(_) => Some(std::env::consts::OS),
            Self::Remote(client) => client.platform_os(),
        }
    }

    pub fn codex_home(&self, local_codex_home: &AbsolutePathBuf) -> Option<AppServerPath> {
        #[cfg(not(feature = "embedded"))]
        let _ = local_codex_home;
        match self {
            #[cfg(feature = "embedded")]
            Self::InProcess(_) => Some(AppServerPath::from_app_server(
                local_codex_home.display().to_string(),
            )),
            Self::Remote(client) => client.codex_home().map(AppServerPath::from_app_server),
        }
    }

    pub async fn request(&self, request: ClientRequest) -> IoResult<RequestResult> {
        match self {
            #[cfg(feature = "embedded")]
            Self::InProcess(client) => client.request(request).await,
            Self::Remote(client) => client.request(request).await,
        }
    }

    pub async fn request_typed<T>(&self, request: ClientRequest) -> Result<T, TypedRequestError>
    where
        T: DeserializeOwned,
    {
        let method = request.method_name();
        let response = self.request(request).await;
        decode_typed_response(method, response)
    }

    pub async fn notify(&self, notification: ClientNotification) -> IoResult<()> {
        match self {
            #[cfg(feature = "embedded")]
            Self::InProcess(client) => client.notify(notification).await,
            Self::Remote(client) => client.notify(notification).await,
        }
    }

    pub async fn resolve_server_request(
        &self,
        request_id: RequestId,
        result: JsonRpcResult,
    ) -> IoResult<()> {
        match self {
            #[cfg(feature = "embedded")]
            Self::InProcess(client) => client.resolve_server_request(request_id, result).await,
            Self::Remote(client) => client.resolve_server_request(request_id, result).await,
        }
    }

    pub async fn reject_server_request(
        &self,
        request_id: RequestId,
        error: JSONRPCErrorError,
    ) -> IoResult<()> {
        match self {
            #[cfg(feature = "embedded")]
            Self::InProcess(client) => client.reject_server_request(request_id, error).await,
            Self::Remote(client) => client.reject_server_request(request_id, error).await,
        }
    }

    pub async fn next_event(&mut self) -> Option<AppServerEvent> {
        match self {
            #[cfg(feature = "embedded")]
            Self::InProcess(client) => client.next_event().await.map(Into::into),
            Self::Remote(client) => client.next_event().await,
        }
    }

    pub async fn shutdown(self) -> IoResult<()> {
        match self {
            #[cfg(feature = "embedded")]
            Self::InProcess(client) => client.shutdown().await,
            Self::Remote(client) => client.shutdown().await,
        }
    }

    pub fn request_handle(&self) -> AppServerRequestHandle {
        match self {
            #[cfg(feature = "embedded")]
            Self::InProcess(client) => AppServerRequestHandle::InProcess(client.request_handle()),
            Self::Remote(client) => AppServerRequestHandle::Remote(client.request_handle()),
        }
    }
}
