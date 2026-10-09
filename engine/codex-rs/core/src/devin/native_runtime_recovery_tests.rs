use super::*;
use futures::StreamExt;
use pretty_assertions::assert_eq;
use std::path::PathBuf;

fn policy() -> TimingPolicy {
    TimingPolicy {
        idle: Duration::from_millis(350),
        deadline: Duration::from_millis(1600),
        backoff: Duration::from_millis(40),
    }
}

struct Finished(CancellationToken);
impl Drop for Finished {
    fn drop(&mut self) {
        self.0.cancel();
    }
}

async fn fixture(
    root: &Path,
    mode: &str,
    policy: TimingPolicy,
    cancellation: CancellationToken,
) -> (ResponseStream, CancellationToken) {
    let helper = root.join("fixture.mjs");
    std::fs::write(&helper, format!(r#"
import fs from 'node:fs';
const file = new URL('./attempts', import.meta.url);
let n = fs.existsSync(file) ? Number(fs.readFileSync(file)) + 1 : 1;
fs.writeFileSync(file, String(n));
let input = ''; for await (const chunk of process.stdin) input += chunk;
const prior = new URL('./input', import.meta.url);
if (n === 1) fs.writeFileSync(prior,input);
else if (fs.readFileSync(prior,'utf8') !== input) process.exit(3);
let seq=0;
const emit = frame => process.stdout.write(JSON.stringify({{protocol_version:1,request_id:'recovery',seq:seq++,...frame}})+'\n');
const progress = (count, age=0, event='reasoning') => emit({{type:'progress',progress:{{phase:'stream',elapsed_ms:0,network_idle_ms:0,event_idle_ms:age,bytes_received:seq*1000,event_count:count,last_event:event}}}});
const tool = id => emit({{type:'item_done',item:{{type:'function_call',name:'exec',call_id:id,arguments:'{{}}'}}}});
const finish = () => {{tool('success');emit({{type:'completed',usage:{{input_tokens:1,cached_input_tokens:0,output_tokens:1,reasoning_output_tokens:0,total_tokens:2}}}});}};
const wait = ms => new Promise(resolve => setTimeout(resolve,ms));
emit({{type:'created'}});
const mode = '{mode}';
if (mode === 'retry' && n === 2) finish();
else if (mode === 'full_terminal' || mode === 'full_pending') {{
    for (let i=0; i < (mode === 'full_terminal' ? 63 : 80); i++) tool(`buffered-${{i}}`);
    emit({{type:'completed',usage:{{input_tokens:1,cached_input_tokens:0,output_tokens:1,reasoning_output_tokens:0,total_tokens:2}}}});
}}
else if (mode.startsWith('thinking_')) {{
    let count=0;
    const heartbeat = () => emit({{type:'progress',progress:{{phase:'stream',elapsed_ms:0,network_idle_ms:0,event_idle_ms:seq*70,bytes_received:seq*1000,event_count:0,last_event:'none',thinking_wait:{{open:true,heartbeat_count:++count,heartbeat_idle_ms:0}}}}}});
    heartbeat();
    for (let i=0; i < (mode === 'thinking_finish' ? 12 : mode === 'thinking_silence' ? 2 : 70); i++) {{await wait(70);heartbeat();}}
    if (mode === 'thinking_finish') finish();
    else await wait(5000);
}}
else if (mode === 'http') emit({{type:'error',code:'provider_http_400'}});
else if (mode === 'protocol') emit({{type:'bogus'}});
else if (mode === 'active' || mode === 'deadline' || (mode === 'retry_deadline' && n === 2)) {{
    for (let i=1; i <= (mode === 'active' ? 10 : 50); i++) {{await wait(70); progress(i,0,i%2 ? 'reasoning' : 'tool_call_args');}}
    finish();
}} else {{
    tool('discarded');tool('success');
    let i=0; const timer = setInterval(() => {{i++;progress(mode === 'stale' ? i : mode === 'repeated' ? 1 : mode === 'regressing' ? Math.max(0,5-i) : 0, mode === 'stale' ? 9999 : 0, mode === 'heartbeat' ? 'none' : 'reasoning');}},60);
    await wait(5000);clearInterval(timer);
}}
"#)).unwrap();
    let runtime = std::env::var_os("AZRAEL_DEVIN_NODE")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("node"));
    let mut prompt = Prompt::default();
    prompt.tools = vec![tests::function("exec")].into();
    let finished = CancellationToken::new();
    let stream = run_helper_with_policy(
        HelperRequest {
            anthropic_thinking: mode.starts_with("thinking_") && mode != "thinking_unscoped",
            executable: &runtime,
            helper: &helper,
            codex_home: root,
            init: b"{\"init\":true}\n".to_vec(),
            request: b"{\"request\":true}\n".to_vec(),
            prompt,
            request_id: "recovery".to_string(),
            cancellation,
            turn_guard: Finished(finished.clone()),
        },
        policy,
    )
    .await
    .unwrap();
    (stream, finished)
}

#[tokio::test]
async fn fresh_buffered_provider_activity_survives_idle_and_flushes_once() {
    let root = tempfile::tempdir().unwrap();
    let (mut stream, _finished) =
        fixture(root.path(), "active", policy(), CancellationToken::new()).await;
    let mut calls = Vec::new();
    let mut completed = 0;
    while let Some(event) = stream.next().await {
        match event.unwrap() {
            ResponseEvent::OutputItemDone(ResponseItem::FunctionCall { call_id, .. }) => {
                calls.push(call_id)
            }
            ResponseEvent::Completed { .. } => completed += 1,
            _ => {}
        }
    }
    assert_eq!(
        (
            calls,
            completed,
            std::fs::read_to_string(root.path().join("attempts")).unwrap()
        ),
        (vec!["success".to_string()], 1, "1".to_string())
    );
}

#[tokio::test]
async fn idle_retries_identical_input_and_discards_partial_tools() {
    let root = tempfile::tempdir().unwrap();
    let (mut stream, _finished) =
        fixture(root.path(), "retry", policy(), CancellationToken::new()).await;
    let mut calls = Vec::new();
    while let Some(event) = stream.next().await {
        if let ResponseEvent::OutputItemDone(ResponseItem::FunctionCall { call_id, .. }) =
            event.unwrap()
        {
            calls.push(call_id);
        }
    }
    assert_eq!(
        (
            calls,
            std::fs::read_to_string(root.path().join("attempts")).unwrap()
        ),
        (vec!["success".to_string()], "2".to_string())
    );
}

#[tokio::test]
async fn idle_exhaustion_and_nonretryable_failures_never_publish_pending_calls() {
    for (mode, attempts, message) in [
        ("heartbeat", "2", "retry=exhausted"),
        ("stale", "2", "retry=exhausted"),
        ("repeated", "2", "retry=exhausted"),
        ("regressing", "2", "retry=exhausted"),
        ("protocol", "1", "invalid event sequence"),
        ("http", "1", "provider_http_400"),
        ("deadline", "1", "deadline"),
    ] {
        let root = tempfile::tempdir().unwrap();
        let (mut stream, _finished) =
            fixture(root.path(), mode, policy(), CancellationToken::new()).await;
        let error = stream
            .next()
            .await
            .unwrap()
            .expect_err("failed attempt must publish no buffered event");
        assert!(error.to_string().contains(message), "{mode}: {error}");
        assert!(error.retry_delay(1).is_none());
        assert!(stream.next().await.is_none());
        assert_eq!(
            std::fs::read_to_string(root.path().join("attempts")).unwrap(),
            attempts
        );
    }
}

#[tokio::test]
async fn cancellation_and_drop_stop_backoff_before_replacement() {
    for drop_consumer in [false, true] {
        let root = tempfile::tempdir().unwrap();
        let cancellation = CancellationToken::new();
        let mut timing = policy();
        timing.backoff = Duration::from_secs(2);
        let (mut stream, finished) =
            fixture(root.path(), "heartbeat", timing, cancellation.clone()).await;
        tokio::time::sleep(Duration::from_millis(700)).await;
        if drop_consumer {
            drop(stream);
        } else {
            cancellation.cancel();
            let error = stream.next().await.unwrap().unwrap_err();
            assert!(matches!(error.details(), CodexErrorDetails::Interrupted));
        }
        tokio::time::timeout(Duration::from_millis(300), finished.cancelled())
            .await
            .expect("recovery must stop promptly");
        assert_eq!(
            std::fs::read_to_string(root.path().join("attempts")).unwrap(),
            "1"
        );
    }
}

#[tokio::test]
async fn retry_and_continuous_events_share_the_original_absolute_deadline() {
    let root = tempfile::tempdir().unwrap();
    let started = tokio::time::Instant::now();
    let (mut stream, _finished) = fixture(
        root.path(),
        "retry_deadline",
        policy(),
        CancellationToken::new(),
    )
    .await;
    let error = stream.next().await.unwrap().unwrap_err();
    assert!(error.to_string().contains("deadline"));
    assert!(started.elapsed() < policy().deadline + Duration::from_millis(250));
    assert_eq!(
        std::fs::read_to_string(root.path().join("attempts")).unwrap(),
        "2"
    );
}

#[tokio::test]
async fn deadline_during_backoff_does_not_launch_a_replacement() {
    let root = tempfile::tempdir().unwrap();
    let mut timing = policy();
    timing.backoff = Duration::from_secs(2);
    timing.deadline = Duration::from_millis(800);
    let (mut stream, _finished) =
        fixture(root.path(), "heartbeat", timing, CancellationToken::new()).await;
    let error = stream.next().await.unwrap().unwrap_err();
    assert!(error.to_string().contains("deadline"));
    assert_eq!(
        std::fs::read_to_string(root.path().join("attempts")).unwrap(),
        "1"
    );
}

#[tokio::test]
async fn full_output_queue_releases_turn_on_cancellation_or_deadline_without_retry() {
    for mode in ["full_terminal", "full_pending"] {
        for stop in ["cancel", "deadline"] {
            let root = tempfile::tempdir().unwrap();
            let cancellation = CancellationToken::new();
            let mut timing = policy();
            timing.deadline = Duration::from_millis(1000);
            let (mut stream, finished) =
                fixture(root.path(), mode, timing, cancellation.clone()).await;
            tokio::time::timeout(Duration::from_millis(800), async {
                while stream.rx_event.len() < STREAM_CAPACITY {
                    tokio::time::sleep(Duration::from_millis(5)).await;
                }
            })
            .await
            .expect("successful helper must fill the response queue");
            assert!(
                !finished.is_cancelled(),
                "fixture must block during output delivery"
            );
            if stop == "cancel" {
                cancellation.cancel();
            }
            let release_limit = if stop == "cancel" {
                Duration::from_millis(300)
            } else {
                timing.deadline
            };
            tokio::time::timeout(release_limit, finished.cancelled())
                .await
                .expect("full queue must not retain the turn guard");
            let mut delivered = 0;
            while let Some(event) = stream.next().await {
                assert!(!matches!(event.unwrap(), ResponseEvent::Completed { .. }));
                delivered += 1;
            }
            assert_eq!(
                (
                    delivered,
                    std::fs::read_to_string(root.path().join("attempts")).unwrap()
                ),
                (STREAM_CAPACITY, "1".to_string())
            );
        }
    }
}

#[tokio::test]
async fn anthropic_hidden_thinking_survives_idle_and_publishes_once() {
    let root = tempfile::tempdir().unwrap();
    let (mut stream, _) = fixture(
        root.path(),
        "thinking_finish",
        policy(),
        CancellationToken::new(),
    )
    .await;
    let mut calls = Vec::new();
    let mut completed = 0;
    while let Some(event) = stream.next().await {
        match event.unwrap() {
            ResponseEvent::OutputItemDone(ResponseItem::FunctionCall { call_id, .. }) => {
                calls.push(call_id)
            }
            ResponseEvent::Completed { .. } => completed += 1,
            _ => {}
        }
    }
    assert_eq!(calls, vec!["success".to_string()]);
    assert_eq!(completed, 1);
    assert_eq!(
        std::fs::read_to_string(root.path().join("attempts")).unwrap(),
        "1"
    );
}

#[tokio::test]
async fn anthropic_permanent_thinking_obeys_shared_deadline_without_retry() {
    use std::collections::BTreeMap;
    use std::sync::Mutex;
    use tracing::field::{Field, Visit};
    use tracing_subscriber::Layer;
    use tracing_subscriber::layer::SubscriberExt;

    #[derive(Clone, Default)]
    struct Capture(Arc<Mutex<Vec<BTreeMap<String, String>>>>);
    impl<S: tracing::Subscriber> Layer<S> for Capture {
        fn on_event(
            &self,
            event: &tracing::Event<'_>,
            _: tracing_subscriber::layer::Context<'_, S>,
        ) {
            #[derive(Default)]
            struct Fields(BTreeMap<String, String>);
            impl Visit for Fields {
                fn record_str(&mut self, field: &Field, value: &str) {
                    self.0.insert(field.name().to_string(), value.to_string());
                }
                fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
                    self.0
                        .insert(field.name().to_string(), format!("{value:?}"));
                }
            }
            let mut fields = Fields::default();
            event.record(&mut fields);
            self.0.lock().unwrap().push(fields.0);
        }
    }

    let capture = Capture::default();
    let subscriber = tracing_subscriber::registry().with(capture.clone());
    async {
        let root = tempfile::tempdir().unwrap();
        let started = tokio::time::Instant::now();
        let (mut stream, _) = fixture(
            root.path(),
            "thinking_forever",
            policy(),
            CancellationToken::new(),
        )
        .await;
        let error = stream.next().await.unwrap().unwrap_err();
        assert!(error.to_string().contains("deadline"));
        assert!(error.retry_delay(1).is_none());
        assert!(started.elapsed() < policy().deadline + Duration::from_millis(250));
        assert!(stream.next().await.is_none());
        assert_eq!(
            std::fs::read_to_string(root.path().join("attempts")).unwrap(),
            "1"
        );
    }
    .with_subscriber(subscriber)
    .await;
    let records = capture.0.lock().unwrap();
    for name in [
        "native_inference_thinking_wait",
        "native_inference_wait_extended",
    ] {
        let matching: Vec<_> = records
            .iter()
            .filter(|record| record.get("event").map(String::as_str) == Some(name))
            .collect();
        assert!(!matching.is_empty(), "missing actual {name} diagnostics");
        for record in &matching {
            assert_eq!(
                record.get("generation_event_count").map(String::as_str),
                Some("0")
            );
            assert!(record.contains_key("generation_idle_ms"));
        }
        println!(
            "thinking diagnostic records={}: {}",
            matching.len(),
            serde_json::to_string(matching[0]).unwrap()
        );
    }
}

