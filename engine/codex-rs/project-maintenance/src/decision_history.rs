use serde_json::{Value, json};

use crate::State;
use crate::hash;

/// Discard only the per-file detail of an unambiguously successful deletion.
/// Nested receipts and unknown fields remain untouched.
pub(crate) fn summarize_success(outcome: &Value) -> Result<Value, String> {
    let Some(deletion) = outcome.get("deletion").and_then(Value::as_object) else {
        return Ok(outcome.clone());
    };
    if outcome.get("status").and_then(Value::as_str) != Some("deleted")
        || outcome.get("remaining").and_then(Value::as_bool) != Some(false)
        || deletion.get("status").and_then(Value::as_str) != Some("deleted")
        || deletion.get("remaining").and_then(Value::as_bool) != Some(false)
        || deletion.get("error") != Some(&Value::Null)
        || ["error", "persistence_error"]
            .iter()
            .any(|key| outcome.get(*key).is_some_and(|value| !value.is_null()))
        || deletion.contains_key("attributes_summary")
    {
        return Ok(outcome.clone());
    }
    let Some(attributes) = deletion
        .get("attributes")
        .and_then(Value::as_array)
        .filter(|attributes| !attributes.is_empty())
    else {
        return Ok(outcome.clone());
    };
    let summary = json!({
        "schema": 1,
        "count": attributes.len(),
        "sha256": hash(attributes)?,
        "logical_bytes": serde_json::to_vec(attributes).map_err(|error| error.to_string())?.len(),
    });
    let mut result = outcome.clone();
    let deletion = result["deletion"]
        .as_object_mut()
        .expect("validated deletion object");
    deletion.remove("attributes");
    deletion.insert("attributes_summary".into(), summary);
    Ok(result)
}

struct Candidate {
    index: usize,
    original_hash: String,
    summarized: Value,
}

struct Review {
    result: Value,
    candidates: Vec<Candidate>,
}

fn prepare_review(state: &State) -> Result<Review, String> {
    let mut candidates = Vec::new();
    let mut legacy_count = 0usize;
    let mut detail_count = 0usize;
    let mut detail_bytes = 0usize;
    let mut before_bytes = 0usize;
    let mut after_bytes = 0usize;
    for (index, outcome) in state.decisions.iter().enumerate() {
        let summarized = summarize_success(outcome)?;
        if summarized == *outcome {
            continue;
        }
        let summary = &summarized["deletion"]["attributes_summary"];
        detail_count += summary["count"].as_u64().expect("summary count") as usize;
        detail_bytes += summary["logical_bytes"].as_u64().expect("summary bytes") as usize;
        before_bytes += serde_json::to_vec(outcome).map_err(|error| error.to_string())?.len();
        after_bytes += serde_json::to_vec(&summarized).map_err(|error| error.to_string())?.len();
        if outcome.get("decision_id").and_then(Value::as_str).is_none() {
            legacy_count += 1;
        }
        candidates.push(Candidate {
            index,
            original_hash: hash(outcome)?,
            summarized,
        });
    }
    let eligible = candidates
        .iter()
        .map(|candidate| json!({"index":candidate.index,"original_hash":candidate.original_hash}))
        .collect::<Vec<_>>();
    let token = hash(&json!({
        "policy": {"schema":1,"operation":"compact_decision_history"},
        "revision":state.revision,
        "eligible":eligible,
    }))?;
    // A short attributes array can be smaller than its summary. Preserve that
    // negative difference instead of claiming bytes were removed.
    let estimated_removed_bytes = i64::try_from(before_bytes)
        .and_then(|before| i64::try_from(after_bytes).map(|after| before - after))
        .map_err(|error| error.to_string())?;
    Ok(Review {
        result: json!({
            "operation":"review_decision_history",
            "policy_schema":1,
            "revision":state.revision,
            "review_token":token,
            "eligible_count":candidates.len(),
            "legacy_count":legacy_count,
            "stable_count":candidates.len() - legacy_count,
            "detail_count":detail_count,
            "detail_bytes":detail_bytes,
            "before_bytes":before_bytes,
            "after_bytes":after_bytes,
            "estimated_removed_bytes":estimated_removed_bytes,
            "eligible":eligible,
        }),
        candidates,
    })
}

pub(crate) fn review(state: &State) -> Result<Value, String> {
    Ok(prepare_review(state)?.result)
}

