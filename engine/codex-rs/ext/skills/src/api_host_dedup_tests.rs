use std::sync::Arc;

use codex_protocol::protocol::SkillScope;
use codex_skills::SkillMetadata;
use codex_utils_absolute_path::AbsolutePathBuf;
use codex_utils_path_uri::PathUri;

use super::hide_duplicate_host_prompts;
use crate::HostSkillsSnapshot;
use crate::SkillLoadOutcome;
use crate::catalog::SkillCatalog;
use crate::provider::HostSkillProvider;
use crate::provider::SkillListQuery;
use crate::provider::SkillProvider;
use crate::provider::SkillReadContext;
use crate::provider::SkillReadRequest;

type TestResult = Result<(), Box<dyn std::error::Error>>;

fn fixture() -> Result<(tempfile::TempDir, HostSkillsSnapshot), Box<dyn std::error::Error>> {
    let temp = tempfile::tempdir()?;
    let mut outcome = SkillLoadOutcome::default();
    for root in ["first-root", "second-root"] {
        let path = temp.path().join(root).join("demo/SKILL.md");
        std::fs::create_dir_all(path.parent().ok_or("missing parent")?)?;
        std::fs::write(
            &path,
            "---\nname: demo\ndescription: Demo.\n---\nInstructions\n",
        )?;
        outcome.skills.push(SkillMetadata {
            name: "demo".to_string(),
            description: "Demo.".to_string(),
            short_description: None,
            interface: None,
            dependencies: None,
            policy: None,
            path_to_skills_md: PathUri::from_abs_path(&AbsolutePathBuf::try_from(path)?),
            scope: SkillScope::User,
            plugin_id: None,
            remote_plugin_id: None,
        });
    }
    Ok((temp, HostSkillsSnapshot::new(Arc::new(outcome))))
}

async fn catalog(
    snapshot: &HostSkillsSnapshot,
) -> Result<SkillCatalog, Box<dyn std::error::Error>> {
    Ok(HostSkillProvider::new()
        .list(SkillListQuery {
            turn_id: "dedup-test".to_string(),
            executor_roots: Vec::new(),
            resolved_executor_roots: Vec::new(),
            host_snapshot: Some(Arc::new(snapshot.clone())),
            include_host_skills: true,
            include_bundled_skills: false,
            include_cloud_skills: false,
            mcp_resources: None,
            executor_capability_discovery: None,
        })
        .await?)
}

#[tokio::test]
async fn identical_roots_hide_only_later_prompt_and_preserve_explicit_read() -> TestResult {
    let (_temp, snapshot) = fixture()?;
    let mut catalog = catalog(&snapshot).await?;
    let original = catalog.clone();
    hide_duplicate_host_prompts(&mut catalog, "api/anthropic/model", &snapshot).await;
    assert_eq!(catalog.entries.len(), 2);
    assert!(catalog.entries[0].is_model_visible());
    assert!(!catalog.entries[1].prompt_visible);
    assert!(catalog.entries[1].enabled);
    assert_eq!(snapshot.outcome().skills.len(), 2);
    assert!(
        snapshot
            .outcome()
            .skills
            .iter()
            .all(|skill| snapshot.outcome().is_skill_enabled(skill))
    );
    let hidden = &catalog.entries[1];
    let read = HostSkillProvider::new()
        .read(SkillReadRequest {
            authority: hidden.authority.clone(),
            package: hidden.id.clone(),
            resource: hidden.main_prompt.clone(),
            context: SkillReadContext::Host {
                host_snapshot: Some(Arc::new(snapshot.clone())),
            },
        })
        .await?;
    assert_eq!(
        read.contents,
        snapshot
            .read_skill_text(&snapshot.outcome().skills[0])
            .await?
    );
    catalog.entries[1].prompt_visible = true;
    assert_eq!(catalog, original);
    Ok(())
}

