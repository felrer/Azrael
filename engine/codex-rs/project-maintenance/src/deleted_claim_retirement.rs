//! Retire one historical logical path claim, never payload or deletion history.
//! No claim is made about the historical object's physical identity or birth time.
use crate::{AccessMode, Auth, Config, State, groups, hash, now_ms, paths, string};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, io::Read, path::Path};

const SCOPE: &str = "terminal_deleted_historical_path_claim";
const RECEIPT: &str = "deleted_claim_retirement";

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    mode: String,
    scope: String,
    historical_group_id: String,
    replacement_group_id: String,
    reason: String,
    expected_snapshot: Option<Value>,
    evidence_ref: Option<String>,
    evidence_sha256: Option<String>,
}

pub(crate) fn review_request(request: &Value) -> bool {
    request["operation"] == "register" && request["retire_deleted_claim"]["mode"] == "review"
}

/// Registration must not forge, erase, overwrite or reactivate this receipt.
/// The historical group and its members stay immutable through all register routes.
pub(crate) fn guard_registration(state: &State, request: &Value) -> Result<(), String> {
    if request.get("retire_deleted_claim").is_some() {
        if request
            .as_object()
            .ok_or("invalid request")?
            .keys()
            .any(|key| {
                ![
                    "operation",
                    "retire_deleted_claim",
                    "lock_wait_ms",
                    "coordination",
                ]
                .contains(&key.as_str())
            })
        {
            return Err(
                "retire_deleted_claim cannot include another registration operation".into(),
            );
        }
        return Ok(());
    }
    let group = &request["group"];
    if group.get(RECEIPT).is_some() {
        return Err("claim retirement receipts cannot be supplied by registration".into());
    }
    for candidate in [
        group,
        &request["refresh_group"],
        &request["retire_group_source"],
    ] {
        if candidate["id"]
            .as_str()
            .and_then(|id| state.groups.get(id))
            .is_some_and(|group| group.get(RECEIPT).is_some())
        {
            return Err("retired historical claim cannot be registered or refreshed".into());
        }
    }
    for item in request
        .get("item")
        .into_iter()
        .chain(group["members"].as_array().into_iter().flatten())
    {
        if item["id"]
            .as_str()
            .and_then(|id| state.items.get(id))
            .and_then(groups::id)
            .and_then(|id| state.groups.get(id))
            .is_some_and(|group| group.get(RECEIPT).is_some())
        {
            return Err("retired historical member cannot be re-registered".into());
        }
    }
    Ok(())
}

fn single<'a>(state: &'a State, id: &str) -> Result<(&'a Value, &'a Value), String> {
    let group = state
        .groups
        .get(id)
        .ok_or("unknown claim lifecycle group")?;
    let members = group["members"]
        .as_array()
        .filter(|ids| ids.len() == 1)
        .ok_or("claim retirement requires single-member groups")?;
    let member_id = members[0].as_str().ok_or("invalid claim member id")?;
    let item = state.items.get(member_id).ok_or("claim member missing")?;
    if group["id"] != id
        || group["membership_complete"] != true
        || group["membership_source_format"] != "producer_registry_v1"
        || item["id"] != member_id
        || groups::id(item) != Some(id)
        || item["owner"] != group["owner"]
        || string(group, "owner")?.trim().is_empty()
        || state
            .items
            .values()
            .filter(|item| groups::id(item) == Some(id))
            .count()
            != 1
    {
        return Err("claim retirement requires exact complete producer inverse membership".into());
    }
    for object in [group, item] {
        if object
            .get("references")
            .is_some_and(|refs| !refs.as_array().is_some_and(Vec::is_empty))
            || object
                .get("retain_reason")
                .is_some_and(|reason| reason.as_str().is_none_or(|s| !s.is_empty()))
        {
            return Err("claim remains referenced or retained".into());
        }
    }
    if item["generated"] != true
        || item["protection_known"] != true
        || !item["references"].as_array().is_some_and(Vec::is_empty)
    {
        return Err("claim member ownership or protection is unknown".into());
    }
    Ok((group, item))
}

fn historical(state: &State, id: &str, config: &str) -> Result<Value, String> {
    let (group, item) = single(state, id)?;
    if group["cleanup_status"] != "deleted"
        || item["cleanup_status"] != "deleted"
        || item["remaining"] != false
    {
        return Err("historical claim is not a terminal native deletion".into());
    }
    let mut snapshot = groups::source_retirement_snapshot(state, id, config)?;
    snapshot["group"]
        .as_object_mut()
        .ok_or("invalid historical group")?
        .remove(RECEIPT);
    let decisions = snapshot["decisions"]
        .as_array()
        .ok_or("invalid claim decisions")?;
    if decisions.is_empty()
        || decisions.iter().any(|d| {
            d["id"] != item["id"]
                || d["lifecycle_group_id"] != id
                || d["decision"] != "delete"
                || d["status"] != "deleted"
                || d["remaining"] != false
                || d["group_status"] != "deleted"
                || d["token"].as_str().is_none_or(str::is_empty)
                || d["attempt_id"].as_str().is_none_or(str::is_empty)
                || ["error", "persistence_error", "observation_error"]
                    .iter()
                    .any(|key| d.get(*key).is_some_and(|v| !v.is_null()))
                || d.get("deletion").is_some_and(|deletion| {
                    deletion["status"] != "deleted"
                        || deletion["remaining"] != false
                        || deletion.get("error").is_some_and(|v| !v.is_null())
                })
        })
    {
        return Err(
            "historical claim has incomplete, conflicting or non-deletion native decisions".into(),
        );
    }
    Ok(snapshot)
}

