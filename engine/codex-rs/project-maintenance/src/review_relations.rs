//! Pure path relations only. Filesystem observations and protection stay fresh.
use crate::{State, paths, string};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::ffi::OsString;
use std::path::{Component, Path, PathBuf, Prefix};

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

// Owned Components retain Prefix equality (including UNC separators), rather
// than comparing raw strings or flattening component boundaries.
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord)]
enum PathComponent {
    Prefix(u8, OsString, OsString),
    RootDir,
    CurDir,
    ParentDir,
    Normal(OsString),
}

fn path_key(path: &Path) -> Vec<PathComponent> {
    #[cfg(any(windows, target_os = "macos"))]
    let folded = path.to_string_lossy().to_lowercase();
    #[cfg(any(windows, target_os = "macos"))]
    let path = Path::new(&folded);
    path.components()
        .map(|component| match component {
            Component::Prefix(prefix) => {
                let empty = OsString::new();
                let (kind, first, second) = match prefix.kind() {
                    Prefix::Verbatim(value) => (0, value.to_owned(), empty),
                    Prefix::VerbatimUNC(server, share) => (1, server.to_owned(), share.to_owned()),
                    Prefix::VerbatimDisk(drive) => {
                        (2, OsString::from(char::from(drive).to_string()), empty)
                    }
                    Prefix::DeviceNS(value) => (3, value.to_owned(), empty),
                    Prefix::UNC(server, share) => (4, server.to_owned(), share.to_owned()),
                    Prefix::Disk(drive) => {
                        (5, OsString::from(char::from(drive).to_string()), empty)
                    }
                };
                PathComponent::Prefix(kind, first, second)
            }
            Component::RootDir => PathComponent::RootDir,
            Component::CurDir => PathComponent::CurDir,
            Component::ParentDir => PathComponent::ParentDir,
            Component::Normal(value) => PathComponent::Normal(value.to_owned()),
        })
        .collect()
}

enum Relation {
    ControlSource(usize),
    Item { key: String, source: bool },
}

#[derive(Default)]
struct RelationIndex {
    paths: BTreeMap<Vec<PathComponent>, Vec<Relation>>,
}

impl RelationIndex {
    fn new(root: &Path, state: &State) -> Result<Self, String> {
        let mut index = Self::default();
        for (position, group) in state.groups.values().enumerate() {
            if let Some(source) = group["membership_source"].as_str() {
                let source = paths::resolve(root, Path::new(source))?;
                index
                    .paths
                    .entry(path_key(&source))
                    .or_default()
                    .push(Relation::ControlSource(position));
            }
        }
        for (key, item) in &state.items {
            let path = Path::new(string(item, "path")?);
            index
                .paths
                .entry(path_key(path))
                .or_default()
                .push(Relation::Item {
                    key: key.clone(),
                    source: false,
                });
            if let Some(source) = item["source_path"].as_str() {
                let source = paths::resolve(root, Path::new(source))?;
                index
                    .paths
                    .entry(path_key(&source))
                    .or_default()
                    .push(Relation::Item {
                        key: key.clone(),
                        source: true,
                    });
            }
        }
        Ok(index)
    }

    fn member(&self, state: &State, item: &Value) -> Result<MemberRelations, String> {
        let target = path_key(Path::new(string(item, "path")?));
        let mut controls = BTreeSet::new();
        let mut items = BTreeMap::<String, (bool, bool)>::new();
        let mut include = |relations: &Vec<Relation>| {
            for relation in relations {
                match relation {
                    Relation::ControlSource(position) => {
                        controls.insert(*position);
                    }
                    Relation::Item { key, source } => {
                        if state.items[key]["id"] == item["id"] {
                            continue;
                        }
                        let flags = items.entry(key.clone()).or_default();
                        if *source {
                            flags.0 = true;
                        } else {
                            flags.1 = true;
                        }
                    }
                }
            }
        };
        // Strict ancestors, then the target and its contiguous descendant range.
        for length in 0..target.len() {
            if let Some(relations) = self.paths.get(&target[..length]) {
                include(relations);
            }
        }
        for (key, relations) in self.paths.range(target.clone()..) {
            if !key.starts_with(&target) {
                break;
            }
            include(relations);
        }
        let mut steps = controls
            .into_iter()
            .map(|_| Step::ControlSource)
            .collect::<Vec<_>>();
        steps.extend(
            items
                .into_iter()
                .map(|(key, (source_overlap, overlaps))| Step::Item {
                    key,
                    source_overlap,
                    overlaps,
                }),
        );
        Ok(MemberRelations { steps })
    }
}

pub(crate) struct ReviewRelations {
    root: PathBuf,
    items: BTreeMap<String, [Option<Value>; 3]>,
    groups: BTreeMap<String, [Option<Value>; 2]>,
    members: BTreeMap<String, MemberRelations>,
}

