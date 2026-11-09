//! Executes the existing Responses endpoint clients in a reusable private process.
use codex_api::ApiError;
use codex_api::AuthProvider;
use codex_api::ResponseStream;
use codex_api::ResponsesClient;
use codex_api::ResponsesWebsocketClient;
use codex_api::ResponsesWebsocketConnection;
use codex_client::HttpTransport;
use codex_http_client::HttpClientFactory;
use codex_http_client::NetworkPermit;
use codex_http_client::NetworkPolicy;
use codex_http_client::NetworkPolicyAuthority;
use codex_http_client::NetworkPolicyDenied;
use codex_http_client::SharedCookieAuthority;
use codex_responses_worker_client::ipc::Endpoint;
use codex_responses_worker_client::ipc::Incoming;
use codex_responses_worker_client::protocol::*;
use codex_responses_worker_client::telemetry::NetworkTelemetry;
use codex_responses_worker_protocol::WireHeaders;
use futures::StreamExt;
use std::collections::HashMap;
use std::collections::HashSet;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::OnceLock;
use std::sync::atomic::AtomicU64;
use std::sync::atomic::Ordering;
use tokio::sync::Semaphore;
use tokio::sync::watch;

fn error(message: impl Into<String>) -> ApiError {
    ApiError::Stream(message.into())
}

struct RemoteAuthority {
    endpoint: Arc<Endpoint>,
    id: u64,
    global_only: bool,
}
impl RemoteAuthority {
    fn call(&self, callback: Callback) -> Result<CallbackResult, String> {
        tokio::task::block_in_place(|| self.endpoint.call(self.id, callback))
    }
}
impl NetworkPolicyAuthority for RemoteAuthority {
    fn acquire(&self, url: &url::Url) -> Result<NetworkPermit, NetworkPolicyDenied> {
        let result = self
            .call(Callback::Acquire {
                url: url.to_string(),
            })
            .map_err(|_| NetworkPolicyDenied::Unavailable)?;
        let CallbackResult::Permit(result) = result else {
            return Err(NetworkPolicyDenied::Unavailable);
        };
        let permit = result.map_err(NetworkPolicyDenied::from)?;
        let (sender, receiver) = {
            let mut permits = self
                .endpoint
                .permits
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            let sender = permits
                .entry(permit)
                .or_insert_with(|| watch::channel(false).0)
                .clone();
            let receiver = sender.subscribe();
            (sender, receiver)
        };
        let endpoint = self.endpoint.clone();
        let id = self.id;
        tokio::spawn(async move {
            sender.closed().await;
            endpoint
                .permits
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(&permit);
            let _ = endpoint.control(Frame::Callback {
                generation: endpoint.generation(),
                id,
                call: 0,
                callback: Callback::ReleasePermit { permit },
            });
        });
        Ok(NetworkPermit::from_revocation(receiver))
    }
}
impl SharedCookieAuthority for RemoteAuthority {
    fn cookies(&self, url: &url::Url) -> Option<http::HeaderValue> {
        match self.call(Callback::Cookies {
            url: url.to_string(),
            global_only: self.global_only,
        }) {
            Ok(CallbackResult::Cookie(Some((value, sensitive)))) => {
                match http::HeaderValue::from_bytes(&value) {
                    Ok(mut value) => {
                        value.set_sensitive(sensitive);
                        Some(value)
                    }
                    Err(_) => {
                        self.endpoint
                            .invalidate("invalid Responses cookie authority value");
                        None
                    }
                }
            }
            Ok(CallbackResult::Cookie(None)) => None,
            _ => {
                self.endpoint
                    .invalidate("Responses cookie authority unavailable");
                None
            }
        }
    }
    fn set_cookies(&self, url: &url::Url, headers: &http::HeaderMap) {
        if !matches!(
            self.call(Callback::SetCookies {
                url: url.to_string(),
                headers: headers.into(),
                global_only: self.global_only
            }),
            Ok(CallbackResult::Unit)
        ) {
            self.endpoint
                .invalidate("Responses cookie update authority unavailable");
        }
    }
}
struct RemoteAuth {
    endpoint: Arc<Endpoint>,
    id: u64,
    headers: http::HeaderMap,
}