#[tokio::test]
async fn thinking_silence_and_unscoped_pings_still_exhaust_idle_recovery() {
    for mode in ["thinking_silence", "thinking_unscoped"] {
        let root = tempfile::tempdir().unwrap();
        let mut timing = policy();
        timing.deadline = Duration::from_secs(3);
        let (mut stream, _) = fixture(root.path(), mode, timing, CancellationToken::new()).await;
        let error = stream.next().await.unwrap().unwrap_err();
        assert!(
            error.to_string().contains("retry=exhausted"),
            "{mode}: {error}"
        );
        assert!(stream.next().await.is_none());
        assert_eq!(
            std::fs::read_to_string(root.path().join("attempts")).unwrap(),
            "2"
        );
    }
}

#[tokio::test]
async fn cancellation_interrupts_ping_only_anthropic_thinking_without_retry() {
    let root = tempfile::tempdir().unwrap();
    let cancellation = CancellationToken::new();
    let (mut stream, finished) = fixture(
        root.path(),
        "thinking_forever",
        policy(),
        cancellation.clone(),
    )
    .await;
    tokio::time::sleep(Duration::from_millis(700)).await;
    cancellation.cancel();
    let error = stream.next().await.unwrap().unwrap_err();
    assert!(matches!(error.details(), CodexErrorDetails::Interrupted));
    tokio::time::timeout(Duration::from_millis(300), finished.cancelled())
        .await
        .unwrap();
    assert_eq!(
        std::fs::read_to_string(root.path().join("attempts")).unwrap(),
        "1"
    );
}
