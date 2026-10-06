use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{self, BufRead};

pub const MAX_LINE: usize = 16 * 1024 * 1024;

#[derive(Debug, Serialize)]
pub struct Error {
    pub code: &'static str,
    pub message: String,
}
impl Error {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}
impl From<windows::core::Error> for Error {
    fn from(e: windows::core::Error) -> Self {
        Self::new("native-error", format!("Windows API failed: {}", e.code()))
    }
}
pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub id: Value,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Window {
    pub hwnd: String,
    pub pid: u32,
    pub process_created: String,
    pub executable: String,
    pub title: String,
    pub minimized: bool,
    pub width_px: i32,
    pub height_px: i32,
    pub dpi: u32,
}
impl Window {
    pub fn validate(&self) -> Result<()> {
        hex(&self.hwnd)?;
        hex(&self.process_created)?;
        if self.pid == 0
            || self.executable.is_empty()
            || self.executable.len() > 32768
            || self.title.len() > 65536
            || self.dpi == 0
            || self.dpi > 960
        {
            return Err(Error::new("invalid-params", "Invalid window descriptor"));
        }
        Ok(())
    }
    pub fn same_identity(&self, other: &Self) -> bool {
        self.hwnd == other.hwnd
            && self.pid == other.pid
            && self.process_created == other.process_created
            && self.executable.eq_ignore_ascii_case(&other.executable)
    }
}
pub fn hex(value: &str) -> Result<u64> {
    if value.is_empty() || value.len() > 16 || !value.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(Error::new(
            "invalid-params",
            "Expected a hexadecimal identity",
        ));
    }
    let n = u64::from_str_radix(value, 16)
        .map_err(|_| Error::new("invalid-params", "Invalid hexadecimal identity"))?;
    if n == 0 {
        return Err(Error::new("invalid-params", "Identity cannot be zero"));
    }
    Ok(n)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Target {
    pub window: Window,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Resize {
    pub window: Window,
    pub width_dip: f64,
    pub height_dip: f64,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Action {
    Invoke,
    SetValue,
    Toggle,
    Select,
    Expand,
    Collapse,
    Scroll,
    PressKey,
}
// Fixed named keys only: no model-supplied virtual keys, scan codes or modifiers.
pub fn named_key(value: Option<&Value>) -> Result<(u16, u8, bool)> {
    let key = value.and_then(Value::as_str).ok_or_else(||
        Error::new("invalid-params", "pressKey requires a supported named key string"))?;
    match key {
        "Return" => Ok((0x0d, 0x1c, false)),
        "Tab" => Ok((0x09, 0x0f, false)),
        "Escape" => Ok((0x1b, 0x01, false)),
        "BackSpace" => Ok((0x08, 0x0e, false)),
        "Delete" => Ok((0x2e, 0x53, true)),
        "Left" => Ok((0x25, 0x4b, true)),
        "Right" => Ok((0x27, 0x4d, true)),
        "Up" => Ok((0x26, 0x48, true)),
        "Down" => Ok((0x28, 0x50, true)),
        "Home" => Ok((0x24, 0x47, true)),
        "End" => Ok((0x23, 0x4f, true)),
        "PageUp" => Ok((0x21, 0x49, true)),
        "PageDown" => Ok((0x22, 0x51, true)),
        "space" => Ok((0x20, 0x39, false)),
        _ => Err(Error::new("unsupported-key", "Key name or modifier combination is unsupported")),
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Act {
    pub window: Window,
    pub observation_id: String,
    pub element_id: String,
    pub action: Action,
    pub value: Option<Value>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Scroll {
    pub horizontal: i32,
    pub vertical: i32,
}
pub fn params<T: serde::de::DeserializeOwned>(value: Value) -> Result<T> {
    serde_json::from_value(value).map_err(|_| {
        Error::new(
            "invalid-params",
            "Parameters do not match the method contract",
        )
    })
}
pub fn dip_to_px(dip: f64, dpi: u32) -> Result<i32> {
    let px = (dip * dpi as f64 / 96.0).round();
    if !dip.is_finite() || dip <= 0.0 || dpi == 0 || dpi > 960 || !(1.0..=32768.0).contains(&px) {
        return Err(Error::new(
            "invalid-params",
            "Window size or DPI outside supported bounds",
        ));
    }
    Ok(px as i32)
}

// Consume oversize lines without allocating beyond the bound; the next request remains readable.
pub fn read_line(
    reader: &mut impl BufRead,
) -> io::Result<Option<std::result::Result<Vec<u8>, Error>>> {
    let mut line = Vec::new();
    let mut oversize = false;
    loop {
        let buf = reader.fill_buf()?;
        if buf.is_empty() {
            if line.is_empty() && !oversize {
                return Ok(None);
            }
            break;
        }
        let end = buf.iter().position(|b| *b == b'\n');
        let count = end.map_or(buf.len(), |n| n + 1);
        if !oversize {
            if line.len() + count > MAX_LINE {
                oversize = true;
                line.clear();
            } else {
                line.extend_from_slice(&buf[..count]);
            }
        }
        reader.consume(count);
        if end.is_some() {
            break;
        }
    }
    Ok(Some(if oversize {
        Err(Error::new(
            "request-too-large",
            "JSON request exceeds 16 MiB",
        ))
    } else {
        Ok(line)
    }))
}

pub fn validate_request(request: &Request) -> Result<()> {
    if !(request.id.is_string() || request.id.is_u64() || request.id.is_i64())
        || request.id.as_str().is_some_and(|s| s.len() > 128)
        || request.method.len() > 64
    {
        return Err(Error::new(
            "invalid-request",
            "Request ID must be a bounded string or integer",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn named_keys_are_closed_and_typed() {
        for key in ["Return", "Tab", "Escape", "BackSpace", "Delete", "Left", "Right",
            "Up", "Down", "Home", "End", "PageUp", "PageDown", "space"] {
            assert!(named_key(Some(&Value::String(key.into()))).is_ok());
        }
        for key in ["Enter", "Ctrl+Return", "a", "", "return"] {
            assert!(named_key(Some(&Value::String(key.into()))).is_err());
        }
        assert!(named_key(None).is_err());
        assert!(named_key(Some(&Value::from(13))).is_err());
        assert!(named_key(Some(&Value::Array(vec![]))).is_err());
        assert_eq!(named_key(Some(&Value::String("Left".into()))).unwrap(), (0x25, 0x4b, true));
        assert!(serde_json::from_str::<Action>(r#""pressKey""#).is_ok());
    }
    #[test]
    fn sizes_are_physical_outer_dimensions() {
        assert_eq!(dip_to_px(640.0, 144).unwrap(), 960);
        assert_eq!(dip_to_px(640.0, 96).unwrap(), 640);
        assert!(dip_to_px(f64::NAN, 96).is_err());
        assert!(dip_to_px(-1.0, 96).is_err());
        assert!(dip_to_px(50000.0, 192).is_err());
    }
    #[test]
    fn identities_reject_reuse_and_ignore_title() {
        let w = Window {
            hwnd: "1234".into(),
            pid: 42,
            process_created: "abcd".into(),
            executable: "C:\\app.exe".into(),
            title: "before".into(),
            minimized: false,
            width_px: 640,
            height_px: 480,
            dpi: 96,
        };
        let mut changed = w.clone();
        changed.title = "after".into();
        assert!(w.same_identity(&changed));
        changed.pid = 43;
        assert!(!w.same_identity(&changed));
        changed.pid = 42;
        changed.process_created = "abce".into();
        assert!(!w.same_identity(&changed));
        changed.process_created = "abcd".into();
        changed.executable = "C:\\other.exe".into();
        assert!(!w.same_identity(&changed));
    }
    #[test]
    fn strict_protocol_and_actions() {
        assert!(
            serde_json::from_str::<Request>(r#"{"id":1,"method":"status","unexpected":1}"#)
                .is_err()
        );
        assert!(serde_json::from_str::<Action>(r#""click""#).is_err());
        assert!(serde_json::from_str::<Action>(r#""setValue""#).is_ok());
        assert!(hex("0").is_err());
        assert!(hex("-1").is_err());
        assert!(hex("0x123").is_err());
        assert!(validate_request(&Request {
            id: Value::Null,
            method: "status".into(),
            params: Value::Null
        })
        .is_err());
    }
    #[test]
    fn bounded_reader_recovers_after_large_line() {
        let mut data = vec![b'x'; MAX_LINE + 1];
        data.extend_from_slice(b"\n{}\n");
        let mut reader = io::Cursor::new(data);
        assert!(read_line(&mut reader).unwrap().unwrap().is_err());
        assert_eq!(read_line(&mut reader).unwrap().unwrap().unwrap(), b"{}\n");
        assert!(read_line(&mut reader).unwrap().is_none());
    }
}
