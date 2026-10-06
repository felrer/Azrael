use super::*;
use crate::outgoing_message::ConnectionId;
use pretty_assertions::assert_eq;

#[test]
fn wire_ids_hash_raw_strings_and_decimal_integers() {
    assert_eq!(
        request_ref(&RequestId::String("abc".to_owned())),
        "ba7816bf8f01cfea"
    );
    for value in [i64::MIN, -1, 0, i64::MAX] {
        assert_eq!(
            request_ref(&RequestId::Integer(value)),
            request_ref(&RequestId::String(value.to_string()))
        );
    }
}

#[test]
fn input_metadata_retains_only_hashes() {
    let request = ClientRequest::TurnSteer {
        request_id: RequestId::String("provider:private-request".to_owned()),
        params: codex_app_server_protocol::TurnSteerParams {
            thread_id: "private-thread".to_owned(),
            input: Vec::new(),
            expected_turn_id: "private-turn".to_owned(),
            client_user_message_id: Some("private-message".to_owned()),
            ..Default::default()
        },
    };
    let id = ConnectionRequestId {
        connection_id: ConnectionId(1),
        request_id: request.id().clone(),
    };
    let diagnostics = InputDiagnostics::for_request(&id, &request).expect("input diagnostic");
    assert_eq!(
        (
            diagnostics.request_ref.len(),
            diagnostics.thread_ref.as_ref().map(String::len),
            diagnostics.client_message_hash.as_ref().map(String::len)
        ),
        (16, Some(16), Some(64))
    );
    assert_eq!(
        diagnostics.client_message_hash,
        Some(full_hash("private-message"))
    );
}

#[test]
fn abandoned_and_completed_handlers_emit_redacted_correlated_events() {
    use std::sync::Arc;
    use std::sync::Mutex;
    use tracing_subscriber::layer::SubscriberExt;

    #[derive(Clone)]
    struct Events(Arc<Mutex<Vec<String>>>);
    struct Fields(String);
    impl tracing::field::Visit for Fields {
        fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
            use std::fmt::Write;
            write!(&mut self.0, "{}={value:?};", field.name()).unwrap();
        }
    }
    impl<S: tracing::Subscriber> tracing_subscriber::Layer<S> for Events {
        fn on_event(
            &self,
            event: &tracing::Event<'_>,
            _: tracing_subscriber::layer::Context<'_, S>,
        ) {
            assert_eq!(event.metadata().target(), "azrael_input_delivery");
            let mut fields = Fields(String::new());
            event.record(&mut fields);
            fields.0.push_str(event.metadata().level().as_str());
            self.0.lock().unwrap().push(fields.0);
        }
    }

    let events = Events(Arc::new(Mutex::new(Vec::new())));
    let subscriber = tracing_subscriber::registry().with(events.clone());
    let id = ConnectionRequestId {
        connection_id: ConnectionId(9),
        request_id: RequestId::String("private-wire-id".to_owned()),
    };
    let diagnostics = InputDiagnostics::new(&id, "turn/steer").unwrap();
    tracing::subscriber::with_default(subscriber, || {
        drop(HandlerGuard::start(diagnostics.clone()));
        let mut completed = HandlerGuard::start(diagnostics.clone());
        completed.complete();
        drop(completed);
        // Caught async panics can drop their guards after unwinding has ended.
        diagnostics.handler_panicked();
    });
    let events = events.0.lock().unwrap();
    assert_eq!(events.len(), 5);
    assert!(events[1].contains("input.handler_abandoned"));
    assert!(events[1].contains("panicking=false"));
    assert!(events[3].contains("input.handler_completed"));
    assert!(events[4].contains("input.handler_panicked"));
    assert!(events[4].contains("outcome=\"unknown\""));
    assert!(events[4].ends_with("ERROR"));
    for event in events.iter() {
        assert!(event.contains(&request_ref(&id.request_id)));
        assert!(!event.contains("private-wire-id"));
    }
}