fn pending_absent(root: &Path, source: &Path, id: &str, auth: Auth<'_>) -> Result<(), String> {
    let basename = format!("{:x}", Sha256::digest(id.as_bytes()));
    if paths::checked_metadata(root, &source.join(format!("{basename}.pending")), auth)?.is_some() {
        return Err("claim producer publication is pending".into());
    }
    Ok(())
}

/// Metadata-only root observation; no payload traversal or content measurement.
fn root_observation(root: &Path, path: &Path, auth: Auth<'_>) -> Result<Value, String> {
    let observation = paths::registered_observation(root, path, auth)?;
    if observation["presence"] != "present" || observation["identity"].is_null() {
        return Err("replacement root missing or physical identity unavailable".into());
    }
    Ok(observation)
}

/// A fresh, complete producer scan deliberately bypasses successful observation
/// caching. Omitted/unreadable records cannot hide inbound references or claims.
fn snapshot(
    root: &Path,
    config: &Config,
    config_identity: &str,
    state: &State,
    old: &str,
    replacement: &str,
    auth: Auth<'_>,
    ordinary_cleanup: bool,
) -> Result<Value, String> {
    if old == replacement {
        return Err("claim replacement must be a different group".into());
    }
    let historical = historical(state, old, config_identity)?;
    let (old_group, old_item) = single(state, old)?;
    let (new_group, new_item) = single(state, replacement)?;
    if old_group["owner"] == new_group["owner"]
        || new_group.get(RECEIPT).is_some()
        || new_group["cleanup_status"] == "deleted"
        || new_item["cleanup_status"] == "deleted"
        || new_item["cleanup_status"] == "pending"
        || new_item["remaining"] != true
        || new_item["identity"].as_str().is_none_or(str::is_empty)
        || !new_item["logical_bytes"].is_u64()
        || !new_item["measured_at_ms"].is_u64()
    {
        return Err(
            "replacement requires a different current owner and native cached measurement".into(),
        );
    }
    let target = paths::resolve(root, Path::new(string(new_item, "path")?))?;
    if paths::resolve(root, Path::new(string(old_item, "path")?))? != target {
        return Err("claim retirement requires the exact same canonical path".into());
    }
    for group in state.groups.values() {
        if let Some(source) = group["membership_source"].as_str() {
            let source = paths::resolve(root, Path::new(source))?;
            if paths::within(&target, &source) || paths::within(&source, &target) {
                return Err("claim overlaps protected membership source evidence".into());
            }
        }
    }
    // Reuse ordinary policy without obtaining a related-item review (which is
    // precisely the historical overlap this operation is permitted to retire).
    let review = crate::review_single(
        root,
        config,
        config_identity,
        state,
        new_item,
        auth,
        false,
        crate::Verification::Registered,
        None,
    )?;
    if !review["blockers"].as_array().is_some_and(Vec::is_empty) {
        return Err("replacement member remains protected by ordinary policy".into());
    }
    for (id, item) in &state.items {
        if item["id"] == old_item["id"] || item["id"] == new_item["id"] {
            continue;
        }
        let path = Path::new(string(item, "path")?);
        if paths::within(&target, path) || paths::within(path, &target) {
            return Err(format!("third registered claim overlaps replacement: {id}"));
        }
    }
    for (id, group, item) in [
        (old, old_group, old_item),
        (replacement, new_group, new_item),
    ] {
        if ordinary_cleanup && id == old && auth.reservations.borrow().contains_key(old) {
            return Err("historical claim has an owning reservation".into());
        }
        crate::reservations::check_group(root, id, auth)?;
        if !ordinary_cleanup {
            let mut claim = group.clone();
            claim["members"] = json!([item]);
            crate::reservations::check_record_mutation(root, id, Some(&claim), auth)?;
        }
    }
    // During ordinary apply, only its exact native-owned replacement reservation
    // may survive check_group + the source observation fence. Foreign, unknown
    // and overlapping reservations still fail through the existing reader owner.
    crate::reservations::check_reader_paths(root, std::slice::from_ref(&target), auth)?;
    let old_source = paths::resolve(root, Path::new(string(old_group, "membership_source")?))?;
    let new_source = paths::resolve(root, Path::new(string(new_group, "membership_source")?))?;
    let mut catalogs = BTreeMap::new();
    for source in [&old_source, &new_source] {
        if !catalogs.contains_key(source) {
            catalogs.insert(
                source.clone(),
                crate::registry::retirement_records(root, source, auth)?,
            );
        }
    }
    let basename = format!("{:x}", Sha256::digest(old.as_bytes()));
    if paths::checked_metadata(root, &old_source.join(format!("{basename}.json")), auth)?.is_some()
        || catalogs.values().any(|records| records.contains_key(old))
    {
        return Err("historical producer source still exists".into());
    }
    pending_absent(root, &old_source, old, auth)?;
    pending_absent(root, &new_source, replacement, auth)?;
    for (source, records) in &catalogs {
        for (id, record) in records {
            if record["references"].as_array().is_none_or(|refs| {
                refs.iter()
                    .any(|reference| reference["id"] == old || reference["id"] == replacement)
            }) {
                return Err("claim producer has inbound or unknown references".into());
            }
            if id == replacement {
                if source != &new_source {
                    return Err("replacement producer id is claimed by another catalog".into());
                }
                continue;
            }
            if crate::registry::validate(root, record)?
                .iter()
                .any(|path| paths::within(path, &target) || paths::within(&target, path))
            {
                return Err("third producer path claim overlaps replacement".into());
            }
        }
    }
    let items = BTreeMap::from([(string(new_item, "id")?.to_owned(), new_item.clone())]);
    let observed = crate::registry::observe(root, &new_source, new_group, &items, auth)?;
    let owner = &observed["owner"];
    let actual_owner = catalogs[&new_source]
        .get(replacement)
        .ok_or("replacement source missing")?;
    let producer_members = owner["members"]
        .as_array()
        .filter(|members| members.len() == 1)
        .ok_or("replacement producer requires one explicit generated member")?;
    if owner != actual_owner
        || observed["status"] != "measured"
        || observed["settled"] != true
        || observed["membership_matches"] != true
        || !observed["blockers"].as_array().is_some_and(Vec::is_empty)
        || !observed["references"].as_array().is_some_and(Vec::is_empty)
        || !owner["references"].as_array().is_some_and(Vec::is_empty)
        || producer_members[0]["generated"] != true
        || producer_members[0]["protection_known"] != true
        || owner["generation"].is_null()
        || observed["identity"] != new_group["membership_source_identity"]
    {
        return Err(
            "replacement producer generation, source identity or protection changed".into(),
        );
    }
    let physical = root_observation(root, &target, auth)?;
    // Fresh closing reads also cover changes made by authorizer callbacks.
    for (source, records) in &catalogs {
        if crate::registry::retirement_records(root, source, auth)? != *records {
            return Err("claim producer catalog changed while observing".into());
        }
    }
    pending_absent(root, &old_source, old, auth)?;
    pending_absent(root, &new_source, replacement, auth)?;
    if root_observation(root, &target, auth)? != physical {
        return Err("replacement physical root changed while observing".into());
    }
    Ok(
        json!({"historical":historical,"replacement_group":new_group,"replacement_item":new_item,
        "replacement_source":observed,"replacement_root":physical}),
    )
}

