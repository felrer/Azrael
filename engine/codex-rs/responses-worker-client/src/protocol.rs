//! Private process protocol. Request identifiers are never reused within a process generation.
use codex_api::Provider;
use codex_api::ResponsesOptions;
use codex_api::RetryConfig;
use codex_responses_worker_protocol::WireApiError;
use codex_responses_worker_protocol::WireHeaders;
use codex_responses_worker_protocol::WireRequest;
use codex_responses_worker_protocol::WireResponseEvent;
use serde::Deserialize;
use serde::Serialize;
use std::collections::HashMap;
use std::io;
use std::io::Read;
use std::io::Write;
use std::sync::Arc;
use std::sync::OnceLock;
use std::time::Duration;

pub const VERSION: u32 = 1;
pub const CAPABILITIES: &[&str] = &[
    "auth-request-v1",
    "live-policy-v1",
    "shared-cookies-v1",
    "credits-v1",
    "pump-termination-v1",
    "telemetry-v1",
    "native-routing-v1",
];
pub const MAX_FRAME: usize = 1024 * 1024;
pub const CHUNK_SIZE: usize = 64 * 1024;
pub const CREDITS: usize = 8;
pub const DATA_WINDOW: usize = 32;

#[derive(Serialize, Deserialize)]
pub struct WireIoError {
    pub kind: String,
    pub os_code: Option<i32>,
    pub message: String,
}
impl From<std::io::Error> for WireIoError {
    fn from(error: std::io::Error) -> Self {
        let mut os_code = error.raw_os_error();
        let mut source = std::error::Error::source(&error);
        while os_code.is_none() {
            let Some(cause) = source else {
                break;
            };
            os_code = cause
                .downcast_ref::<std::io::Error>()
                .and_then(std::io::Error::raw_os_error);
            source = cause.source();
        }
        Self {
            kind: format!("{:?}", error.kind()),
            os_code,
            message: error.to_string(),
        }
    }
}
impl WireIoError {
    pub fn decode(self) -> std::io::Result<std::io::Error> {
        use std::io::ErrorKind as K;
        let kind = match self.kind.as_str() {
            "Other" => K::Other,
            "InvalidData" => K::InvalidData,
            "InvalidInput" => K::InvalidInput,
            "NotFound" => K::NotFound,
            "PermissionDenied" => K::PermissionDenied,
            "TimedOut" => K::TimedOut,
            "Interrupted" => K::Interrupted,
            "Unsupported" => K::Unsupported,
            "AlreadyExists" => K::AlreadyExists,
            "WouldBlock" => K::WouldBlock,
            "UnexpectedEof" => K::UnexpectedEof,
            "OutOfMemory" => K::OutOfMemory,
            _ => self
                .os_code
                .map(|code| std::io::Error::from_raw_os_error(code).kind())
                .filter(|kind| format!("{kind:?}") == self.kind)
                .ok_or_else(|| {
                    std::io::Error::new(K::InvalidData, "unsupported remote IO error kind")
                })?,
        };
        Ok(std::io::Error::new(kind, self.message))
    }
}

#[derive(Serialize, Deserialize)]
pub struct WireProvider {
    name: String,
    base_url: String,
    query_params: Option<HashMap<String, String>>,
    headers: WireHeaders,
    max_attempts: u64,
    base_delay: Duration,
    retry_429: bool,
    retry_5xx: bool,
    retry_transport: bool,
    idle_timeout: Duration,
}
impl From<Provider> for WireProvider {
    fn from(p: Provider) -> Self {
        Self {
            name: p.name,
            base_url: p.base_url,
            query_params: p.query_params,
            headers: p.headers.into(),
            max_attempts: p.retry.max_attempts,
            base_delay: p.retry.base_delay,
            retry_429: p.retry.retry_429,
            retry_5xx: p.retry.retry_5xx,
            retry_transport: p.retry.retry_transport,
            idle_timeout: p.stream_idle_timeout,
        }
    }
}
impl WireProvider {
    pub fn decode(self) -> Result<Provider, String> {
        Ok(Provider {
            name: self.name,
            base_url: self.base_url,
            query_params: self.query_params,
            headers: self.headers.try_into().map_err(|e| format!("{e}"))?,
            retry: RetryConfig {
                max_attempts: self.max_attempts,
                base_delay: self.base_delay,
                retry_429: self.retry_429,
                retry_5xx: self.retry_5xx,
                retry_transport: self.retry_transport,
            },
            stream_idle_timeout: self.idle_timeout,
        })
    }
}

