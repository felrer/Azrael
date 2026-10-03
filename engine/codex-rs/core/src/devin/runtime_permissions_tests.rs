use super::*;
use pretty_assertions::assert_eq;

#[test]
fn permission_option_requires_one_unique_nonempty_allow_once_id() {
    for options in [
        json!([{"kind":"allow_once","optionId":"once"},{"kind":"allow_always","optionId":"always"}]),
        json!([{"kind":"allow_always","optionId":"always"},{"kind":"allow_once","optionId":"once"}]),
    ] {
        let request = json!({"options": options});
        assert_eq!(allow_once_option(&request), Some("once"));
    }
    for options in [
        json!([]),
        json!([{"kind":"allow_always","optionId":"always"}]),
        json!([{"kind":"allow_once","optionId":""}]),
        json!([{"kind":"allow_once","optionId":1}]),
        json!([{"kind":"allow_once","optionId":"a"},{"kind":"allow_once","optionId":"b"}]),
        json!([{"kind":"allow_once","optionId":"a"},{"kind":"reject_once","optionId":"a"}]),
    ] {
        assert_eq!(allow_once_option(&json!({"options":options})), None);
    }
}

#[test]
fn interactive_classifier_requires_literal_powershell_without_scope_overrides() {
    let request = json!({"toolCall":{"kind":"execute","rawInput":{"command":"Get-ChildItem | Select-Object -First 30 Name","shell_flavor":"powershell"}}});
    assert_eq!(
        permission_command(&request),
        Ok("Get-ChildItem | Select-Object -First 30 Name")
    );
    for command in [
        "",
        "$env:SECRET",
        "& $env:COMMAND",
        "Write-Output $(Remove-Item C:/data)",
    ] {
        let request = json!({"toolCall":{"kind":"execute","rawInput":{"command":command,"shell_flavor":"powershell"}}});
        assert!(permission_command(&request).is_err());
    }
    for field in ["shell", "cwd", "workdir", "workingDirectory", "executable"] {
        let mut request = request.clone();
        request["toolCall"]["rawInput"][field] = json!("override");
        assert_eq!(
            permission_command(&request),
            Err("unsupported_execution_override")
        );
    }
    for flavor in [Value::Null, json!("bash"), json!("unknown")] {
        let mut changed = request.clone();
        changed["toolCall"]["rawInput"]["shell_flavor"] = flavor;
        assert_eq!(
            permission_command(&changed),
            Err("unsupported_shell_flavor")
        );
    }
    let mut scoped = request.clone();
    scoped["toolCall"]["scope"] = json!({"other":"scope"});
    assert_eq!(
        permission_command(&scoped),
        Err("unsupported_execution_scope")
    );
    let mut unknown = request;
    unknown["toolCall"]["kind"] = json!("other");
    assert_eq!(permission_command(&unknown), Err("unsupported_tool_kind"));
}

#[test]
fn interactive_requirement_decision_preserves_native_policy() {
    let needs_approval = ExecApprovalRequirement::NeedsApproval {
        reason: None,
        proposed_execpolicy_amendment: None,
    };
    assert_eq!(automatic_requirement_decision(&needs_approval), None);

    let forbidden = ExecApprovalRequirement::Forbidden {
        reason: "dangerous command".to_string(),
    };
    assert_eq!(
        automatic_requirement_decision(&forbidden),
        Some(Err("exec_policy_denied"))
    );
}
