mod protocol;
mod windows_backend;

use protocol::{Error, Request, Result};
use serde_json::{json, Value};
use std::io::{self, Write};

fn dispatch(backend: &mut Option<windows_backend::Backend>, request: Request) -> Result<Value> {
    protocol::validate_request(&request)?;
    match request.method.as_str() {
        "listWindows" | "shutdown" => {
            if request.params != Value::Null && request.params != json!({}) {
                return Err(Error::new(
                    "invalid-params",
                    "This method takes no parameters",
                ));
            }
        }
        "observe" | "restore" | "resize" | "act" | "status" => (),
        _ => {
            return Err(Error::new(
                "unknown-method",
                "Unknown native backend method",
            ))
        }
    }
    if request.method == "shutdown" {
        return Ok(json!({ "shutdown": true }));
    }
    if backend.is_none() {
        *backend = Some(windows_backend::Backend::new()?);
    }
    backend
        .as_mut()
        .unwrap()
        .call(&request.method, request.params)
}

fn main() -> io::Result<()> {
    let stdin = io::stdin();
    let mut reader = stdin.lock();
    let stdout = io::stdout();
    let mut writer = stdout.lock();
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
                let result = dispatch(&mut backend, request);
                let stop = shutdown && result.is_ok();
                (id, result, stop)
            }
            Err(error) => (Value::Null, Err(error), false),
        };
        let response = match result {
            Ok(result) => json!({ "id": id, "result": result }),
            Err(error) => json!({ "id": id, "error": error }),
        };
        serde_json::to_writer(&mut writer, &response)?;
        writer.write_all(b"\n")?;
        writer.flush()?;
        if shutdown {
            break;
        }
    }
    Ok(())
}
