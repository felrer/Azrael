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
        Security::*,
        System::{Com::*, Threading::*, WinRT::*},
        UI::{Accessibility::*, HiDpi::*, WindowsAndMessaging::*},
    },
};

#[path = "capture.rs"]
mod capture;
#[path = "desktop_capture.rs"]
mod desktop_capture;
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
    descriptors: Vec<Value>,
    coverage: Value,
    signature: Value,
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
        if matches!(method, "act" | "restore" | "resize") {
            if let Some(window) = selected.as_ref() { crate::overlay::guard(window)?; }
        }
        let result = match method {
            "windowAtPoint" => {
                let p: protocol::WindowAtPoint = protocol::params(params)?;
                window_at_point(POINT { x: p.x, y: p.y })
            }
            "actionPoint" => {
                let p: protocol::ActionPoint = protocol::params(params)?;
                self.action_point(p)
            }
            "captureDesktop" => {
                let p: protocol::DesktopCapture = protocol::params(params)?;
                p.validate()?;
                desktop_capture::capture(&p.blocked_apps)
            }
            "listWindows" => list_windows(),
            "observe" => {
                let p: protocol::Target = protocol::params(params)?;
                self.observe(&p.window)
            }
            "inspect" => {
                let p: protocol::Inspect = protocol::params(params)?;
                p.validate()?;
                self.inspect(p)
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
        ensure_not_minimized(&current)?;
        if current.width_px <= 0 || current.height_px <= 0 {
            return Err(Error::new(
                "unobservable-target",
                "Window dimensions must be positive before observing",
            ));
        }
        let hwnd = handle(&current)?;
        let work = (|| -> Result<Value> {

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
                id: id.clone(), window: after_capture.clone(), elements: HashMap::new(),
                descriptors: Vec::new(), coverage: json!("image-only"), signature: Value::Null,
            });
            Ok(
                json!({ "window": after_capture, "observationId": id, "frameTimestamp": frame.timestamp.to_string(),
                "widthPx": frame.width, "heightPx": frame.height, "dpi": after_capture.dpi, "captureProtection": frame.protection,
                "elements": [], "elementsTruncated": false, "retrieval": {"mode":"image","coverage":"image-only","returnedCount":0}, "image": { "mimeType": "image/png", "data": frame.data } }),
            )
        })();
        work
    }
    fn inspect(&mut self, request: protocol::Inspect) -> Result<Value> {
        let current = verify(&request.window)?;
        ensure_not_minimized(&current)?;
        let hwnd = handle(&current)?;
        let previous = self.observation.take();
        let prior = previous.as_ref().filter(|o| o.window.same_identity(&current)
            && ensure_capture_geometry(&o.window, &current).is_ok());
        let exact = prior.filter(|o| request.observation_id.as_ref() == Some(&o.id));
        let scope_compatible = request.mode() != "changes" || prior.is_some_and(|o|
            request.base_observation_id.as_ref() == Some(&o.id) && o.signature == json!({"query":request.query,"scope":request.scope,"limit":request.limit()}));
        let container = request.scope.as_ref().and_then(|s| s.container_id.as_ref()).filter(|_| scope_compatible);
        let container_ref = if let Some(id) = container {
            Some(exact.and_then(|o| o.elements.get(id)).ok_or_else(|| Error::new("stale-observation", "Scope requires an exact retained observation and container"))?)
        } else { None };
        if request.mode() == "read" {
            let observation = exact.ok_or_else(|| Error::new("stale-observation", "Read requires an exact retained observation"))?;
            let element = observation.elements.get(request.element_id.as_ref().unwrap())
                .ok_or_else(|| Error::new("unknown-element", "Element was not retained in this observation"))?;
            uia::assert_descendant(&self.automation, hwnd, element)?;
            let mut descriptor = uia::read(&self.automation, hwnd, element, &request)?;
            let after = verify(&request.window)?;
            ensure_capture_geometry(&current, &after)?;
            self.sequence = self.sequence.checked_add(1).ok_or_else(|| Error::new("backend-exhausted", "Observation sequence exhausted"))?;
            let id = format!("observation-{}",self.sequence);
            if descriptor.get("textRange").is_some() { descriptor["textRange"]["revision"] = json!(id); }
            let result = json!({"window":after,"observationId":id,"elements":[descriptor],"elementsTruncated":false,
                "retrieval":{"mode":"read","coverage":"requested-fields","returnedCount":1}});
            self.observation = Some(Observation {id,window:after,elements:HashMap::from([(request.element_id.clone().unwrap(),element.clone())]),
                descriptors:vec![descriptor],coverage:json!("requested-fields"),signature:Value::Null});
            return Ok(result);
        }
        let signature = json!({"query":request.query,"scope":request.scope,"limit":request.limit()});
        let compatible_base = prior.filter(|o| request.base_observation_id.as_ref() == Some(&o.id) && o.signature == signature);
        let mut scan_request = request.clone();
        if request.mode() == "changes" && compatible_base.is_none() {
            scan_request.mode = Some("summary".to_owned());
            scan_request.query = None; scan_request.scope = None; scan_request.limit = Some(20);
        }
        let (mut descriptors, mut elements, mut retrieval) = if request.mode() == "task" {
            let (d,e,t) = uia::elements(&self.automation, hwnd)?;
            let count = d.len();
            (d,e,json!({"mode":"task","coverage":if t {"partial"} else {"complete"},"returnedCount":count,"incompleteReason":if t {Some("scan-limit")} else {None}}))
        } else { uia::retrieve(&self.automation, hwnd, &scan_request,
            if request.mode() == "changes" && compatible_base.is_none() { None } else { container_ref })? };
        let mut changes = Value::Null;
        if request.mode() == "changes" {
            if let Some(base) = compatible_base {
                // Compare actual provider identities; traversal positions alone do not identify controls.
                let mut matched = std::collections::HashSet::new();
                let mut changed = Vec::new();
                let mut remapped = HashMap::new();
                for (index, descriptor) in descriptors.iter_mut().enumerate() {
                    let original = descriptor["id"].as_str().unwrap().to_owned();
                    let element = elements.remove(&original).unwrap();
                    let old = base.elements.iter().find(|(_, old)| unsafe { self.automation.CompareElements(&element, *old).is_ok_and(|v| v.as_bool()) });
                    let id = old.map(|(id,_)| id.clone()).unwrap_or_else(|| format!("new-{}-{}",self.sequence + 1,index));
                    descriptor["id"] = json!(id);
                    if let Some((old_id,_)) = old { matched.insert(old_id.clone()); }
                    if !base.descriptors.iter().any(|v| v == descriptor) { changed.push(descriptor.clone()); }
                    remapped.insert(id,element);
                }
                elements = remapped;
                let complete = retrieval["coverage"] == "complete" && base.coverage == "complete";
                let removed: Vec<_> = if complete { base.elements.keys().filter(|id| !matched.contains(*id)).cloned().collect() } else { Vec::new() };
                changes = json!({"updated":changed,"removed":removed,"removalsComplete":complete,"basis":"fresh-provider-scan"});
            } else {
                retrieval["fallback"] = json!("summary");
                retrieval["fallbackReason"] = json!("base-unavailable-or-incompatible");
            }
        }
        let after = verify(&request.window)?;
        ensure_capture_geometry(&current, &after)?;
        self.sequence = self.sequence.checked_add(1)
            .ok_or_else(|| Error::new("backend-exhausted", "Observation sequence exhausted"))?;
        let id = format!("observation-{}", self.sequence);
        let retained_signature = json!({"query":scan_request.query,"scope":scan_request.scope,"limit":scan_request.limit()});
        self.observation = Some(Observation { id: id.clone(), window: after.clone(), elements,
            descriptors:descriptors.clone(), coverage:retrieval["coverage"].clone(), signature:retained_signature });
        Ok(json!({ "window": after, "observationId": id, "elements": descriptors,
            "elementsTruncated": retrieval["coverage"] == "partial", "retrieval":retrieval,"changes":changes }))
    }
    fn action_point(&self, p: protocol::ActionPoint) -> Result<Value> {
        let current = query_window(&p.window)?;
        let observation = self.observation.as_ref().ok_or_else(||
            Error::new("stale-observation", "A retained observation is required"))?;
        if observation.id != p.observation_id || !observation.window.same_identity(&current) {
            return Err(Error::new("stale-observation", "Observation does not belong to this window"));
        }
        ensure_capture_geometry(&observation.window, &current)?;
        let hwnd = handle(&current)?;
        unsafe {
            let mut outer = RECT::default();
            GetWindowRect(hwnd, &mut outer)?;
            let bounds = if let Some(id) = p.element_id.as_ref() {
                let element = observation.elements.get(id).ok_or_else(||
                    Error::new("unknown-element", "Element was not retained in this observation"))?;
                uia::assert_descendant(&self.automation, hwnd, element)?;
                // CompareElements compares provider runtime identities, including after refreshing
                // the retained reference. No UIA action or global input is performed.
                let cache = self.automation.CreateCacheRequest()?;
                cache.SetTreeScope(TreeScope_Element)?;
                let fresh = element.BuildUpdatedCache(&cache)?;
                if !self.automation.CompareElements(element, &fresh)?.as_bool()
                    || !fresh.CurrentIsEnabled()?.as_bool() || fresh.CurrentIsOffscreen()?.as_bool() {
                    return Err(Error::new("stale-element", "Element identity or enabled visibility changed"));
                }
                uia::assert_descendant(&self.automation, hwnd, &fresh)?;
                let rect = fresh.CurrentBoundingRectangle()?;
                RECT { left: rect.left.max(outer.left), top: rect.top.max(outer.top),
                    right: rect.right.min(outer.right), bottom: rect.bottom.min(outer.bottom) }
            } else {
                let mut client = RECT::default();
                GetClientRect(hwnd, &mut client)?;
                let mut origin = POINT::default();
                ClientToScreen(hwnd, &mut origin).ok()?;
                if client.right > client.left && client.bottom > client.top {
                    RECT { left: origin.x, top: origin.y,
                        right: origin.x.checked_add(client.right).ok_or_else(point_bounds_error)?,
                        bottom: origin.y.checked_add(client.bottom).ok_or_else(point_bounds_error)? }
                } else { outer }
            };
            let point = rect_center(&bounds)?;
            if point.x < outer.left || point.x >= outer.right || point.y < outer.top || point.y >= outer.bottom
                || MonitorFromPoint(point, MONITOR_DEFAULTTONULL).0.is_null() {
                return Err(point_bounds_error());
            }
            query_window(&p.window)?;
            let mut after = RECT::default();
            GetWindowRect(hwnd, &mut after)?;
            if outer.left != after.left || outer.top != after.top || outer.right != after.right || outer.bottom != after.bottom {
                return Err(Error::new("stale-observation", "Window moved while resolving action point"));
            }
            Ok(json!({"x":point.x,"y":point.y}))
        }
    }
    fn act(&mut self, p: protocol::Act) -> Result<Value> {
        ensure_not_minimized(&verify(&p.window)?)?;
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
            ensure_not_minimized(&verify(&p.window)?)?;
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
fn ensure_not_minimized(window: &Window) -> Result<()> {
    if window.minimized {
        return Err(Error::new(
            "window-minimized",
            "Selected window is minimized; restore it before continuing",
        ));
    }
    Ok(())
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
    fn window() -> Window {
        Window {
            hwnd: "1234".into(),
            pid: 42,
            process_created: "abcd".into(),
            executable: "C:\\app.exe".into(),
            title: "before".into(),
            minimized: false,
            width_px: 1016,
            height_px: 768,
            dpi: 144,
        }
    }
    #[test]
    fn minimized_guard_uses_current_state_and_keeps_geometry_distinct() {
        let mut current = window();
        assert!(ensure_not_minimized(&current).is_ok());
        current.width_px = 0;
        current.height_px = -1;
        assert!(ensure_not_minimized(&current).is_ok());
        current.minimized = true;
        let error = ensure_not_minimized(&current).unwrap_err();
        assert_eq!(error.code, "window-minimized");
        assert_eq!(error.mutation_outcome, None);
        let payload = serde_json::to_value(error).unwrap();
        assert_eq!(payload["code"], "window-minimized");
        assert!(payload.get("mutationOutcome").is_none());
        assert!(payload.get("restoreAllowed").is_none());
        current.minimized = false;
        assert!(ensure_not_minimized(&current).is_ok());
    }
    #[test]
    fn rejects_outer_geometry_changes_without_equating_outer_and_frame_sizes() {
        let before = window();
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
pub(crate) fn describe(hwnd: HWND) -> Result<Window> {
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
pub(crate) fn verify(window: &Window) -> Result<Window> {
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
        if !crate::overlay::owns(hwnd)
            && lifetime::validate(hwnd).is_ok()
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

fn point_bounds_error() -> Error {
    Error::new("unobservable-target", "No valid screen point exists inside target bounds")
}
fn rect_center(rect: &RECT) -> Result<POINT> {
    if rect.right <= rect.left || rect.bottom <= rect.top { return Err(point_bounds_error()); }
    Ok(POINT {
        x: (rect.left as i64 + (rect.right as i64 - rect.left as i64) / 2) as i32,
        y: (rect.top as i64 + (rect.bottom as i64 - rect.top as i64) / 2) as i32,
    })
}

// Query-only admission. Existing selected-window action authority remains unchanged.
fn query_window(requested: &Window) -> Result<Window> {
    let current = verify(requested)?;
    ensure_not_minimized(&current)?;
    let hwnd = handle(&current)?;
    unsafe {
        if crate::overlay::owns(hwnd) || !IsWindowVisible(hwnd).as_bool() {
            return Err(Error::new("unobservable-target", "Window is hidden or belongs to the overlay"));
        }
        let mut affinity = 0;
        GetWindowDisplayAffinity(hwnd, &mut affinity)?;
        if affinity != 0 {
            return Err(Error::new("protected-target", "Window is capture protected"));
        }
        let mut owner = hwnd;
        let mut seen = std::collections::HashSet::new();
        while !owner.0.is_null() {
            if seen.len() >= 64 || !seen.insert(owner.0 as usize) {
                return Err(Error::new("invalid-target", "Window owner chain is invalid"));
            }
            let descriptor = verify(&describe(owner)?)?;
            query_process(descriptor.pid)?;
            let mut owner_affinity = 0;
            GetWindowDisplayAffinity(owner, &mut owner_affinity)?;
            if owner_affinity != 0 {
                return Err(Error::new("protected-target", "Window owner is capture protected"));
            }
            owner = GetWindow(owner, GW_OWNER).unwrap_or_default();
        }
    }
    verify(&current)
}

unsafe fn token_information(token: HANDLE, class: TOKEN_INFORMATION_CLASS) -> Result<Vec<usize>> {
    let mut bytes = 0;
    let _ = GetTokenInformation(token, class, None, 0, &mut bytes);
    if bytes == 0 || bytes > 65536 {
        return Err(Error::new("inaccessible-target", "Token information has invalid size"));
    }
    let mut data = vec![0usize; (bytes as usize + size_of::<usize>() - 1) / size_of::<usize>()];
    GetTokenInformation(token, class, Some(data.as_mut_ptr().cast()), bytes, &mut bytes)?;
    Ok(data)
}
unsafe fn query_process(pid: u32) -> Result<()> {
    let process = Process(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)?);
    let mut own_handle = HANDLE::default();
    OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut own_handle)?;
    let own = Process(own_handle);
    let mut target_handle = HANDLE::default();
    OpenProcessToken(process.0, TOKEN_QUERY, &mut target_handle)?;
    let target = Process(target_handle);
    let own_user = token_information(own.0, TokenUser)?;
    let target_user = token_information(target.0, TokenUser)?;
    EqualSid((*(own_user.as_ptr().cast::<TOKEN_USER>())).User.Sid,
        (*(target_user.as_ptr().cast::<TOKEN_USER>())).User.Sid)
        .map_err(|_| Error::new("protected-target", "Window belongs to another user"))?;
    let own_session = token_information(own.0, TokenSessionId)?;
    let target_session = token_information(target.0, TokenSessionId)?;
    if *own_session.as_ptr().cast::<u32>() != *target_session.as_ptr().cast::<u32>() {
        return Err(Error::new("protected-target", "Window belongs to another session"));
    }
    let integrity = |token| -> Result<u32> {
        let info = token_information(token, TokenIntegrityLevel)?;
        let sid = (*info.as_ptr().cast::<TOKEN_MANDATORY_LABEL>()).Label.Sid;
        if !IsValidSid(sid).as_bool() { return Err(Error::new("inaccessible-target", "Invalid integrity SID")); }
        let count = *GetSidSubAuthorityCount(sid);
        if count == 0 { return Err(Error::new("inaccessible-target", "Missing integrity level")); }
        Ok(*GetSidSubAuthority(sid, count as u32 - 1))
    };
    if integrity(target.0)? > integrity(own.0)? {
        return Err(Error::new("protected-target", "Window has higher integrity than the backend"));
    }
    Ok(())
}

fn window_at_point(point: POINT) -> Result<Value> {
    unsafe {
        if MonitorFromPoint(point, MONITOR_DEFAULTTONULL).0.is_null() {
            return Err(point_bounds_error());
        }
        let resolve = || -> Result<HWND> {
            let hit = WindowFromPoint(point);
            if hit.0.is_null() { return Err(Error::new("unobservable-target", "No window exists at this screen point")); }
            let root = GetAncestor(hit, GA_ROOT);
            if !crate::overlay::owns(root) { return Ok(root); }
            // Only our transparent overlay is bypassed. Unknown foreign layers
            // must never cause a guessed selection beneath them.
            let mut below = GetWindow(root, GW_HWNDNEXT).unwrap_or_default();
            for _ in 0..4096 {
                if below.0.is_null() { break; }
                if !crate::overlay::owns(below) && IsWindowVisible(below).as_bool() {
                    let mut rect = RECT::default();
                    GetWindowRect(below, &mut rect)?;
                    if point.x >= rect.left && point.x < rect.right && point.y >= rect.top && point.y < rect.bottom {
                        // A region or transparent foreign layer prevents a safe rectangular hit.
                        let region = CreateRectRgn(0, 0, 0, 0);
                        if region.0.is_null() { return Err(point_bounds_error()); }
                        let kind = GetWindowRgn(below, region);
                        let _ = DeleteObject(region);
                        if kind.0 != ERROR || GetWindowLongPtrW(below, GWL_EXSTYLE) & WS_EX_TRANSPARENT.0 as isize != 0 {
                            return Err(Error::new("unobservable-target", "Cannot safely resolve the window beneath the overlay"));
                        }
                        return Ok(below);
                    }
                }
                below = GetWindow(below, GW_HWNDNEXT).unwrap_or_default();
            }
            Err(Error::new("unobservable-target", "No safe window exists beneath the overlay"))
        };
        let hwnd = resolve()?;
        let window = query_window(&describe(hwnd)?)?;
        if resolve()? != hwnd { return Err(Error::new("stale-target", "Screen point target changed during query")); }
        Ok(json!({"window":query_window(&window)?}))
    }
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
    // UIA actions can activate the target or its popup. Foreground changes are
    // ordinary app behavior, not a failure or evidence of user interference.
    let result = operation(hwnd);
    verify(window).map_err(Error::uncertain)?;
    result
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