impl ReviewRelations {
    pub(crate) fn new(root: &Path, state: &State, members: &BTreeMap<String, Value>) -> Self {
        // Invalid rows retain the original partial steps and first error, even
        // when that error belongs to an otherwise unrelated or self-skipped row.
        let index = RelationIndex::new(root, state).ok();
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
                .map(|(key, group)| {
                    (
                        key.clone(),
                        [
                            group.get("membership_source").cloned(),
                            group.get("deleted_claim_retirement").cloned(),
                        ],
                    )
                })
                .collect(),
            members: members
                .iter()
                .map(|(id, item)| {
                    let relations = index
                        .as_ref()
                        .and_then(|index| index.member(state, item).ok())
                        .unwrap_or_else(|| MemberRelations::new(root, state, item));
                    (id.clone(), relations)
                })
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
                .all(|((key, fields), (current_key, group))| {
                    key == current_key
                        && ["membership_source", "deleted_claim_retirement"]
                            .iter()
                            .zip(fields)
                            .all(|(field, value)| group.get(*field) == value.as_ref())
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
        assert!(RelationIndex::new(root, &changed).is_err());
        // An invalid self-skipped row must still select the legacy scanner,
        // which skips it before attempting to read its missing path.
        changed.items.get_mut("z-bad").unwrap()["id"] = json!("a");
        let self_skipped = ReviewRelations::new(root, &changed, &members);
        assert_eq!(self_skipped.member("a").unwrap(), plan.member("a").unwrap());
        changed.groups.insert(
            "first-invalid".into(),
            json!({"membership_source":"../outside"}),
        );
        let invalid_source = ReviewRelations::new(root, &changed, &members);
        assert_eq!(
            invalid_source.member("a").unwrap().steps,
            vec![
                Step::ControlSource,
                Step::Error("path must be a contained relative path".into())
            ]
        );
    }

    #[test]
    fn prefix_index_preserves_relation_order_duplicates_and_component_semantics() {
        let root = Path::new(if cfg!(windows) {
            "C:/project"
        } else {
            "/project"
        });
        let target = root.join("generated/a");
        let item = json!({"id":"a", "path":target});
        let mut state = State::default();
        state.groups.insert(
            "one".into(),
            json!({"membership_source":"./generated/a/control"}),
        );
        state.groups.insert(
            "two".into(),
            json!({"membership_source":"generated/a/control"}),
        );
        state.groups.insert(
            "unrelated".into(),
            json!({"membership_source":"generated/a-other"}),
        );
        for (key, id, path, source) in [
            (
                "a-self-alias",
                "a",
                target.clone(),
                Some("generated/a/source"),
            ),
            ("b", "b", root.join("generated"), None),
            (
                "c",
                "c",
                root.join("elsewhere"),
                Some("./generated/a/source"),
            ),
            ("d", "d", target.join("child"), Some("generated/a")),
            (
                "e",
                "e",
                root.join("generated/a-other"),
                Some("generated/elsewhere"),
            ),
        ] {
            state.items.insert(
                key.into(),
                json!({"id":id,"path":path,"source_path":source}),
            );
        }
        let members = BTreeMap::from([("a".into(), item)]);
        assert!(RelationIndex::new(root, &state).is_ok());
        let plan = ReviewRelations::new(root, &state, &members);
        assert_eq!(
            plan.member("a").unwrap().steps,
            vec![
                Step::ControlSource,
                Step::ControlSource,
                Step::Item {
                    key: "b".into(),
                    source_overlap: false,
                    overlaps: true
                },
                Step::Item {
                    key: "c".into(),
                    source_overlap: true,
                    overlaps: false
                },
                Step::Item {
                    key: "d".into(),
                    source_overlap: true,
                    overlaps: true
                },
            ]
        );
        // A future path-key simplification must keep within's host-specific
        // folding, component boundaries, roots and leading CurDir behavior.
        for (path, base) in [
            (target.join("child"), target.clone()),
            (root.join("generated/a-other"), target.clone()),
            (root.join("Generated/A/child"), target.clone()),
            (PathBuf::from("./generated/a"), PathBuf::from("generated")),
            (PathBuf::from("generated/a"), PathBuf::from("./generated")),
            (target.clone(), PathBuf::from("")),
            (
                PathBuf::from("//server/share/child"),
                PathBuf::from("//server/share"),
            ),
            (
                PathBuf::from("C:/project/child"),
                PathBuf::from("C:/project"),
            ),
            (
                PathBuf::from(r"\\server\share\child"),
                PathBuf::from("//server/share"),
            ),
        ] {
            assert_eq!(
                path_key(&path).starts_with(&path_key(&base)),
                paths::within(&path, &base),
                "{} within {}",
                path.display(),
                base.display()
            );
        }
        let folded = root.join("Generated/A/child");
        assert_eq!(
            path_key(&folded).starts_with(&path_key(&target)),
            cfg!(any(windows, target_os = "macos"))
        );
    }
}
