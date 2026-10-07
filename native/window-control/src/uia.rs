use crate::protocol::{self, Action, Error, Result};
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use windows::{
    core::*,
    Win32::{Foundation::{HWND, LPARAM, WPARAM}, UI::{Accessibility::*, WindowsAndMessaging::*}},
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

const MAX_ELEMENTS: usize = 2048;
const MAX_DEPTH: usize = 128;

fn schedule<T>(pending: &mut VecDeque<T>, node: T, retained: usize, depth: usize, siblings: usize) -> bool {
    if depth >= MAX_DEPTH || siblings >= MAX_ELEMENTS || retained + pending.len() >= MAX_ELEMENTS {
        return false;
    }
    pending.push_back(node);
    true
}

// The generated bindings turn successful null walker results into E_POINTER.
// Read the ABI result so absent children are distinct from actual provider failures.
unsafe fn related_element(walker: &IUIAutomationTreeWalker, element: &IUIAutomationElement, sibling: bool) -> Result<Option<IUIAutomationElement>> {
    let mut raw = std::ptr::null_mut();
    let method = if sibling { walker.vtable().GetNextSiblingElement } else { walker.vtable().GetFirstChildElement };
    method(walker.as_raw(), element.as_raw(), &mut raw).ok()?;
    Ok(if raw.is_null() { None } else { Some(IUIAutomationElement::from_raw(raw)) })
}

pub fn elements(
    automation: &IUIAutomation,
    hwnd: HWND,
) -> Result<(Vec<Value>, HashMap<String, IUIAutomationElement>, bool)> {
    unsafe {
        let root = automation.ElementFromHandle(hwnd)?;
        let walker = automation.RawViewWalker()?;
        let mut pending = VecDeque::from([(root, 0usize, None::<String>)]);
        let mut references = HashMap::new();
        let mut descriptors = Vec::new();
        let mut truncated = false;
        // Walk incrementally rather than unbounded FindAll allocations from a provider.
        while let Some((element, depth, parent_id)) = pending.pop_front() {
            assert_descendant(automation, hwnd, &element)?;
            let id = format!("element-{}", descriptors.len() + 1);
            let mut patterns = Vec::new();
            let is_password = element.CurrentIsPassword()?.as_bool();
            let enabled = element.CurrentIsEnabled()?.as_bool();
            let automation_id = element.CurrentAutomationId()?.to_string();
            let mut properties = serde_json::Map::new();
            if element
                .GetCurrentPatternAs::<IUIAutomationInvokePattern>(UIA_InvokePatternId)
                .is_ok()
            {
                patterns.push("invoke");
            }
            if let Ok(pattern) = element
                .GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
            {
                if enabled && pattern.CurrentIsReadOnly().is_ok_and(|readonly| !readonly.as_bool()) {
                    patterns.push("setValue");
                }
                if !is_password {
                    if let Ok(value) = pattern.CurrentValue() {
                        let value = value.to_string();
                        if value.len() > 65536 {
                            return Err(Error::new("uia-value-limit", "Accessibility value exceeds supported bounds"));
                        }
                        properties.insert("value".into(), Value::String(value));
                    }
                }
            }
            if let Ok(pattern) = element
                .GetCurrentPatternAs::<IUIAutomationTogglePattern>(UIA_TogglePatternId)
            {
                patterns.push("toggle");
                if let Ok(state) = pattern.CurrentToggleState() {
                    let state = match state { ToggleState_Off => Some("off"), ToggleState_On => Some("on"),
                        ToggleState_Indeterminate => Some("indeterminate"), _ => None };
                    if let Some(state) = state { properties.insert("toggleState".into(), json!(state)); }
                }
            }
            if let Ok(pattern) = element
                .GetCurrentPatternAs::<IUIAutomationSelectionItemPattern>(
                    UIA_SelectionItemPatternId,
                )
            {
                patterns.push("select");
                if let Ok(selected) = pattern.CurrentIsSelected() {
                    properties.insert("selected".into(), json!(selected.as_bool()));
                }
            }
            if let Ok(pattern) = element
                .GetCurrentPatternAs::<IUIAutomationExpandCollapsePattern>(
                    UIA_ExpandCollapsePatternId,
                )
            {
                patterns.extend(["expand", "collapse"]);
                if let Ok(state) = pattern.CurrentExpandCollapseState() {
                    let state = match state { ExpandCollapseState_Collapsed => Some("collapsed"),
                        ExpandCollapseState_Expanded => Some("expanded"), ExpandCollapseState_PartiallyExpanded => Some("partial"),
                        ExpandCollapseState_LeafNode => Some("leaf"), _ => None };
                    if let Some(state) = state { properties.insert("expandState".into(), json!(state)); }
                }
            }
            if element
                .GetCurrentPatternAs::<IUIAutomationScrollPattern>(UIA_ScrollPatternId)
                .is_ok()
            {
                patterns.push("scroll");
            }
            if enabled && key_target(automation, hwnd, &element).is_ok() {
                patterns.push("pressKey");
            }
            let name = if is_password {
                String::new()
            } else {
                element.CurrentName()?.to_string()
            };
            if name.len() > 65536 || automation_id.len() > 65536 {
                return Err(Error::new(
                    "uia-value-limit",
                    "Accessibility name or AutomationId exceeds supported bounds",
                ));
            }
            properties.extend(json!({ "id": id, "name": name, "controlType": control_type(element.CurrentControlType()?.0),
                "patterns": patterns, "automationId": automation_id, "parentId": parent_id,
                "enabled": enabled, "isPassword": is_password }).as_object().unwrap().clone());
            descriptors.push(Value::Object(properties));
            if let Some(child) = related_element(&walker, &element, false)? {
                let mut child = child;
                let mut siblings = 0;
                loop {
                    if !schedule(&mut pending, (child.clone(), depth + 1, Some(id.clone())), descriptors.len(), depth + 1, siblings) {
                        truncated = true;
                        break;
                    }
                    siblings += 1;
                    match related_element(&walker, &child, true)? {
                        Some(next) => child = next,
                        None => break,
                    }
                }
            }
            references.insert(id, element);
        }
        Ok((descriptors, references, truncated))
    }
}

#[cfg(test)]
mod budget_tests {
    use super::*;

    fn walk(children: impl Fn(usize) -> Vec<usize>) -> (Vec<(usize, Option<usize>)>, bool) {
        let mut pending = VecDeque::from([(0, 0, None)]);
        let mut retained = Vec::new();
        let mut truncated = false;
        while let Some((node, depth, parent)) = pending.pop_front() {
            retained.push((node, parent));
            for (siblings, child) in children(node).into_iter().enumerate() {
                if !schedule(&mut pending, (child, depth + 1, Some(node)), retained.len(), depth + 1, siblings) {
                    truncated = true;
                    break;
                }
            }
        }
        (retained, truncated)
    }

    #[test]
    fn breadth_first_preserves_shallow_nodes_and_returned_parents() {
        let (nodes, truncated) = walk(|node| match node { 0 => vec![1, 2], 1 => vec![3, 4], 2 => vec![5], _ => vec![] });
        assert!(!truncated);
        assert_eq!(nodes.iter().map(|(node, _)| *node).collect::<Vec<_>>(), vec![0, 1, 2, 3, 4, 5]);
        for (index, (_, parent)) in nodes.iter().enumerate() {
            if let Some(parent) = parent { assert!(nodes[..index].iter().any(|(node, _)| node == parent)); }
        }
    }

    #[test]
    fn exact_element_budget_with_complete_leaves_is_not_truncated() {
        let (nodes, truncated) = walk(|node| if node == 0 { (1..MAX_ELEMENTS).collect() } else { vec![] });
        assert_eq!(nodes.len(), MAX_ELEMENTS);
        assert!(!truncated);
    }

    #[test]
    fn extra_sibling_returns_bounded_partial_tree() {
        let (nodes, truncated) = walk(|node| if node == 0 { (1..=MAX_ELEMENTS).collect() } else { vec![] });
        assert_eq!(nodes.len(), MAX_ELEMENTS);
        assert!(truncated);
    }

    #[test]
    fn exact_depth_leaf_is_complete_but_deeper_child_is_truncated() {
        let (nodes, truncated) = walk(|node| if node + 1 < MAX_DEPTH { vec![node + 1] } else { vec![] });
        assert_eq!(nodes.len(), MAX_DEPTH);
        assert!(!truncated);
        let (nodes, truncated) = walk(|node| vec![node + 1]);
        assert_eq!(nodes.len(), MAX_DEPTH);
        assert!(truncated);
    }

    #[test]
    fn full_queue_rejects_additional_work_without_growth() {
        let mut pending = VecDeque::from(vec![0; MAX_ELEMENTS]);
        assert!(!schedule(&mut pending, 1, 0, 1, 0));
        assert_eq!(pending.len(), MAX_ELEMENTS);
    }

    #[test]
    fn retained_plus_pending_and_sibling_limits_are_enforced() {
        let mut pending = VecDeque::from([0]);
        assert!(!schedule(&mut pending, 1, MAX_ELEMENTS - 1, 1, 0));
        assert!(!schedule(&mut pending, 1, 0, 1, MAX_ELEMENTS));
        assert_eq!(pending.len(), 1);
    }
}

pub fn key_target(automation: &IUIAutomation, root: HWND, element: &IUIAutomationElement) -> Result<HWND> {
    unsafe {
        let target = element.CurrentNativeWindowHandle()?;
        if !IsWindow(target).as_bool() || (target != root && !IsChild(root, target).as_bool()) {
            return Err(Error::new("unsupported-action", "Element has no supported window-directed key target"));
        }
        // Virtual controls can share an ancestor HWND. A message to that HWND
        // can reach another focused control, so require the HWND's exact owner.
        let owner = automation.ElementFromHandle(target)?;
        if !automation.CompareElements(element, &owner)?.as_bool() {
            return Err(Error::new("unsupported-action", "Element does not own its window-directed key target"));
        }
        assert_descendant(automation, root, element)?;
        Ok(target)
    }
}

pub fn press_key(automation: &IUIAutomation, root: HWND, element: &IUIAutomationElement, value: Option<Value>) -> Result<()> {
    let (key, scan, extended) = protocol::named_key(value.as_ref())?;
    unsafe {
        if !element.CurrentIsEnabled()?.as_bool() {
            return Err(Error::new("disabled-element", "Element is disabled"));
        }
        let target = key_target(automation, root, element)?;
        let bits = 1u32 | ((scan as u32) << 16) | if extended { 1 << 24 } else { 0 };
        PostMessageW(target, WM_KEYDOWN, WPARAM(key as usize), LPARAM(bits as isize))?;
        // A second queue failure leaves delivery uncertain; never retry this mutation.
        PostMessageW(target, WM_KEYUP, WPARAM(key as usize), LPARAM((bits | (3 << 30)) as isize))
            .map_err(|_| Error::new("uncertain-delivery", "Key down queued but key up could not be queued"))?;
    }
    Ok(())
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

fn unsupported(error: windows::core::Error) -> Error {
    if error.code().0 as u32 == UIA_E_NOTSUPPORTED {
        Error::new("unsupported-action", "Element does not support the requested UIA pattern")
    } else {
        error.into()
    }
}

#[cfg(test)]
mod pattern_error_tests {
    use super::*;
    #[test]
    fn only_pattern_not_supported_is_an_unsupported_action() {
        assert_eq!(unsupported(windows::core::Error::from_hresult(HRESULT(UIA_E_NOTSUPPORTED as i32))).code, "unsupported-action");
        assert_eq!(unsupported(windows::core::Error::from_hresult(windows::Win32::Foundation::E_ACCESSDENIED)).code, "native-error");
        assert_eq!(unsupported(windows::core::Error::from_hresult(windows::Win32::Foundation::E_NOINTERFACE)).code, "native-error");
    }
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
            Action::PressKey => return Err(Error::new("unsupported-action", "pressKey requires a validated window delivery target")),
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
