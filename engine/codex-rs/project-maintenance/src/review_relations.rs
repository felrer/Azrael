//! Pure path relations only. Filesystem observations and protection stay fresh.
use crate::{State, paths, string};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

const ITEM_FIELDS: [&str; 3] = ["id", "path", "source_path"];

#[derive(Debug, PartialEq)]
pub(crate) enum Step {
    ControlSource,
    Item {
        key: String,
        source_overlap: bool,
        overlaps: bool,
    },
    Error(String),
}

#[derive(Debug, PartialEq)]
pub(crate) struct MemberRelations {
    pub(crate) steps: Vec<Step>,
}

impl MemberRelations {
    pub(crate) fn new(root: &Path, state: &State, item: &Value) -> Self {
        let mut steps = Vec::new();
        let result = (|| -> Result<(), String> {
            let target = Path::new(string(item, "path")?);
            for group in state.groups.values() {
                if let Some(source) = group["membership_source"].as_str() {
                    let source = paths::resolve(root, Path::new(source))?;
                    if paths::within(target, &source) || paths::within(&source, target) {
                        steps.push(Step::ControlSource);
                    }
                }
            }
            for (key, other) in &state.items {
                if other["id"] == item["id"] {
                    continue;
                }
                let other_path = Path::new(string(other, "path")?);
                let source_overlap = if let Some(source) = other["source_path"].as_str() {
                    let source = paths::resolve(root, Path::new(source))?;
                    paths::within(target, &source) || paths::within(&source, target)
                } else {
                    false
                };
                let overlaps =
                    paths::within(target, other_path) || paths::within(other_path, target);
                if source_overlap || overlaps {
                    steps.push(Step::Item {
                        key: key.clone(),
                        source_overlap,
                        overlaps,
                    });
                }
            }
            Ok(())
        })();
        if let Err(error) = result {
            steps.push(Step::Error(error));
        }
        Self { steps }
    }
}

pub(crate) struct ReviewRelations {
    root: PathBuf,
    items: BTreeMap<String, [Option<Value>; 3]>,
    groups: BTreeMap<String, Option<Value>>,
    members: BTreeMap<String, MemberRelations>,
}

impl ReviewRelations {
    pub(crate) fn new(root: &Path, state: &State, members: &BTreeMap<String, Value>) -> Self {
        Self {
            root: root.to_owned(),
            items: state
                .items
                .iter()
                .map(|(key, item)| {
                    (
                        key.clone(),
                        ITEM_FIELDS.map(|field| item.get(field).cloned()),
                    )
                })
                .collect(),
            groups: state
                .groups
                .iter()
                .map(|(key, group)| (key.clone(), group.get("membership_source").cloned()))
                .collect(),
            members: members
                .iter()
                .map(|(id, item)| (id.clone(), MemberRelations::new(root, state, item)))
                .collect(),
        }
    }

    pub(crate) fn matches(&self, root: &Path, state: &State) -> bool {
        self.root == root
            && self.items.len() == state.items.len()
            && self.groups.len() == state.groups.len()
            && self
                .items
                .iter()
                .zip(&state.items)
                .all(|((key, fields), (current_key, item))| {
                    key == current_key
                        && ITEM_FIELDS
                            .iter()
                            .zip(fields)
                            .all(|(field, value)| item.get(*field) == value.as_ref())
                })
            && self
                .groups
                .iter()
                .zip(&state.groups)
                .all(|((key, source), (current_key, group))| {
                    key == current_key && group.get("membership_source") == source.as_ref()
                })
    }

    pub(crate) fn member(&self, id: &str) -> Result<&MemberRelations, String> {
        self.members
            .get(id)
            .ok_or_else(|| "missing lifecycle relation plan".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn plans_bind_relation_inputs_but_never_cache_dynamic_protection() {
        let root = Path::new(if cfg!(windows) {
            "C:/project"
        } else {
            "/project"
        });
        let item = json!({"id":"a","path":root.join("generated/a")});
        let sibling = json!({"id":"b","path":root.join("generated/a/child"),"source_path":root.join("generated/a/original")});
        let mut state = State::default();
        state.items.insert("a".into(), item.clone());
        state.items.insert("b".into(), sibling);
        state.groups.insert(
            "controls".into(),
            json!({"membership_source":root.join("generated/a/control")}),
        );
        let members = BTreeMap::from([("a".into(), item)]);
        let plan = ReviewRelations::new(root, &state, &members);
        assert_eq!(
            plan.member("a").unwrap().steps,
            vec![
                Step::ControlSource,
                Step::Item {
                    key: "b".into(),
                    source_overlap: true,
                    overlaps: true
                }
            ]
        );
        state.revision += 1;
        state.items.get_mut("b").unwrap()["references"] = json!(["new consumer"]);
        state.items.get_mut("b").unwrap()["cleanup_status"] = json!("deleted");
        state
            .runs
            .insert("active".into(), json!({"steps":[{"status":"running"}]}));
        assert!(
            plan.matches(root, &state),
            "protection and run values must be evaluated freshly, outside this plan"
        );
        for field in ITEM_FIELDS {
            let mut changed = state.clone();
            changed.items.get_mut("b").unwrap()[field] = json!("changed");
            assert!(!plan.matches(root, &changed));
        }
        let mut changed = state.clone();
        changed.items.insert(
            "new".into(),
            json!({"id":"new","path":root.join("generated/a/new")}),
        );
        assert!(!plan.matches(root, &changed));
        changed = state.clone();
        changed.groups.get_mut("controls").unwrap()["membership_source"] = Value::Null;
        assert!(!plan.matches(root, &changed));
        changed = state.clone();
        changed.items.insert("z-bad".into(), json!({"id":"bad"}));
        let invalid = ReviewRelations::new(root, &changed, &members);
        assert!(matches!(
            invalid.member("a").unwrap().steps.last(),
            Some(Step::Error(_))
        ));
        assert_eq!(
            &invalid.member("a").unwrap().steps[..2],
            &plan.member("a").unwrap().steps
        );
    }
}
