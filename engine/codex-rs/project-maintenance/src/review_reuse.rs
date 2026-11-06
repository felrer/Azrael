use std::cell::RefCell;
use std::collections::BTreeMap;
use std::rc::Rc;

use serde_json::Value;
use serde_json::json;

pub(crate) type TokenRuns = Rc<BTreeMap<String, Value>>;

/// Pure token reuse: callers must still obtain current observations and proofs.
#[derive(Default)]
pub(crate) struct TokenCache {
    runs: RefCell<Option<TokenRuns>>,
    entries: RefCell<BTreeMap<(String, bool), Entry>>,
    #[cfg(test)]
    misses: std::cell::Cell<usize>,
}

pub(crate) struct TokenInputs<'a> {
    pub(crate) item: &'a Value,
    pub(crate) verification: &'a str,
    pub(crate) observation: &'a Value,
    pub(crate) measurement: &'a Value,
    pub(crate) recovery: &'a Value,
    pub(crate) config: &'a str,
    pub(crate) preference_revision: Option<u64>,
    pub(crate) retire_managed_roots: &'a Value,
    pub(crate) retirement_evidence_identity: &'a Option<String>,
    pub(crate) retire_nested_member: &'a Value,
    pub(crate) nested_evidence_identity: &'a Option<String>,
}

impl TokenInputs<'_> {
    fn same_as(&self, other: &Self) -> bool {
        same_json(self.item, other.item)
            && self.verification == other.verification
            && same_json(self.observation, other.observation)
            && same_json(self.measurement, other.measurement)
            && same_json(self.recovery, other.recovery)
            && self.config == other.config
            && self.preference_revision == other.preference_revision
            && same_json(self.retire_managed_roots, other.retire_managed_roots)
            && self.retirement_evidence_identity == other.retirement_evidence_identity
            && same_json(self.retire_nested_member, other.retire_nested_member)
            && self.nested_evidence_identity == other.nested_evidence_identity
    }

    pub(crate) fn hash(&self, runs: &BTreeMap<String, Value>) -> Result<String, String> {
        // Preserve the original json! expression's keys and order, including builds
        // where serde_json enables preserve_order.
        crate::hash(
            &json!({"item":self.item,"verification":self.verification,"observation":self.observation,"measurement":self.measurement,"recovery":self.recovery,"runs":runs,"config":self.config,"preference_revision":self.preference_revision,"retire_managed_roots":self.retire_managed_roots,"retirement_evidence_identity":self.retirement_evidence_identity,"retire_nested_member":self.retire_nested_member,"nested_evidence_identity":self.nested_evidence_identity}),
        )
    }

    fn to_owned(&self) -> OwnedInputs {
        OwnedInputs {
            item: self.item.clone(),
            verification: self.verification.to_owned(),
            observation: self.observation.clone(),
            measurement: self.measurement.clone(),
            recovery: self.recovery.clone(),
            config: self.config.to_owned(),
            preference_revision: self.preference_revision,
            retire_managed_roots: self.retire_managed_roots.clone(),
            retirement_evidence_identity: self.retirement_evidence_identity.clone(),
            retire_nested_member: self.retire_nested_member.clone(),
            nested_evidence_identity: self.nested_evidence_identity.clone(),
        }
    }
}

// Value equality ignores object insertion order (with preserve_order) and the
// sign of floating-point zero. Both can change the original token bytes.
fn same_json(left: &Value, right: &Value) -> bool {
    match (left, right) {
        (Value::Object(left), Value::Object(right)) => {
            left.len() == right.len()
                && left
                    .iter()
                    .zip(right)
                    .all(|((lk, lv), (rk, rv))| lk == rk && same_json(lv, rv))
        }
        (Value::Array(left), Value::Array(right)) => {
            left.len() == right.len()
                && left
                    .iter()
                    .zip(right)
                    .all(|(left, right)| same_json(left, right))
        }
        (Value::Number(left), Value::Number(right)) => left.to_string() == right.to_string(),
        _ => left == right,
    }
}

fn same_runs(left: &BTreeMap<String, Value>, right: &BTreeMap<String, Value>) -> bool {
    left.len() == right.len()
        && left
            .iter()
            .zip(right)
            .all(|((lk, lv), (rk, rv))| lk == rk && same_json(lv, rv))
}

