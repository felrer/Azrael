use crate::protocol::{self, Action, Error, Result};
use serde_json::{json, Value};
use std::collections::HashMap;
use windows::{
    core::*,
    Win32::{Foundation::HWND, UI::Accessibility::*},
};

pub fn assert_descendant(
    automation: &IUIAutomation,
    hwnd: HWND,
    element: &IUIAutomationElement,
) -> Result<()> {
    unsafe {
        let root = automation.ElementFromHandle(hwnd)?;
        if root.CurrentNativeWindowHandle()? != hwnd {
            return Err(Error::new(
                "stale-element",
                "Provider root does not match the selected HWND",
            ));
        }
        let walker = automation.RawViewWalker()?;
        let mut current = element.clone();
        for _ in 0..256 {
            if automation.CompareElements(&current, &root)?.as_bool() {
                return Ok(());
            }
            current = walker.GetParentElement(&current).map_err(|_| {
                Error::new(
                    "stale-element",
                    "Element is no longer a descendant of the selected HWND",
                )
            })?;
        }
    }
    Err(Error::new(
        "stale-element",
        "Element ancestry exceeds supported bounds",
    ))
}

pub fn elements(
    automation: &IUIAutomation,
    hwnd: HWND,
) -> Result<(Vec<Value>, HashMap<String, IUIAutomationElement>)> {
    unsafe {
        let root = automation.ElementFromHandle(hwnd)?;
        let walker = automation.RawViewWalker()?;
        let mut pending = vec![(root, 0usize)];
        let mut references = HashMap::new();
        let mut descriptors = Vec::new();
        // Walk incrementally rather than unbounded FindAll allocations from a provider.
        while let Some((element, depth)) = pending.pop() {
            if descriptors.len() >= 2048 || depth >= 128 {
                return Err(Error::new(
                    "uia-tree-limit",
                    "Accessibility tree exceeds supported bounds",
                ));
            }
            assert_descendant(automation, hwnd, &element)?;
            let id = format!("element-{}", descriptors.len() + 1);
            let mut patterns = Vec::new();
            if element
                .GetCurrentPatternAs::<IUIAutomationInvokePattern>(UIA_InvokePatternId)
                .is_ok()
            {
                patterns.push("invoke");
            }
            if element
                .GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
                .is_ok()
            {
                patterns.push("setValue");
            }
            if element
                .GetCurrentPatternAs::<IUIAutomationTogglePattern>(UIA_TogglePatternId)
                .is_ok()
            {
                patterns.push("toggle");
            }
            if element
                .GetCurrentPatternAs::<IUIAutomationSelectionItemPattern>(
                    UIA_SelectionItemPatternId,
                )
                .is_ok()
            {
                patterns.push("select");
            }
            if element
                .GetCurrentPatternAs::<IUIAutomationExpandCollapsePattern>(
                    UIA_ExpandCollapsePatternId,
                )
                .is_ok()
            {
                patterns.extend(["expand", "collapse"]);
            }
            if element
                .GetCurrentPatternAs::<IUIAutomationScrollPattern>(UIA_ScrollPatternId)
                .is_ok()
            {
                patterns.push("scroll");
            }
            let name = if element.CurrentIsPassword()?.as_bool() {
                String::new()
            } else {
                element.CurrentName()?.to_string()
            };
            if name.len() > 65536 {
                return Err(Error::new(
                    "uia-value-limit",
                    "Accessibility name exceeds supported bounds",
                ));
            }
            descriptors.push(json!({ "id": id, "name": name, "controlType": control_type(element.CurrentControlType()?.0), "patterns": patterns }));
            if let Ok(child) = walker.GetFirstChildElement(&element) {
                let mut child = child;
                let mut siblings = 0;
                loop {
                    pending.push((child.clone(), depth + 1));
                    siblings += 1;
                    if siblings > 2048 || pending.len() > 2048 {
                        return Err(Error::new(
                            "uia-tree-limit",
                            "Accessibility tree exceeds supported bounds",
                        ));
                    }
                    match walker.GetNextSiblingElement(&child) {
                        Ok(next) => child = next,
                        Err(_) => break,
                    }
                }
            }
            references.insert(id, element);
        }
        Ok((descriptors, references))
    }
}

