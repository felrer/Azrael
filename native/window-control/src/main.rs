mod overlay;
mod protocol;
mod windows_backend;

use protocol::{Error, Request, Result};
use serde_json::{json, Value};
use std::io;

fn validate_dispatch(request: &Request) -> Result<()> {
    protocol::validate_request(request)?;
    match request.method.as_str() {
        "listWindows" | "shutdown" => {
            if request.params != Value::Null && request.params != json!({}) {
                return Err(Error::new(
                    "invalid-params",
                    "This method takes no parameters",
                ));
            }
        }
        "observe" | "inspect" | "restore" | "resize" | "act" | "status" | "overlayShow"
        | "overlayHide" => (),
        _ => {
            return Err(Error::new(
                "unknown-method",
                "Unknown native backend method",
            ))
        }
    }
    Ok(())
}

fn dispatch(
    backend: &mut Option<windows_backend::Backend>,
    overlays: &mut Option<overlay::Overlay>,
    request: Request,
) -> Result<Value> {
    validate_dispatch(&request)?;
    if request.method == "shutdown" {
        return Ok(json!({ "shutdown": true }));
    }
    if request.method == "overlayHide" {
        return match overlays.as_ref() {
            Some(overlay) => overlay.call(&request.method, request.params),
            None => overlay::hide_without_overlay(request.params),
        };
    }
    if backend.is_none() {
        *backend = Some(windows_backend::Backend::new()?);
    }
    if request.method == "overlayShow" || request.method == "overlayHide" {
        if overlays.is_none() {
            *overlays = Some(overlay::Overlay::new());
        }
        return overlays
            .as_ref()
            .unwrap()
            .call(&request.method, request.params);
    }
    backend
        .as_mut()
        .unwrap()
        .call(&request.method, request.params)
}

#[cfg(test)]
mod dispatch_tests {
    use super::*;

    #[test]
    fn supported_backend_methods_pass_dispatch_gate_without_desktop_operations() {
        for method in [
            "listWindows",
            "observe",
            "inspect",
            "status",
            "restore",
            "resize",
            "act",
            "overlayShow",
            "overlayHide",
            "shutdown",
        ] {
            let request = Request {
                id: json!("dispatch-contract"),
                method: method.into(),
                params: json!({}),
            };
            assert!(
                validate_dispatch(&request).is_ok(),
                "Supported method rejected: {method}"
            );
        }
    }

    #[test]
    fn hide_and_shutdown_do_not_initialize_desktop_services() {
        let mut backend = None;
        let mut overlay = None;
        for (method, params) in [
            (
                "overlayHide",
                json!({"targetId":"12345678-1234-1234-1234-123456789abc","generation":0}),
            ),
            ("shutdown", json!({})),
        ] {
            let request = Request {
                id: json!(1),
                method: method.into(),
                params,
            };
            assert!(dispatch(&mut backend, &mut overlay, request).is_ok());
            assert!(backend.is_none() && overlay.is_none());
        }
        let invalid = Request {
            id: json!(1),
            method: "overlayHide".into(),
            params: json!({}),
        };
        assert_eq!(
            dispatch(&mut backend, &mut overlay, invalid)
                .unwrap_err()
                .code,
            "invalid-params"
        );
    }

    #[test]
    fn unsupported_method_remains_rejected() {
        let request = Request {
            id: json!("dispatch-contract"),
            method: "shell".into(),
            params: json!({}),
        };
        assert_eq!(
            validate_dispatch(&request).unwrap_err().code,
            "unknown-method"
        );
    }
}

fn main() -> io::Result<()> {
    let stdin = io::stdin();
    let mut reader = stdin.lock();
    let mut overlays = None;
    let mut backend = None;
    while let Some(line) = protocol::read_line(&mut reader)? {
        let request = line.and_then(|line| {
            serde_json::from_slice::<Request>(&line).map_err(|_| {
                Error::new("invalid-request", "Expected newline-delimited JSON request")
            })
        });
        let (id, result, shutdown) = match request {
            Ok(request) => {
                let id = request.id.clone();
                let shutdown = request.method == "shutdown";
                let result = dispatch(&mut backend, &mut overlays, request);
                let stop = shutdown && result.is_ok();
                (id, result, stop)
            }
            Err(error) => (Value::Null, Err(error), false),
        };
        let response = match result {
            Ok(result) => json!({ "id": id, "result": result }),
            Err(error) => json!({ "id": id, "error": error }),
        };
        overlay::write_message(&response)?;
        if shutdown {
            break;
        }
    }
    Ok(())
}