struct OwnedInputs {
    item: Value,
    verification: String,
    observation: Value,
    measurement: Value,
    recovery: Value,
    config: String,
    preference_revision: Option<u64>,
    retire_managed_roots: Value,
    retirement_evidence_identity: Option<String>,
    retire_nested_member: Value,
    nested_evidence_identity: Option<String>,
}

impl OwnedInputs {
    fn as_inputs(&self) -> TokenInputs<'_> {
        TokenInputs {
            item: &self.item,
            verification: &self.verification,
            observation: &self.observation,
            measurement: &self.measurement,
            recovery: &self.recovery,
            config: &self.config,
            preference_revision: self.preference_revision,
            retire_managed_roots: &self.retire_managed_roots,
            retirement_evidence_identity: &self.retirement_evidence_identity,
            retire_nested_member: &self.retire_nested_member,
            nested_evidence_identity: &self.nested_evidence_identity,
        }
    }
}

struct Entry {
    runs: TokenRuns,
    inputs: OwnedInputs,
    token: String,
}

impl TokenCache {
    pub(crate) fn begin(&self, runs: &BTreeMap<String, Value>) -> TokenRuns {
        let mut current = self.runs.borrow_mut();
        if let Some(previous) = current.as_ref()
            && same_runs(previous, runs)
        {
            return Rc::clone(previous);
        }
        let snapshot = Rc::new(runs.clone());
        *current = Some(Rc::clone(&snapshot));
        self.entries.borrow_mut().clear();
        snapshot
    }