/// Retains the owning process's permission around the original native HTTP
/// transport without replacing native redirect or body handling.
struct AuthorizedTransport {
    inner: codex_api::ReqwestTransport,
    authority: Option<Arc<RemoteAuthority>>,
}
impl AuthorizedTransport {
    fn permit(
        &self,
        request: &codex_client::Request,
    ) -> Result<Option<NetworkPermit>, codex_client::TransportError> {
        let Some(authority) = &self.authority else {
            return Ok(None);
        };
        // Preserve the original transport's malformed-URL error classification.
        match url::Url::parse(&request.url) {
            Ok(url) => authority.acquire(&url).map(Some).map_err(Into::into),
            Err(_) => Ok(None),
        }
    }
}
impl HttpTransport for AuthorizedTransport {
    async fn execute(
        &self,
        request: codex_client::Request,
    ) -> Result<codex_client::Response, codex_client::TransportError> {
        match self.permit(&request)? {
            Some(permit) => permit
                .run(self.inner.execute(request))
                .await
                .map_err(codex_client::TransportError::from)?,
            None => self.inner.execute(request).await,
        }
    }
    async fn stream(
        &self,
        request: codex_client::Request,
    ) -> Result<codex_client::StreamResponse, codex_client::TransportError> {
        let Some(permit) = self.permit(&request)? else {
            return self.inner.stream(request).await;
        };
        let response = permit
            .run(self.inner.stream(request))
            .await
            .map_err(codex_client::TransportError::from)??;
        let bytes = futures::stream::try_unfold(
            (response.bytes, permit),
            |(mut body, permit)| async move {
                let next = permit
                    .run(body.next())
                    .await
                    .map_err(codex_client::TransportError::from)?;
                next.transpose()
                    .map(|next| next.map(|chunk| (chunk, (body, permit))))
            },
        );
        Ok(codex_client::StreamResponse {
            status: response.status,
            headers: response.headers,
            bytes: Box::pin(bytes),
        })
    }
}
impl AuthProvider for RemoteAuth {
    fn add_auth_headers(&self, headers: &mut http::HeaderMap) {
        headers.extend(self.headers.clone());
    }
    fn apply_auth(&self, request: codex_client::Request) -> codex_api::AuthProviderFuture<'_> {
        let endpoint = self.endpoint.clone();
        let id = self.id;
        Box::pin(async move {
            let request = request.try_into().map_err(|e| {
                codex_api::AuthError::Build(format!("invalid prepared auth request: {e}"))
            })?;
            let reply = endpoint
                .call_async(id, Callback::Auth(request))
                .await
                .map_err(codex_api::AuthError::Build)?;
            match reply {
                CallbackResult::Auth(Ok(request)) => request.try_into().map_err(|e| {
                    codex_api::AuthError::Build(format!("invalid authoritative auth response: {e}"))
                }),
                CallbackResult::Auth(Err(AuthFailure::Build(s))) => {
                    Err(codex_api::AuthError::Build(s))
                }
                CallbackResult::Auth(Err(AuthFailure::Transient(s))) => {
                    Err(codex_api::AuthError::Transient(s))
                }
                _ => Err(codex_api::AuthError::Build(
                    "Responses auth authority unavailable".into(),
                )),
            }
        })
    }
}

