use crate::{Auth, Config, hash, paths};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

#[derive(Clone, Deserialize, Serialize)]
pub(crate) struct Bundle {
    id: String,
    kind: String,
    purpose: String,
    argv: Vec<String>,
    #[serde(default = "dot")]
    cwd: PathBuf,
    #[serde(default)]
    env: BTreeMap<String, String>,
    #[serde(default)]
    depends_on: Vec<String>,
    #[serde(default)]
    inputs: Vec<PathBuf>,
    #[serde(default)]
    resource: Option<String>,
    #[serde(default)]
    guards: Vec<String>,
    #[serde(flatten)]
    extra: BTreeMap<String, Value>,
}
fn dot() -> PathBuf {
    PathBuf::from(".")
}
pub(crate) fn plan(
    root: &Path,
    config: &Config,
    request: &Value,
    auth: Auth<'_>,
) -> Result<Value, String> {
    let requested_kind = match request.get("kind") {
        Some(value) => Some(
            value
                .as_str()
                .filter(|kind| ["test", "build", "prepare"].contains(kind))
                .ok_or("unknown plan kind")?,
        ),
        None => None,
    };
    let mut bundles = BTreeMap::new();
    for bundle in &config.bundles {
        if bundle.id.is_empty()
            || bundle.argv.is_empty()
            || bundle.argv.iter().any(|s| s.contains('\0'))
            || !["test", "build", "prepare"].contains(&bundle.kind.as_str())
            || !["one_off", "retained"].contains(&bundle.purpose.as_str())
        {
            return Err("invalid bundle contract".into());
        }
        if bundles.insert(bundle.id.clone(), bundle).is_some() {
            return Err("duplicate bundle id".into());
        }
    }
    let selected = if let Some(ids) = request.get("bundles") {
        ids.as_array()
            .ok_or("bundles must be an array")?
            .iter()
            .map(|id| {
                id.as_str()
                    .map(str::to_owned)
                    .ok_or("invalid bundle id".to_owned())
            })
            .collect::<Result<Vec<_>, _>>()?
    } else {
        config
            .bundles
            .iter()
            .filter(|b| {
                request
                    .get("kind")
                    .and_then(Value::as_str)
                    .is_none_or(|kind| b.kind == kind)
            })
            .map(|b| b.id.clone())
            .collect()
    };
    if selected.is_empty() {
        return Err("plan must select at least one bundle".into());
    }
    let mut ordered = Vec::new();
    let mut visiting = BTreeSet::new();
    let mut done = BTreeSet::new();
    for id in selected {
        visit(&id, &bundles, &mut visiting, &mut done, &mut ordered)?;
    }
    if let Some(kind) = requested_kind {
        for id in &ordered {
            let actual = bundles[id].kind.as_str();
            if actual != kind && actual != "prepare" {
                return Err(format!("{kind} plan cannot execute {actual} bundle {id}"));
            }
        }
    }
    let mut steps: Vec<Value> = Vec::new();
    let mut semantic_steps = BTreeMap::<String, usize>::new();
    let mut bundle_steps = BTreeMap::<String, String>::new();
    for id in ordered {
        let bundle = bundles[&id];
        let cwd = paths::resolve(root, &bundle.cwd)?;
        paths::check(root, &cwd, auth)?;
        if !cwd.is_dir() {
            return Err("bundle cwd must exist and be a directory".into());
        }
        let mut inputs = Vec::new();
        for input in &bundle.inputs {
            let path = paths::resolve(root, input)?;
            let measurement = paths::measure(root, &path, auth)?;
            inputs.push(json!({"path":path,"identity":measurement["identity"]}));
        }
        let dependencies = bundle
            .depends_on
            .iter()
            .map(|dep| {
                bundle_steps
                    .get(dep)
                    .cloned()
                    .ok_or("missing dependency step".to_owned())
            })
            .collect::<Result<BTreeSet<_>, _>>()?;
        // Include phase, guards, resource, all unknown options and resolved dependencies.
        // Only explicit identical semantics can share a receipt.
        let semantic = json!({"kind":bundle.kind,"purpose":bundle.purpose,"argv":bundle.argv,"cwd":cwd,"env":bundle.env,"inputs":inputs,"resource":bundle.resource,"guards":bundle.guards,"depends_on":dependencies,"extra":bundle.extra});
        let key = hash(&semantic)?;
        if let Some(index) = semantic_steps.get(&key) {
            steps[*index]["bundle_ids"]
                .as_array_mut()
                .ok_or("invalid plan")?
                .push(json!(id));
            bundle_steps.insert(
                id,
                steps[*index]["step_id"]
                    .as_str()
                    .ok_or("invalid step id")?
                    .to_owned(),
            );
        } else {
            let step_id = format!("step-{key}");
            let input_identity = hash(&inputs)?;
            let mut step = semantic;
            step["step_id"] = json!(step_id);
            step["bundle_ids"] = json!([id]);
            step["input_identity"] = json!(input_identity);
            semantic_steps.insert(key, steps.len());
            bundle_steps.insert(id, step_id);
            steps.push(step);
        }
    }
    Ok(
        json!({"plan_id":format!("plan-{}",hash(&steps)?),"steps":steps,"project_id":config.project_id}),
    )
}
fn visit(
    id: &str,
    bundles: &BTreeMap<String, &Bundle>,
    visiting: &mut BTreeSet<String>,
    done: &mut BTreeSet<String>,
    ordered: &mut Vec<String>,
) -> Result<(), String> {
    if done.contains(id) {
        return Ok(());
    }
    if !visiting.insert(id.to_owned()) {
        return Err("cyclic bundle dependencies".into());
    }
    let bundle = bundles
        .get(id)
        .ok_or_else(|| format!("unknown bundle: {id}"))?;
    for dep in &bundle.depends_on {
        visit(dep, bundles, visiting, done, ordered)?;
    }
    visiting.remove(id);
    done.insert(id.to_owned());
    ordered.push(id.to_owned());
    Ok(())
}