    pub(crate) fn token(
        &self,
        runs: &TokenRuns,
        measure: bool,
        inputs: &TokenInputs<'_>,
    ) -> Result<String, String> {
        let key = inputs
            .item
            .get("id")
            .and_then(Value::as_str)
            .map(|id| (id.to_owned(), measure));
        if let Some(key) = key.as_ref()
            && let Some(entry) = self.entries.borrow().get(key)
            && Rc::ptr_eq(&entry.runs, runs)
            && entry.inputs.as_inputs().same_as(inputs)
        {
            return Ok(entry.token.clone());
        }
        #[cfg(test)]
        self.misses.set(self.misses.get() + 1);
        let token = inputs.hash(runs)?;
        if let Some(key) = key {
            self.entries.borrow_mut().insert(
                key,
                Entry {
                    runs: Rc::clone(runs),
                    inputs: inputs.to_owned(),
                    token: token.clone(),
                },
            );
        }
        Ok(token)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> OwnedInputs {
        OwnedInputs {
            item: json!({"id":"member", "unknown":{"preserve":true}}),
            verification: "registered".into(),
            observation: json!({"identity":"root"}),
            measurement: json!({"identity":"member", "logical_bytes":7}),
            recovery: json!({"replacement":"verified"}),
            config: "config".into(),
            preference_revision: Some(1),
            retire_managed_roots: json!({"enabled":true}),
            retirement_evidence_identity: Some("managed-proof".into()),
            retire_nested_member: json!({"enabled":true}),
            nested_evidence_identity: Some("nested-proof".into()),
        }
    }

    #[test]
    fn original_wire_hash_is_preserved() {
        let input = fixture();
        let runs = BTreeMap::from([("run".into(), json!({"steps":[]}))]);
        let original = json!({"item":input.item,"verification":input.verification,"observation":input.observation,"measurement":input.measurement,"recovery":input.recovery,"runs":runs,"config":input.config,"preference_revision":input.preference_revision,"retire_managed_roots":input.retire_managed_roots,"retirement_evidence_identity":input.retirement_evidence_identity,"retire_nested_member":input.retire_nested_member,"nested_evidence_identity":input.nested_evidence_identity});
        assert_eq!(input.as_inputs().hash(&runs), crate::hash(&original));
    }

    #[test]
    fn wire_spelling_and_nested_object_order_are_part_of_the_key() {
        let cache = TokenCache::default();
        let empty_runs = BTreeMap::new();
        let snapshot = cache.begin(&empty_runs);
        let mut input = fixture();
        input.measurement = json!(-0.0);
        let negative = cache.token(&snapshot, false, &input.as_inputs()).unwrap();
        let misses = cache.misses.get();
        input.measurement = json!(0.0);
        let positive = cache.token(&snapshot, false, &input.as_inputs()).unwrap();
        assert_ne!(negative, positive);
        assert_eq!(cache.misses.get(), misses + 1);

        let first: Value = serde_json::from_str(r#"{"outer":{"a":1,"b":2}}"#).unwrap();
        let reordered: Value = serde_json::from_str(r#"{"outer":{"b":2,"a":1}}"#).unwrap();
        let order_matters =
            serde_json::to_string(&first).unwrap() != serde_json::to_string(&reordered).unwrap();
        input.observation = first.clone();
        let before = cache.token(&snapshot, false, &input.as_inputs()).unwrap();
        let misses = cache.misses.get();
        input.observation = reordered.clone();
        let after = cache.token(&snapshot, false, &input.as_inputs()).unwrap();
        assert_eq!(before != after, order_matters);
        assert_eq!(cache.misses.get(), misses + usize::from(order_matters));
        let runs = cache.begin(&BTreeMap::from([("run".into(), first)]));
        let reordered_runs = cache.begin(&BTreeMap::from([("run".into(), reordered)]));
        assert_eq!(!Rc::ptr_eq(&runs, &reordered_runs), order_matters);
        input.observation["outer"]["a"] = json!(3);
        let changed = cache.token(&snapshot, false, &input.as_inputs()).unwrap();
        assert_ne!(changed, after);
    }

    // Retained to catch future omissions of a token input from cache equality.
    #[test]
    fn reuse_requires_every_original_input_and_the_same_runs_snapshot() {
        let changes: &[fn(&mut OwnedInputs)] = &[
            |v| v.item["unknown"]["preserve"] = json!(false),
            |v| v.verification = "full".into(),
            |v| v.observation["identity"] = json!("changed"),
            |v| v.measurement["logical_bytes"] = json!(8),
            |v| v.recovery["replacement"] = json!("changed"),
            |v| v.config = "changed".into(),
            |v| v.preference_revision = None,
            |v| v.retire_managed_roots["enabled"] = json!(false),
            |v| v.retirement_evidence_identity = None,
            |v| v.retire_nested_member["enabled"] = json!(false),
            |v| v.nested_evidence_identity = None,
        ];
        let cache = TokenCache::default();
        let runs = BTreeMap::from([("run".into(), json!({"steps":[]}))]);
        let snapshot = cache.begin(&runs);
        let same = cache.begin(&runs.clone());
        assert!(Rc::ptr_eq(&snapshot, &same));
        for change in changes {
            let mut input = fixture();
            let baseline = cache.token(&snapshot, false, &input.as_inputs()).unwrap();
            let misses = cache.misses.get();
            assert_eq!(
                cache.token(&same, false, &input.as_inputs()).unwrap(),
                baseline
            );
            assert_eq!(cache.misses.get(), misses);
            change(&mut input);
            let changed = cache.token(&snapshot, false, &input.as_inputs()).unwrap();
            assert_ne!(changed, baseline);
            assert_eq!(changed, input.as_inputs().hash(&runs).unwrap());
            assert_eq!(cache.misses.get(), misses + 1);
        }

        let input = fixture();
        cache.token(&snapshot, false, &input.as_inputs()).unwrap();
        let misses = cache.misses.get();
        cache.token(&snapshot, true, &input.as_inputs()).unwrap();
        assert_eq!(cache.misses.get(), misses + 1);
        let changed_runs = BTreeMap::from([("run".into(), json!({"steps":["changed"]}))]);
        let changed_snapshot = cache.begin(&changed_runs);
        assert!(!Rc::ptr_eq(&snapshot, &changed_snapshot));
        let changed = cache
            .token(&changed_snapshot, false, &input.as_inputs())
            .unwrap();
        assert_eq!(changed, input.as_inputs().hash(&changed_runs).unwrap());
        let misses = cache.misses.get();
        // A reentrant pass can retain an old snapshot; it must never receive the
        // entry associated with a different pass's runs.
        let old = cache.token(&snapshot, false, &input.as_inputs()).unwrap();
        assert_eq!(old, input.as_inputs().hash(&runs).unwrap());
        assert_ne!(old, changed);
        assert_eq!(cache.misses.get(), misses + 1);

        for id in [None, Some(Value::Null), Some(json!(42))] {
            let mut input = fixture();
            if let Some(id) = id {
                input.item["id"] = id;
            } else {
                input.item.as_object_mut().unwrap().remove("id");
            }
            let misses = cache.misses.get();
            for _ in 0..2 {
                assert_eq!(
                    cache.token(&snapshot, false, &input.as_inputs()).unwrap(),
                    input.as_inputs().hash(&runs).unwrap()
                );
            }
            assert_eq!(cache.misses.get(), misses + 2);
        }
    }
}
