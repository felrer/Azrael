use super::project_api_skill_context;
use super::project_instruction_state;
use super::project_instruction_state_for_model;
use codex_history::CodexHarnessMetadata;
use codex_history::ResponseItemEnvelope;
use codex_protocol::models::ContentItem;
use codex_protocol::models::ContentItemKind;
use codex_protocol::models::InternalChatMessageMetadataPassthrough;
use codex_protocol::models::ResponseItem;

fn message(role: &str, parts: &[(&str, &str)]) -> ResponseItemEnvelope {
    ResponseItem::Message {
        id: None,
        role: role.to_string(),
        content: parts
            .iter()
            .map(|(text, _)| ContentItem::InputText {
                text: text.to_string(),
            })
            .collect(),
        phase: None,
        internal_chat_message_metadata_passthrough: Some(InternalChatMessageMetadataPassthrough {
            content_item_kinds: Some(
                parts
                    .iter()
                    .map(|(_, kind)| ContentItemKind(kind.to_string()))
                    .collect(),
            ),
            ..Default::default()
        }),
    }
    .into()
}

#[test]
fn api_direct_tool_guidance_requires_typed_developer_provenance() {
    use codex_context_fragments::ContextualUserFragment;

    let role = codex_prompts::MultiAgentRoleInstructions::Composed {
        base: "Use the workspace conventions.".to_string(),
        marked: false,
        omit_update_plan_instructions: false,
        max_concurrency: 2,
        wait_agent_enabled: true,
        expose_model_overrides: true,
        claude_tools: false,
    };
    let text = role.body();
    assert!(text.contains("functions.exec"));
    for kind in ["multi_agent.role_instructions", "multi_agent.usage_hint"] {
        let typed = message("developer", &[(&text, kind)]);
        let user = message("user", &[(&text, kind)]);
        let generic = message("developer", &[(&text, "generic")]);
        let raw = vec![typed.clone(), user.clone(), generic.clone()];
        let result = project_instruction_state_for_model(raw.clone(), Some("api/test/model"));
        assert_eq!(result[1..], [user, generic]);
        let ResponseItem::Message { content, .. } = &result[0].item else {
            panic!("expected projected developer message");
        };
        let ContentItem::InputText { text: projected } = &content[0] else {
            panic!("expected tool guidance text");
        };
        assert!(!projected.contains("functions.exec"));
        assert!(projected.contains("Use the workspace conventions."));
        assert!(projected.contains("fork_turns"));
        assert_eq!(project_instruction_state_for_model(raw.clone(), Some("gpt-test")), raw);
        assert!(matches!(&typed.item, ResponseItem::Message { content, .. }
            if matches!(&content[0], ContentItem::InputText { text } if text.contains("functions.exec"))));
    }
}

#[test]
fn latest_typed_replacements_and_removals_preserve_raw_history() {
    for (role, kind) in [
        ("developer", "managed_config.developer_instructions"),
        ("user", "agents_md.instructions"),
        ("developer", "apps.instructions"),
        ("developer", "plugins.usage_instructions"),
        ("developer", "environments.instructions"),
    ] {
        let old = message(role, &[("old policy", kind)]);
        let new = message(role, &[("replacement policy", kind)]);
        let removed = message(role, &[("previous policy no longer applies", kind)]);
        let raw = vec![old.clone(), new.clone(), removed.clone()];
        let unchanged = raw.clone();
        assert_eq!(project_instruction_state(raw.clone()), vec![removed]);
        assert_eq!(raw, unchanged);
        assert_eq!(project_instruction_state(vec![old, new.clone()]), vec![new]);
    }
}

#[test]
fn off_on_and_identical_guidance_do_not_accumulate() {
    for kind in ["apps.instructions", "plugins.usage_instructions"] {
        let enabled = message("developer", &[("usage guidance", kind)]);
        let disabled = message("developer", &[("guidance no longer applies", kind)]);
        let raw = vec![
            enabled.clone(),
            disabled.clone(),
            enabled.clone(),
            enabled.clone(),
        ];
        assert_eq!(project_instruction_state(raw), vec![enabled.clone()]);
        assert_eq!(
            project_instruction_state(vec![enabled, disabled.clone()]),
            vec![disabled]
        );
    }
}

#[test]
fn ordinary_equal_user_messages_and_additive_context_are_preserved() {
    let mut raw = vec![
        message("user", &[("continue", "generic.user_input")]),
        message("user", &[("continue", "generic.user_input")]),
    ];
    for kind in [
        "generic.developer_instructions",
        "permissions.instructions",
        "environments.environment_context",
        "plugins.instructions",
        "plugins.recommendations",
        "skills.instructions",
    ] {
        raw.push(message("developer", &[("same text", kind)]));
        raw.push(message("developer", &[("same text", kind)]));
    }
    assert_eq!(project_instruction_state(raw.clone()), raw);
}