#[derive(Serialize, Deserialize)]
pub struct WireOptions {
    session_id: Option<String>,
    thread_id: Option<String>,
    session_source: Option<codex_protocol::protocol::SessionSource>,
    extra_headers: WireHeaders,
    zstd: bool,
    pub turn_state: Option<String>,
}
impl From<ResponsesOptions> for WireOptions {
    fn from(o: ResponsesOptions) -> Self {
        Self {
            session_id: o.session_id,
            thread_id: o.thread_id,
            session_source: o.session_source,
            extra_headers: o.extra_headers.into(),
            zstd: matches!(o.compression, codex_api::Compression::Zstd),
            turn_state: o.turn_state.and_then(|s| s.get().cloned()),
        }
    }
}
impl WireOptions {
    pub fn decode(self, turn_state: Arc<OnceLock<String>>) -> Result<ResponsesOptions, String> {
        if let Some(value) = self.turn_state {
            let _ = turn_state.set(value);
        }
        Ok(ResponsesOptions {
            session_id: self.session_id,
            thread_id: self.thread_id,
            session_source: self.session_source,
            extra_headers: self.extra_headers.try_into().map_err(|e| format!("{e}"))?,
            compression: if self.zstd {
                codex_api::Compression::Zstd
            } else {
                codex_api::Compression::None
            },
            turn_state: Some(turn_state),
        })
    }
}

#[derive(Serialize, Deserialize)]
pub enum Command {
    Http {
        provider: WireProvider,
        json: String,
        options: WireOptions,
        defaults: WireHeaders,
        reject_redirects: bool,
        request_telemetry: bool,
        sse_telemetry: bool,
    },
    Connect {
        provider: WireProvider,
        extra: WireHeaders,
        defaults: WireHeaders,
        turn_state: Option<String>,
        telemetry: bool,
    },
    Websocket {
        connection: u64,
        json: String,
        reused: bool,
        turn_state: Option<String>,
    },
    IsClosed {
        connection: u64,
    },
    DropConnection {
        connection: u64,
    },
}

#[derive(Serialize, Deserialize)]
pub enum Callback {
    Auth(WireRequest),
    AuthHeaders,
    Acquire {
        url: String,
    },
    Cookies {
        url: String,
        global_only: bool,
    },
    SetCookies {
        url: String,
        headers: WireHeaders,
        global_only: bool,
    },
    ReleasePermit {
        permit: u64,
    },
}
#[derive(Serialize, Deserialize)]
pub enum CallbackResult {
    Auth(Result<WireRequest, AuthFailure>),
    Headers(WireHeaders),
    Permit(Result<u64, PolicyFailure>),
    Cookie(Option<(Vec<u8>, bool)>),
    Unit,
    Failed(String),
}
#[derive(Serialize, Deserialize)]
pub enum AuthFailure {
    Build(String),
    Transient(String),
}
#[derive(Serialize, Deserialize)]
pub enum PolicyFailure {
    Unavailable,
    Destination,
    Revoked,
    UnsupportedTransport,
}
impl From<codex_http_client::NetworkPolicyDenied> for PolicyFailure {
    fn from(e: codex_http_client::NetworkPolicyDenied) -> Self {
        use codex_http_client::NetworkPolicyDenied as E;
        match e {
            E::Unavailable => Self::Unavailable,
            E::Destination => Self::Destination,
            E::Revoked => Self::Revoked,
            E::UnsupportedTransport => Self::UnsupportedTransport,
        }
    }
}
impl From<PolicyFailure> for codex_http_client::NetworkPolicyDenied {
    fn from(e: PolicyFailure) -> Self {
        match e {
            PolicyFailure::Unavailable => Self::Unavailable,
            PolicyFailure::Destination => Self::Destination,
            PolicyFailure::Revoked => Self::Revoked,
            PolicyFailure::UnsupportedTransport => Self::UnsupportedTransport,
        }
    }
}

#[derive(Serialize, Deserialize)]
pub enum Frame {
    /// Bounded physical fragments; no artificial logical Responses payload limit.
    Fragment {
        stream: u64,
        index: u64,
        last: bool,
        bytes: Vec<u8>,
    },
    Hello {
        version: u32,
        identity: String,
        capabilities: Vec<String>,
    },
    Init {
        generation: u64,
        system_proxy: bool,
        system_fallback: bool,
        managed: bool,
    },
    Ready {
        generation: u64,
    },
    Command {
        generation: u64,
        id: u64,
        command: Command,
    },
    Started {
        generation: u64,
        id: u64,
        request_id: Option<String>,
        interruptible: bool,
        turn_state: Option<String>,
    },
    Connected {
        generation: u64,
        id: u64,
        turn_state: Option<String>,
    },
    Closed {
        generation: u64,
        id: u64,
        closed: bool,
    },
    Event {
        generation: u64,
        id: u64,
        event: Result<WireResponseEvent, WireApiError>,
    },
    Error {
        generation: u64,
        id: u64,
        error: WireApiError,
    },
    ClientBuildError {
        generation: u64,
        id: u64,
        error: WireIoError,
    },
    Terminated {
        generation: u64,
        id: u64,
        turn_state: Option<String>,
    },
    Credit {
        generation: u64,
        id: u64,
        amount: usize,
    },
    DataCredit {
        generation: u64,
        amount: usize,
    },
    Cancel {
        generation: u64,
        id: u64,
    },
    Interrupt {
        generation: u64,
        id: u64,
    },
    Callback {
        generation: u64,
        id: u64,
        call: u64,
        callback: Callback,
    },
    CallbackReply {
        generation: u64,
        id: u64,
        call: u64,
        result: CallbackResult,
    },
    Revoke {
        generation: u64,
        permit: u64,
    },
    Telemetry {
        generation: u64,
        id: u64,
        value: crate::telemetry::Telemetry,
    },
    Shutdown,
}
pub fn is_data_frame(frame: &Frame) -> bool {
    matches!(
        frame,
        Frame::Event { .. }
            | Frame::Telemetry { .. }
            | Frame::Error { .. }
            | Frame::ClientBuildError { .. }
            | Frame::Terminated { .. }
    )
}

