//! Registration measures payload under a recoverable scope lease, not global locks.
use crate::{Auth, State, groups, hash, paths, registry, reservations, storage, string};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

fn root_stamp(root: &Path, path: &Path, auth: Auth<'_>) -> Result<Value, String> {
    let observation = paths::registered_observation(root, path, auth)?;
    let metadata = paths::checked_metadata(root, path, auth)?;
    Ok(
        json!({"object":observation,"metadata":metadata.map(|metadata| json!({
            "platform":paths::platform_identity(&metadata),"bytes":metadata.len(),
            "modified":metadata.modified().ok().and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok()).map(|value|value.as_nanos().to_string()),
            "readonly":metadata.permissions().readonly()
        }))}),
    )
}

pub(crate) fn prepare(
    root: &Path,
    request: &Value,
    state: &mut State,
    auth: Auth<'_>,
) -> Result<Value, String> {
    if request.get("group").is_some() {
        if request.get("item").is_some() {
            return Err("register accepts item or group, not both".into());
        }
        groups::register(root, request["group"].clone(), state, auth)
    } else {
        let mut item = request.get("item").cloned().ok_or("missing item")?;
        let id = string(&item, "id")?.to_owned();
        if item.get("lifecycle_group_id").is_some()
            || item.get("lifecycle_role").is_some()
            || state.groups.values().any(|group| {
                group["members"].as_array().is_some_and(|members| {
                    members
                        .iter()
                        .any(|member| member.as_str() == Some(id.as_str()))
                })
            })
            || state
                .items
                .get(&id)
                .is_some_and(|old| groups::id(old).is_some())
        {
            return Err("grouped members must be updated through group registration".into());
        }
        item = crate::prepare_item(root, item, auth)?;
        state.items.insert(id, item.clone());
        Ok(json!({"item":item}))
    }
}

pub(crate) fn register<'a>(
    root: &Path,
    config_identity: &str,
    request: &Value,
    store: &mut storage::Store<'a>,
    auth: Auth<'a>,
    catalog_locks: Vec<registry::CatalogLock<'a>>,
) -> Result<Value, String> {
    if auth.cancelled() {
        return Err("registration cancelled before measurement".into());
    }
    let before = store.state.clone();
    // Capture declared junction identities before observing member roots.
    for item in request["group"]["members"]
        .as_array()
        .into_iter()
        .flatten()
        .chain(request.get("item").into_iter())
    {
        if item.get("verified_junctions").is_some() {
            paths::configure_junctions(root, item, true, auth)?;
        }
    }
    let mut lease =
        reservations::ReservationSet::acquire_registration(root, request, &store.state, auth)?;
    let scope = lease
        .observed()
        .iter()
        .flat_map(|entry| {
            entry["fence"]["members"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|member| member["path"].as_str().map(PathBuf::from))
                .collect::<Vec<_>>()
        })
        .collect::<BTreeSet<_>>();
    let observed = scope
        .iter()
        .map(|path| Ok((path.clone(), root_stamp(root, path, auth)?)))
        .collect::<Result<BTreeMap<_, _>, String>>();
    // A failed preflight has not changed state or payload and can release safely.
    let observed = match observed {
        Ok(value) => value,
        Err(error) => {
            lease.release_registration(auth)?;
            return Err(error);
        }
    };
    drop(catalog_locks);
    store.suspend()?;
    let measured = prepare(root, request, &mut store.state, auth).and_then(|result| {
        if auth.cancelled() {
            return Err("registration cancelled before commit".into());
        }
        for (path, stamp) in &observed {
            if root_stamp(root, path, auth)? != *stamp {
                return Err("registration root changed during measurement".into());
            }
        }
        Ok(result)
    });
    if measured.is_err() {
        store.state = before.clone();
    }
    // Preserve lock ordering: reacquire maintenance first, then current catalogs.
    // CAS merge rejects same-identity changes and retains unrelated commits.
    store.resume()?;
    *auth.catalog.borrow_mut() = Default::default();
    // The merged state already contains the prepared source. Use the original
    // cohort here so a source switch still locks both old and incoming catalogs.
    let _catalog_locks = registry::lock_request(root, request, &before, auth)?;
    lease.verify(auth)?;
    let result = match measured {
        Ok(value) => value,
        Err(error) => {
            lease.release_registration(auth)?;
            return Err(error);
        }
    };
    let validation = (|| {
        let config_path = root.join("project-maintenance.json");
        paths::check(root, &config_path, auth)?;
        auth(&config_path, crate::AccessMode::Read)?;
        let bytes = std::fs::read(config_path).map_err(|error| error.to_string())?;
        if hash(&bytes)? != config_identity {
            return Err("project config changed during registration".into());
        }
        reservations::check_request(root, request, &store.state, auth)?;
        for (path, stamp) in &observed {
            if root_stamp(root, path, auth)? != *stamp {
                return Err("registration root changed before commit".into());
            }
        }
        if let Some(group) = result.get("group") {
            if group["membership_source_format"] == "producer_registry_v1" {
                let items = result["items"]
                    .as_array()
                    .ok_or("missing prepared items")?
                    .iter()
                    .map(|item| Ok((string(item, "id")?.to_owned(), item.clone())))
                    .collect::<Result<BTreeMap<_, _>, String>>()?;
                if groups::source_measurement(root, group, &items, auth)?["identity"]
                    != group["membership_source_identity"]
                {
                    return Err("registration producer source changed before commit".into());
                }
            }
        }
        if auth.cancelled() {
            return Err("registration cancelled before commit".into());
        }
        Ok(())
    })();
    if let Err(error) = validation {
        // No save has been attempted; prepared local state is discarded on return.
        lease.release_registration(auth)?;
        return Err(error);
    }
    // A failed/unknown save retains the durable scope for explicit recovery.
    store.save(auth)?;
    lease.release_registration(auth)?;
    Ok(result)
}
