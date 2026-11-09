//! Real bundled-process checks. These guard omissions at the private IPC/lifecycle
//! boundary which ordinary endpoint unit tests cannot observe.
use codex_api::Provider;
use codex_api::ResponsesOptions;
use codex_api::RetryConfig;
use codex_responses_worker_client::ipc::Endpoint;
use codex_responses_worker_client::ipc::Incoming;
use codex_responses_worker_client::protocol::*;
use std::io::BufRead;
use std::io::Read;
use std::io::Write;
use std::net::TcpListener;
use std::process::Child;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use std::time::Instant;

const PROGRAM: &str = env!("CARGO_BIN_EXE_azrael-responses-worker");
const GENERATION: u64 = 7123;

struct Harness {
    child: Child,
    endpoint: Option<Arc<Endpoint>>,
    frames: tokio::sync::mpsc::UnboundedReceiver<Incoming>,
    auth_attempts: usize,
    next_permit: u64,
    telemetry_count: usize,
    data_credits: usize,
}
impl Harness {
    fn spawn() -> Self {
        Self::spawn_config(true, false, None)
    }
    fn spawn_config(
        managed: bool,
        system_proxy: bool,
        custom_ca: Option<&std::path::Path>,
    ) -> Self {
        let mut command = std::process::Command::new(PROGRAM);
        command
            .env_clear()
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());
        for key in ["SystemRoot", "WINDIR", "PATH", "TMP", "TEMP"] {
            if let Some(value) = std::env::var_os(key) {
                command.env(key, value);
            }
        }
        if let Some(path) = custom_ca {
            command.env("CODEX_CA_CERTIFICATE", path);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut child = command.spawn().expect("spawn real worker");
        let mut output = child.stdout.take().unwrap();
        let mut input = child.stdin.take().unwrap();
        match read_frame(&mut output).expect("worker hello") {
            Frame::Hello {
                version,
                identity,
                capabilities,
            } => {
                assert_eq!(version, VERSION);
                assert_eq!(
                    identity,
                    codex_responses_worker_client::hash_file(std::path::Path::new(PROGRAM))
                        .unwrap()
                );
                assert!(
                    CAPABILITIES
                        .iter()
                        .all(|c| capabilities.iter().any(|v| v == c))
                );
            }
            _ => panic!("worker must handshake before accepting commands"),
        }
        write_frame(
            &mut input,
            &Frame::Init {
                generation: GENERATION,
                system_proxy,
                system_fallback: false,
                managed,
            },
        )
        .unwrap();
        let (endpoint, frames) = Endpoint::start(GENERATION, output, input);
        Self {
            child,
            endpoint: Some(endpoint),
            frames,
            auth_attempts: 0,
            next_permit: 1,
            telemetry_count: 0,
            data_credits: 0,
        }
    }
    async fn ready(&mut self) {
        assert!(matches!(
            self.next().await,
            Frame::Ready {
                generation: GENERATION
            }
        ));
    }
    fn send(&self, frame: Frame) {
        self.endpoint.as_ref().unwrap().control(frame).unwrap();
    }
    fn command(&self, id: u64, command: Command) {
        self.send(Frame::Command {
            generation: GENERATION,
            id,
            command,
        });
    }
    async fn next(&mut self) -> Frame {
        loop {
            let message = tokio::time::timeout(Duration::from_secs(15), self.frames.recv())
                .await
                .expect("bounded worker reply")
                .expect("worker EOF");
            let Incoming::Frame(frame) = message else {
                panic!("worker disconnected unexpectedly");
            };
            if is_data_frame(&frame) {
                self.data_credits += 1;
                if self.data_credits >= 8 {
                    self.send(Frame::DataCredit {
                        generation: GENERATION,
                        amount: self.data_credits,
                    });
                    self.data_credits = 0;
                }
            }
            match frame {
                Frame::Callback {
                    generation,
                    id,
                    call,
                    callback,
                } => {
                    assert_eq!(generation, GENERATION);
                    let result = match callback {
                        Callback::Auth(request) => {
                            self.auth_attempts += 1;
                            let mut request: codex_client::Request = request.try_into().unwrap();
                            request.headers.insert(
                                "x-test-auth-attempt",
                                http::HeaderValue::from_str(&self.auth_attempts.to_string())
                                    .unwrap(),
                            );
                            CallbackResult::Auth(Ok(request.try_into().unwrap()))
                        }
                        Callback::AuthHeaders => {
                            CallbackResult::Headers(http::HeaderMap::new().into())
                        }
                        Callback::Acquire { .. } => {
                            let permit = self.next_permit;
                            self.next_permit += 1;
                            CallbackResult::Permit(Ok(permit))
                        }
                        Callback::Cookies { .. } => CallbackResult::Cookie(None),
                        Callback::SetCookies { .. } | Callback::ReleasePermit { .. } => {
                            CallbackResult::Unit
                        }
                    };
                    if call != 0 {
                        self.send(Frame::CallbackReply {
                            generation,
                            id,
                            call,
                            result,
                        });
                    }
                }
                Frame::Telemetry { .. } => self.telemetry_count += 1,
                frame => return frame,
            }
        }
    }
    async fn reap(&mut self) {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if let Some(status) = self.child.try_wait().unwrap() {
                assert!(status.success());
                self.child.wait().unwrap();
                return;
            }
            assert!(
                Instant::now() < deadline,
                "worker did not terminate/reap after EOF"
            );
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }
}
impl Drop for Harness {
    fn drop(&mut self) {
        if let Some(endpoint) = self.endpoint.take() {
            endpoint.invalidate("test owner shutdown");
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn provider(address: std::net::SocketAddr) -> Provider {
    Provider {
        name: "fixture".into(),
        base_url: format!("http://{address}"),
        query_params: None,
        headers: http::HeaderMap::new(),
        retry: RetryConfig {
            max_attempts: 1,
            base_delay: Duration::ZERO,
            retry_429: false,
            retry_5xx: false,
            retry_transport: false,
        },
        stream_idle_timeout: Duration::from_secs(10),
    }
}
fn http_command(provider: Provider, json: String) -> Command {
    Command::Http {
        provider: provider.into(),
        json,
        options: ResponsesOptions::default().into(),
        defaults: http::HeaderMap::new().into(),
        reject_redirects: false,
        request_telemetry: true,
        sse_telemetry: true,
    }
}
fn read_request(stream: &mut std::net::TcpStream) -> Vec<u8> {
    capture_request(stream).body
}
#[derive(Debug, PartialEq, Eq)]
struct CapturedRequest {
    line: String,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}
fn capture_request(stream: &mut std::net::TcpStream) -> CapturedRequest {
    stream
        .set_read_timeout(Some(Duration::from_secs(10)))
        .unwrap();
    let mut reader = std::io::BufReader::new(stream);
    let mut length = None;
    let mut first_line = String::new();
    reader.read_line(&mut first_line).unwrap();
    let mut headers = Vec::new();
    loop {
        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        assert!(!line.is_empty(), "HTTP request ended before headers");
        if line == "\r\n" {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            headers.push((name.to_ascii_lowercase(), value.trim().to_string()));
            if name.eq_ignore_ascii_case("content-length") {
                length = Some(value.trim().parse::<usize>().unwrap());
            }
        }
    }
    let mut body = vec![0; length.unwrap_or(0)];
    reader.read_exact(&mut body).unwrap();
    headers.sort_by(|a, b| a.0.cmp(&b.0));
    CapturedRequest {
        line: first_line,
        headers,
        body,
    }
}
fn completed_response() -> String {
    "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"r-fixture\"}}\n\n".into()
}
fn write_response(stream: &mut std::net::TcpStream, response: &str) {
    write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nx-request-id: upstream-fixture\r\nx-codex-turn-state: state-fixture\r\n\r\n{}", response.len(), response).unwrap();
    stream.flush().unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn actual_worker_large_request_roundtrip_and_eof_reaps() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let target = provider(listener.local_addr().unwrap());
    let json = format!(
        "{{\"model\":\"fixture\",\"input\":\"{}\",\"stream\":true}}",
        "x".repeat(17 * 1024 * 1024)
    );
    let expected = json.clone();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        assert_eq!(read_request(&mut stream), expected.as_bytes());
        write_response(&mut stream, &completed_response());
    });
    let mut worker = Harness::spawn();
    worker.ready().await;
    worker.command(1, http_command(target, json));
    let mut events = 0;
    loop {
        match worker.next().await {
            Frame::Started {
                request_id,
                turn_state,
                ..
            } => {
                assert_eq!(request_id.as_deref(), Some("upstream-fixture"));
                assert_eq!(turn_state.as_deref(), Some("state-fixture"));
            }
            Frame::Event { event, .. } => {
                assert!(event.is_ok());
                events += 1;
                worker.send(Frame::Credit {
                    generation: GENERATION,
                    id: 1,
                    amount: 1,
                });
            }
            Frame::Terminated { .. } => break,
            Frame::Error { error, .. } => panic!("worker HTTP failed: {error:?}"),
            _ => panic!("unexpected worker frame"),
        }
    }
    assert!(events > 0);
    assert_eq!(worker.auth_attempts, 1);
    assert!(worker.telemetry_count > 0);
    server.join().unwrap();
    // Dropping the sole writer closes the inherited private pipe. No shutdown RPC is required.
    worker.endpoint.take();
    worker.reap().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn actual_worker_cancel_full_event_window_terminates_and_reuses_process() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let target = provider(listener.local_addr().unwrap());
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        read_request(&mut stream);
        let mut response = String::new();
        for _ in 0..2000 {
            response
                .push_str("data: {\"type\":\"response.output_text.delta\",\"delta\":\"x\"}\n\n");
        }
        write_response(&mut stream, &response);
        let (mut second, _) = listener.accept().unwrap();
        read_request(&mut second);
        write_response(&mut second, &completed_response());
    });
    let mut worker = Harness::spawn();
    worker.ready().await;
    worker.command(
        1,
        http_command(target.clone(), "{\"model\":\"fixture\"}".into()),
    );
    let mut count = 0;
    while count < CREDITS {
        match worker.next().await {
            Frame::Event { .. } => count += 1,
            Frame::Started { .. } => {}
            _ => panic!("unexpected pre-cancel frame"),
        }
    }
    // No credits are returned. Cancellation must bypass the saturated event window.
    worker.send(Frame::Cancel {
        generation: GENERATION,
        id: 1,
    });
    assert!(matches!(
        worker.next().await,
        Frame::Terminated { id: 1, .. }
    ));
    worker.command(2, http_command(target, "{\"model\":\"fixture\"}".into()));
    loop {
        match worker.next().await {
            Frame::Event { .. } => worker.send(Frame::Credit {
                generation: GENERATION,
                id: 2,
                amount: 1,
            }),
            Frame::Started { .. } => {}
            Frame::Terminated { id: 2, .. } => break,
            _ => panic!("worker was not reusable after cancellation"),
        }
    }
    assert_eq!(worker.auth_attempts, 2);
    server.join().unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn actual_worker_rejects_stale_generation_and_crash_is_not_replayed() {
    let mut worker = Harness::spawn();
    worker.ready().await;
    worker.send(Frame::Credit {
        generation: GENERATION + 1,
        id: 1,
        amount: 1,
    });
    let result = tokio::time::timeout(Duration::from_secs(5), worker.frames.recv())
        .await
        .unwrap();
    assert!(matches!(result, Some(Incoming::Disconnected(_))));
    assert!(!worker.child.wait().unwrap().success());
    let mut worker = Harness::spawn();
    worker.ready().await;
    worker.child.kill().unwrap();
    worker.child.wait().unwrap();
    assert!(matches!(
        tokio::time::timeout(Duration::from_secs(5), worker.frames.recv())
            .await
            .unwrap(),
        Some(Incoming::Disconnected(_))
    ));
    assert!(worker.endpoint.as_ref().unwrap().is_closed());
}

