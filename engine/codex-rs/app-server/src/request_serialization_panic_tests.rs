use super::*;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;
use tokio::sync::mpsc;
use tokio::sync::oneshot;
use tokio::time::Duration;
use tokio::time::timeout;

struct Cleanup(Arc<AtomicBool>);

impl Drop for Cleanup {
    fn drop(&mut self) {
        self.0.store(true, Ordering::SeqCst);
    }
}

async fn wait_for_drain(queues: &RequestSerializationQueues) {
    timeout(Duration::from_secs(1), async {
        while !queues.inner.lock().await.is_empty() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("queue should drain and remove its owner");
}

#[tokio::test]
async fn exclusive_panic_cleans_up_before_fallback_and_queued_followup_and_allows_reuse() {
    let queues = RequestSerializationQueues::default();
    let key = RequestSerializationQueueKey::Global("panic-exclusive");
    let gate = Arc::new(ConnectionRpcGate::new());
    let cleaned = Arc::new(AtomicBool::new(false));
    let (started_tx, started_rx) = oneshot::channel();
    let (release_tx, release_rx) = oneshot::channel();
    let (events_tx, mut events_rx) = mpsc::unbounded_channel();
    let handler_cleaned = Arc::clone(&cleaned);
    let fallback_cleaned = Arc::clone(&cleaned);
    let fallback_events = events_tx.clone();
    queues
        .enqueue(
            key.clone(),
            RequestSerializationAccess::Exclusive,
            QueuedInitializedRequest::new(Arc::clone(&gate), async move {
                let _cleanup = Cleanup(handler_cleaned);
                started_tx.send(()).unwrap();
                release_rx.await.unwrap();
                panic!("private handler payload");
            })
            .with_panic_handler(async move {
                assert!(fallback_cleaned.load(Ordering::SeqCst));
                fallback_events.send("fallback").unwrap();
                // A broken fallback must not strand the remaining queue either.
                panic!("private fallback payload");
            }),
        )
        .await;
    started_rx.await.unwrap();
    let followup_events = events_tx.clone();
    queues
        .enqueue(
            key.clone(),
            RequestSerializationAccess::Exclusive,
            QueuedInitializedRequest::new(Arc::clone(&gate), async move {
                assert!(cleaned.load(Ordering::SeqCst));
                followup_events.send("followup").unwrap();
            }),
        )
        .await;
    release_tx.send(()).unwrap();
    wait_for_drain(&queues).await;
    assert_eq!(events_rx.try_recv().unwrap(), "fallback");
    assert_eq!(events_rx.try_recv().unwrap(), "followup");
    timeout(Duration::from_secs(1), gate.shutdown())
        .await
        .expect("panicked handler should release its gate token");
    queues
        .enqueue_background(key, RequestSerializationAccess::Exclusive, async move {
            events_tx.send("reuse").unwrap();
        })
        .await;
    wait_for_drain(&queues).await;
    assert_eq!(events_rx.try_recv().unwrap(), "reuse");
}

#[tokio::test]
async fn shared_read_panic_preserves_sibling_and_writer_barrier() {
    let queues = RequestSerializationQueues::default();
    let key = RequestSerializationQueueKey::Global("panic-reads");
    let gate = Arc::new(ConnectionRpcGate::new());
    let (started_tx, started_rx) = oneshot::channel();
    let (release_tx, release_rx) = oneshot::channel();
    let (panic_tx, panic_rx) = oneshot::channel();
    let (events_tx, mut events_rx) = mpsc::unbounded_channel();
    let read_events = events_tx.clone();
    queues
        .enqueue(
            key.clone(),
            RequestSerializationAccess::SharedRead,
            QueuedInitializedRequest::new(Arc::clone(&gate), async move {
                started_tx.send(()).unwrap();
                release_rx.await.unwrap();
                read_events.send("sibling").unwrap();
            }),
        )
        .await;
    started_rx.await.unwrap();
    queues
        .enqueue(
            key.clone(),
            RequestSerializationAccess::SharedRead,
            QueuedInitializedRequest::new(Arc::clone(&gate), async {
                panic!("private read payload");
            })
            .with_panic_handler(async move {
                panic_tx.send(()).unwrap();
            }),
        )
        .await;
    timeout(Duration::from_secs(1), panic_rx)
        .await
        .unwrap()
        .unwrap();
    let writer_events = events_tx.clone();
    queues
        .enqueue(
            key.clone(),
            RequestSerializationAccess::Exclusive,
            QueuedInitializedRequest::new(Arc::clone(&gate), async move {
                writer_events.send("writer").unwrap();
            }),
        )
        .await;
    queues
        .enqueue(
            key,
            RequestSerializationAccess::SharedRead,
            QueuedInitializedRequest::new(gate, async move {
                events_tx.send("later_read").unwrap();
            }),
        )
        .await;
    assert!(events_rx.try_recv().is_err());
    release_tx.send(()).unwrap();
    wait_for_drain(&queues).await;
    let mut events = Vec::new();
    while let Ok(event) = events_rx.try_recv() {
        events.push(event);
    }
    assert_eq!(events, vec!["sibling", "writer", "later_read"]);
}

#[tokio::test]
async fn background_panic_continues_to_queued_background_work() {
    let queues = RequestSerializationQueues::default();
    let key = RequestSerializationQueueKey::Global("panic-background");
    let (started_tx, started_rx) = oneshot::channel();
    let (release_tx, release_rx) = oneshot::channel();
    let (done_tx, done_rx) = oneshot::channel();
    queues
        .enqueue_background(
            key.clone(),
            RequestSerializationAccess::Exclusive,
            async move {
                started_tx.send(()).unwrap();
                release_rx.await.unwrap();
                panic!("private background payload");
            },
        )
        .await;
    started_rx.await.unwrap();
    queues
        .enqueue_background(key, RequestSerializationAccess::Exclusive, async move {
            done_tx.send(()).unwrap();
        })
        .await;
    release_tx.send(()).unwrap();
    timeout(Duration::from_secs(1), done_rx)
        .await
        .unwrap()
        .unwrap();
    wait_for_drain(&queues).await;
}

#[tokio::test]
async fn closed_gate_drops_handler_and_does_not_run_panic_fallback() {
    let gate = Arc::new(ConnectionRpcGate::new());
    gate.close().await;
    let cleaned = Arc::new(AtomicBool::new(false));
    let cleanup = Cleanup(Arc::clone(&cleaned));
    QueuedInitializedRequest::new(gate, async move {
        let _cleanup = cleanup;
        panic!("closed gate must never poll this handler");
    })
    .with_panic_handler(async {
        panic!("closed gate must never run fallback");
    })
    .run()
    .await;
    assert!(cleaned.load(Ordering::SeqCst));
}