fn control_type(id: i32) -> String {
    match id {
        50000 => "Button",
        50001 => "Calendar",
        50002 => "CheckBox",
        50003 => "ComboBox",
        50004 => "Edit",
        50005 => "Hyperlink",
        50006 => "Image",
        50007 => "ListItem",
        50008 => "List",
        50009 => "Menu",
        50010 => "MenuBar",
        50011 => "MenuItem",
        50012 => "ProgressBar",
        50013 => "RadioButton",
        50014 => "ScrollBar",
        50015 => "Slider",
        50016 => "Spinner",
        50017 => "StatusBar",
        50018 => "Tab",
        50019 => "TabItem",
        50020 => "Text",
        50021 => "ToolBar",
        50022 => "ToolTip",
        50023 => "Tree",
        50024 => "TreeItem",
        50025 => "Custom",
        50026 => "Group",
        50027 => "Thumb",
        50028 => "DataGrid",
        50029 => "DataItem",
        50030 => "Document",
        50031 => "SplitButton",
        50032 => "Window",
        50033 => "Pane",
        50034 => "Header",
        50035 => "HeaderItem",
        50036 => "Table",
        50037 => "TitleBar",
        50038 => "Separator",
        50039 => "SemanticZoom",
        50040 => "AppBar",
        _ => return format!("ControlType({id})"),
    }
    .into()
}

fn unsupported(_: windows::core::Error) -> Error {
    Error::new(
        "unsupported-action",
        "Element does not support the requested UIA pattern",
    )
}
fn scroll_amount(value: i32) -> Result<ScrollAmount> {
    match value {
        -2 => Ok(ScrollAmount_LargeDecrement),
        -1 => Ok(ScrollAmount_SmallDecrement),
        0 => Ok(ScrollAmount_NoAmount),
        1 => Ok(ScrollAmount_SmallIncrement),
        2 => Ok(ScrollAmount_LargeIncrement),
        _ => Err(Error::new(
            "invalid-params",
            "Scroll amounts must be integers from -2 to 2",
        )),
    }
}
pub fn act(element: &IUIAutomationElement, action: &Action, value: Option<Value>) -> Result<()> {
    if !matches!(action, Action::SetValue | Action::Scroll) && value.is_some() {
        return Err(Error::new("invalid-params", "This action takes no value"));
    }
    unsafe {
        if !element.CurrentIsEnabled()?.as_bool() {
            return Err(Error::new("disabled-element", "Element is disabled"));
        }
        match action {
            Action::Invoke => element
                .GetCurrentPatternAs::<IUIAutomationInvokePattern>(UIA_InvokePatternId)
                .map_err(unsupported)?
                .Invoke()?,
            Action::Toggle => element
                .GetCurrentPatternAs::<IUIAutomationTogglePattern>(UIA_TogglePatternId)
                .map_err(unsupported)?
                .Toggle()?,
            Action::Select => element
                .GetCurrentPatternAs::<IUIAutomationSelectionItemPattern>(
                    UIA_SelectionItemPatternId,
                )
                .map_err(unsupported)?
                .Select()?,
            Action::Expand => element
                .GetCurrentPatternAs::<IUIAutomationExpandCollapsePattern>(
                    UIA_ExpandCollapsePatternId,
                )
                .map_err(unsupported)?
                .Expand()?,
            Action::Collapse => element
                .GetCurrentPatternAs::<IUIAutomationExpandCollapsePattern>(
                    UIA_ExpandCollapsePatternId,
                )
                .map_err(unsupported)?
                .Collapse()?,
            Action::SetValue => {
                let value = value
                    .and_then(|v| v.as_str().map(str::to_owned))
                    .ok_or_else(|| {
                        Error::new("invalid-params", "setValue requires a string value")
                    })?;
                if value.len() > 65536 || value.contains('\0') {
                    return Err(Error::new(
                        "invalid-params",
                        "Value exceeds supported bounds or contains NUL",
                    ));
                }
                let pattern = element
                    .GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
                    .map_err(unsupported)?;
                if pattern.CurrentIsReadOnly()?.as_bool() {
                    return Err(Error::new("readonly-element", "Element value is read only"));
                }
                pattern.SetValue(&BSTR::from(value))?;
            }
            Action::Scroll => {
                let amounts: protocol::Scroll = protocol::params(value.ok_or_else(|| {
                    Error::new(
                        "invalid-params",
                        "scroll requires horizontal and vertical amounts",
                    )
                })?)?;
                let horizontal = scroll_amount(amounts.horizontal)?;
                let vertical = scroll_amount(amounts.vertical)?;
                element
                    .GetCurrentPatternAs::<IUIAutomationScrollPattern>(UIA_ScrollPatternId)
                    .map_err(unsupported)?
                    .Scroll(horizontal, vertical)?;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn scroll_parameters_are_bounded() {
        for value in -2..=2 {
            assert!(scroll_amount(value).is_ok());
        }
        assert!(scroll_amount(-3).is_err());
        assert!(scroll_amount(3).is_err());
    }
}