fn evidence(
    root: &Path,
    reference: &str,
    sha256: &str,
    auth: Auth<'_>,
) -> Result<(Value, String), String> {
    if sha256.len() != 64
        || !sha256
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err("claim retirement requires an exact lowercase evidence SHA256".into());
    }
    let identity = crate::retirement::read_evidence(root, reference, auth)?;
    let path = paths::resolve(root, Path::new(reference))?;
    auth(&path, AccessMode::Read)?;
    let mut bytes = Vec::new();
    std::fs::File::open(&path)
        .map_err(|e| e.to_string())?
        .take(1_048_577)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 1_048_576
        || format!("{:x}", Sha256::digest(&bytes)) != sha256
        || hash(&bytes)? != identity
        || crate::retirement::read_evidence(root, reference, auth)? != identity
    {
        return Err("claim retirement evidence changed or SHA256 mismatch".into());
    }
    Ok((
        serde_json::from_slice(&bytes).map_err(|e| e.to_string())?,
        identity,
    ))
}

pub(crate) fn retire(
    root: &Path,
    config: &Config,
    config_identity: &str,
    descriptor: &Value,
    state: &mut State,
    auth: Auth<'_>,
) -> Result<Value, String> {
    let request: Request = serde_json::from_value(descriptor.clone()).map_err(|e| e.to_string())?;
    if !["review", "apply"].contains(&request.mode.as_str())
        || request.scope != SCOPE
        || request.reason.trim().is_empty()
    {
        return Err("invalid claim retirement mode, scope or reason".into());
    }
    let old = &request.historical_group_id;
    let replacement = &request.replacement_group_id;
    if state
        .groups
        .get(old)
        .is_some_and(|group| group.get(RECEIPT).is_some())
    {
        return Err("historical claim retirement is permitted only once".into());
    }
    let current = snapshot(
        root,
        config,
        config_identity,
        state,
        old,
        replacement,
        auth,
        false,
    )?;
    let required = json!({"schema":1,"scope":SCOPE,"user_authorized":true,
        "historical_group_id":old,"replacement_group_id":replacement,"reason":request.reason,
        "meaning":"historical logical path claim only; no historical physical generation assertion",
        "expected_snapshot":current,"native_delete_decisions":current["historical"]["decisions"]});
    if request.mode == "review" {
        if request.expected_snapshot.is_some()
            || request.evidence_ref.is_some()
            || request.evidence_sha256.is_some()
        {
            return Err("claim review accepts no apply evidence or expected snapshot".into());
        }
        return Ok(
            json!({"mode":"review","scope":SCOPE,"expected_snapshot":current,
            "required_evidence":required,"payload_changed":false}),
        );
    }
    if request.expected_snapshot.as_ref() != Some(&current) {
        return Err("claim retirement snapshot changed; fresh review required".into());
    }
    let reference = request
        .evidence_ref
        .as_deref()
        .ok_or("missing claim evidence_ref")?;
    let sha256 = request
        .evidence_sha256
        .as_deref()
        .ok_or("missing claim evidence_sha256")?;
    let (proof, identity) = evidence(root, reference, sha256, auth)?;
    if proof != required {
        return Err("evidence must preserve exact native history, snapshot and user-authorized logical retirement".into());
    }
    if snapshot(
        root,
        config,
        config_identity,
        state,
        old,
        replacement,
        auth,
        false,
    )? != current
        || evidence(root, reference, sha256, auth)?.1 != identity
    {
        return Err("claim retirement inputs changed before commit".into());
    }
    let config_path = root.join("project-maintenance.json");
    paths::check(root, &config_path, auth)?;
    auth(&config_path, AccessMode::Read)?;
    if hash(&std::fs::read(config_path).map_err(|e| e.to_string())?)? != config_identity {
        return Err("claim retirement config changed before commit".into());
    }
    if root_observation(
        root,
        Path::new(string(&current["replacement_item"], "path")?),
        auth,
    )? != current["replacement_root"]
    {
        return Err("replacement root changed before claim retirement commit".into());
    }
    let receipt = json!({"schema":1,"scope":SCOPE,"historical_group_id":old,
        "replacement_group_id":replacement,"reason":request.reason,"expected_snapshot":current,
        "evidence_ref":reference,"evidence_sha256":sha256,"evidence_identity":identity,
        "retired_at_ms":now_ms()?,"meaning":required["meaning"],
        "pin_meanings":{"replacement_item.identity":"native registered content measurement; not physical identity",
            "replacement_root.identity":"current physical root identity only"}});
    state
        .groups
        .get_mut(old)
        .ok_or("historical group disappeared")?[RECEIPT] = receipt.clone();
    Ok(
        json!({"mode":"apply","scope":SCOPE,"claim_retired":true,"receipt":receipt,"payload_changed":false}),
    )
}

