use crate::WireDuration;
use crate::WireError;
use crate::WireHeaders;
use codex_http_client::Request;
use codex_http_client::RequestBody;
use http::Method;
use serde::Deserialize;
use serde::Serialize;

#[derive(Debug, Serialize, Deserialize)]
pub struct WireRequest {
    pub method: String,
    pub url: String,
    pub headers: WireHeaders,
    pub body: Option<Vec<u8>>,
    pub timeout: Option<WireDuration>,
    pub response_body_limit_bytes: Option<u64>,
}

impl TryFrom<Request> for WireRequest {
    type Error = WireError;

    fn try_from(request: Request) -> Result<Self, Self::Error> {
        let request = request.into_prepared().map_err(WireError)?;
        let body = request.prepare_body_for_send().map_err(WireError)?.body;
        Ok(Self {
            method: request.method.as_str().to_owned(),
            url: request.url,
            headers: request.headers.into(),
            body: body.map(|body| body.to_vec()),
            timeout: request.timeout.map(Into::into),
            response_body_limit_bytes: request
                .response_body_limit_bytes
                .map(u64::try_from)
                .transpose()
                .map_err(|err| WireError(err.to_string()))?,
        })
    }
}

impl TryFrom<WireRequest> for Request {
    type Error = WireError;

    fn try_from(request: WireRequest) -> Result<Self, Self::Error> {
        let method = Method::from_bytes(request.method.as_bytes())
            .map_err(|err| WireError(err.to_string()))?;
        let mut restored = Request::new(method, request.url);
        restored.headers = request.headers.try_into()?;
        restored.body = request.body.map(|body| RequestBody::Raw(body.into()));
        restored.timeout = request.timeout.map(TryInto::try_into).transpose()?;
        restored.response_body_limit_bytes = request
            .response_body_limit_bytes
            .map(usize::try_from)
            .transpose()
            .map_err(|err| WireError(err.to_string()))?;
        Ok(restored)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use codex_http_client::RequestCompression;
    use std::time::Duration;

    // Converting through JSON again would re-encode the already compressed body.
    #[test]
    fn preserves_prepared_compression_and_request_limits() {
        let mut request = Request::new(Method::POST, "https://example.com/r?q=%2F".into())
            .with_json(&serde_json::json!({"input": "hello"}))
            .with_compression(RequestCompression::Zstd);
        request.timeout = Some(Duration::new(9, 17));
        request.response_body_limit_bytes = Some(12345);
        let expected = request.into_prepared().unwrap();
        let wire = WireRequest::try_from(expected.clone()).unwrap();
        let encoded = serde_json::to_vec(&wire).unwrap();
        let restored =
            Request::try_from(serde_json::from_slice::<WireRequest>(&encoded).unwrap()).unwrap();
        assert_eq!(restored.method, expected.method);
        assert_eq!(restored.url, expected.url);
        assert_eq!(restored.timeout, expected.timeout);
        assert_eq!(
            restored.response_body_limit_bytes,
            expected.response_body_limit_bytes
        );
        assert_eq!(
            restored.prepare_body_for_send().unwrap(),
            expected.prepare_body_for_send().unwrap()
        );
        assert_eq!(restored.compression, RequestCompression::None);
    }
}
