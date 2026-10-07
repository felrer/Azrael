use crate::protocol::{self, Error, Result, Window};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    mem::size_of,
    time::{Duration, Instant},
};
use windows::{
    core::*,
    Win32::{
        Foundation::*,
        Graphics::Gdi::*,
        System::{Com::*, Threading::*, WinRT::*},
        UI::{Accessibility::*, HiDpi::*, WindowsAndMessaging::*},
    },
};

#[path = "capture.rs"]
mod capture;
#[path = "lifetime.rs"]
mod lifetime;
#[path = "uia.rs"]
mod uia;

pub struct Backend {
    automation: IUIAutomation,
    observation: Option<Observation>,
    sequence: u64,
    last_frames: HashMap<String, i64>,
    watcher: lifetime::Watcher,
    _apartment: Apartment,
}
struct Apartment;
impl Drop for Apartment {
    fn drop(&mut self) {
        unsafe {
            RoUninitialize();
        }
    }
}
struct Observation {
    id: String,
    window: Window,
    elements: HashMap<String, IUIAutomationElement>,
}

impl Backend {
    pub fn new() -> Result<Self> {
        unsafe {
            RoInitialize(RO_INIT_MULTITHREADED)?;
            let apartment = Apartment;
            // DPI awareness changes only this dedicated backend process/thread, never the target.
            if SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)
                .0
                .is_null()
            {
                return Err(Error::new(
                    "dpi-awareness",
                    "Cannot enable physical pixel coordinates for backend thread",
                ));
            }
            let automation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)?;
            let watcher = lifetime::Watcher::new()?;
            Ok(Self {
                automation,
                observation: None,
                sequence: 0,
                last_frames: HashMap::new(),
                watcher,
                _apartment: apartment,
            })
        }
    }
    pub fn call(&mut self, method: &str, params: Value) -> Result<Value> {
        let selected: Option<Window> = params
            .get("window")
            .cloned()
            .map(protocol::params)
            .transpose()?;
        self.watcher.barrier()?;
        let result = match method {
            "listWindows" => list_windows(),
            "observe" => {
                let p: protocol::Target = protocol::params(params)?;
                self.observe(&p.window)
            }
            "inspect" => {
                let p: protocol::Target = protocol::params(params)?;
                self.inspect(&p.window)
            }
            "status" => {
                let p: protocol::Target = protocol::params(params)?;
                status(&p.window)
            }
            "restore" => {
                let p: protocol::Target = protocol::params(params)?;
                self.observation = None;
                guarded(&p.window, |hwnd| restore(hwnd))
            }
            "resize" => {
                let p: protocol::Resize = protocol::params(params)?;
                let current = verify(&p.window)?;
                let width = protocol::dip_to_px(p.width_dip, current.dpi)?;
                let height = protocol::dip_to_px(p.height_dip, current.dpi)?;
                self.observation = None;
                guarded(&p.window, |hwnd| resize(hwnd, width, height, current.dpi))
            }
            "act" => {
                let p: protocol::Act = protocol::params(params)?;
                self.act(p)
            }
            _ => Err(Error::new(
                "unknown-method",
                "Unknown native backend method",
            )),
        };
        self.watcher.barrier()?;
        if let Some(window) = selected {
            verify(&window)?;
        }
        result
    }
    fn observe(&mut self, requested: &Window) -> Result<Value> {
        self.observation = None;
        let current = verify(requested)?;
        if current.minimized || current.width_px <= 0 || current.height_px <= 0 {
            return Err(Error::new(
                "unobservable-target",
                "Restore a minimized window before observing",
            ));
        }
        let hwnd = handle(&current)?;
        let work = (|| -> Result<Value> {
            // Resolve accessibility first: the subsequent captured frame is after those reads.
            let (descriptors, elements, elements_truncated) = uia::elements(&self.automation, hwnd)?;
            let identity = format!(
                "{}:{}:{}:{}",
                current.hwnd, current.pid, current.process_created, current.executable
            );
            let previous = self.last_frames.get(&identity).copied().unwrap_or(0);
            let frame = capture::capture(hwnd, previous)?;
            let after_capture = verify(requested)?;
            ensure_capture_geometry(&current, &after_capture)?;
            self.sequence = self
                .sequence
                .checked_add(1)
                .ok_or_else(|| Error::new("backend-exhausted", "Observation sequence exhausted"))?;
            let id = format!("observation-{}", self.sequence);
            self.last_frames.insert(identity, frame.timestamp);
            self.observation = Some(Observation {
                id: id.clone(),
                window: after_capture.clone(),
                elements,
            });
            Ok(
                json!({ "window": after_capture, "observationId": id, "frameTimestamp": frame.timestamp.to_string(),
                "widthPx": frame.width, "heightPx": frame.height, "dpi": after_capture.dpi, "captureProtection": frame.protection,
                "elements": descriptors, "elementsTruncated": elements_truncated, "image": { "mimeType": "image/png", "data": frame.data } }),
            )
        })();
        work
    }
    fn inspect(&mut self, requested: &Window) -> Result<Value> {
        self.observation = None;
        let current = verify(requested)?;
        let (descriptors, elements, elements_truncated) = uia::elements(&self.automation, handle(&current)?)?;
        let after = verify(requested)?;
        ensure_capture_geometry(&current, &after)?;
        self.sequence = self.sequence.checked_add(1)
            .ok_or_else(|| Error::new("backend-exhausted", "Observation sequence exhausted"))?;
        let id = format!("observation-{}", self.sequence);
        self.observation = Some(Observation { id: id.clone(), window: after.clone(), elements });
        Ok(json!({ "window": after, "observationId": id, "elements": descriptors, "elementsTruncated": elements_truncated }))
    }
    fn act(&mut self, p: protocol::Act) -> Result<Value> {
        verify(&p.window)?;
        let observation = self
            .observation
            .take()
            .ok_or_else(|| Error::new("stale-observation", "A fresh observation is required"))?;
        if observation.id != p.observation_id || !observation.window.same_identity(&p.window) {
            return Err(Error::new(
                "stale-observation",
                "Observation does not belong to this window",
            ));
        }
        let element = observation.elements.get(&p.element_id).ok_or_else(|| {
            Error::new(
                "unknown-element",
                "Element was not in the latest observation",
            )
        })?;
        guarded(&p.window, |hwnd| {
            uia::assert_descendant(&self.automation, hwnd, element)?;
            if matches!(p.action, protocol::Action::PressKey) {
                uia::press_key(&self.automation, hwnd, element, p.value)?;
                return Ok(json!({ "window": verify(&p.window).map_err(Error::uncertain)?, "acted": true, "requiresObservation": true,
                    "delivery": "windowMessage", "verified": false, "experimental": true }));
            }
            uia::act(element, &p.action, p.value)?;
            Ok(json!({ "window": verify(&p.window).map_err(Error::uncertain)?, "acted": true, "requiresObservation": true }))
        })
    }
}
fn ensure_capture_geometry(before: &Window, after: &Window) -> Result<()> {
    if before.width_px != after.width_px
        || before.height_px != after.height_px
        || before.dpi != after.dpi
        || before.minimized != after.minimized
    {
        return Err(Error::new(
            "capture-size-changed",
            "Window outer dimensions, DPI or minimized state changed during capture; observe again",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod geometry_tests {
    use super::*;
    #[test]
    fn rejects_outer_geometry_changes_without_equating_outer_and_frame_sizes() {
        let before = Window {
            hwnd: "1234".into(),
            pid: 42,
            process_created: "abcd".into(),
            executable: "C:\\app.exe".into(),
            title: "before".into(),
            minimized: false,
            width_px: 1016,
            height_px: 768,
            dpi: 144,
        };
        let mut after = before.clone();
        after.title = "after".into();
        assert!(ensure_capture_geometry(&before, &after).is_ok());
        after.width_px += 1;
        assert_eq!(
            ensure_capture_geometry(&before, &after).unwrap_err().code,
            "capture-size-changed"
        );
        after = before.clone();
        after.height_px += 1;
        assert!(ensure_capture_geometry(&before, &after).is_err());
        after = before.clone();
        after.dpi = 192;
        assert!(ensure_capture_geometry(&before, &after).is_err());
        after = before.clone();
        after.minimized = true;
        assert!(ensure_capture_geometry(&before, &after).is_err());
    }
}
impl Drop for Backend {
    fn drop(&mut self) {
        self.observation = None;
    }
}

pub(super) fn handle(window: &Window) -> Result<HWND> {
    window.validate()?;
    let raw = protocol::hex(&window.hwnd)?;
    if raw > usize::MAX as u64 {
        return Err(Error::new("invalid-params", "HWND exceeds pointer width"));
    }
    Ok(HWND(raw as usize as *mut std::ffi::c_void))
}

struct Process(HANDLE);
impl Drop for Process {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}
fn describe(hwnd: HWND) -> Result<Window> {
    unsafe {
        if !IsWindow(hwnd).as_bool() {
            return Err(Error::new(
                "stale-target",
                "Selected window no longer exists",
            ));
        }
        let mut pid = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 {
            return Err(Error::new(
                "stale-target",
                "Selected process no longer exists",
            ));
        }
        let process = Process(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)?);
        let mut created = FILETIME::default();
        let mut exit = FILETIME::default();
        let mut kernel = FILETIME::default();
        let mut user = FILETIME::default();
        GetProcessTimes(process.0, &mut created, &mut exit, &mut kernel, &mut user)?;
        let mut name = vec![0u16; 32768];
        let mut name_size = name.len() as u32;
        QueryFullProcessImageNameW(
            process.0,
            PROCESS_NAME_WIN32,
            PWSTR(name.as_mut_ptr()),
            &mut name_size,
        )?;
        let mut title = vec![0u16; 32768];
        let count = GetWindowTextW(hwnd, &mut title);
        let mut rect = RECT::default();
        GetWindowRect(hwnd, &mut rect)?;
        let dpi = GetDpiForWindow(hwnd);
        let mut check_pid = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut check_pid));
        if check_pid != pid || !IsWindow(hwnd).as_bool() {
            return Err(Error::new(
                "stale-target",
                "Window changed while reading identity",
            ));
        }
        Ok(Window {
            hwnd: format!("{:x}", hwnd.0 as usize),
            pid,
            process_created: format!(
                "{:016x}",
                ((created.dwHighDateTime as u64) << 32) | created.dwLowDateTime as u64
            ),
            executable: String::from_utf16_lossy(&name[..name_size as usize]),
            title: String::from_utf16_lossy(&title[..count.max(0) as usize]),
            minimized: IsIconic(hwnd).as_bool(),
            width_px: rect.right - rect.left,
            height_px: rect.bottom - rect.top,
            dpi,
        })
    }
}
fn verify(window: &Window) -> Result<Window> {
    let hwnd = handle(window)?;
    lifetime::validate(hwnd)?;
    let actual = describe(hwnd)?;
    if !actual.same_identity(window) {
        return Err(Error::new(
            "stale-target",
            "HWND or process identity changed",
        ));
    }
    // Only actual top-level windows are eligible; child handles cannot extend the selection boundary.
    unsafe {
        if GetAncestor(hwnd, GA_ROOT) != hwnd {
            return Err(Error::new(
                "invalid-target",
                "Selected HWND must be a top-level window",
            ));
        }
    }
    Ok(actual)
}
fn list_windows() -> Result<Value> {
    unsafe extern "system" fn collect(hwnd: HWND, parameter: LPARAM) -> BOOL {
        let windows = &mut *(parameter.0 as *mut Vec<Window>);
        if windows.len() >= 4096 {
            return BOOL(1);
        }
        if lifetime::validate(hwnd).is_ok()
            && IsWindowVisible(hwnd).as_bool()
            && GetAncestor(hwnd, GA_ROOT) == hwnd
        {
            if let Ok(window) = describe(hwnd) {
                if window.validate().is_ok() {
                    windows.push(window);
                }
            }
        }
        BOOL(1)
    }
    let mut windows = Vec::<Window>::new();
    unsafe {
        EnumWindows(Some(collect), LPARAM(&mut windows as *mut _ as isize))?;
    }
    Ok(json!({ "windows": windows }))
}

#[derive(PartialEq, Eq)]
struct Interference {
    foreground: usize,
    cursor_visible: bool,
}
fn interference_state() -> Result<Interference> {
    unsafe {
        let mut cursor = CURSORINFO {
            cbSize: size_of::<CURSORINFO>() as u32,
            ..Default::default()
        };
        GetCursorInfo(&mut cursor)?;
        Ok(Interference {
            foreground: GetForegroundWindow().0 as usize,
            cursor_visible: cursor.flags == CURSOR_SHOWING,
        })
    }
}
fn guarded(window: &Window, operation: impl FnOnce(HWND) -> Result<Value>) -> Result<Value> {
    verify(window)?;
    let hwnd = handle(window)?;
    let before = unsafe { GetForegroundWindow() };
    let result = operation(hwnd);
    // Check even when a provider reports failure: it may have already changed focus.
    let after = unsafe { GetForegroundWindow() };
    if foreground_transition_conflicts(before.0 as usize, after.0 as usize, target_owned_foreground(hwnd, after)) {
        return Err(Error::new(
            "interference",
            "Target or target-owned popup became foreground during mutation; cause is ambiguous, action may have occurred; no focus recovery attempted",
        ));
    }
    verify(window).map_err(Error::uncertain)?;
    result
}
// Endpoint evidence cannot attribute a transition or detect transient activation between checks.
fn foreground_transition_conflicts(before: usize, after: usize, after_is_target: bool) -> bool {
    before != after && after_is_target
}
fn target_owned_foreground(target: HWND, foreground: HWND) -> bool {
    unsafe {
        if foreground == target || IsChild(target, foreground).as_bool() { return true; }
        let mut current = foreground;
        for _ in 0..256 {
            current = match GetWindow(current, GW_OWNER) { Ok(owner) => owner, Err(_) => return false };
            if current == target { return true; }
            if current.0.is_null() { return false; }
        }
        // An unexpectedly unbounded ownership chain is ambiguous; fail conservatively.
        true
    }
}
#[cfg(test)]
mod foreground_tests {
    use super::foreground_transition_conflicts;
    #[test]
    fn unrelated_switches_are_allowed_and_target_activation_is_ambiguous() {
        assert!(!foreground_transition_conflicts(10, 20, false)); // unrelated apps
        assert!(!foreground_transition_conflicts(1, 1, true));
        assert!(!foreground_transition_conflicts(1, 2, false)); // target loses foreground
        assert!(foreground_transition_conflicts(1, 2, true)); // target or owned popup becomes foreground
        assert!(foreground_transition_conflicts(0, 2, true));
    }
}
fn status(window: &Window) -> Result<Value> {
    let actual = verify(window)?;
    let hwnd = handle(window)?;
    let state = interference_state()?;
    Ok(
        json!({ "window": actual, "state": if actual.minimized { "minimized" } else if unsafe { IsZoomed(hwnd).as_bool() } { "maximized" } else { "normal" },
        "foregroundHwnd": format!("{:x}", state.foreground), "cursorVisible": state.cursor_visible }),
    )
}
fn restore(hwnd: HWND) -> Result<Value> {
    unsafe {
        if !IsIconic(hwnd).as_bool() {
            return Ok(json!({ "window": describe(hwnd)?, "restored": false }));
        }
        let previous = GetWindow(hwnd, GW_HWNDPREV).unwrap_or_default();
        // SW_SHOWNOACTIVATE is the restore variant that does not activate the selected HWND.
        ShowWindowAsync(hwnd, SW_SHOWNOACTIVATE).ok()?;
        let deadline = Instant::now() + Duration::from_secs(2);
        while IsIconic(hwnd).as_bool() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        if IsIconic(hwnd).as_bool() {
            return Err(Error::new("restore-rejected", "Window remained minimized"));
        }
        if previous.0.is_null() || IsWindow(previous).as_bool() {
            SetWindowPos(
                hwnd,
                previous,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER,
            )?;
        }
        Ok(json!({ "window": describe(hwnd).map_err(Error::uncertain)?, "restored": true }))
    }
}
fn resize(hwnd: HWND, width: i32, height: i32, dpi: u32) -> Result<Value> {
    unsafe {
        if IsIconic(hwnd).as_bool() || IsZoomed(hwnd).as_bool() {
            return Err(Error::new(
                "resize-state",
                "Window must be restored to normal state before resizing",
            ));
        }
        if GetWindowLongPtrW(hwnd, GWL_STYLE) & WS_THICKFRAME.0 as isize == 0 {
            return Err(Error::new("not-resizable", "Window has no resizable frame"));
        }
        let mut rect = RECT::default();
        GetWindowRect(hwnd, &mut rect)?;
        let mut monitor = MONITORINFO {
            cbSize: size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        GetMonitorInfoW(
            MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST),
            &mut monitor,
        )
        .ok()?;
        let area = monitor.rcWork;
        let mut limits = MINMAXINFO::default();
        limits.ptMinTrackSize.x = GetSystemMetricsForDpi(SM_CXMINTRACK, dpi);
        limits.ptMinTrackSize.y = GetSystemMetricsForDpi(SM_CYMINTRACK, dpi);
        limits.ptMaxTrackSize.x = area.right - area.left;
        limits.ptMaxTrackSize.y = area.bottom - area.top;
        if SendMessageTimeoutW(
            hwnd,
            WM_GETMINMAXINFO,
            WPARAM(0),
            LPARAM(&mut limits as *mut _ as isize),
            SMTO_ABORTIFHUNG | SMTO_BLOCK,
            500,
            None,
        )
        .0 == 0
        {
            return Err(Error::new(
                "provider-timeout",
                "Window size constraint query failed or timed out",
            ));
        }
        if width < limits.ptMinTrackSize.x
            || height < limits.ptMinTrackSize.y
            || width > limits.ptMaxTrackSize.x
            || height > limits.ptMaxTrackSize.y
            || rect.left < area.left
            || rect.top < area.top
            || rect.left as i64 + width as i64 > area.right as i64
            || rect.top as i64 + height as i64 > area.bottom as i64
        {
            return Err(Error::new(
                "resize-bounds",
                "Requested outer size exceeds app constraints or monitor work area",
            ));
        }
        SetWindowPos(
            hwnd,
            None,
            rect.left,
            rect.top,
            width,
            height,
            SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOOWNERZORDER,
        )?;
        let actual = describe(hwnd).map_err(Error::uncertain)?;
        let mut after = RECT::default();
        GetWindowRect(hwnd, &mut after)?;
        if actual.width_px != width
            || actual.height_px != height
            || after.left != rect.left
            || after.top != rect.top
        {
            return Err(Error::new(
                "resize-rejected",
                resize_rejection_message(actual.width_px, actual.height_px, width, height, &rect, &after),
            ));
        }
        Ok(
            json!({ "window": actual, "widthPx": actual.width_px, "heightPx": actual.height_px, "widthDip": actual.width_px as f64 * 96.0 / actual.dpi as f64, "heightDip": actual.height_px as f64 * 96.0 / actual.dpi as f64 }),
        )
    }
}

fn resize_rejection_message(actual_width: i32, actual_height: i32, width: i32, height: i32, before: &RECT, after: &RECT) -> String {
    if actual_width == width && actual_height == height {
        format!("Window position changed from ({}, {}) to ({}, {}) during resize", before.left, before.top, after.left, after.top)
    } else {
        format!("App returned {}x{} instead of {}x{} pixels", actual_width, actual_height, width, height)
    }
}

#[cfg(test)]
mod resize_error_tests {
    use super::*;
    #[test]
    fn position_only_rejection_reports_position_change() {
        let before = RECT { left: 10, top: 20, ..Default::default() };
        let after = RECT { left: 30, top: 20, ..Default::default() };
        assert_eq!(resize_rejection_message(800, 600, 800, 600, &before, &after), "Window position changed from (10, 20) to (30, 20) during resize");
        assert_eq!(resize_rejection_message(700, 600, 800, 600, &before, &after), "App returned 700x600 instead of 800x600 pixels");
    }
}