#[tokio::test]
async fn first_discovery_root_wins_over_native_path_catalog_order() -> TestResult {
    let (_temp, snapshot) = fixture()?;
    let mut catalog = catalog(&snapshot).await?;
    catalog.entries[0] = catalog.entries[0].clone().with_alias_root_order(1);
    catalog.entries[1] = catalog.entries[1].clone().with_alias_root_order(0);
    hide_duplicate_host_prompts(&mut catalog, "api/test/model", &snapshot).await;
    assert!(!catalog.entries[0].is_model_visible());
    assert!(catalog.entries[1].is_model_visible());
    Ok(())
}

#[tokio::test]
async fn changed_body_is_retained_even_between_discoveries_with_same_snapshot() -> TestResult {
    let (temp, snapshot) = fixture()?;
    let mut first = catalog(&snapshot).await?;
    hide_duplicate_host_prompts(&mut first, "api/test/model", &snapshot).await;
    assert!(!first.entries[1].is_model_visible());
    std::fs::write(
        temp.path().join("second-root/demo/SKILL.md"),
        "Different instructions",
    )?;
    let mut next = catalog(&snapshot).await?;
    hide_duplicate_host_prompts(&mut next, "api/test/model", &snapshot).await;
    assert!(next.entries.iter().all(|entry| entry.is_model_visible()));
    Ok(())
}

#[tokio::test]
async fn unreadable_copy_remains_visible() -> TestResult {
    let (temp, snapshot) = fixture()?;
    std::fs::remove_file(temp.path().join("second-root/demo/SKILL.md"))?;
    let mut catalog = catalog(&snapshot).await?;
    let original = catalog.clone();
    hide_duplicate_host_prompts(&mut catalog, "api/test/model", &snapshot).await;
    assert_eq!(catalog, original);
    Ok(())
}

#[tokio::test]
async fn ordinary_models_leave_identical_copies_visible() -> TestResult {
    let (_temp, snapshot) = fixture()?;
    for slug in ["gpt-6.1-sol", "managed/anthropic/model", "not-api/model"] {
        let mut catalog = catalog(&snapshot).await?;
        let original = catalog.clone();
        hide_duplicate_host_prompts(&mut catalog, slug, &snapshot).await;
        assert_eq!(catalog, original);
    }
    Ok(())
}

#[tokio::test]
async fn different_metadata_keeps_equal_bodies_visible() -> TestResult {
    let (_temp, snapshot) = fixture()?;
    let original = catalog(&snapshot).await?;
    for variant in 0..5 {
        let mut catalog = original.clone();
        let second = &mut catalog.entries[1];
        match variant {
            0 => second.description = "Other description".to_string(),
            1 => second.short_description = Some("Other summary".to_string()),
            2 => *second = second.clone().with_prompt_scope(SkillScope::Repo),
            3 => second.plugin_id = Some("other-plugin".to_string()),
            _ => second.dependencies = Some(codex_skills::SkillDependencies { tools: Vec::new() }),
        }
        let expected = catalog.clone();
        hide_duplicate_host_prompts(&mut catalog, "api/test/model", &snapshot).await;
        assert_eq!(catalog, expected);
    }
    Ok(())
}

#[tokio::test]
async fn hidden_and_disabled_copies_do_not_hide_visible_copy() -> TestResult {
    let (_temp, snapshot) = fixture()?;
    for disabled in [false, true] {
        let mut catalog = catalog(&snapshot).await?;
        if disabled {
            catalog.entries[0].enabled = false;
        } else {
            catalog.entries[0].prompt_visible = false;
        }
        let expected = catalog.clone();
        hide_duplicate_host_prompts(&mut catalog, "api/test/model", &snapshot).await;
        assert_eq!(catalog, expected);
    }
    Ok(())
}

#[tokio::test]
async fn source_plugin_identity_keeps_equal_bodies_visible() -> TestResult {
    let (_temp, snapshot) = fixture()?;
    let mut outcome = snapshot.outcome().clone();
    outcome.skills[1].remote_plugin_id = Some("other-remote-plugin".to_string());
    let snapshot = HostSkillsSnapshot::new(Arc::new(outcome));
    let mut catalog = catalog(&snapshot).await?;
    let expected = catalog.clone();
    hide_duplicate_host_prompts(&mut catalog, "api/test/model", &snapshot).await;
    assert_eq!(catalog, expected);
    Ok(())
}
