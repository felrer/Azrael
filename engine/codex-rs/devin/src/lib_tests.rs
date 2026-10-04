use super::*;
use pretty_assertions::assert_eq;
use tokio::io::AsyncBufReadExt;
use tokio::io::AsyncWriteExt;
use tokio::io::BufReader;

fn test_client() -> (
    AcpClient,
    tokio::io::DuplexStream,
    mpsc::Receiver<ServerMessage>,
) {
    let (client_io, server_io) = tokio::io::duplex(MAX_MESSAGE_SIZE * 2);
    let (reader, writer) = tokio::io::split(client_io);
    let (client, messages) = AcpClient::start_transport(reader, writer, None);
    (client, server_io, messages)
}

#[tokio::test]
async fn correlates_response_ids() {
    let (client, server_io, _messages) = test_client();
    let (server_reader, mut server_writer) = tokio::io::split(server_io);
    let mut server_reader = BufReader::new(server_reader);
    let server = tokio::spawn(async move {
        let mut request = String::new();
        server_reader.read_line(&mut request).await.unwrap();
        let request: Value = serde_json::from_str(&request).unwrap();
        assert_eq!(request["method"], "session/new");
        server_writer
            .write_all(
                format!(
                    "{{\"jsonrpc\":\"2.0\",\"id\":{},\"result\":{{\"sessionId\":\"s1\"}}}}\n",
                    request["id"]
                )
                .as_bytes(),
            )
            .await
            .unwrap();
    });

    let response = client.request("session/new", json!({})).await.unwrap();
    assert_eq!(response, json!({"sessionId": "s1"}));
    server.await.unwrap();
}

#[tokio::test]
async fn forwards_server_requests_and_writes_responses() {
    let (client, mut server_io, mut messages) = test_client();
    server_io
        .write_all(b"{\"jsonrpc\":\"2.0\",\"id\":7,\"method\":\"session/request_permission\",\"params\":{\"tool\":\"x\"}}\n")
        .await
        .unwrap();

    assert_eq!(
        messages.recv().await,
        Some(ServerMessage::Request(ServerRequest {
            id: Value::from(7),
            method: "session/request_permission".to_owned(),
            params: json!({"tool": "x"}),
        }))
    );
    client
        .respond(Value::from(7), json!({"outcome": "denied"}))
        .await
        .unwrap();
    let mut reader = BufReader::new(server_io);
    let mut response = String::new();
    reader.read_line(&mut response).await.unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&response).unwrap(),
        json!({"jsonrpc": "2.0", "id": 7, "result": {"outcome": "denied"}})
    );
}

#[tokio::test]
async fn process_exit_rejects_pending_request() {
    let (client, mut server_io, _messages) = test_client();
    let request = tokio::spawn({
        let client = client.clone();
        async move { client.request("session/prompt", json!({})).await }
    });
    let mut line = String::new();
    BufReader::new(&mut server_io)
        .read_line(&mut line)
        .await
        .unwrap();
    drop(server_io);

    assert_eq!(
        request.await.unwrap().unwrap_err().to_string(),
        "Devin ACP process exited"
    );
}

#[tokio::test]
async fn malformed_response_rejects_pending_request() {
    let (client, mut server_io, _messages) = test_client();
    let request = tokio::spawn({
        let client = client.clone();
        async move { client.request("session/prompt", json!({})).await }
    });
    let mut line = String::new();
    BufReader::new(&mut server_io)
        .read_line(&mut line)
        .await
        .unwrap();
    server_io
        .write_all(b"{\"jsonrpc\":\"2.0\",\"id\":1}\n")
        .await
        .unwrap();

    assert_eq!(
        request.await.unwrap().unwrap_err().to_string(),
        "malformed Devin ACP response"
    );
}

#[tokio::test]
async fn initialize_disables_filesystem_and_terminal_capabilities() {
    let (client, server_io, _messages) = test_client();
    let (server_reader, mut server_writer) = tokio::io::split(server_io);
    let server = tokio::spawn(async move {
        let mut request = String::new();
        BufReader::new(server_reader)
            .read_line(&mut request)
            .await
            .unwrap();
        let request: Value = serde_json::from_str(&request).unwrap();
        assert_eq!(request["method"], "initialize");
        assert_eq!(
            request["params"]["clientCapabilities"],
            json!({
                "fs": {"readTextFile": false, "writeTextFile": false},
                "terminal": false
            })
        );
        server_writer
            .write_all(
                format!(
                    "{{\"jsonrpc\":\"2.0\",\"id\":{},\"result\":{{\"protocolVersion\":1}}}}\n",
                    request["id"]
                )
                .as_bytes(),
            )
            .await
            .unwrap();
    });

    assert_eq!(
        client.initialize().await.unwrap(),
        json!({"protocolVersion": 1})
    );
    server.await.unwrap();
}

#[tokio::test]
async fn rejects_oversized_outbound_message() {
    let (client, _server_io, _messages) = test_client();
    let error = client
        .notify("oversized", Value::String("x".repeat(MAX_MESSAGE_SIZE)))
        .await
        .unwrap_err();
    assert_eq!(
        error.to_string(),
        format!("Devin ACP message exceeded {MAX_MESSAGE_SIZE} bytes")
    );
}