fn api_request() -> codex_api::ResponsesApiRequest {
    codex_api::ResponsesApiRequest {
        model: "fixture".into(),
        stream: true,
        service_tier: None,
        input: Vec::new(),
        tools: None,
        tool_choice: "auto".into(),
        parallel_tool_calls: false,
        reasoning: None,
        store: false,
        stream_options: None,
        include: Vec::new(),
        prompt_cache_key: None,
        text: None,
        client_metadata: None,
        access_programs: None,
    }
}
#[derive(Default)]
struct CountingAuth(std::sync::atomic::AtomicUsize);
impl codex_api::AuthProvider for CountingAuth {
    fn add_auth_headers(&self, _: &mut http::HeaderMap) {}
    fn apply_auth(&self, mut request: codex_client::Request) -> codex_api::AuthProviderFuture<'_> {
        let attempt = self.0.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
        request.url.push_str(&format!("?signed_attempt={attempt}"));
        Box::pin(async move { Ok(request) })
    }
}
struct SlowAuth {
    started: Arc<tokio::sync::Notify>,
    dropped: Arc<std::sync::atomic::AtomicBool>,
}
impl codex_api::AuthProvider for SlowAuth {
    fn add_auth_headers(&self, _: &mut http::HeaderMap) {}
    fn apply_auth(&self, _: codex_client::Request) -> codex_api::AuthProviderFuture<'_> {
        struct Dropped(Arc<std::sync::atomic::AtomicBool>);
        impl Drop for Dropped {
            fn drop(&mut self) {
                self.0.store(true, std::sync::atomic::Ordering::SeqCst);
            }
        }
        Box::pin(async move {
            let _guard = Dropped(self.dropped.clone());
            self.started.notify_one();
            std::future::pending().await
        })
    }
}
#[derive(Default)]
struct LivePolicy {
    denied: std::sync::atomic::AtomicBool,
    destinations: std::sync::Mutex<Vec<String>>,
}
impl codex_http_client::NetworkPolicyAuthority for LivePolicy {
    fn acquire(
        &self,
        url: &url::Url,
    ) -> Result<codex_http_client::NetworkPermit, codex_http_client::NetworkPolicyDenied> {
        self.destinations.lock().unwrap().push(url.to_string());
        if self.denied.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(codex_http_client::NetworkPolicyDenied::Destination);
        }
        codex_http_client::NetworkPolicy::unmanaged().acquire(url)
    }
}
async fn drain(mut stream: codex_api::ResponseStream) -> usize {
    let mut count = 0;
    while let Some(event) = stream.rx_event.recv().await {
        event.expect("successful loopback Responses event");
        count += 1;
    }
    if let Some(pump) = stream.pump_task.take() {
        pump.await.unwrap();
    }
    count
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn actual_client_http_reuses_connections_auth_policy_and_measures_boundary() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let target = provider(listener.local_addr().unwrap());
    let accepted = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let observed = accepted.clone();
    let server = std::thread::spawn(move || {
        let mut handlers = Vec::new();
        for _ in 0..2 {
            let (mut stream, _) = listener.accept().unwrap();
            observed.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            handlers.push(std::thread::spawn(move || {
                for _ in 0..2 {
                    read_request(&mut stream);
                    write_response(&mut stream, &completed_response());
                }
            }));
        }
        for handler in handlers {
            handler.join().unwrap();
        }
    });
    let policy = Arc::new(LivePolicy::default());
    let factory = codex_http_client::HttpClientFactory::new(
        codex_http_client::OutboundProxyPolicy::ReqwestDefault,
    )
    .with_network_policy(codex_http_client::NetworkPolicy::from_authority(
        policy.clone(),
    ));
    let direct_http = codex_login::default_client::create_client_for_route(
        &factory,
        &target.url_for_path("/responses"),
        codex_http_client::ClientRouteClass::Api,
        codex_login::default_client::ClientRedirectPolicy::Default,
    )
    .unwrap();
    let auth = Arc::new(CountingAuth::default());
    let direct = codex_api::ResponsesClient::new(
        codex_api::ReqwestTransport::from_http_client(direct_http),
        target.clone(),
        auth.clone(),
    );
    let mut direct_ns = Vec::new();
    let mut direct_events = 0;
    for _ in 0..2 {
        let start = Instant::now();
        direct_events += drain(
            direct
                .stream_request(api_request(), ResponsesOptions::default())
                .await
                .unwrap(),
        )
        .await;
        direct_ns.push(start.elapsed().as_nanos());
    }
    let worker = codex_responses_worker_client::ResponsesWorker::new(PROGRAM.into(), factory)
        .with_expected_identity(
            codex_responses_worker_client::hash_file(std::path::Path::new(PROGRAM)).unwrap(),
        );
    let mut remote_ns = Vec::new();
    let mut remote_events = 0;
    for _ in 0..2 {
        let start = Instant::now();
        remote_events += drain(
            worker
                .stream_http(
                    target.clone(),
                    auth.clone(),
                    api_request(),
                    ResponsesOptions::default(),
                    None,
                    None,
                    false,
                )
                .await
                .unwrap(),
        )
        .await;
        remote_ns.push(start.elapsed().as_nanos());
    }
    assert_eq!(direct_events, remote_events);
    assert_eq!(auth.0.load(std::sync::atomic::Ordering::SeqCst), 4);
    assert_eq!(
        accepted.load(std::sync::atomic::Ordering::SeqCst),
        2,
        "one direct and one worker HTTP keepalive connection"
    );
    assert!(
        policy
            .destinations
            .lock()
            .unwrap()
            .iter()
            .any(|url| url.contains("signed_attempt=4")),
        "authoritative parent-auth URL must drive destination acquisition"
    );
    println!(
        "responses-boundary HTTP direct_ns={direct_ns:?} worker_ns={remote_ns:?} direct_events={direct_events} worker_events={remote_events}"
    );
    policy
        .denied
        .store(true, std::sync::atomic::Ordering::SeqCst);
    assert!(
        worker
            .stream_http(
                target.clone(),
                auth.clone(),
                api_request(),
                ResponsesOptions::default(),
                None,
                None,
                false
            )
            .await
            .is_err(),
        "cached HTTP pool must reacquire live parent policy"
    );
    let started = Arc::new(tokio::sync::Notify::new());
    let dropped = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let slow = Arc::new(SlowAuth {
        started: started.clone(),
        dropped: dropped.clone(),
    });
    let task_worker = worker.clone();
    let task_target = target.clone();
    let task = tokio::spawn(async move {
        task_worker
            .stream_http(
                task_target,
                slow,
                api_request(),
                ResponsesOptions::default(),
                None,
                None,
                false,
            )
            .await
    });
    tokio::time::timeout(Duration::from_secs(5), started.notified())
        .await
        .unwrap();
    task.abort();
    let _ = task.await;
    tokio::time::timeout(Duration::from_secs(5), async {
        while !dropped.load(std::sync::atomic::Ordering::SeqCst) {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("parent auth future must cancel without a late network request");
    drop(worker);
    server.join().unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn actual_client_websocket_reuse_interrupt_drop_and_boundary_measurement() {
    use tokio_tungstenite::tungstenite::Message;
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let target = provider(listener.local_addr().unwrap());
    let server = std::thread::spawn(move || {
        let mut handlers = Vec::new();
        for connection in 0..2 {
            let (stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(10)))
                .unwrap();
            handlers.push(std::thread::spawn(move || {
                let mut config = tokio_tungstenite::tungstenite::protocol::WebSocketConfig::default();
                config.extensions.permessage_deflate = Some(tokio_tungstenite::tungstenite::extensions::compression::deflate::DeflateConfig::default());
                let mut socket = tokio_tungstenite::tungstenite::accept_with_config(stream, Some(config)).unwrap();
                let requests = if connection == 0 { 2 } else { 5 };
                for turn in 0..requests {
                    let message = socket.read().unwrap();
                    let Message::Text(text) = message else { panic!("expected Responses create"); };
                    let request: serde_json::Value = serde_json::from_str(&text).unwrap(); assert_eq!(request["type"], "response.create");
                    socket.send(Message::Text("{\"type\":\"response.created\",\"response\":{\"id\":\"ws-fixture\"}}".into())).unwrap();
                    if connection == 1 && turn == 2 {
                        // The request pump has no next event to wake it. An interrupt must
                        // reach the existing socket pump while the event path is idle.
                        let Message::Text(interrupt) = socket.read().unwrap() else { panic!("expected graceful interrupt"); };
                        let interrupt: serde_json::Value = serde_json::from_str(&interrupt).unwrap();
                        assert_eq!(interrupt["type"], "response.interrupt"); assert_eq!(interrupt["response_id"], "ws-fixture");
                    } else {
                        let count = if connection == 1 && turn == 4 { 2000 } else { 100 };
                        for _ in 0..count {
                            if socket.send(Message::Text("{\"type\":\"response.output_text.delta\",\"delta\":\"x\"}".into())).is_err() { assert_eq!(turn, 4); return; }
                        }
                    }
                    if connection == 1 && turn == 4 {
                        assert!(socket.read().is_err(), "hard consumer drop discards the remote socket"); return;
                    }
                    socket.send(Message::Text("{\"type\":\"response.completed\",\"response\":{\"id\":\"ws-fixture\"}}".into())).unwrap();
                }
            }));
        }
        for handler in handlers {
            handler.join().unwrap();
        }
    });
    let factory = codex_http_client::HttpClientFactory::new(
        codex_http_client::OutboundProxyPolicy::ReqwestDefault,
    );
    let auth = Arc::new(CountingAuth::default());
    let request = api_request();
    let direct = codex_api::ResponsesWebsocketClient::new(target.clone(), auth.clone())
        .connect(
            &factory,
            http::HeaderMap::new(),
            http::HeaderMap::new(),
            None,
            None,
        )
        .await
        .unwrap();
    let mut direct_ns = Vec::new();
    let mut direct_events = 0;
    for turn in 0..2 {
        let start = Instant::now();
        direct_events += drain(
            direct
                .stream_request(
                    codex_api::ResponsesWsRequest::ResponseCreate((&request).into()),
                    turn != 0,
                    None,
                )
                .await
                .unwrap(),
        )
        .await;
        direct_ns.push(start.elapsed().as_nanos());
    }
    direct.close_and_wait().await;
    let worker = codex_responses_worker_client::ResponsesWorker::new(PROGRAM.into(), factory)
        .with_expected_identity(
            codex_responses_worker_client::hash_file(std::path::Path::new(PROGRAM)).unwrap(),
        );
    let remote = worker
        .connect_websocket(
            target,
            auth,
            http::HeaderMap::new(),
            http::HeaderMap::new(),
            None,
            None,
        )
        .await
        .unwrap();
    let mut remote_ns = Vec::new();
    let mut remote_events = 0;
    for turn in 0..2 {
        let start = Instant::now();
        remote_events += drain(
            remote
                .stream_request(
                    codex_api::ResponsesWsRequest::ResponseCreate((&request).into()),
                    turn != 0,
                    None,
                )
                .await
                .unwrap(),
        )
        .await;
        remote_ns.push(start.elapsed().as_nanos());
    }
    assert_eq!(direct_events, remote_events);
    println!(
        "responses-boundary WS direct_ns={direct_ns:?} worker_ns={remote_ns:?} direct_events={direct_events} worker_events={remote_events}"
    );
    let mut interrupted = remote
        .stream_request(
            codex_api::ResponsesWsRequest::ResponseCreate((&request).into()),
            true,
            None,
        )
        .await
        .unwrap();
    loop {
        if matches!(
            interrupted.rx_event.recv().await.unwrap().unwrap(),
            codex_api::ResponseEvent::Created { .. }
        ) {
            break;
        }
    }
    interrupted.interrupt.take().unwrap().send(()).unwrap();
    assert!(
        tokio::time::timeout(Duration::from_secs(5), drain(interrupted))
            .await
            .unwrap()
            > 0
    );
    assert!(
        !remote.is_closed().await,
        "graceful interrupt drains and keeps socket reusable"
    );
    assert!(
        drain(
            remote
                .stream_request(
                    codex_api::ResponsesWsRequest::ResponseCreate((&request).into()),
                    true,
                    None
                )
                .await
                .unwrap()
        )
        .await
            > 0
    );
    let mut dropped = remote
        .stream_request(
            codex_api::ResponsesWsRequest::ResponseCreate((&request).into()),
            true,
            None,
        )
        .await
        .unwrap();
    dropped.rx_event.recv().await.unwrap().unwrap();
    let pump = dropped.pump_task.take().unwrap();
    drop(dropped);
    tokio::time::timeout(Duration::from_secs(5), pump)
        .await
        .expect("hard cancel acknowledges actual pump/socket exit")
        .unwrap();
    assert!(remote.is_closed().await);
    drop(remote);
    drop(worker);
    server.join().unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn actual_worker_fragmented_request_cancel_precedes_auth() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let target = provider(listener.local_addr().unwrap());
    let mut worker = Harness::spawn();
    worker.ready().await;
    let command = http_command(
        target,
        format!("{{\"input\":\"{}\"}}", "x".repeat(17 * 1024 * 1024)),
    );
    worker
        .endpoint
        .as_ref()
        .unwrap()
        .control_batch([
            Frame::Command {
                generation: GENERATION,
                id: 1,
                command,
            },
            Frame::Cancel {
                generation: GENERATION,
                id: 1,
            },
        ])
        .unwrap();
    // Priority cancel interleaves physical fragments. The completed logical command
    // must not recreate expired authority or start a late network request.
    assert!(matches!(
        worker.next().await,
        Frame::Terminated { id: 1, .. }
    ));
    assert_eq!(worker.auth_attempts, 0);
    assert_eq!(
        listener.accept().unwrap_err().kind(),
        std::io::ErrorKind::WouldBlock
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn actual_client_live_permit_revocation_stops_existing_stream() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let target = provider(listener.local_addr().unwrap());
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        read_request(&mut stream);
        write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n").unwrap();
        stream.flush().unwrap();
        let mut byte = [0];
        assert_eq!(
            stream.read(&mut byte).unwrap(),
            0,
            "revocation must close existing network stream"
        );
    });
    let controller = codex_http_client::NetworkPolicyController::default();
    let policy = controller.policy();
    assert!(controller.publish(
        policy.revision(),
        codex_http_client::DestinationPolicy::Unrestricted
    ));
    let factory = codex_http_client::HttpClientFactory::new(
        codex_http_client::OutboundProxyPolicy::ReqwestDefault,
    )
    .with_network_policy(policy.clone());
    let worker = codex_responses_worker_client::ResponsesWorker::new(PROGRAM.into(), factory)
        .with_expected_identity(
            codex_responses_worker_client::hash_file(std::path::Path::new(PROGRAM)).unwrap(),
        );
    let mut stream = worker
        .stream_http(
            target,
            Arc::new(CountingAuth::default()),
            api_request(),
            ResponsesOptions::default(),
            None,
            None,
            false,
        )
        .await
        .unwrap();
    // The existing endpoint eagerly emits the default Codex header snapshot even
    // when no rate-limit headers exist. Consume exactly that metadata before
    // revoking; the server has sent no chunk or terminating chunk, so SSE body
    // polling must still be pending.
    let metadata = tokio::time::timeout(Duration::from_secs(5), stream.rx_event.recv())
        .await
        .unwrap()
        .unwrap();
    match metadata {
        Ok(codex_api::ResponseEvent::RateLimits(snapshot)) => {
            assert_eq!(snapshot.limit_id.as_deref(), Some("codex"));
            assert!(
                snapshot.limit_name.is_none()
                    && snapshot.normal_model_slug.is_none()
                    && snapshot.primary.is_none()
                    && snapshot.secondary.is_none()
                    && snapshot.credits.is_none()
                    && snapshot.individual_limit.is_none()
                    && snapshot.spend_control_reached.is_none()
                    && snapshot.plan_type.is_none()
                    && snapshot.rate_limit_reached_type.is_none()
            );
        }
        unexpected => {
            panic!("expected initial empty Codex header snapshot, received {unexpected:?}")
        }
    }
    assert!(matches!(
        stream.rx_event.try_recv(),
        Err(tokio::sync::mpsc::error::TryRecvError::Empty)
    ));
    policy.invalidate();
    let result = tokio::time::timeout(Duration::from_secs(5), stream.rx_event.recv())
        .await
        .unwrap()
        .unwrap();
    assert!(
        matches!(
            &result,
            Err(codex_api::ApiError::Transport(
                codex_client::TransportError::Policy(_)
            ))
        ),
        "expected typed live-policy revocation, received {result:?}"
    );
    assert!(
        tokio::time::timeout(Duration::from_secs(5), stream.rx_event.recv())
            .await
            .unwrap()
            .is_none()
    );
    if let Some(pump) = stream.pump_task.take() {
        pump.await.unwrap();
    }
    drop(worker);
    server.join().unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn actual_client_rejects_wrong_selected_identity_without_network_fallback() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let target = provider(listener.local_addr().unwrap());
    let factory = codex_http_client::HttpClientFactory::new(
        codex_http_client::OutboundProxyPolicy::ReqwestDefault,
    );
    let worker = codex_responses_worker_client::ResponsesWorker::new(PROGRAM.into(), factory)
        .with_expected_identity("0".repeat(64));
    for _ in 0..2 {
        assert!(
            worker
                .stream_http(
                    target.clone(),
                    Arc::new(CountingAuth::default()),
                    api_request(),
                    ResponsesOptions::default(),
                    None,
                    None,
                    false
                )
                .await
                .is_err()
        );
    }
    assert_eq!(
        listener.accept().unwrap_err().kind(),
        std::io::ErrorKind::WouldBlock
    );
}

struct StaticAuth;
impl codex_api::AuthProvider for StaticAuth {
    fn add_auth_headers(&self, headers: &mut http::HeaderMap) {
        headers.insert(
            http::header::AUTHORIZATION,
            http::HeaderValue::from_static("Bearer fixture-only"),
        );
    }
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn actual_client_unmanaged_native_redirects_match_existing_endpoint() {
    let factory = codex_http_client::HttpClientFactory::new(
        codex_http_client::OutboundProxyPolicy::ReqwestDefault,
    );
    let worker =
        codex_responses_worker_client::ResponsesWorker::new(PROGRAM.into(), factory.clone())
            .with_expected_identity(
                codex_responses_worker_client::hash_file(std::path::Path::new(PROGRAM)).unwrap(),
            );
    for status in [301, 302, 307, 308] {
        let initial = TcpListener::bind("127.0.0.1:0").unwrap();
        let final_listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let target = provider(initial.local_addr().unwrap());
        let final_port = final_listener.local_addr().unwrap().port();
        let initial_server = std::thread::spawn(move || {
            let mut observed = Vec::new();
            for _ in 0..2 {
                let (mut stream, _) = initial.accept().unwrap();
                observed.push(capture_request(&mut stream));
                write!(stream,"HTTP/1.1 {status} Redirect\r\nLocation: http://localhost:{final_port}/redirected\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
            }
            observed
        });
        let final_server = std::thread::spawn(move || {
            let mut observed = Vec::new();
            for _ in 0..2 {
                let (mut stream, _) = final_listener.accept().unwrap();
                observed.push(capture_request(&mut stream));
                write_response(&mut stream, &completed_response());
            }
            observed
        });
        let direct_http = codex_login::default_client::create_client_for_route(
            &factory,
            &target.url_for_path("/responses"),
            codex_http_client::ClientRouteClass::Api,
            codex_login::default_client::ClientRedirectPolicy::Default,
        )
        .unwrap();
        let direct = codex_api::ResponsesClient::new(
            codex_api::ReqwestTransport::from_http_client(direct_http),
            target.clone(),
            Arc::new(StaticAuth),
        );
        let mut options = ResponsesOptions::default();
        options
            .extra_headers
            .append("x-preserved", http::HeaderValue::from_static("one"));
        options
            .extra_headers
            .append("x-preserved", http::HeaderValue::from_static("two"));
        drain(direct.stream_request(api_request(), options).await.unwrap()).await;
        let mut options = ResponsesOptions::default();
        options
            .extra_headers
            .append("x-preserved", http::HeaderValue::from_static("one"));
        options
            .extra_headers
            .append("x-preserved", http::HeaderValue::from_static("two"));
        drain(
            worker
                .stream_http(
                    target,
                    Arc::new(StaticAuth),
                    api_request(),
                    options,
                    None,
                    None,
                    false,
                )
                .await
                .unwrap(),
        )
        .await;
        let initial = initial_server.join().unwrap();
        let redirected = final_server.join().unwrap();
        assert_eq!(
            initial[0], initial[1],
            "native original/worker initial request for {status}"
        );
        assert_eq!(
            redirected[0], redirected[1],
            "native original/worker redirect method/body/headers for {status}"
        );
        assert!(
            !redirected[1]
                .headers
                .iter()
                .any(|(name, _)| name == "authorization")
        );
        assert!(
            redirected[1]
                .line
                .starts_with(if status == 301 || status == 302 {
                    "GET "
                } else {
                    "POST "
                })
        );
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn actual_worker_eager_client_build_failure_precedes_auth() {
    const BASELINE: &str = "AZRAEL_RESPONSES_EAGER_BUILD_BASELINE";
    const TARGET: &str = "fixture://build-order/responses";
    // An existing directory is never a CA file. Compare the actual OS error kind
    // instead of assuming Windows PermissionDenied or Unix IsADirectory.
    if std::env::var_os(BASELINE).is_some() {
        let ca_path = std::env::var_os("CODEX_CA_CERTIFICATE").expect("child-only CA selection");
        let expected = std::fs::read(&ca_path)
            .expect_err("selected CA path is a directory")
            .kind();
        let factory = codex_http_client::HttpClientFactory::new(
            codex_http_client::OutboundProxyPolicy::RespectSystemProxy,
        );
        // The unsupported-origin fixture URL makes the existing route resolver choose
        // Direct, without consulting mutable OS/PAC/proxy configuration. The eager
        // constructor must fail on CA loading before any request URL/auth work occurs.
        let failure = codex_login::default_client::create_client_for_route(
            &factory,
            TARGET,
            codex_http_client::ClientRouteClass::Api,
            codex_login::default_client::ClientRedirectPolicy::Default,
        )
        .expect_err("original eager constructor must reject unreadable CA selection");
        let failure: std::io::Error = failure.into();
        assert_eq!(failure.kind(), expected);
        assert!(failure.to_string().contains("CODEX_CA_CERTIFICATE"));
        println!("original-eager-client-build-kind={:?}", failure.kind());
        return;
    }
    let executable = std::env::current_exe().unwrap();
    let ca_directory = executable.parent().unwrap();
    assert!(ca_directory.is_dir());
    let expected_kind = std::fs::read(ca_directory).unwrap_err().kind();
    // Reuse the repository's isolated test-binary probe pattern. Only each child's
    // environment changes; concurrent tests in this process keep their own CA state.
    let mut baseline = std::process::Command::new(&executable);
    baseline
        .args([
            "--exact",
            "actual_worker_eager_client_build_failure_precedes_auth",
            "--nocapture",
        ])
        .env_clear()
        .env(BASELINE, "1")
        .env("CODEX_CA_CERTIFICATE", ca_directory);
    for key in ["SystemRoot", "WINDIR", "PATH", "TMP", "TEMP"] {
        if let Some(value) = std::env::var_os(key) {
            baseline.env(key, value);
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        baseline.creation_flags(0x08000000);
    }
    let output = baseline.output().expect("original constructor probe child");
    assert!(
        output.status.success(),
        "original constructor probe failed: {}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let mut worker = Harness::spawn_config(false, true, Some(ca_directory));
    worker.ready().await;
    let mut target = provider(([127, 0, 0, 1], 9).into());
    target.base_url = "fixture://build-order".into();
    worker.command(1, http_command(target, "{\"model\":\"fixture\"}".into()));
    match worker.next().await {
        Frame::ClientBuildError { id: 1, error, .. } => {
            let error = error.decode().expect("exact IO classification crosses IPC");
            assert_eq!(error.kind(), expected_kind);
            assert!(error.to_string().contains("CODEX_CA_CERTIFICATE"));
        }
        _ => panic!("eager client build failure must precede Started/auth/transport error"),
    }
    assert!(matches!(
        worker.next().await,
        Frame::Terminated { id: 1, .. }
    ));
    assert_eq!(
        worker.auth_attempts, 0,
        "client construction must fail before parent authentication"
    );
}
