use crate::protocol::{self, Error, Result, Window};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    io::{self, Write},
    mem::size_of,
    sync::{mpsc, Mutex, OnceLock},
    thread,
    time::Duration,
};
use windows::{
    core::*,
    Win32::{
        Foundation::*,
        Graphics::{Dwm::*, Gdi::*},
        UI::{HiDpi::*, Input::KeyboardAndMouse::*, WindowsAndMessaging::*},
    },
};

static OWNED: OnceLock<Mutex<HashSet<usize>>> = OnceLock::new();
static STOPPED: OnceLock<Mutex<Option<(String, u64, Window, bool)>>> = OnceLock::new();
fn stopped() -> &'static Mutex<Option<(String, u64, Window, bool)>> {
    STOPPED.get_or_init(|| Mutex::new(None))
}
pub fn owns(hwnd: HWND) -> bool {
    OWNED
        .get_or_init(Default::default)
        .lock()
        .unwrap()
        .contains(&(hwnd.0 as usize))
}
pub fn guard(window: &Window) -> Result<()> {
    if stopped()
        .lock()
        .unwrap()
        .as_ref()
        .is_some_and(|(_, _, w, cancelled)| *cancelled && w.same_identity(window))
    {
        return Err(Error::new(
            "operation-cancelled",
            "Window operation stopped by Escape",
        ));
    }
    Ok(())
}
pub fn write_message(value: &Value) -> io::Result<()> {
    let stdout = io::stdout();
    let mut writer = stdout.lock();
    serde_json::to_writer(&mut writer, value)?;
    writer.write_all(b"\n")?;
    writer.flush()
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Show {
    window: Window,
    target_id: String,
    generation: u64,
    label: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Hide {
    target_id: String,
    generation: u64,
}
pub fn hide_without_overlay(params: Value) -> Result<Value> {
    let p: Hide = protocol::params(params)?;
    if !valid_id(&p.target_id) || p.generation > 9_007_199_254_740_991 {
        return Err(Error::new("invalid-params", "Invalid overlay identity"));
    }
    Ok(json!({"visible":false}))
}
fn valid_id(id: &str) -> bool {
    id.len() == 36
        && id.bytes().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                b == b'-'
            } else {
                b.is_ascii_hexdigit()
            }
        })
}
enum Command {
    Show(Show, mpsc::SyncSender<Result<Value>>),
    Hide(Hide, mpsc::SyncSender<Result<Value>>),
    Exit,
}
pub struct Overlay {
    tx: mpsc::SyncSender<Command>,
    worker: Option<thread::JoinHandle<()>>,
}
impl Overlay {
    pub fn new() -> Self {
        let (tx, rx) = mpsc::sync_channel(2);
        let worker = thread::spawn(move || unsafe { run(rx) });
        Self {
            tx,
            worker: Some(worker),
        }
    }
    pub fn call(&self, method: &str, params: Value) -> Result<Value> {
        let (tx, rx) = mpsc::sync_channel(1);
        let command = if method == "overlayShow" {
            let p: Show = protocol::params(params)?;
            if !valid_id(&p.target_id)
                || p.generation > 9_007_199_254_740_991
                || p.label.chars().count() > 48
                || p.label.chars().any(char::is_control)
            {
                return Err(Error::new(
                    "invalid-params",
                    "Invalid overlay identity or label",
                ));
            }
            crate::windows_backend::verify(&p.window)?;
            Command::Show(p, tx)
        } else {
            let p: Hide = protocol::params(params)?;
            if !valid_id(&p.target_id) || p.generation > 9_007_199_254_740_991 {
                return Err(Error::new("invalid-params", "Invalid overlay identity"));
            }
            Command::Hide(p, tx)
        };
        self.tx
            .send(command)
            .map_err(|_| Error::new("overlay-unavailable", "Overlay thread stopped"))?;
        rx.recv_timeout(Duration::from_secs(3))
            .map_err(|_| Error::new("overlay-unavailable", "Overlay setup timed out"))?
    }
}
impl Drop for Overlay {
    fn drop(&mut self) {
        let _ = self.tx.send(Command::Exit);
        if let Some(t) = self.worker.take() {
            let _ = t.join();
        }
    }
}
unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, w: WPARAM, l: LPARAM) -> LRESULT {
    match msg {
        WM_NCHITTEST => LRESULT(HTTRANSPARENT as isize),
        WM_MOUSEACTIVATE => LRESULT(MA_NOACTIVATE as isize),
        WM_NCDESTROY => {
            OWNED
                .get_or_init(Default::default)
                .lock()
                .unwrap()
                .remove(&(hwnd.0 as usize));
            DefWindowProcW(hwnd, msg, w, l)
        }
        _ => DefWindowProcW(hwnd, msg, w, l),
    }
}
unsafe fn hint_font(height: i32) -> HFONT {
    CreateFontW(
        -((height as f64) * 0.36) as i32,
        0,
        0,
        0,
        400,
        0,
        0,
        0,
        DEFAULT_CHARSET.0 as u32,
        OUT_DEFAULT_PRECIS.0 as u32,
        CLIP_DEFAULT_PRECIS.0 as u32,
        CLEARTYPE_QUALITY.0 as u32,
        DEFAULT_PITCH.0 as u32,
        w!("Segoe UI"),
    )
}
unsafe fn hint_width(text: &str, height: i32, available: i32) -> i32 {
    let dc = CreateCompatibleDC(None);
    let font = hint_font(height);
    let old = SelectObject(dc, font);
    let mut text: Vec<u16> = text.encode_utf16().collect();
    let mut rect = RECT::default();
    DrawTextW(
        dc,
        &mut text,
        &mut rect,
        DT_SINGLELINE | DT_CALCRECT | DT_NOPREFIX,
    );
    SelectObject(dc, old);
    let _ = DeleteObject(font);
    let _ = DeleteDC(dc);
    (rect.right - rect.left + height).min(available).max(1)
}
fn hint_text(label: &str, registered: bool) -> String {
    if registered {
        format!("{label}  ·  Esc to cancel")
    } else {
        format!("{label}  ·  Esc 사용 불가 · Azrael에서 중지")
    }
}
// Preserve the stop guidance before spending narrow work-area space on context.
unsafe fn fitted_hint(label: &str, registered: bool, height: i32, available: i32) -> String {
    let full = hint_text(label, registered);
    if hint_width(&full, height, i32::MAX) <= available {
        return full;
    }
    let primary = if !registered {
        "Esc 사용 불가"
    } else if hint_width("Esc to cancel", height, i32::MAX) <= available {
        "Esc to cancel"
    } else {
        "Esc 중지"
    };
    let mut context = if registered {
        label.to_owned()
    } else {
        format!("Azrael에서 중지 · {label}")
    };
    while !context.is_empty() {
        let candidate = format!("{primary} · {context}…");
        if hint_width(&candidate, height, i32::MAX) <= available {
            return candidate;
        }
        context.pop();
    }
    primary.to_owned()
}
struct Layer(HWND);
#[derive(Clone, Copy)]
struct Glow {
    extent: i32,
    corner_radius: i32,
}
impl Layer {
    unsafe fn new(owner: HWND) -> Result<Self> {
        let hwnd = CreateWindowExW(
            WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW,
            w!("AzraelWindowOverlay"),
            w!(""),
            WS_POPUP,
            0,
            0,
            0,
            0,
            owner,
            None,
            None,
            None,
        )?;
        OWNED
            .get_or_init(Default::default)
            .lock()
            .unwrap()
            .insert(hwnd.0 as usize);
        // Keep UI chrome out of capture where supported. Rendering still works if unsupported.
        let _ = SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE);
        Ok(Self(hwnd))
    }
    unsafe fn paint(
        &self,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
        glow: Option<Glow>,
        text: Option<&str>,
    ) -> Result<()> {
        let dc = CreateCompatibleDC(None);
        let mut info = BITMAPINFO::default();
        info.bmiHeader = BITMAPINFOHEADER {
            biSize: size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: -height,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        };
        let mut bits = std::ptr::null_mut();
        let bitmap = CreateDIBSection(dc, &info, DIB_RGB_COLORS, &mut bits, None, 0)?;
        let previous = SelectObject(dc, bitmap);
        let pixels = std::slice::from_raw_parts_mut(bits as *mut u32, (width * height) as usize);
        pixels.fill(0);
        if let Some(glow) = glow {
            // One continuous surface owns the entire visible frame. Paint only
            // its corner areas; the untouched centre remains fully transparent.
            let extent = glow.extent.min(width / 2).min(height / 2).max(1);
            for c in 0..4 {
                for dy in 0..extent {
                    for dx in 0..extent {
                        let px = if c % 2 == 0 { dx } else { width - 1 - dx };
                        let py = if c < 2 { dy } else { height - 1 - dy };
                        pixels[(py * width + px) as usize] =
                            corner_glow_pixel(dx, dy, extent, glow.corner_radius);
                    }
                }
            }
        } else {
            for py in 0..height {
                for px in 0..width {
                    let r = (height.min(width) as f64) / 2.0;
                    let cx = (px as f64).clamp(r, width as f64 - r);
                    let cy = height as f64 / 2.0;
                    pixels[(py * width + px) as usize] =
                        if ((px as f64 - cx).powi(2) + (py as f64 - cy).powi(2)).sqrt() < r {
                            0xc02b2725
                        } else {
                            0
                        };
                }
            }
        }
        if let Some(text) = text {
            let before = pixels.to_vec();
            let font = hint_font(height);
            let old_font = SelectObject(dc, font);
            SetBkMode(dc, TRANSPARENT);
            SetTextColor(dc, COLORREF(0x00ffffff));
            let mut wide: Vec<u16> = text.encode_utf16().collect();
            let mut rect = RECT {
                left: (height / 2).min(width / 4),
                top: 0,
                right: width - (height / 2).min(width / 4),
                bottom: height,
            };
            DrawTextW(
                dc,
                &mut wide,
                &mut rect,
                DT_SINGLELINE | DT_VCENTER | DT_CENTER | DT_NOPREFIX | DT_END_ELLIPSIS,
            );
            for (p, b) in pixels.iter_mut().zip(before) {
                if *p & 0x00ffffff != b & 0x00ffffff {
                    let coverage = (*p & 255).max((*p >> 8) & 255).max((*p >> 16) & 255);
                    let v = (coverage * 235 / 255).max(43);
                    *p = 0xff000000 | v | (v << 8) | (v << 16);
                }
            }
            SelectObject(dc, old_font);
            let _ = DeleteObject(font);
        }
        let result = UpdateLayeredWindow(
            self.0,
            None,
            Some(&POINT { x, y }),
            Some(&SIZE {
                cx: width,
                cy: height,
            }),
            dc,
            Some(&POINT::default()),
            COLORREF(0),
            Some(&BLENDFUNCTION {
                BlendOp: AC_SRC_OVER as u8,
                BlendFlags: 0,
                SourceConstantAlpha: 255,
                AlphaFormat: AC_SRC_ALPHA as u8,
            }),
            ULW_ALPHA,
        );
        SelectObject(dc, previous);
        let _ = DeleteObject(bitmap);
        let _ = DeleteDC(dc);
        result?;
        let _ = ShowWindow(self.0, SW_SHOWNOACTIVATE);
        Ok(())
    }
    unsafe fn move_to(&self, x: i32, y: i32) -> Result<()> {
        SetWindowPos(
            self.0,
            None,
            x,
            y,
            0,
            0,
            SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOZORDER,
        )?;
        let _ = ShowWindow(self.0, SW_SHOWNOACTIVATE);
        Ok(())
    }
}
impl Drop for Layer {
    fn drop(&mut self) {
        unsafe {
            if owns(self.0) {
                let _ = DestroyWindow(self.0);
            }
        }
    }
}
fn glow_pixel(x: i32, y: i32, w: i32, h: i32) -> u32 {
    let radius = ((x as f64 / w as f64).powi(2) + (y as f64 / h as f64).powi(2)).sqrt();
    let alpha = ((1.0 - radius).max(0.0).powi(2) * 105.0) as u32;
    premultiplied_glow(alpha)
}
fn premultiplied_glow(alpha: u32) -> u32 {
    let red = 125 * alpha / 255;
    let green = 133 * alpha / 255;
    let blue = 250 * alpha / 255;
    alpha << 24 | red << 16 | green << 8 | blue
}
fn corner_glow_pixel(x: i32, y: i32, extent: i32, rounding: i32) -> u32 {
    let radius = rounding.min(extent).max(0) as f64;
    let coverage = if (x as f64) < radius && (y as f64) < radius {
        let distance = (radius - x as f64 - 0.5).hypot(radius - y as f64 - 0.5);
        (radius + 0.5 - distance).clamp(0.0, 1.0)
    } else {
        1.0
    };
    let alpha = (glow_pixel(x, y, extent, extent) >> 24) as f64 * coverage;
    premultiplied_glow(alpha.round() as u32)
}
unsafe fn visible_frame(target: HWND) -> Result<RECT> {
    let mut rect = RECT::default();
    if DwmGetWindowAttribute(
        target,
        DWMWA_EXTENDED_FRAME_BOUNDS,
        &mut rect as *mut _ as *mut _,
        size_of::<RECT>() as u32,
    )
    .is_err()
        || rect.right <= rect.left
        || rect.bottom <= rect.top
    {
        GetWindowRect(target, &mut rect)?;
    }
    Ok(rect)
}
unsafe fn corner_radius(target: HWND, rect: RECT, dpi: u32) -> i32 {
    if IsZoomed(target).as_bool() {
        return 0;
    }
    let mut preference = DWMWCP_DEFAULT;
    if DwmGetWindowAttribute(
        target,
        DWMWA_WINDOW_CORNER_PREFERENCE,
        &mut preference as *mut _ as *mut _,
        size_of::<DWM_WINDOW_CORNER_PREFERENCE>() as u32,
    )
    .is_err()
    {
        return 0;
    }
    let style = GetWindowLongW(target, GWL_STYLE) as u32;
    let radius = if preference == DWMWCP_ROUNDSMALL {
        4.0
    } else if preference == DWMWCP_ROUND
        || (preference == DWMWCP_DEFAULT
            && style & (WS_THICKFRAME.0 | WS_CAPTION.0) == (WS_THICKFRAME.0 | WS_CAPTION.0))
    {
        8.0
    } else {
        0.0
    };
    // DWM removes rounding on snapped windows spanning the work area's height.
    let mut monitor = MONITORINFO {
        cbSize: size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    if GetMonitorInfoW(
        MonitorFromWindow(target, MONITOR_DEFAULTTONEAREST),
        &mut monitor,
    )
    .as_bool()
        && rect.top <= monitor.rcWork.top
        && rect.bottom >= monitor.rcWork.bottom
    {
        return 0;
    }
    ((radius * dpi as f64 / 96.0).round() as i32)
        .min((rect.right - rect.left) / 2)
        .min((rect.bottom - rect.top) / 2)
}
struct Active {
    show: Show,
    layers: Vec<Layer>,
    hotkey: bool,
    last: Option<(i32, i32, i32, i32, u32, bool, bool, i32)>,
}
impl Active {
    unsafe fn refresh(&mut self) -> Result<()> {
        let current = crate::windows_backend::verify(&self.show.window)?;
        let target = HWND(protocol::hex(&current.hwnd)? as usize as *mut _);
        let foreground = GetForegroundWindow() == target;
        let visible = !IsIconic(target).as_bool() && IsWindowVisible(target).as_bool();
        if !visible {
            if self.hotkey {
                let _ = UnregisterHotKey(None, 1);
                self.hotkey = false;
            }
            for layer in &self.layers {
                let _ = ShowWindow(layer.0, SW_HIDE);
            }
            self.last = None;
            return Ok(());
        }
        if !foreground {
            if self.hotkey {
                let _ = UnregisterHotKey(None, 1);
                self.hotkey = false;
            }
            let _ = ShowWindow(self.layers[1].0, SW_HIDE);
        } else if !self.hotkey {
            self.hotkey = RegisterHotKey(None, 1, MOD_NOREPEAT, 0x1b).is_ok();
        }
        let rect = visible_frame(target)?;
        let rounding = corner_radius(target, rect, current.dpi);
        let geometry = (
            rect.left,
            rect.top,
            rect.right,
            rect.bottom,
            current.dpi,
            self.hotkey,
            foreground,
            rounding,
        );
        if self.last == Some(geometry) {
            return Ok(());
        }
        let scale = current.dpi as f64 / 96.0;
        let size = ((190.0 * scale) as i32)
            .min((rect.right - rect.left) / 2)
            .min((rect.bottom - rect.top) / 2)
            .max(1);
        let pixels_changed = self.last.is_none_or(|old| {
            (old.2 - old.0, old.3 - old.1, old.4, old.7)
                != (
                    rect.right - rect.left,
                    rect.bottom - rect.top,
                    current.dpi,
                    rounding,
                )
        });
        if pixels_changed {
            self.layers[0].paint(
                rect.left,
                rect.top,
                rect.right - rect.left,
                rect.bottom - rect.top,
                Some(Glow {
                    extent: size,
                    corner_radius: rounding,
                }),
                None,
            )?;
        } else {
            self.layers[0].move_to(rect.left, rect.top)?;
        }
        if !foreground {
            self.last = Some(geometry);
            return Ok(());
        }
        let mut monitor = MONITORINFO {
            cbSize: size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !GetMonitorInfoW(
            MonitorFromWindow(target, MONITOR_DEFAULTTONEAREST),
            &mut monitor,
        )
        .as_bool()
        {
            return Err(Error::new(
                "overlay-unavailable",
                "Cannot read monitor work area",
            ));
        }
        let margin = ((20.0 * scale) as i32)
            .min((monitor.rcWork.right - monitor.rcWork.left) / 4)
            .min((monitor.rcWork.bottom - monitor.rcWork.top) / 4)
            .max(0);
        let height = ((42.0 * scale) as i32)
            .min(monitor.rcWork.bottom - monitor.rcWork.top - 2 * margin)
            .max(1);
        let available = monitor.rcWork.right - monitor.rcWork.left - 2 * margin;
        let hint = fitted_hint(&self.show.label, self.hotkey, height, available);
        let width = hint_width(
            &hint,
            height,
            monitor.rcWork.right - monitor.rcWork.left - 2 * margin,
        );
        self.layers[1].paint(
            monitor.rcWork.left + margin,
            monitor.rcWork.bottom - height - margin,
            width,
            height,
            None,
            Some(&hint),
        )?;
        self.last = Some(geometry);
        Ok(())
    }
}
impl Drop for Active {
    fn drop(&mut self) {
        unsafe {
            if self.hotkey {
                let _ = UnregisterHotKey(None, 1);
            }
        }
    }
}
unsafe fn run(rx: mpsc::Receiver<Command>) {
    SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    let class = WNDCLASSW {
        lpfnWndProc: Some(wndproc),
        lpszClassName: w!("AzraelWindowOverlay"),
        ..Default::default()
    };
    RegisterClassW(&class);
    let mut active: Option<Active> = None;
    'running: loop {
        while let Ok(command) = rx.try_recv() {
            match command {
                Command::Exit => break 'running,
                Command::Hide(p, done) => {
                    if active.as_ref().is_some_and(|a| {
                        a.show.target_id == p.target_id && a.show.generation == p.generation
                    }) {
                        active = None;
                    }
                    let _ = done.send(Ok(json!({"visible":false})));
                }
                Command::Show(p, done) => {
                    let rejected = stopped()
                        .lock()
                        .unwrap()
                        .as_ref()
                        .is_some_and(|(id, g, _, _)| id == &p.target_id && p.generation <= *g);
                    if rejected {
                        let _ = done.send(Err(Error::new(
                            "operation-cancelled",
                            "Stopped generation cannot restart",
                        )));
                        continue;
                    }
                    let result = (|| -> Result<Value> {
                        if let Some(a) = active.as_mut().filter(|a| {
                            a.show.target_id == p.target_id
                                && a.show.generation == p.generation
                                && a.show.window.same_identity(&p.window)
                        }) {
                            a.show.label = p.label;
                            a.last = None;
                            a.refresh()?;
                            return Ok(json!({"visible":true,"hotkeyRegistered":a.hotkey}));
                        }
                        active = None;
                        let hwnd = HWND(protocol::hex(&p.window.hwnd)? as usize as *mut _);
                        let mut layers = Vec::new();
                        for _ in 0..2 {
                            layers.push(Layer::new(hwnd)?);
                        }
                        let mut a = Active {
                            show: p,
                            layers,
                            hotkey: false,
                            last: None,
                        };
                        a.refresh()?;
                        let value = json!({"visible":true,"hotkeyRegistered":a.hotkey});
                        active = Some(a);
                        if let Some((_, _, _, cancelled)) = stopped().lock().unwrap().as_mut() {
                            *cancelled = false;
                        }
                        Ok(value)
                    })();
                    let _ = done.send(result);
                }
            }
        }
        let mut msg = MSG::default();
        while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
            if msg.message == WM_HOTKEY && msg.wParam.0 == 1 {
                if let Some(a) = active.as_ref() {
                    if crate::windows_backend::verify(&a.show.window).is_ok()
                        && GetForegroundWindow().0 as usize
                            == protocol::hex(&a.show.window.hwnd).unwrap_or(0) as usize
                    {
                        *stopped().lock().unwrap() = Some((
                            a.show.target_id.clone(),
                            a.show.generation,
                            a.show.window.clone(),
                            true,
                        ));
                        let _ = write_message(
                            &json!({"event":{"type":"overlayStop","targetId":a.show.target_id,"generation":a.show.generation}}),
                        );
                        active = None;
                    }
                }
            } else {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
        if active.as_mut().is_some_and(|a| a.refresh().is_err()) {
            active = None;
        }
        thread::sleep(Duration::from_millis(20));
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn gradient_is_premultiplied_and_fades_inward() {
        let origin = glow_pixel(0, 0, 190, 190);
        assert_eq!(glow_pixel(189, 189, 190, 190), 0);
        assert!(origin >> 24 > glow_pixel(80, 80, 190, 190) >> 24);
        for shift in [0, 8, 16] {
            assert!((origin >> shift) & 255 <= origin >> 24);
        }
    }
    #[test]
    fn rounded_mask_removes_spill_and_preserves_smooth_fade() {
        for radius in [4, 8, 12, 16] {
            assert_eq!(corner_glow_pixel(0, 0, 190, radius), 0);
            assert!(corner_glow_pixel(radius, 0, 190, radius) >> 24 > 0);
            for x in 0..190 {
                assert_eq!(corner_glow_pixel(x, 189, 190, radius), 0);
                assert_eq!(corner_glow_pixel(189, x, 190, radius), 0);
                for y in 0..190 {
                    let pixel = corner_glow_pixel(x, y, 190, radius);
                    for shift in [0, 8, 16] {
                        assert!((pixel >> shift) & 255 <= pixel >> 24);
                    }
                }
            }
        }
        assert_eq!(corner_glow_pixel(0, 0, 190, 0), glow_pixel(0, 0, 190, 190));
    }
    #[test]
    fn identity_validation_is_bounded() {
        assert!(valid_id("12345678-1234-1234-1234-123456789abc"));
        assert!(!valid_id("../../desktop"));
    }
}

#[cfg(test)]
mod fixture {
    use super::*;
    unsafe extern "system" fn fixture_proc(h: HWND, m: u32, w: WPARAM, l: LPARAM) -> LRESULT {
        let color = GetWindowLongPtrW(h, GWLP_USERDATA);
        if m == WM_PAINT && color != 0 {
            let mut paint = PAINTSTRUCT::default();
            let dc = BeginPaint(h, &mut paint);
            let brush = CreateSolidBrush(COLORREF((color - 1) as u32));
            FillRect(dc, &paint.rcPaint, brush);
            let _ = DeleteObject(brush);
            let _ = EndPaint(h, &paint);
            return LRESULT(0);
        }
        DefWindowProcW(h, m, w, l)
    }
    unsafe fn pump() {
        for _ in 0..12 {
            let mut m = MSG::default();
            while PeekMessageW(&mut m, None, 0, 0, PM_REMOVE).as_bool() {
                let _ = TranslateMessage(&m);
                DispatchMessageW(&m);
            }
            thread::sleep(Duration::from_millis(20));
        }
    }
    struct Fixture(HWND);
    impl Drop for Fixture {
        fn drop(&mut self) {
            unsafe {
                let _ = DestroyWindow(self.0);
            }
        }
    }
    unsafe fn call(overlay: &Overlay, method: &str, params: Value) -> Result<Value> {
        thread::scope(|scope| {
            let task = scope.spawn(|| overlay.call(method, params));
            while !task.is_finished() {
                pump();
            }
            task.join().unwrap()
        })
    }
    unsafe fn capture(hwnd: HWND, path: &str) {
        let mut r = RECT::default();
        GetWindowRect(hwnd, &mut r).unwrap();
        let w = r.right - r.left;
        let h = r.bottom - r.top;
        let screen = GetDC(None);
        let dc = CreateCompatibleDC(screen);
        let mut info = BITMAPINFO::default();
        info.bmiHeader = BITMAPINFOHEADER {
            biSize: size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: w,
            biHeight: -h,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        };
        let mut bits = std::ptr::null_mut();
        let bitmap = CreateDIBSection(dc, &info, DIB_RGB_COLORS, &mut bits, None, 0).unwrap();
        let old = SelectObject(dc, bitmap);
        BitBlt(dc, 0, 0, w, h, screen, r.left, r.top, SRCCOPY | CAPTUREBLT).unwrap();
        let pixels = std::slice::from_raw_parts(bits as *const u32, (w * h) as usize);
        let mut rgb = Vec::new();
        for p in pixels {
            rgb.extend_from_slice(&[(p >> 16) as u8, (p >> 8) as u8, *p as u8]);
        }
        let file = std::fs::File::create(path).unwrap();
        let mut encoder = png::Encoder::new(file, w as u32, h as u32);
        encoder.set_color(png::ColorType::Rgb);
        encoder.set_depth(png::BitDepth::Eight);
        encoder
            .write_header()
            .unwrap()
            .write_image_data(&rgb)
            .unwrap();
        SelectObject(dc, old);
        let _ = DeleteObject(bitmap);
        let _ = DeleteDC(dc);
        ReleaseDC(None, screen);
    }
    #[test]
    #[ignore = "opens only owned fixture windows; run explicitly for native visual acceptance"]
    fn native_overlay_fixture() {
        unsafe {
            SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
            let class = WNDCLASSW {
                lpfnWndProc: Some(fixture_proc),
                lpszClassName: w!("AzraelOverlayFixture"),
                ..Default::default()
            };
            RegisterClassW(&class);
            let mut monitor = MONITORINFO {
                cbSize: size_of::<MONITORINFO>() as u32,
                ..Default::default()
            };
            assert!(GetMonitorInfoW(
                MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY),
                &mut monitor
            )
            .as_bool());
            let x = monitor.rcWork.left;
            let y = monitor.rcWork.bottom - 460;
            let first = Fixture(
                CreateWindowExW(
                    WINDOW_EX_STYLE(0),
                    w!("AzraelOverlayFixture"),
                    w!("Azrael owned overlay fixture"),
                    WS_POPUP,
                    x,
                    y,
                    760,
                    460,
                    None,
                    None,
                    None,
                    None,
                )
                .unwrap(),
            );
            let second = Fixture(
                CreateWindowExW(
                    WINDOW_EX_STYLE(0),
                    w!("AzraelOverlayFixture"),
                    w!("Azrael unrelated foreground fixture"),
                    WS_POPUP,
                    x + 780,
                    y,
                    160,
                    160,
                    None,
                    None,
                    None,
                    None,
                )
                .unwrap(),
            );
            let _ = ShowWindow(first.0, SW_SHOW);
            assert!(SetForegroundWindow(first.0).as_bool());
            pump();
            let descriptor = crate::windows_backend::describe(first.0).unwrap();
            let overlay = Overlay::new();
            let target = "12345678-1234-1234-1234-123456789abc";
            let show = |generation| json!({"window":descriptor,"targetId":target,"generation":generation,"label":"창 작업 중"});
            let result = call(&overlay, "overlayShow", show(1)).unwrap();
            assert_eq!(result["hotkeyRegistered"], true);
            pump();
            assert_eq!(GetForegroundWindow(), first.0);
            let handles: Vec<usize> = OWNED
                .get_or_init(Default::default)
                .lock()
                .unwrap()
                .iter()
                .copied()
                .collect();
            assert_eq!(handles.len(), 2);
            for hwnd in &handles {
                let hwnd = HWND(*hwnd as *mut _);
                assert_eq!(
                    SendMessageW(hwnd, WM_NCHITTEST, WPARAM(0), LPARAM(0)).0,
                    HTTRANSPARENT as isize
                );
                assert_eq!(
                    SendMessageW(hwnd, WM_MOUSEACTIVATE, WPARAM(0), LPARAM(0)).0,
                    MA_NOACTIVATE as isize
                );
            }
            assert_eq!(
                WindowFromPoint(POINT {
                    x: x + 12,
                    y: y + 12
                }),
                first.0
            );
            let out = std::env::var("AZRAEL_OVERLAY_FIXTURE_OUTPUT")
                .expect("fixture output directory required");
            for (theme, color) in [("light", 0x00f7f7f7), ("dark", 0x00212121)] {
                let dc = GetDC(first.0);
                let brush = CreateSolidBrush(COLORREF(color));
                let rect = RECT {
                    left: 0,
                    top: 0,
                    right: 760,
                    bottom: 460,
                };
                FillRect(dc, &rect, brush);
                let _ = DeleteObject(brush);
                ReleaseDC(first.0, dc);
                pump();
                let excluded = format!("{out}/excluded.png");
                if theme == "light" {
                    capture(first.0, &excluded);
                }
                for hwnd in &handles {
                    SetWindowDisplayAffinity(HWND(*hwnd as *mut _), WDA_NONE).unwrap();
                }
                pump();
                capture(first.0, &format!("{out}/{theme}.png"));
                if theme == "light" {
                    assert_ne!(
                        std::fs::read(&excluded).unwrap(),
                        std::fs::read(format!("{out}/light.png")).unwrap(),
                        "screen capture exclusion had no effect"
                    );
                    std::fs::remove_file(excluded).unwrap();
                }
            }
            let _ = ShowWindow(second.0, SW_SHOW);
            assert!(SetForegroundWindow(second.0).as_bool());
            pump();
            assert_eq!(GetForegroundWindow(), second.0);
            assert_eq!(
                handles
                    .iter()
                    .filter(|h| IsWindowVisible(HWND(**h as *mut _)).as_bool())
                    .count(),
                1
            );
            SetWindowPos(
                second.0,
                None,
                x + 660,
                y,
                160,
                160,
                SWP_NOACTIVATE | SWP_NOZORDER,
            )
            .unwrap();
            let dc = GetDC(second.0);
            let brush = CreateSolidBrush(COLORREF(0x00604020));
            FillRect(
                dc,
                &RECT {
                    left: 0,
                    top: 0,
                    right: 160,
                    bottom: 160,
                },
                brush,
            );
            let _ = DeleteObject(brush);
            ReleaseDC(second.0, dc);
            pump();
            assert_eq!(GetForegroundWindow(), second.0);
            let screen = GetDC(None);
            assert_eq!(GetPixel(screen, x + 740, y + 30), COLORREF(0x00604020));
            ReleaseDC(None, screen);
            capture(first.0, &format!("{out}/background-overlap.png"));
            assert!(
                RegisterHotKey(None, 2, MOD_NOREPEAT, 0x1b).is_ok(),
                "background target retained Escape"
            );
            let _ = UnregisterHotKey(None, 2);
            let _ = ShowWindow(first.0, SW_MINIMIZE);
            pump();
            assert!(IsIconic(first.0).as_bool());
            for hwnd in &handles {
                assert!(!IsWindowVisible(HWND(*hwnd as *mut _)).as_bool());
            }
            let _ = ShowWindow(first.0, SW_RESTORE);
            assert!(SetForegroundWindow(second.0).as_bool());
            pump();
            assert_eq!(
                handles
                    .iter()
                    .filter(|h| IsWindowVisible(HWND(**h as *mut _)).as_bool())
                    .count(),
                1
            );
            assert_eq!(GetForegroundWindow(), second.0);
            // Exercise the worker's foreground/identity stop checks without
            // injecting keys into the user's global keyboard stream.
            PostMessageW(HWND(handles[0] as *mut _), WM_HOTKEY, WPARAM(1), LPARAM(0)).unwrap();
            pump();
            assert!(guard(&descriptor).is_ok());
            assert!(SetForegroundWindow(first.0).as_bool());
            pump();
            PostMessageW(HWND(handles[0] as *mut _), WM_HOTKEY, WPARAM(1), LPARAM(0)).unwrap();
            pump();
            assert_eq!(guard(&descriptor).unwrap_err().code, "operation-cancelled");
            assert_eq!(
                call(&overlay, "overlayShow", show(1)).unwrap_err().code,
                "operation-cancelled"
            );
            call(&overlay, "overlayShow", show(2)).unwrap();
            assert!(guard(&descriptor).is_ok());
            call(
                &overlay,
                "overlayHide",
                json!({"targetId":target,"generation":2}),
            )
            .unwrap();
            assert!(OWNED
                .get_or_init(Default::default)
                .lock()
                .unwrap()
                .is_empty());
            assert!(RegisterHotKey(None, 2, MOD_NOREPEAT, 0x1b).is_ok());
            SetWindowPos(
                first.0,
                None,
                x,
                y,
                monitor.rcWork.right - monitor.rcWork.left,
                460,
                SWP_NOACTIVATE | SWP_NOZORDER,
            )
            .unwrap();
            let dc = GetDC(first.0);
            let brush = CreateSolidBrush(COLORREF(0x00212121));
            FillRect(
                dc,
                &RECT {
                    left: 0,
                    top: 0,
                    right: monitor.rcWork.right - monitor.rcWork.left,
                    bottom: 460,
                },
                brush,
            );
            let _ = DeleteObject(brush);
            ReleaseDC(first.0, dc);
            let label = "선택한 창에서 여러 단계의 매크로 작업을 진행하는 중입니다";
            let mut long_show = show(3);
            long_show["label"] = json!(label);
            let unavailable = call(&overlay, "overlayShow", long_show).unwrap();
            assert_eq!(unavailable["hotkeyRegistered"], false);
            pump();
            let new_handles: Vec<usize> = OWNED
                .get_or_init(Default::default)
                .lock()
                .unwrap()
                .iter()
                .copied()
                .collect();
            for h in new_handles {
                let hwnd = HWND(h as *mut _);
                SetWindowDisplayAffinity(hwnd, WDA_NONE).unwrap();
                let mut r = RECT::default();
                GetWindowRect(hwnd, &mut r).unwrap();
                if r.bottom - r.top < 150 {
                    assert!(r.left >= monitor.rcWork.left && r.right <= monitor.rcWork.right);
                    assert_eq!(
                        r.right - r.left,
                        hint_width(
                            &hint_text(label, false),
                            r.bottom - r.top,
                            monitor.rcWork.right - monitor.rcWork.left - 60
                        )
                    );
                }
            }
            pump();
            capture(first.0, &format!("{out}/long-label-fallback.png"));
            let narrow = Layer::new(first.0).unwrap();
            SetWindowDisplayAffinity(narrow.0, WDA_NONE).unwrap();
            let text = fitted_hint(label, false, 63, 200);
            assert_eq!(text, "Esc 사용 불가");
            assert!(hint_width(&text, 63, i32::MAX) <= 200);
            assert_eq!(
                fitted_hint(label, false, 63, 10000),
                hint_text(label, false)
            );
            assert_eq!(fitted_hint(label, true, 63, 170), "Esc 중지");
            narrow
                .paint(x + 40, y + 40, 200, 63, None, Some(&text))
                .unwrap();
            pump();
            capture(narrow.0, &format!("{out}/narrow-ellipsis.png"));
            let actionable = fitted_hint(label, true, 63, 200);
            assert_eq!(actionable, "Esc to cancel");
            assert!(hint_width(&actionable, 63, i32::MAX) <= 200);
            narrow
                .paint(x + 40, y + 40, 200, 63, None, Some(&actionable))
                .unwrap();
            pump();
            capture(narrow.0, &format!("{out}/narrow-active.png"));
            drop(narrow);

            call(
                &overlay,
                "overlayHide",
                json!({"targetId":target,"generation":3}),
            )
            .unwrap();
            let _ = UnregisterHotKey(None, 2);
            assert!(RegisterHotKey(None, 1, MOD_NOREPEAT, 0x1b).is_ok());
            let _ = UnregisterHotKey(None, 1);
            thread::scope(|scope| {
                let task = scope.spawn(move || drop(overlay));
                while !task.is_finished() {
                    pump();
                }
                task.join().unwrap();
            });
        }
    }

    #[test]
    #[ignore = "opens only owned framed windows; explicit visual geometry acceptance"]
    fn native_overlay_geometry_fixture() {
        unsafe {
            SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
            RegisterClassW(&WNDCLASSW {
                lpfnWndProc: Some(fixture_proc),
                lpszClassName: w!("AzraelOverlayGeometryFixture"),
                ..Default::default()
            });
            let mut monitor = MONITORINFO {
                cbSize: size_of::<MONITORINFO>() as u32,
                ..Default::default()
            };
            assert!(GetMonitorInfoW(
                MonitorFromPoint(POINT::default(), MONITOR_DEFAULTTOPRIMARY),
                &mut monitor
            )
            .as_bool());
            let x = monitor.rcWork.left + 80;
            let y = monitor.rcWork.top + 80;
            let window = Fixture(
                CreateWindowExW(
                    WINDOW_EX_STYLE(0),
                    w!("AzraelOverlayGeometryFixture"),
                    w!("Azrael owned rounded-frame visual test"),
                    WS_OVERLAPPEDWINDOW,
                    x,
                    y,
                    900,
                    640,
                    None,
                    None,
                    None,
                    None,
                )
                .unwrap(),
            );
            let out = std::env::var("AZRAEL_OVERLAY_FIXTURE_OUTPUT")
                .expect("fixture output directory required");
            let _ = ShowWindow(window.0, SW_SHOW);
            assert!(SetForegroundWindow(window.0).as_bool());
            pump();
            let descriptor = crate::windows_backend::describe(window.0).unwrap();
            let overlay = Overlay::new();
            let target = "22345678-1234-1234-1234-123456789abc";
            let mut geometries = Vec::new();
            for (index, (name, color, preference, width, height, maximized)) in [
                (
                    "rounded-light",
                    0x00f7f7f7u32,
                    DWMWCP_ROUND,
                    900,
                    640,
                    false,
                ),
                ("rounded-dark", 0x00212121, DWMWCP_ROUND, 900, 640, false),
                ("default-light", 0x00f7f7f7, DWMWCP_DEFAULT, 900, 640, false),
                (
                    "small-radius-dark",
                    0x00212121,
                    DWMWCP_ROUNDSMALL,
                    900,
                    640,
                    false,
                ),
                (
                    "square-light",
                    0x00f7f7f7,
                    DWMWCP_DONOTROUND,
                    900,
                    640,
                    false,
                ),
                (
                    "moved-light",
                    0x00f7f7f7,
                    DWMWCP_DONOTROUND,
                    900,
                    640,
                    false,
                ),
                ("resized-dark", 0x00212121, DWMWCP_ROUND, 560, 360, false),
                ("maximized-dark", 0x00212121, DWMWCP_ROUND, 900, 640, true),
            ]
            .into_iter()
            .enumerate()
            {
                assert_eq!(
                    GetForegroundWindow(),
                    window.0,
                    "physical user focus changed; stop fixture"
                );
                DwmSetWindowAttribute(
                    window.0,
                    DWMWA_WINDOW_CORNER_PREFERENCE,
                    &preference as *const _ as *const _,
                    size_of::<DWM_WINDOW_CORNER_PREFERENCE>() as u32,
                )
                .unwrap();
                let dark = BOOL((color == 0x00212121) as i32);
                DwmSetWindowAttribute(
                    window.0,
                    DWMWA_USE_IMMERSIVE_DARK_MODE,
                    &dark as *const _ as *const _,
                    size_of::<BOOL>() as u32,
                )
                .unwrap();
                SetWindowLongPtrW(window.0, GWLP_USERDATA, color as isize + 1);
                let case_x = if name == "moved-light" { x + 60 } else { x };
                SetWindowPos(
                    window.0,
                    None,
                    case_x,
                    y,
                    width,
                    height,
                    SWP_NOACTIVATE | SWP_NOZORDER,
                )
                .unwrap();
                if maximized {
                    let _ = ShowWindow(window.0, SW_MAXIMIZE);
                }
                let _ = InvalidateRect(window.0, None, true);
                pump();
                capture(window.0, &format!("{out}/{name}-base.png"));
                let generation = index as u64 + 1;
                call(
                    &overlay,
                    "overlayShow",
                    json!({"window":descriptor,"targetId":target,
                    "generation":generation,"label":"Window Use visual test"}),
                )
                .unwrap();
                pump();
                if name == "moved-light" {
                    SetWindowPos(
                        window.0,
                        None,
                        case_x + 40,
                        y + 40,
                        0,
                        0,
                        SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOZORDER,
                    )
                    .unwrap();
                    pump();
                }
                let handles: Vec<usize> = OWNED
                    .get_or_init(Default::default)
                    .lock()
                    .unwrap()
                    .iter()
                    .copied()
                    .collect();
                for h in &handles {
                    SetWindowDisplayAffinity(HWND(*h as *mut _), WDA_NONE).unwrap();
                }
                pump();
                let mut outer = RECT::default();
                GetWindowRect(window.0, &mut outer).unwrap();
                let mut frame = RECT::default();
                DwmGetWindowAttribute(
                    window.0,
                    DWMWA_EXTENDED_FRAME_BOUNDS,
                    &mut frame as *mut _ as *mut _,
                    size_of::<RECT>() as u32,
                )
                .unwrap();
                let rect_array = |r: RECT| [r.left, r.top, r.right, r.bottom];
                let mut layer_rects = Vec::new();
                for h in &handles {
                    let mut r = RECT::default();
                    GetWindowRect(HWND(*h as *mut _), &mut r).unwrap();
                    layer_rects.push(rect_array(r));
                }
                assert_eq!(handles.len(), 2);
                assert!(
                    layer_rects.contains(&rect_array(frame)),
                    "glow must match DWM visible frame exactly"
                );
                geometries.push(json!({"case":name,"outer":rect_array(outer),
                    "frame":rect_array(frame),"dpi":GetDpiForWindow(window.0),
                    "layers":layer_rects,"preference":preference.0}));
                capture(window.0, &format!("{out}/{name}-glow.png"));
                assert_eq!(GetForegroundWindow(), window.0);
                call(
                    &overlay,
                    "overlayHide",
                    json!({"targetId":target,"generation":generation}),
                )
                .unwrap();
            }
            std::fs::write(
                format!("{out}/geometry.json"),
                serde_json::to_vec_pretty(&geometries).unwrap(),
            )
            .unwrap();
            thread::scope(|scope| {
                let task = scope.spawn(move || drop(overlay));
                while !task.is_finished() {
                    pump();
                }
                task.join().unwrap();
            });
        }
    }
}