/// The caller owns the exclusive store lock and saves without suspended merge.
pub(crate) fn compact(state: &mut State, request: &Value) -> Result<Value, String> {
    let prepared = prepare_review(state)?;
    let token = crate::string(request, "review_token")?;
    if prepared.result["review_token"].as_str() != Some(token) {
        return Err("stale decision history review_token".into());
    }
    let reason = crate::string(request, "reason")?;
    if reason.trim().is_empty() {
        return Err("missing nonempty reason".into());
    }
    let mut result = prepared.result;
    result["operation"] = json!("compact_decision_history");
    // The token commits to this list; the audit needs only aggregate evidence.
    result.as_object_mut().expect("review object").remove("eligible");
    if prepared.candidates.is_empty() {
        result["status"] = json!("unchanged");
        return Ok(result);
    }
    result["status"] = json!("compacted");
    result["reason"] = json!(reason);
    result["decision_id"] = json!(hash(&json!({
        "operation":"compact_decision_history",
        "review_token":token,
        "reason":reason,
    }))?);
    // Finish every fallible preparation before modifying any history row.
    for candidate in prepared.candidates {
        state.decisions[candidate.index] = candidate.summarized;
    }
    state.decisions.push(result.clone());
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn successful() -> Value {
        json!({
            "status":"deleted","remaining":false,"unknown":{"keep":[1,2]},
            "deletion":{
                "status":"deleted","remaining":false,"error":null,
                "attributes":[{"path":"example","original":33,"normalized":32}],
                "unknown":{"attributes":["keep nested details"]}
            }
        })
    }

    #[test]
    fn summary_preserves_unknown_fields_and_exact_attribute_evidence() {
        let original = successful();
        let attributes = original["deletion"]["attributes"].clone();
        let result = summarize_success(&original).unwrap();
        assert_eq!(result["deletion"]["attributes_summary"], json!({
            "schema":1,"count":1,"sha256":hash(&attributes).unwrap(),
            "logical_bytes":serde_json::to_vec(&attributes).unwrap().len()
        }));
        let mut restored = result;
        restored["deletion"].as_object_mut().unwrap().remove("attributes_summary");
        restored["deletion"]["attributes"] = attributes;
        assert_eq!(restored, original);
    }

    #[test]
    fn uncertain_failed_pending_and_malformed_details_are_untouched() {
        let paths = [
            ("/status", json!("failed")),
            ("/status", json!("blocked")),
            ("/status", json!("pending")),
            ("/remaining", json!(true)),
            ("/remaining", Value::Null),
            ("/deletion/status", json!("failed")),
            ("/deletion/status", json!("pending")),
            ("/deletion/remaining", json!(true)),
            ("/deletion/remaining", Value::Null),
            ("/deletion/error", json!("failed")),
            ("/deletion/attributes", json!([])),
            ("/deletion/attributes", json!({})),
            ("/deletion/attributes", Value::Null),
        ];
        for (path, value) in paths {
            let mut original = successful();
            *original.pointer_mut(path).unwrap() = value;
            assert_eq!(summarize_success(&original).unwrap(), original, "{path}");
        }
        for key in ["error", "persistence_error"] {
            let mut original = successful();
            original[key] = json!(false);
            assert_eq!(summarize_success(&original).unwrap(), original);
        }
        for key in ["error", "remaining", "status", "attributes"] {
            let mut original = successful();
            original["deletion"].as_object_mut().unwrap().remove(key);
            assert_eq!(summarize_success(&original).unwrap(), original);
        }
        let mut original = successful();
        original["deletion"]["attributes_summary"] = Value::Null;
        assert_eq!(summarize_success(&original).unwrap(), original);
    }

    #[test]
    fn stale_token_and_invalid_reason_never_mutate_history() {
        let mut state = State::default();
        state.decisions.push(successful());
        let token = review(&state).unwrap()["review_token"].clone();
        for request in [
            json!({"review_token":token,"reason":""}),
            json!({"review_token":token,"reason":"  "}),
            json!({"review_token":"stale","reason":"approved"}),
        ] {
            let before = serde_json::to_value(&state).unwrap();
            assert!(compact(&mut state, &request).is_err());
            assert_eq!(serde_json::to_value(&state).unwrap(), before);
        }
        state.decisions[0]["unknown"] = json!("changed");
        let before = serde_json::to_value(&state).unwrap();
        assert!(compact(&mut state, &json!({"review_token":token,"reason":"approved"})).is_err());
        assert_eq!(serde_json::to_value(&state).unwrap(), before);
        let token = review(&state).unwrap()["review_token"].clone();
        state.revision += 1;
        assert!(compact(&mut state, &json!({"review_token":token,"reason":"approved"})).is_err());
    }

    #[test]
    fn compacts_legacy_and_stable_in_order_once_with_truthful_byte_difference() {
        let mut state = State::default();
        let mut stable = successful();
        stable["decision_id"] = json!("stable");
        let pending = json!({"status":"pending","deletion":{"attributes":["keep"]}});
        state.decisions = vec![successful(), pending.clone(), stable];
        let inspected = review(&state).unwrap();
        assert_eq!(inspected["legacy_count"], 1);
        assert_eq!(inspected["stable_count"], 1);
        assert_eq!(inspected["eligible_count"], 2);
        assert_eq!(inspected["eligible"][1]["index"], 2);
        let before_bytes = serde_json::to_vec(&state.decisions).unwrap().len() as i64;
        let request = json!({"review_token":inspected["review_token"],"reason":"approved"});
        let result = compact(&mut state, &request).unwrap();
        assert_eq!(state.decisions.len(), 4);
        assert_eq!(state.decisions[1], pending);
        assert_eq!(state.decisions[2]["decision_id"], "stable");
        assert_eq!(state.decisions[3], result);
        let after_bytes = serde_json::to_vec(&state.decisions[..3]).unwrap().len() as i64;
        assert_eq!(result["estimated_removed_bytes"], before_bytes - after_bytes);
        assert!(compact(&mut state, &request).is_err());
        let token = review(&state).unwrap()["review_token"].clone();
        let before = serde_json::to_value(&state).unwrap();
        assert_eq!(compact(&mut state, &json!({"review_token":token,"reason":"approved"})).unwrap()["status"], "unchanged");
        assert_eq!(serde_json::to_value(&state).unwrap(), before);
    }
}
