use super::parse_status;
use pretty_assertions::assert_eq;

#[test]
fn status_rejects_unknown_output_and_only_returns_display_metadata() {
    assert!(parse_status("temporary upstream error").is_err());
    let status = parse_status(
        "Logged in (via Devin).\n  Email: user@example.com\n  Plan: Pro\n  User ID: internal-id\n",
    )
    .unwrap();
    assert_eq!(
        serde_json::to_value(status).unwrap(),
        serde_json::json!({
            "enabled":true,"loggedIn":true,"email":"user@example.com","plan":"Pro"
        })
    );
    assert_eq!(
        serde_json::to_value(parse_status("Not logged in.\nRun login").unwrap()).unwrap(),
        serde_json::json!({
            "enabled":true,"loggedIn":false,"email":null,"plan":null
        })
    );
}
