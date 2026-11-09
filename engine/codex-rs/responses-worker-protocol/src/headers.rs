use crate::WireError;
use http::HeaderMap;
use http::HeaderName;
use http::HeaderValue;
use serde::Deserialize;
use serde::Serialize;

/// Header names are ASCII; values retain raw bytes, repetitions, and sensitivity.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct WireHeaders(pub Vec<(String, Vec<u8>, bool)>);

impl From<&HeaderMap> for WireHeaders {
    fn from(headers: &HeaderMap) -> Self {
        Self(
            headers
                .iter()
                .map(|(name, value)| {
                    (
                        name.as_str().to_owned(),
                        value.as_bytes().to_vec(),
                        value.is_sensitive(),
                    )
                })
                .collect(),
        )
    }
}

impl From<HeaderMap> for WireHeaders {
    fn from(headers: HeaderMap) -> Self {
        Self::from(&headers)
    }
}

impl TryFrom<WireHeaders> for HeaderMap {
    type Error = WireError;

    fn try_from(headers: WireHeaders) -> Result<Self, Self::Error> {
        let mut result = HeaderMap::new();
        for (name, value, sensitive) in headers.0 {
            let name = HeaderName::from_bytes(name.as_bytes())
                .map_err(|err| WireError(err.to_string()))?;
            let mut value =
                HeaderValue::from_bytes(&value).map_err(|err| WireError(err.to_string()))?;
            value.set_sensitive(sensitive);
            result.append(name, value);
        }
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // A later convenience conversion to String/HashMap would erase these values.
    #[test]
    fn retains_repeated_non_utf8_values() {
        let mut headers = HeaderMap::new();
        headers.append("x-raw", HeaderValue::from_bytes(b"\xff").unwrap());
        headers.append("x-raw", HeaderValue::from_static("second"));
        let mut secret = HeaderValue::from_static("Bearer private");
        secret.set_sensitive(true);
        headers.insert("authorization", secret);
        let encoded = serde_json::to_vec(&WireHeaders::from(&headers)).unwrap();
        let decoded: WireHeaders = serde_json::from_slice(&encoded).unwrap();
        let restored = HeaderMap::try_from(decoded).unwrap();
        assert_eq!(restored, headers);
        assert_eq!(restored.get_all("x-raw").iter().count(), 2);
        assert!(restored.get("authorization").unwrap().is_sensitive());
        assert!(!restored.get("x-raw").unwrap().is_sensitive());
    }
}