struct Operation {
    cancel: watch::Sender<bool>,
    interrupt: watch::Sender<bool>,
    credits: Arc<Semaphore>,
}
struct Connection {
    connection: Arc<ResponsesWebsocketConnection>,
}
struct Runtime {
    endpoint: Arc<Endpoint>,
    system_proxy: bool,
    system_fallback: bool,
    managed: bool,
    connections: Mutex<HashMap<u64, Connection>>,
    operations: Mutex<HashMap<u64, Operation>>,
    seen: Mutex<HashSet<u64>>,
    accepted_high: AtomicU64,
    cancelled_before_start: Mutex<HashSet<u64>>,
    clients: Mutex<std::collections::VecDeque<(String, codex_http_client::HttpClient)>>,
}
impl Runtime {
    fn factory(&self, _id: u64) -> HttpClientFactory {
        let authority = Arc::new(RemoteAuthority {
            endpoint: self.endpoint.clone(),
            id: 0,
            global_only: false,
        });
        let factory = HttpClientFactory::new(if self.system_proxy {
            codex_http_client::OutboundProxyPolicy::RespectSystemProxy
        } else {
            codex_http_client::OutboundProxyPolicy::ReqwestDefault
        })
        .with_network_policy(NetworkPolicy::from_authority(authority.clone()))
        .with_shared_cookie_authority(authority);
        if self.system_fallback {
            factory.with_system_proxy_fallback()
        } else {
            factory
        }
    }
    async fn execute(
        self: Arc<Self>,
        id: u64,
        command: Command,
        mut cancel: watch::Receiver<bool>,
        interrupt: watch::Receiver<bool>,
        credits: Arc<Semaphore>,
    ) {
        let result = tokio::select! {
            biased;
            _ = self.endpoint.closed() => Err(error("Responses worker authority disconnected")),
            _ = cancel.changed() => Err(error("Responses request cancelled before start")),
            result = self.prepare(id, command) => result,
        };
        match result {
            Ok(Some((stream, state, connection))) => {
                self.forward(id, stream, state, connection, cancel, interrupt, credits)
                    .await;
            }
            Ok(None) => {}
            Err(e) => {
                let _ = self.endpoint.data(Frame::Error {
                    generation: self.endpoint.generation(),
                    id,
                    error: e.into(),
                });
                let _ = self.endpoint.data(Frame::Terminated {
                    generation: self.endpoint.generation(),
                    id,
                    turn_state: None,
                });
            }
        }
        self.operations
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&id);
    }
    async fn prepare(
        &self,
        id: u64,
        command: Command,
    ) -> Result<Option<(ResponseStream, Arc<OnceLock<String>>, Option<u64>)>, ApiError> {
        let telemetry = Arc::new(NetworkTelemetry {
            endpoint: self.endpoint.clone(),
            id,
        });
        match command {
            Command::Http {
                provider,
                json,
                options,
                defaults,
                reject_redirects,
                request_telemetry,
                sse_telemetry,
            } => {
                let provider = provider.decode().map_err(error)?;
                let defaults: http::HeaderMap = defaults
                    .try_into()
                    .map_err(|e| error(format!("invalid default headers: {e}")))?;
                let factory = if self.managed {
                    self.factory(id)
                } else {
                    self.factory(id)
                        .with_network_policy(NetworkPolicy::unmanaged())
                };
                let native_authority = (!self.managed).then(|| {
                    Arc::new(RemoteAuthority {
                        endpoint: self.endpoint.clone(),
                        id: 0,
                        global_only: false,
                    })
                });
                let sandboxed = std::env::var("CODEX_SANDBOX").as_deref() == Ok("seatbelt");
                // The original unmanaged system-proxy branch resolves its fixed route
                // eagerly for every request; retaining its client would freeze PAC state.
                let cacheable = self.managed || !self.system_proxy || sandboxed;
                let key = serde_json::to_string(&(reject_redirects, &WireHeaders::from(&defaults)))
                    .map_err(|e| error(e.to_string()))?;
                let cached = self
                    .clients
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .iter()
                    .find(|(k, _)| cacheable && k == &key)
                    .map(|(_, c)| c.clone());
                let client = if let Some(client) = cached {
                    client
                } else {
                    let mut builder = codex_http_client::HttpClientBuilder::new()
                        .default_headers(defaults)
                        .with_chatgpt_cloudflare_cookie_store();
                    if let Some(authority) = &native_authority {
                        builder = builder.with_native_redirect_authority(authority.clone());
                        if !self.system_proxy || sandboxed {
                            builder =
                                builder.with_shared_cookie_authority(Arc::new(RemoteAuthority {
                                    endpoint: self.endpoint.clone(),
                                    id: 0,
                                    global_only: true,
                                }));
                        }
                    }
                    if reject_redirects {
                        builder = builder.without_redirects();
                    }
                    let client = match tokio::task::block_in_place(|| {
                        codex_login::default_client::create_client_for_route_with_builder(
                            &factory,
                            &provider.url_for_path("/responses"),
                            codex_http_client::ClientRouteClass::Api,
                            builder,
                        )
                    }) {
                        Ok(client) => client,
                        Err(failure) => {
                            let failure: std::io::Error = failure.into();
                            self.endpoint
                                .data(Frame::ClientBuildError {
                                    generation: self.endpoint.generation(),
                                    id,
                                    error: failure.into(),
                                })
                                .map_err(error)?;
                            self.endpoint
                                .data(Frame::Terminated {
                                    generation: self.endpoint.generation(),
                                    id,
                                    turn_state: None,
                                })
                                .map_err(error)?;
                            return Ok(None);
                        }
                    };
                    if cacheable {
                        let mut clients = self.clients.lock().unwrap_or_else(|e| e.into_inner());
                        if clients.len() >= 8 {
                            clients.pop_front();
                        }
                        clients.push_back((key, client.clone()));
                    }
                    client
                };
                let auth = Arc::new(RemoteAuth {
                    endpoint: self.endpoint.clone(),
                    id,
                    headers: http::HeaderMap::new(),
                });
                let state = Arc::new(OnceLock::new());
                let options = options.decode(state.clone()).map_err(error)?;
                let request = serde_json::value::RawValue::from_string(json)
                    .map_err(|e| error(e.to_string()))?;
                let stream = ResponsesClient::new(
                    AuthorizedTransport {
                        inner: codex_api::ReqwestTransport::from_http_client(client),
                        authority: native_authority,
                    },
                    provider,
                    auth,
                )
                .with_telemetry(
                    if request_telemetry {
                        Some(telemetry.clone())
                    } else {
                        None
                    },
                    if sse_telemetry { Some(telemetry) } else { None },
                )
                .stream_serialized_request(&request, options)
                .await?;
                Ok(Some((stream, state, None)))
            }
            Command::Connect {
                provider,
                extra,
                defaults,
                turn_state,
                telemetry: emit_telemetry,
            } => {
                let headers = self
                    .endpoint
                    .call_async(id, Callback::AuthHeaders)
                    .await
                    .map_err(error)?;
                let CallbackResult::Headers(headers) = headers else {
                    return Err(error("WebSocket auth authority unavailable"));
                };
                let headers = headers
                    .try_into()
                    .map_err(|e| error(format!("invalid auth headers: {e}")))?;
                let auth = Arc::new(RemoteAuth {
                    endpoint: self.endpoint.clone(),
                    id,
                    headers,
                });
                let state = Arc::new(OnceLock::new());
                if let Some(value) = turn_state {
                    let _ = state.set(value);
                }
                let connection =
                    ResponsesWebsocketClient::new(provider.decode().map_err(error)?, auth)
                        .connect(
                            &self.factory(id),
                            extra
                                .try_into()
                                .map_err(|e| error(format!("invalid extra headers: {e}")))?,
                            defaults
                                .try_into()
                                .map_err(|e| error(format!("invalid default headers: {e}")))?,
                            Some(state.clone()),
                            if emit_telemetry {
                                Some(telemetry)
                            } else {
                                None
                            },
                        )
                        .await?;
                self.connections
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .insert(
                        id,
                        Connection {
                            connection: Arc::new(connection),
                        },
                    );
                self.endpoint
                    .control(Frame::Connected {
                        generation: self.endpoint.generation(),
                        id,
                        turn_state: state.get().cloned(),
                    })
                    .map_err(error)?;
                Ok(None)
            }
            Command::Websocket {
                connection,
                json,
                reused,
                turn_state,
            } => {
                let connection_handle = self
                    .connections
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .get(&connection)
                    .map(|v| v.connection.clone())
                    .ok_or_else(|| error("Responses WebSocket connection is closed"))?;
                // Each request owns a distinct sticky state generation; an old turn's lock
                // must not suppress a later turn's observed server state.
                let state = Arc::new(OnceLock::new());
                if let Some(value) = turn_state {
                    let _ = state.set(value);
                }
                let request = serde_json::value::RawValue::from_string(json)
                    .map_err(|e| error(e.to_string()))?;
                let stream = connection_handle
                    .stream_serialized_request(&request, reused, Some(state.clone()))
                    .await?;
                Ok(Some((stream, state, Some(connection))))
            }
            Command::IsClosed { connection } => {
                let connection = self
                    .connections
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .get(&connection)
                    .map(|v| v.connection.clone());
                let closed = match connection {
                    Some(connection) => connection.is_closed().await,
                    None => true,
                };
                self.endpoint
                    .control(Frame::Closed {
                        generation: self.endpoint.generation(),
                        id,
                        closed,
                    })
                    .map_err(error)?;
                Ok(None)
            }
            Command::DropConnection { connection } => {
                let discarded = self
                    .connections
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .remove(&connection);
                if let Some(discarded) = discarded {
                    discarded.connection.close_and_wait().await;
                }
                self.endpoint
                    .data(Frame::Terminated {
                        generation: self.endpoint.generation(),
                        id: connection,
                        turn_state: None,
                    })
                    .map_err(error)?;
                Ok(None)
            }
        }
    }
    async fn forward(
        &self,
        id: u64,
        mut stream: ResponseStream,
        state: Arc<OnceLock<String>>,
        connection: Option<u64>,
        mut cancel: watch::Receiver<bool>,
        mut interrupt: watch::Receiver<bool>,
        credits: Arc<Semaphore>,
    ) {
        let generation = self.endpoint.generation();
        let pump = stream.pump_task.take();
        let mut interrupt_sender = stream.interrupt.take();
        let _ = self.endpoint.control(Frame::Started {
            generation,
            id,
            request_id: stream.upstream_request_id.take(),
            interruptible: interrupt_sender.is_some(),
            turn_state: state.get().cloned(),
        });
        let mut hard_cancel = *cancel.borrow();
        while !hard_cancel {
            tokio::select! {
                biased;
                _ = self.endpoint.closed() => { hard_cancel = true; }
                result = cancel.changed() => { hard_cancel = result.is_err() || *cancel.borrow(); }
                result = interrupt.changed(), if interrupt_sender.is_some() => {
                    if result.is_ok() && *interrupt.borrow() { if let Some(sender) = interrupt_sender.take() { let _ = sender.send(()); } }
                }
                credit = credits.clone().acquire_owned() => {
                    let Ok(credit) = credit else { hard_cancel = true; continue; };
                    let event = tokio::select! {
                        biased;
                        _ = self.endpoint.closed() => { hard_cancel = true; None }
                        result = cancel.changed() => { hard_cancel = result.is_err() || *cancel.borrow(); None }
                        result = interrupt.changed(), if interrupt_sender.is_some() => {
                            if result.is_ok() && *interrupt.borrow() { if let Some(sender) = interrupt_sender.take() { let _ = sender.send(()); } }
                            continue;
                        }
                        event = stream.rx_event.recv() => event,
                    };
                    if let Some(event) = event {
                        credit.forget();
                        if self.endpoint.data(Frame::Event { generation, id, event: event.map(Into::into).map_err(Into::into) }).is_err() { hard_cancel = true; }
                    } else { break; }
                }
            }
        }
        let discarded = if hard_cancel {
            stream.rx_event.close();
            connection.and_then(|id| {
                self.connections
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .remove(&id)
            })
        } else {
            None
        };
        drop(stream);
        if let Some(pump) = pump {
            let _ = pump.await;
        }
        if let Some(discarded) = discarded {
            discarded.connection.close_and_wait().await;
        }
        // The acknowledgment is queued after all event frames and true producer exit.
        let _ = self.endpoint.data(Frame::Terminated {
            generation,
            id,
            turn_state: state.get().cloned(),
        });
    }
}

