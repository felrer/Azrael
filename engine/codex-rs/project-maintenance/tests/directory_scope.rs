//! Prevent later fast-path edits from silently broadening an exact approval or
//! discarding runtime permissions, root identity, and durable failure evidence.
use azrael_project_maintenance::{AccessMode, dispatch};
use serde_json::{Value, json};
use std::fs;
use std::path::Path;
use tempfile::TempDir;

fn allow(_: &Path, _: AccessMode) -> Result<(), String> {
    Ok(())
}

fn fixture() -> TempDir {
    let root = tempfile::tempdir().unwrap();
    fs::write(
        root.path().join("project-maintenance.json"),
        serde_json::to_vec(&json!({
            "schema_version":1,"project_id":"directory-scope","managed_roots":["generated"],
            "protected_paths":["protected"],"bundles":[]
        }))
        .unwrap(),
    )
    .unwrap();
    fs::create_dir(root.path().join("ordinary")).unwrap();
    fs::write(root.path().join("ordinary/original"), "original").unwrap();
    root
}

fn item(path: &str) -> Value {
    json!({"id":"folder","path":path,"kind":"directory","owner":"explicit-user-approval",
        "generated":false,"protection_known":true,"references":[],
        "deletion_scope":"entire_directory"})
}

fn call(root: &TempDir, request: Value) -> Value {
    dispatch(root.path(), request, &allow).unwrap()
}

fn register(root: &TempDir, item: Value) -> Value {
    call(root, json!({"operation":"register","item":item}))["item"].clone()
}

fn review(root: &TempDir) -> Value {
    call(
        root,
        json!({"operation":"review","ids":["folder"],"verification":"directory"}),
    )["items"][0]
        .clone()
}

fn choice(review: &Value) -> Value {
    json!({"operation":"apply","verification":"directory","decisions":[{
        "id":"folder","token":review["token"],"decision":"delete", "reason":"explicit approval of entire folder"}]})
}

#[test]
fn ordinary_folder_approval_includes_later_contents_without_content_measurement() {
    let root = fixture();
    let registered = register(&root, item("ordinary"));
    assert_eq!(registered["generated"], false);
    assert_eq!(registered["payload_bytes_measured"], false);
    let approved = review(&root);
    assert_eq!(approved["verification"], "directory");
    assert_eq!(approved["blockers"], json!([]));
    fs::write(
        root.path().join("ordinary/original"),
        "changed after approval",
    )
    .unwrap();
    fs::create_dir(root.path().join("ordinary/later")).unwrap();
    fs::write(root.path().join("ordinary/later/new"), "also included").unwrap();
    assert_eq!(review(&root)["token"], approved["token"]);
    let result = call(&root, choice(&approved));
    assert_eq!(result["results"][0]["status"], "deleted", "{result}");
    assert_eq!(result["results"][0]["remaining"], false);
    assert_eq!(result["results"][0]["deletion"]["attributes"], json!([]));
    assert!(!root.path().join("ordinary").exists());
}

#[test]
fn external_directory_requires_explicit_scope_and_retains_runtime_permissions() {
    let root = fixture();
    let external = tempfile::tempdir().unwrap();
    let path = fs::canonicalize(external.path()).unwrap().join("folder");
    fs::create_dir(&path).unwrap();
    fs::write(path.join("outside-project"), "approved external content").unwrap();
    let mut exact = item(path.to_str().unwrap());
    exact.as_object_mut().unwrap().remove("deletion_scope");
    exact["generated"] = json!(true);
    assert!(
        dispatch(
            root.path(),
            json!({"operation":"register","item":exact}),
            &allow
        )
        .is_err()
    );
    let registration = item(path.to_str().unwrap());
    assert!(
        dispatch(
            root.path(),
            json!({"operation":"register","item":registration}),
            &|entry, _| {
                if entry == path {
                    Err("external access denied".into())
                } else {
                    Ok(())
                }
            }
        )
        .is_err()
    );
    register(&root, item(path.to_str().unwrap()));
    let approved = review(&root);
    assert_eq!(approved["blockers"], json!([]), "{approved}");
    fs::write(path.join("later"), "also approved").unwrap();
    let result = call(&root, choice(&approved));
    assert_eq!(result["results"][0]["status"], "deleted", "{result}");
    assert_eq!(result["results"][0]["remaining"], false);
    assert!(!path.exists());
    assert!(root.path().join("ordinary/original").exists());
}