pub struct EncodedFrame {
    bytes: Vec<u8>,
    offset: usize,
    stream: u64,
    index: u64,
}
impl EncodedFrame {
    pub fn new(frame: &Frame, stream: u64) -> io::Result<Self> {
        Ok(Self {
            bytes: serde_json::to_vec(frame).map_err(io::Error::other)?,
            offset: 0,
            stream,
            index: 0,
        })
    }
    /// Writes one bounded chunk so the writer can service control before the next chunk.
    pub fn write_next(&mut self, writer: &mut impl Write) -> io::Result<bool> {
        if self.bytes.len() <= CHUNK_SIZE {
            write_bytes(writer, &self.bytes)?;
            return Ok(true);
        }
        let end = (self.offset + CHUNK_SIZE).min(self.bytes.len());
        let last = end == self.bytes.len();
        // Fragment bytes are binary, avoiding recursive JSON byte-array expansion.
        let mut fragment = Vec::with_capacity(18 + end - self.offset);
        fragment.push(0xff);
        fragment.extend_from_slice(&self.stream.to_be_bytes());
        fragment.extend_from_slice(&self.index.to_be_bytes());
        fragment.push(u8::from(last));
        fragment.extend_from_slice(&self.bytes[self.offset..end]);
        write_bytes(writer, &fragment)?;
        self.offset = end;
        self.index += 1;
        Ok(last)
    }
}
fn write_bytes(writer: &mut impl Write, data: &[u8]) -> io::Result<()> {
    if data.is_empty() || data.len() > MAX_FRAME {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid physical Responses frame",
        ));
    }
    writer.write_all(&(data.len() as u32).to_be_bytes())?;
    writer.write_all(data)?;
    writer.flush()
}

#[derive(Default)]
pub struct Assembler {
    partial: HashMap<u64, (u64, Vec<u8>)>,
}
impl Assembler {
    pub fn accept(&mut self, frame: Frame) -> io::Result<Option<Frame>> {
        let Frame::Fragment {
            stream,
            index,
            last,
            bytes,
        } = frame
        else {
            return Ok(Some(frame));
        };
        if bytes.is_empty() || bytes.len() > CHUNK_SIZE {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "invalid Responses fragment size",
            ));
        }
        let entry = self
            .partial
            .entry(stream)
            .or_insert_with(|| (0, Vec::new()));
        if index != entry.0 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "stale Responses fragment",
            ));
        }
        entry.0 += 1;
        entry.1.extend_from_slice(&bytes);
        if !last {
            return Ok(None);
        }
        let (_, data) = self
            .partial
            .remove(&stream)
            .ok_or_else(|| io::Error::other("missing Responses fragment stream"))?;
        let logical = serde_json::from_slice(&data).map_err(io::Error::other)?;
        if matches!(logical, Frame::Fragment { .. }) {
            return Err(io::Error::other("nested Responses fragments"));
        }
        Ok(Some(logical))
    }
}

pub fn read_frame(reader: &mut impl Read) -> io::Result<Frame> {
    let mut size = [0; 4];
    reader.read_exact(&mut size)?;
    let size = u32::from_be_bytes(size) as usize;
    if size == 0 || size > MAX_FRAME {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid Responses worker frame length",
        ));
    }
    let mut data = vec![0; size];
    reader.read_exact(&mut data)?;
    if data.first() == Some(&0xff) {
        if data.len() <= 18 || data[17] > 1 {
            return Err(io::Error::other("invalid binary Responses fragment"));
        }
        let stream = u64::from_be_bytes(data[1..9].try_into().map_err(io::Error::other)?);
        let index = u64::from_be_bytes(data[9..17].try_into().map_err(io::Error::other)?);
        return Ok(Frame::Fragment {
            stream,
            index,
            last: data[17] == 1,
            bytes: data[18..].to_vec(),
        });
    }
    serde_json::from_slice(&data).map_err(io::Error::other)
}
pub fn write_frame(writer: &mut impl Write, frame: &Frame) -> io::Result<()> {
    let mut frame = EncodedFrame::new(frame, 0)?;
    while !frame.write_next(writer)? {}
    Ok(())
}
