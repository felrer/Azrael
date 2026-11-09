//! Lossless typed values at the Responses worker process boundary.
pub mod error;
pub mod event;
pub mod headers;
pub mod monotonic;
pub mod request;

pub use error::WireApiError;
pub use error::WireDuration;
pub use error::WireRetryAfter;
pub use error::WireTransportError;
pub use event::WireResponseEvent;
pub use headers::WireHeaders;
pub use request::WireRequest;

/// Malformed wire data is a protocol failure, never a flattened API error.
#[derive(Debug)]
pub struct WireError(pub String);

impl std::fmt::Display for WireError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for WireError {}