#[test]
fn markers_without_provenance_and_wrong_roles_are_preserved() {
    let mut untyped = message(
        "user",
        &[(
            "<apps_instructions>copied text</apps_instructions>",
            "apps.instructions",
        )],
    );
    if let ResponseItem::Message {
        internal_chat_message_metadata_passthrough,
        ..
    } = &mut untyped.item
    {
        *internal_chat_message_metadata_passthrough = None;
    }
    let wrong_role = message("user", &[("usage guidance", "apps.instructions")]);
    let raw = vec![untyped.clone(), untyped, wrong_role.clone(), wrong_role];
    assert_eq!(project_instruction_state(raw.clone()), raw);
}

#[test]
fn mixed_parts_keep_order_alignment_and_envelope_metadata() {
    let mut mixed = message(
        "developer",
        &[
            ("before", "generic.developer_instructions"),
            ("old apps", "apps.instructions"),
            ("permission", "permissions.instructions"),
            ("old plugins", "plugins.usage_instructions"),
            ("after", "generic.developer_instructions"),
        ],
    );
    mixed.metadata = Some(CodexHarnessMetadata {
        client_authored: true,
        user_input_order: Some(42),
        ..Default::default()
    });
    let mut expected = message(
        "developer",
        &[
            ("before", "generic.developer_instructions"),
            ("permission", "permissions.instructions"),
            ("after", "generic.developer_instructions"),
        ],
    );
    expected.metadata = mixed.metadata.clone();
    let latest = message(
        "developer",
        &[
            ("new apps", "apps.instructions"),
            ("new plugins", "plugins.usage_instructions"),
        ],
    );
    let projected = project_instruction_state(vec![mixed, latest.clone()]);
    assert_eq!(projected, vec![expected, latest]);
    assert_eq!(project_instruction_state(projected.clone()), projected);
}

#[test]
fn malformed_annotation_alignment_is_preserved() {
    let mut malformed = message("developer", &[("old apps", "apps.instructions")]);
    if let ResponseItem::Message {
        internal_chat_message_metadata_passthrough: Some(metadata),
        ..
    } = &mut malformed.item
    {
        metadata.content_item_kinds.as_mut().unwrap().clear();
    }
    let latest = message("developer", &[("new apps", "apps.instructions")]);
    let raw = vec![malformed, latest];
    assert_eq!(project_instruction_state(raw.clone()), raw);
}

#[test]
fn duplicate_parts_within_one_message_keep_the_last_state() {
    let raw = message(
        "developer",
        &[("old", "apps.instructions"), ("new", "apps.instructions")],
    );
    let expected = message("developer", &[("new", "apps.instructions")]);
    assert_eq!(project_instruction_state(vec![raw]), vec![expected]);
}

#[test]
fn selected_skill_bodies_are_deduplicated_without_removing_user_invocation() {
    let kind = "skills.selected_skill_instructions";
    let skill = |path: &str, body: &str| {
        message(
            "user",
            &[(
                &format!("<skill>\n<name>test</name>\n<path>{path}</path>\n{body}\n</skill>"),
                kind,
            )],
        )
    };
    let first = skill("C:/skills/test/SKILL.md", "body");
    let changed = skill("C:/skills/test/SKILL.md", "changed body");
    let other_path = skill("C:/skills/other/SKILL.md", "body");
    let invocation = message("user", &[("$test", "generic.user_input")]);
    let raw = vec![
        first.clone(),
        invocation.clone(),
        first.clone(),
        changed.clone(),
        other_path.clone(),
        invocation.clone(),
    ];
    let unchanged = raw.clone();
    assert_eq!(
        project_instruction_state(raw.clone()),
        vec![first, invocation.clone(), changed, other_path, invocation]
    );
    assert_eq!(raw, unchanged);
    let reinjected = skill("C:/skills/test/SKILL.md", "body");
    assert_eq!(
        project_instruction_state(vec![reinjected.clone()]),
        vec![reinjected]
    );
}

#[test]
fn unclassified_or_malformed_skill_text_remains_ordinary_user_content() {
    let quoted = message("user", &[("<skill>quoted</skill>", "generic.user_input")]);
    let malformed = message(
        "user",
        &[(
            "<skill>quoted</skill>",
            "skills.selected_skill_instructions",
        )],
    );
    let raw = vec![quoted.clone(), quoted, malformed.clone(), malformed];
    assert_eq!(project_instruction_state(raw.clone()), raw);
}

