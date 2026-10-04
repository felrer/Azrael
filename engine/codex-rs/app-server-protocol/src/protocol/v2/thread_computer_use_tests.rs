use super::ComputerUseMode;
use super::ThreadResumeParams;
use super::ThreadStartParams;
use pretty_assertions::assert_eq;
use serde_json::json;

#[test]
fn selected_window_mode_is_optional_and_strict() {
    let selected: ThreadStartParams =
        serde_json::from_value(json!({"computerUseMode":"selectedWindow"})).unwrap();
    assert_eq!(
        selected.computer_use_mode,
        Some(ComputerUseMode::SelectedWindow)
    );
    assert_eq!(
        serde_json::to_value(selected).unwrap()["computerUseMode"],
        json!("selectedWindow")
    );
    assert_eq!(
        serde_json::from_value::<ThreadStartParams>(json!({}))
            .unwrap()
            .computer_use_mode,
        None
    );
    for mode in ["normal", "fullAccess", "selectedwindow"] {
        assert!(
            serde_json::from_value::<ThreadStartParams>(json!({"computerUseMode":mode})).is_err()
        );
        assert!(
            serde_json::from_value::<ThreadResumeParams>(
                json!({"threadId":"id", "computerUseMode":mode})
            )
            .is_err()
        );
    }
}