/// Revalidate every dynamic pin even when relation and token inputs were reused.
/// This is directional: a retired old claim cannot authorize old-item cleanup.
pub(crate) fn pair(
    root: &Path,
    config: &Config,
    config_identity: &str,
    state: &State,
    item: &Value,
    other: &Value,
    auth: Auth<'_>,
) -> Result<Option<Value>, String> {
    let Some(old) = groups::id(other) else {
        return Ok(None);
    };
    let Some(receipt) = state.groups.get(old).and_then(|group| group.get(RECEIPT)) else {
        return Ok(None);
    };
    let Some(replacement) = groups::id(item) else {
        return Ok(None);
    };
    if receipt["replacement_group_id"] != replacement
        || receipt["expected_snapshot"]["replacement_item"]["id"] != item["id"]
    {
        return Ok(None);
    }
    if receipt["scope"] != SCOPE || receipt["historical_group_id"] != old || receipt["schema"] != 1
    {
        return Err("invalid historical claim retirement receipt".into());
    }
    let mut current = snapshot(
        root,
        config,
        config_identity,
        state,
        old,
        replacement,
        auth,
        true,
    )?;
    // A global revision necessarily advances when the receipt is committed.
    // All scoped group/member/decision/config/source/root values remain exact.
    current["historical"]["revision"] =
        receipt["expected_snapshot"]["historical"]["revision"].clone();
    if current != receipt["expected_snapshot"] {
        return Err("historical claim retirement pins changed; exception invalid".into());
    }
    let (_, identity) = evidence(
        root,
        string(receipt, "evidence_ref")?,
        string(receipt, "evidence_sha256")?,
        auth,
    )?;
    if identity != string(receipt, "evidence_identity")? {
        return Err("historical claim retirement evidence changed".into());
    }
    Ok(Some(
        json!({"historical_claim_retirement":receipt,"current_pins":current,"evidence_identity":identity}),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    struct Fixture {
        _directory: tempfile::TempDir,
        root: PathBuf,
        state: State,
        record: Value,
    }

    impl Fixture {
        fn new() -> Self {
            let directory = tempfile::tempdir().unwrap();
            let root = dunce::canonicalize(directory.path()).unwrap();
            let source = root.join("artifacts/maintenance/lifecycles");
            let target = root.join("artifacts/cache/owned");
            std::fs::create_dir_all(&source).unwrap();
            std::fs::create_dir_all(&target).unwrap();
            std::fs::create_dir_all(root.join("artifacts/maintenance/evidence")).unwrap();
            std::fs::write(target.join("payload"), b"unchanged payload").unwrap();
            let config_bytes =
                serde_json::to_vec(&json!({"schema_version":1,"project_id":"claim-test",
                "managed_roots":["artifacts/cache"],"bundles":[]}))
                .unwrap();
            std::fs::write(root.join("project-maintenance.json"), &config_bytes).unwrap();
            let allow = |_: &Path, _: AccessMode| Ok(());
            let context = crate::Context::new(&allow);
            let measured = paths::measure(&root, &target, &context).unwrap();
            let mut state = State::default();
            for (id, owner, member) in [
                ("old", "historical-owner", "old-item"),
                ("new", "replacement-owner", "new-item"),
            ] {
                state.groups.insert(id.into(), json!({"id":id,"owner":owner,"kind":"work","version":"v1",
                    "membership_complete":true,"members":[member],"provenance_ref":"original provenance",
                    "membership_source":source,"membership_source_format":"producer_registry_v1",
                    "membership_source_identity":"historical-source-identity","references":[]}));
                state.items.insert(member.into(), json!({"id":member,"owner":owner,"kind":"cache","role":"cache",
                    "lifecycle_role":"artifact","lifecycle_group_id":id,"path":target,"generated":true,
                    "protection_known":true,"references":[],"presence":"present","remaining":true,
                    "identity":measured["identity"],"logical_bytes":measured["logical_bytes"],
                    "measured_at_ms":1,"registered_at_ms":1,"source_path":null}));
            }
            state.groups.get_mut("old").unwrap()["cleanup_status"] = json!("deleted");
            state.items.get_mut("old-item").unwrap()["cleanup_status"] = json!("deleted");
            state.items.get_mut("old-item").unwrap()["remaining"] = json!(false);
            state.decisions.push(json!({"id":"old-item","lifecycle_group_id":"old","decision":"delete",
                "status":"deleted","remaining":false,"group_status":"deleted","attempt_id":"original-attempt",
                "token":"original-token","deletion":{"status":"deleted","remaining":false,"error":null}}));
            let record = json!({"schema":1,"id":"new","owner":"replacement-owner","kind":"work","version":"v1",
                "generation":"generation-one","revision":1,"state":"complete","membership_complete":true,
                "members":[{"path":target,"role":"cache","generated":true,"protection_known":true}],"references":[]});
            let mut fixture = Self {
                _directory: directory,
                root,
                state,
                record,
            };
            fixture.write_record();
            let items =
                BTreeMap::from([("new-item".into(), fixture.state.items["new-item"].clone())]);
            let observed = crate::registry::observe(
                &fixture.root,
                &source,
                &fixture.state.groups["new"],
                &items,
                &context,
            )
            .unwrap();
            fixture.state.groups.get_mut("new").unwrap()["membership_source_identity"] =
                observed["identity"].clone();
            fixture.save();
            fixture
        }
        fn manifest(&self) -> PathBuf {
            self.root.join("artifacts/maintenance/manifest.json")
        }
        fn target(&self) -> PathBuf {
            self.root.join("artifacts/cache/owned")
        }
        fn source(&self) -> PathBuf {
            self.root.join("artifacts/maintenance/lifecycles")
        }
        fn save(&self) {
            std::fs::write(self.manifest(), serde_json::to_vec(&self.state).unwrap()).unwrap();
        }
        fn write_record(&self) {
            std::fs::write(
                self.source().join("new.json"),
                serde_json::to_vec(&self.record).unwrap(),
            )
            .unwrap();
        }
        fn descriptor(&self) -> Value {
            json!({"mode":"review","scope":SCOPE,"historical_group_id":"old",
            "replacement_group_id":"new","reason":"User-authorized historical logical claim retirement"})
        }
        fn dispatch(&self, request: Value) -> Result<Value, String> {
            crate::dispatch(&self.root, request, &|_, _| Ok(()))
        }
        fn review(&self) -> Value {
            let bytes = std::fs::read(self.manifest()).unwrap();
            let result = self
                .dispatch(json!({"operation":"register","retire_deleted_claim":self.descriptor()}))
                .unwrap();
            assert_eq!(
                std::fs::read(self.manifest()).unwrap(),
                bytes,
                "review must not write state"
            );
            result
        }
        fn apply_descriptor(&self, review: &Value) -> Value {
            let bytes = serde_json::to_vec(&review["required_evidence"]).unwrap();
            std::fs::write(
                self.root.join("artifacts/maintenance/evidence/claim.json"),
                &bytes,
            )
            .unwrap();
            let mut descriptor = self.descriptor();
            descriptor["mode"] = json!("apply");
            descriptor["expected_snapshot"] = review["expected_snapshot"].clone();
            descriptor["evidence_ref"] = json!("artifacts/maintenance/evidence/claim.json");
            descriptor["evidence_sha256"] = json!(format!("{:x}", Sha256::digest(bytes)));
            descriptor
        }
        fn retire(&self) {
            let descriptor = self.apply_descriptor(&self.review());
            assert_eq!(
                self.dispatch(json!({"operation":"register","retire_deleted_claim":descriptor}))
                    .unwrap()["claim_retired"],
                true
            );
        }
        fn current_state(&self) -> State {
            serde_json::from_slice(&std::fs::read(self.manifest()).unwrap()).unwrap()
        }
        fn register_absent_replacement(&self) -> Value {
            let state = self.current_state();
            let mut group = state.groups["new"].clone();
            group["members"] = json!([state.items["new-item"]]);
            self.dispatch(json!({"operation":"register","group":group}))
                .unwrap()
        }
    }

    // Retained because future changes to overlap handling or metadata register
    // routes could accidentally broaden this exact, directional exception.
    #[test]
    fn public_dispatch_retires_only_logical_claim_and_preserves_native_history() {
        let f = Fixture::new();
        let before = f
            .dispatch(json!({"operation":"review","group_ids":["new"]}))
            .unwrap();
        assert!(
            !before["items"][0]["blockers"]
                .as_array()
                .unwrap()
                .is_empty()
        );
        let review = f.review();
        let descriptor = f.apply_descriptor(&review);
        let payload = f.target().join("payload");
        let deny_payload = |path: &Path, _: AccessMode| {
            if path == payload {
                Err("payload access forbidden during logical retirement".into())
            } else {
                Ok(())
            }
        };
        crate::dispatch(
            &f.root,
            json!({"operation":"register","retire_deleted_claim":descriptor.clone()}),
            &deny_payload,
        )
        .unwrap();
        let saved = f.current_state();
        assert_eq!(saved.items, f.state.items);
        assert_eq!(saved.decisions, f.state.decisions);
        assert_eq!(saved.runs, f.state.runs);
        assert_eq!(saved.groups["new"], f.state.groups["new"]);
        let mut historical = saved.groups["old"].clone();
        assert!(
            historical
                .as_object_mut()
                .unwrap()
                .remove(RECEIPT)
                .is_some()
        );
        assert_eq!(historical, f.state.groups["old"]);
        assert_eq!(std::fs::read(payload).unwrap(), b"unchanged payload");
        let after = f
            .dispatch(json!({"operation":"review","group_ids":["new"]}))
            .unwrap();
        assert_eq!(after["items"][0]["blockers"], json!([]));
        assert_ne!(before["items"][0]["token"], after["items"][0]["token"]);
        let old = f
            .dispatch(json!({"operation":"review","group_ids":["old"]}))
            .unwrap();
        assert!(!old["items"][0]["blockers"].as_array().unwrap().is_empty());
        let bytes = std::fs::read(f.manifest()).unwrap();
        assert!(
            f.dispatch(json!({"operation":"register","retire_deleted_claim":descriptor}))
                .is_err()
        );
        assert!(
            f.dispatch(json!({"operation":"register","refresh_group":{"id":"old"}}))
                .is_err()
        );
        assert!(
            f.dispatch(json!({"operation":"register","group":saved.groups["old"]}))
                .is_err()
        );
        assert_eq!(std::fs::read(f.manifest()).unwrap(), bytes);
    }

    #[test]
    fn public_dispatch_coordinated_descriptor_binds_exact_admission_scopes() {
        let f = Fixture::new();
        let allow = |_: &Path, _: AccessMode| Ok(());
        let context = crate::Context::new(&allow);
        let mut request = json!({"operation":"register","retire_deleted_claim":f.descriptor(),
            "coordination":{"session_id":"claim-test","request_id":"claim-review","wait_ms":60000}});
        let scopes = crate::admission::scopes(&f.root, &request, &f.state, &context).unwrap();
        assert_eq!(scopes.len(), 3);
        assert!(scopes.iter().all(|scope| !scope.exclusive));
        let review = f.dispatch(request.clone()).unwrap();
        let descriptor = f.apply_descriptor(&review);
        request["retire_deleted_claim"] = descriptor;
        request["coordination"]["request_id"] = json!("claim-apply");
        let scopes = crate::admission::scopes(&f.root, &request, &f.state, &context).unwrap();
        assert_eq!(scopes.len(), 4);
        assert_eq!(scopes.iter().filter(|scope| scope.exclusive).count(), 3);
        assert_eq!(f.dispatch(request).unwrap()["claim_retired"], true);
    }

    #[test]
    fn ordinary_public_apply_accepts_only_its_verified_replacement_reservation() {
        let f = Fixture::new();
        f.retire();
        let review = f
            .dispatch(json!({"operation":"review","group_ids":["new"]}))
            .unwrap();
        let applied = f.dispatch(json!({"operation":"apply","verification":"registered",
            "decisions":[{"id":"new-item","token":review["items"][0]["token"],
                "decision":"delete","reason":"Delete only the current fixture payload after fresh review"}]})).unwrap();
        assert_eq!(applied["results"][0]["status"], "deleted");
        assert_eq!(applied["results"][0]["remaining"], false);
        assert!(!f.target().exists());
        let saved = f.current_state();
        assert_eq!(saved.items["old-item"], f.state.items["old-item"]);
        assert_eq!(saved.decisions[0], f.state.decisions[0]);
        assert_eq!(saved.groups["old"]["cleanup_status"], "deleted");
        assert!(saved.groups["old"].get(RECEIPT).is_some());
        let fresh = f
            .dispatch(json!({"operation":"review","group_ids":["new"]}))
            .unwrap();
        assert_eq!(fresh["items"], json!([]));
        let registered = f.register_absent_replacement();
        assert_eq!(registered["items"][0]["presence"], "absent");
        let absent = f
            .dispatch(json!({"operation":"review","group_ids":["new"]}))
            .unwrap();
        assert_eq!(absent["items"][0]["presence"], "absent");
        assert_eq!(absent["items"][0]["remaining"], false);
        assert_eq!(absent["items"][0]["blockers"], json!([]));
    }

    #[test]
    fn public_register_and_review_reconcile_absent_source_after_fixture_archive_rename() {
        let f = Fixture::new();
        f.retire();
        let before = f.current_state();
        let archived = f.root.join("artifacts/cache/archived-owned");
        std::fs::rename(f.target(), &archived).unwrap();
        assert!(!f.target().exists());
        let registered = f.register_absent_replacement();
        assert_eq!(registered["items"][0]["presence"], "absent");
        let review = f
            .dispatch(json!({"operation":"review","group_ids":["new"]}))
            .unwrap();
        assert_eq!(review["items"][0]["root_observation"]["presence"], "absent");
        assert_eq!(review["items"][0]["remaining"], false);
        assert_eq!(review["items"][0]["blockers"], json!([]));
        let after = f.current_state();
        assert_eq!(after.groups["old"], before.groups["old"]);
        assert_eq!(after.items["old-item"], before.items["old-item"]);
        assert_eq!(after.decisions, before.decisions);
        assert_eq!(
            std::fs::read(archived.join("payload")).unwrap(),
            b"unchanged payload"
        );
    }

    #[test]
    fn public_dispatch_rejects_stale_proof_and_unsafe_claims_without_manifest_writes() {
        for case in [
            "sha",
            "snapshot",
            "authorization",
            "root",
            "missing",
            "generation",
            "refs",
            "inbound",
            "lease",
            "reservation",
            "old-source",
            "pending",
            "old-active",
            "old-error",
            "old-unknown",
            "incomplete",
            "multi",
            "same-owner",
            "third",
            "unknown-producer",
            "current-ownership",
        ] {
            let mut f = Fixture::new();
            let mut descriptor = f.apply_descriptor(&f.review());
            match case {
                "sha" => descriptor["evidence_sha256"] = json!("0".repeat(64)),
                "snapshot" => {
                    descriptor["expected_snapshot"]["historical"]["revision"] = json!(900)
                }
                "authorization" => {
                    let mut proof = f.review()["required_evidence"].clone();
                    proof["user_authorized"] = json!(false);
                    let bytes = serde_json::to_vec(&proof).unwrap();
                    std::fs::write(
                        f.root.join("artifacts/maintenance/evidence/claim.json"),
                        &bytes,
                    )
                    .unwrap();
                    descriptor["evidence_sha256"] = json!(format!("{:x}", Sha256::digest(bytes)));
                }
                "root" | "missing" => {
                    std::fs::rename(f.target(), f.root.join("artifacts/cache/prior-root")).unwrap();
                    if case == "root" {
                        std::fs::create_dir(f.target()).unwrap();
                    }
                }
                "generation" => {
                    f.record["generation"] = json!("generation-two");
                    f.write_record();
                }
                "refs" => {
                    f.record["references"] = json!([{"id":"consumer","reason":"still needed"}]);
                    f.write_record();
                }
                "inbound" => {
                    let mut consumer = f.record.clone();
                    consumer["id"] = json!("consumer");
                    consumer["members"][0]["path"] = json!(f.root.join("artifacts/cache/consumer"));
                    consumer["references"] = json!([{"id":"new","reason":"still needed"}]);
                    std::fs::write(
                        f.source().join("consumer.json"),
                        serde_json::to_vec(&consumer).unwrap(),
                    )
                    .unwrap();
                }
                "lease" => {
                    std::fs::write(f.source().join("catalog.lock"), b"unknown lease").unwrap();
                }
                "reservation" => {
                    let reservations = f.source().join("reservations");
                    std::fs::create_dir_all(&reservations).unwrap();
                    let name = format!("{}.json", hash(&"new").unwrap());
                    std::fs::write(reservations.join(name), b"unknown reservation").unwrap();
                }
                "old-source" => {
                    let mut old = f.record.clone();
                    old["id"] = json!("old");
                    std::fs::write(
                        f.source().join("old.json"),
                        serde_json::to_vec(&old).unwrap(),
                    )
                    .unwrap();
                }
                "pending" => {
                    let name = format!("{:x}.pending", Sha256::digest(b"new"));
                    std::fs::write(f.source().join(name), b"pending publication").unwrap();
                }
                "old-active" => {
                    f.state.groups.get_mut("old").unwrap()["cleanup_status"] = Value::Null
                }
                "old-error" => f.state.decisions[0]["error"] = json!("unresolved"),
                "old-unknown" => {
                    let mut d = f.state.decisions[0].clone();
                    d["status"] = json!("unknown");
                    f.state.decisions.push(d);
                }
                "incomplete" => {
                    f.state.groups.get_mut("old").unwrap()["membership_complete"] = json!(false)
                }
                "multi" => {
                    f.state.groups.get_mut("old").unwrap()["members"] =
                        json!(["old-item", "another"])
                }
                "same-owner" => {
                    f.state.groups.get_mut("new").unwrap()["owner"] = json!("historical-owner");
                    f.state.items.get_mut("new-item").unwrap()["owner"] = json!("historical-owner");
                }
                "third" => {
                    let mut item = f.state.items["new-item"].clone();
                    item["id"] = json!("third");
                    f.state.items.insert("third".into(), item);
                }
                "unknown-producer" => {
                    std::fs::write(
                        f.source().join("unknown.json"),
                        b"unreadable producer shape",
                    )
                    .unwrap();
                }
                "current-ownership" => {
                    f.state.items.get_mut("new-item").unwrap()["generated"] = json!(false)
                }
                _ => unreachable!(),
            }
            f.save();
            let bytes = std::fs::read(f.manifest()).unwrap();
            assert!(
                f.dispatch(json!({"operation":"register","retire_deleted_claim":descriptor}))
                    .is_err(),
                "accepted unsafe case: {case}"
            );
            assert_eq!(
                std::fs::read(f.manifest()).unwrap(),
                bytes,
                "rejection wrote manifest: {case}"
            );
        }
    }

    #[test]
    fn reused_review_plan_rechecks_physical_and_source_pins() {
        for case in [
            "root",
            "generation",
            "inbound-old",
            "evidence",
            "old-source",
            "old-native",
            "references",
        ] {
            let mut f = Fixture::new();
            f.retire();
            let mut state = f.current_state();
            let config_bytes = std::fs::read(f.root.join("project-maintenance.json")).unwrap();
            let config: Config = serde_json::from_slice(&config_bytes).unwrap();
            let config_identity = hash(&config_bytes).unwrap();
            let allow = |_: &Path, _: AccessMode| Ok(());
            let context = crate::Context::new(&allow);
            let batch = groups::batch(
                &f.root,
                &config,
                &config_identity,
                &state,
                "new",
                &context,
                crate::Verification::Registered,
            )
            .unwrap();
            let original = batch.initial().unwrap()["new-item"]["token"].clone();
            assert_eq!(
                batch
                    .current(
                        &f.root,
                        &config,
                        &config_identity,
                        &state,
                        &context,
                        "new-item"
                    )
                    .unwrap()["token"],
                original
            );
            match case {
                "root" => {
                    std::fs::rename(f.target(), f.root.join("artifacts/cache/prior-root")).unwrap();
                    std::fs::create_dir(f.target()).unwrap();
                }
                "generation" => {
                    f.record["generation"] = json!("generation-two");
                    f.write_record();
                }
                "inbound-old" => {
                    let mut consumer = f.record.clone();
                    consumer["id"] = json!("consumer");
                    consumer["members"][0]["path"] = json!(f.root.join("artifacts/cache/consumer"));
                    consumer["references"] =
                        json!([{"id":"old","reason":"dangling historical reference"}]);
                    std::fs::write(
                        f.source().join("consumer.json"),
                        serde_json::to_vec(&consumer).unwrap(),
                    )
                    .unwrap();
                }
                "evidence" => {
                    std::fs::write(
                        f.root.join("artifacts/maintenance/evidence/claim.json"),
                        b"changed evidence",
                    )
                    .unwrap();
                }
                "old-source" => {
                    let mut old = f.record.clone();
                    old["id"] = json!("old");
                    std::fs::write(
                        f.source().join("old.json"),
                        serde_json::to_vec(&old).unwrap(),
                    )
                    .unwrap();
                }
                "old-native" => {
                    state.decisions[0]["token"] = json!("rewritten-native-history");
                }
                "references" => {
                    state.items.get_mut("new-item").unwrap()["references"] =
                        json!(["new consumer"]);
                }
                _ => unreachable!(),
            }
            assert!(
                batch
                    .current(
                        &f.root,
                        &config,
                        &config_identity,
                        &state,
                        &context,
                        "new-item"
                    )
                    .is_err(),
                "reused plan ignored drift: {case}"
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn public_dispatch_rejects_linked_replacement_root() {
        let f = Fixture::new();
        let descriptor = f.apply_descriptor(&f.review());
        let prior = f.root.join("artifacts/cache/prior-root");
        std::fs::rename(f.target(), &prior).unwrap();
        std::os::unix::fs::symlink(prior, f.target()).unwrap();
        let bytes = std::fs::read(f.manifest()).unwrap();
        assert!(
            f.dispatch(json!({"operation":"register","retire_deleted_claim":descriptor}))
                .is_err()
        );
        assert_eq!(std::fs::read(f.manifest()).unwrap(), bytes);
    }

    #[cfg(windows)]
    #[test]
    fn public_dispatch_rejects_linked_replacement_root() {
        let f = Fixture::new();
        let descriptor = f.apply_descriptor(&f.review());
        let prior = f.root.join("artifacts/cache/prior-root");
        std::fs::rename(f.target(), &prior).unwrap();
        if let Err(error) = std::os::windows::fs::symlink_dir(prior, f.target()) {
            if error.kind() == std::io::ErrorKind::PermissionDenied
                || error.raw_os_error() == Some(1314)
            {
                eprintln!(
                    "SKIP linked-root fixture: Windows symlink creation privilege unavailable: {error}"
                );
                return;
            }
            panic!("linked-root fixture setup failed: {error}");
        }
        let bytes = std::fs::read(f.manifest()).unwrap();
        assert!(
            f.dispatch(json!({"operation":"register","retire_deleted_claim":descriptor}))
                .is_err()
        );
        assert_eq!(std::fs::read(f.manifest()).unwrap(), bytes);
    }
}