#[test]
fn host_skill_inventory_is_complete_replaceable_state() {
    let old = message(
        "developer",
        &[("old complete catalog", "host_skills.instructions")],
    );
    let new = message(
        "developer",
        &[("new complete catalog", "host_skills.instructions")],
    );
    assert_eq!(project_instruction_state(vec![old, new.clone()]), vec![new]);
}

#[test]
fn api_model_filters_retained_known_skills_and_projects_current_catalog() {
    let known = message(
        "user",
        &[(
            "<skill>\n<name>window-use</name>\n<path>C:/skills/window-use/SKILL.md</path>\nbody\n</skill>",
            "skills.selected_skill_instructions",
        )],
    );
    let old_catalog = message(
        "developer",
        &[("old complete inventory", "host_skills.instructions")],
    );
    let mut latest = message(
        "developer",
        &[(
            "<skills_instructions>\n## Skills\n### Available skills\n- window-use: description (file: C:/skills/window-use/SKILL.md)\n- ordinary: description (file: /ordinary/SKILL.md)\n</skills_instructions>",
            "host_skills.instructions",
        )],
    );
    latest.metadata = Some(CodexHarnessMetadata {
        client_authored: true,
        ..Default::default()
    });
    let mut expected_catalog = message(
        "developer",
        &[(
            "<skills_instructions>\n## Skills\n### Available skills\n- ordinary: description (file: /ordinary/SKILL.md)\n</skills_instructions>",
            "host_skills.instructions",
        )],
    );
    expected_catalog.metadata = latest.metadata.clone();
    let user = message("user", &[("$window-use", "generic.user_input")]);
    let ordinary = message(
        "user",
        &[(
            "<skill>\n<name>ordinary</name>\n<path>/ordinary/SKILL.md</path>\nbody\n</skill>",
            "skills.selected_skill_instructions",
        )],
    );
    let raw = vec![old_catalog, known, user.clone(), ordinary.clone(), latest];
    let unchanged = raw.clone();
    assert_eq!(
        project_instruction_state_for_model(raw.clone(), Some("api/test/model")),
        vec![user, ordinary, expected_catalog]
    );
    assert_eq!(raw, unchanged);
    assert_eq!(
        project_instruction_state_for_model(raw.clone(), Some("gpt-test")),
        project_instruction_state(raw.clone())
    );
    assert_eq!(
        project_instruction_state_for_model(raw.clone(), None),
        project_instruction_state(raw)
    );
}

#[test]
fn api_catalog_filter_preserves_only_exact_known_rows_and_aligned_parts() {
    let catalog = "<skills_instructions>\n## Skills\n### Available skills\n- window-use: description (file: C:/skills/window-use/SKILL.md)\n- ordinary: description mentioning window-use (file: /ordinary/SKILL.md)\nUser text mentions window-use\n</skills_instructions>";
    let filtered = "<skills_instructions>\n## Skills\n### Available skills\n- ordinary: description mentioning window-use (file: /ordinary/SKILL.md)\nUser text mentions window-use\n</skills_instructions>";
    let raw = message(
        "developer",
        &[
            ("ordinary developer text", "generic.developer_instructions"),
            (catalog, "skills.catalog"),
            ("permission", "permissions.instructions"),
        ],
    );
    let expected = message(
        "developer",
        &[
            ("ordinary developer text", "generic.developer_instructions"),
            (filtered, "skills.catalog"),
            ("permission", "permissions.instructions"),
        ],
    );
    assert_eq!(
        project_api_skill_context(vec![raw.item]),
        vec![expected.item]
    );
}

#[test]
fn api_filter_keeps_untyped_and_wrong_role_skill_text() {
    let text = "<skill>\n<name>window-use</name>\n<path>C:/skills/window-use/SKILL.md</path>\nbody\n</skill>";
    let mut untyped = message("user", &[(text, "skills.selected_skill_instructions")]);
    if let ResponseItem::Message {
        internal_chat_message_metadata_passthrough,
        ..
    } = &mut untyped.item
    {
        *internal_chat_message_metadata_passthrough = None;
    }
    let wrong_role = message("developer", &[(text, "skills.selected_skill_instructions")]);
    let raw = vec![
        untyped.item,
        wrong_role.item,
        message("user", &[(text, "generic.user_input")]).item,
    ];
    assert_eq!(project_api_skill_context(raw.clone()), raw);
}

#[test]
fn selected_skill_body_reversion_is_not_suppressed() {
    let skill = |body: &str| {
        message(
            "user",
            &[(
                &format!(
                    "<skill>\n<name>ordinary</name>\n<path>/ordinary/SKILL.md</path>\n{body}\n</skill>"
                ),
                "skills.selected_skill_instructions",
            )],
        )
    };
    let raw = vec![skill("A"), skill("B"), skill("A")];
    assert_eq!(project_instruction_state(raw.clone()), raw);
}