#[test]
fn root_replacement_invalidates_the_whole_directory_approval() {
    let root = fixture();
    register(&root, item("ordinary"));
    let approved = review(&root);
    fs::rename(
        root.path().join("ordinary"),
        root.path().join("original-folder"),
    )
    .unwrap();
    fs::create_dir(root.path().join("ordinary")).unwrap();
    fs::write(root.path().join("ordinary/replacement"), "preserve").unwrap();
    let result = call(&root, choice(&approved));
    assert_eq!(result["results"][0]["status"], "blocked", "{result}");
    assert_eq!(
        fs::read_to_string(root.path().join("ordinary/replacement")).unwrap(),
        "preserve"
    );
    assert!(root.path().join("original-folder/original").exists());
}

#[test]
fn explicit_scope_cannot_discard_references_or_protected_paths() {
    for (path, extra) in [
        ("ordinary", json!({"references":["active reader"]})),
        ("ordinary", json!({"protection_known":false})),
        ("protected", json!({})),
    ] {
        let root = fixture();
        if path == "protected" {
            fs::create_dir(root.path().join(path)).unwrap();
        }
        let mut registration = item(path);
        for (key, value) in extra.as_object().unwrap() {
            registration[key] = value.clone();
        }
        register(&root, registration);
        let observed = review(&root);
        assert!(!observed["blockers"].as_array().unwrap().is_empty());
        let result = call(&root, choice(&observed));
        assert_eq!(result["results"][0]["status"], "blocked", "{result}");
        assert!(root.path().join(path).exists());
    }
}

#[test]
fn permission_denial_is_enforced_on_descendants_during_whole_deletion() {
    let root = fixture();
    register(&root, item("ordinary"));
    let approved = review(&root);
    let result = dispatch(root.path(), choice(&approved), &|path, mode| {
        if path.file_name().is_some_and(|name| name == "original")
            && matches!(mode, AccessMode::Write)
        {
            Err("fixture descendant write denied".into())
        } else {
            Ok(())
        }
    })
    .unwrap();
    assert_eq!(result["results"][0]["status"], "failed", "{result}");
    assert_eq!(result["results"][0]["remaining"], true);
    assert!(
        result["results"][0]["deletion"]["error"]
            .as_str()
            .unwrap()
            .contains("write denied")
    );
    assert_eq!(
        fs::read_to_string(root.path().join("ordinary/original")).unwrap(),
        "original"
    );
}

#[test]
fn approval_modes_are_explicit_and_cannot_be_cross_used() {
    let root = fixture();
    register(&root, item("ordinary"));
    assert!(
        dispatch(
            root.path(),
            json!({"operation":"review","ids":["folder"],"verification":"full"}),
            &allow
        )
        .is_err()
    );
    let approved = review(&root);
    let mut wrong = choice(&approved);
    wrong["verification"] = json!("full");
    assert!(dispatch(root.path(), wrong, &allow).is_err());
    assert!(root.path().join("ordinary/original").exists());
    let mut unknown = item("ordinary");
    unknown["deletion_scope"] = json!("anything");
    assert!(
        dispatch(
            root.path(),
            json!({"operation":"register","item":unknown}),
            &allow
        )
        .is_err()
    );
    assert!(
        dispatch(
            root.path(),
            json!({"operation":"register","item":item("ordinary/original")}),
            &allow
        )
        .is_err()
    );
}

#[cfg(windows)]
#[test]
fn readonly_hardlink_failure_never_changes_the_external_file_attributes() {
    let root = fixture();
    let original = root.path().join("ordinary/original");
    let outside = root.path().join("outside");
    fs::hard_link(&original, &outside).unwrap();
    let mut permissions = fs::metadata(&original).unwrap().permissions();
    permissions.set_readonly(true);
    fs::set_permissions(&original, permissions).unwrap();
    register(&root, item("ordinary"));
    let approved = review(&root);
    let result = call(&root, choice(&approved));
    assert_eq!(result["results"][0]["status"], "failed", "{result}");
    assert!(fs::metadata(&outside).unwrap().permissions().readonly());
    assert_eq!(fs::read_to_string(&outside).unwrap(), "original");
    // Restore this fixture-owned shared attribute for ordinary fixture cleanup.
    let mut permissions = fs::metadata(&outside).unwrap().permissions();
    permissions.set_readonly(false);
    fs::set_permissions(&outside, permissions).unwrap();
}