#[tokio::main(flavor = "multi_thread", worker_threads = 2)]
async fn main() {
    if run().await.is_err() {
        std::process::exit(1);
    }
}
async fn run() -> Result<(), String> {
    let identity = codex_responses_worker_client::hash_file(
        &std::env::current_exe().map_err(|e| e.to_string())?,
    )?;
    write_frame(
        &mut std::io::stdout(),
        &Frame::Hello {
            version: VERSION,
            identity,
            capabilities: CAPABILITIES.iter().map(|s| s.to_string()).collect(),
        },
    )
    .map_err(|e| e.to_string())?;
    let Frame::Init {
        generation,
        system_proxy,
        system_fallback,
        managed,
    } = read_frame(&mut std::io::stdin()).map_err(|e| e.to_string())?
    else {
        return Err("expected worker initialization".into());
    };
    let (endpoint, mut incoming) = Endpoint::start(generation, std::io::stdin(), std::io::stdout());
    let runtime = Arc::new(Runtime {
        endpoint: endpoint.clone(),
        system_proxy,
        system_fallback,
        managed,
        connections: Mutex::new(HashMap::new()),
        operations: Mutex::new(HashMap::new()),
        seen: Mutex::new(HashSet::new()),
        accepted_high: AtomicU64::new(0),
        cancelled_before_start: Mutex::new(HashSet::new()),
        clients: Mutex::new(std::collections::VecDeque::new()),
    });
    endpoint.control(Frame::Ready { generation })?;
    let mut tasks = tokio::task::JoinSet::new();
    while let Some(message) = incoming.recv().await {
        let Incoming::Frame(frame) = message else {
            break;
        };
        match frame {
            Frame::Command {
                generation: got,
                id,
                command,
            } if got == generation => {
                {
                    let mut seen = runtime.seen.lock().unwrap_or_else(|e| e.into_inner());
                    let mut high = runtime.accepted_high.load(Ordering::Acquire);
                    if id == 0 || id <= high || !seen.insert(id) {
                        return Err("stale worker request generation".into());
                    }
                    while seen.remove(&(high + 1)) {
                        high += 1;
                    }
                    runtime.accepted_high.store(high, Ordering::Release);
                }
                if runtime
                    .cancelled_before_start
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .remove(&id)
                {
                    endpoint.data(Frame::Terminated {
                        generation,
                        id,
                        turn_state: None,
                    })?;
                    continue;
                }
                let (cancel, cancel_rx) = watch::channel(false);
                let (interrupt, interrupt_rx) = watch::channel(false);
                let credits = Arc::new(Semaphore::new(CREDITS));
                runtime
                    .operations
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .insert(
                        id,
                        Operation {
                            cancel,
                            interrupt,
                            credits: credits.clone(),
                        },
                    );
                tasks.spawn(
                    runtime
                        .clone()
                        .execute(id, command, cancel_rx, interrupt_rx, credits),
                );
            }
            Frame::Cancel {
                generation: got,
                id,
            } if got == generation => {
                if let Some(op) = runtime
                    .operations
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .get(&id)
                {
                    let _ = op.cancel.send(true);
                } else {
                    let discarded = runtime
                        .connections
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .remove(&id);
                    if let Some(discarded) = discarded {
                        let endpoint = endpoint.clone();
                        tasks.spawn(async move {
                            discarded.connection.close_and_wait().await;
                            let _ = endpoint.data(Frame::Terminated {
                                generation,
                                id,
                                turn_state: None,
                            });
                        });
                    } else if id > runtime.accepted_high.load(Ordering::Acquire) {
                        runtime
                            .cancelled_before_start
                            .lock()
                            .unwrap_or_else(|e| e.into_inner())
                            .insert(id);
                    }
                }
            }
            Frame::Interrupt {
                generation: got,
                id,
            } if got == generation => {
                if let Some(op) = runtime
                    .operations
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .get(&id)
                {
                    let _ = op.interrupt.send(true);
                }
            }
            Frame::Credit {
                generation: got,
                id,
                amount,
            } if got == generation => {
                if let Some(op) = runtime
                    .operations
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .get(&id)
                {
                    if amount == 0
                        || amount > CREDITS
                        || op.credits.available_permits() + amount > CREDITS
                    {
                        return Err("invalid Responses event credit".into());
                    }
                    op.credits.add_permits(amount);
                }
            }
            Frame::Shutdown => break,
            _ => return Err("invalid worker control generation/state".into()),
        }
        while tasks.try_join_next().is_some() {}
    }
    for op in runtime
        .operations
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .values()
    {
        let _ = op.cancel.send(true);
    }
    runtime
        .connections
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clear();
    tasks.abort_all();
    while tasks.join_next().await.is_some() {}
    Ok(())
}
