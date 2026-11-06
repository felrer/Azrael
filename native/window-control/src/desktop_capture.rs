//! Read-only desktop observation. WinEvent/snapshot checks are conservative race
//! detection, not an atomic compositor privacy boundary. Never persist raw pixels.
use crate::protocol::{Error, Result};
use base64::Engine;
use serde_json::{json, Value};
use std::{
    cell::Cell,
    mem::size_of,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use windows::Win32::{
    Foundation::*,
    Graphics::Gdi::*,
    UI::{Accessibility::*, WindowsAndMessaging::*},
};

const MAX_PIXELS: usize = 32 * 1024 * 1024;
const MAX_WINDOWS: usize = 4096;
thread_local! { static CHANGED: Cell<bool> = const { Cell::new(false) }; }
fn failure(message: &str) -> Error {
    Error::new("desktop-capture-unavailable", message)
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Area {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}
impl Area {
    fn dimensions(&self) -> Result<(i32, i32, usize)> {
        let w = i64::from(self.right) - i64::from(self.left);
        let h = i64::from(self.bottom) - i64::from(self.top);
        if w <= 0 || h <= 0 || w > 32768 || h > 32768 || w * h > MAX_PIXELS as i64 {
            return Err(failure(&format!(
                "Desktop capture geometry exceeds bounds: width={w}, height={h}"
            )));
        }
        Ok((w as i32, h as i32, w as usize * h as usize * 4))
    }
    fn visible_intersection(&self, desktop: &Area) -> Result<Option<Area>> {
        // Window rectangles do not allocate buffers. Validate their arithmetic,
        // then apply allocation limits only to their on-desktop intersection.
        let width = self.right.checked_sub(self.left);
        let height = self.bottom.checked_sub(self.top);
        if width.is_none_or(|w| w < 0) || height.is_none_or(|h| h < 0) {
            return Err(failure(&format!(
                "Invalid candidate window rectangle: left={}, top={}, right={}, bottom={}",
                self.left, self.top, self.right, self.bottom
            )));
        }
        let clipped = Area {
            left: self.left.max(desktop.left),
            top: self.top.max(desktop.top),
            right: self.right.min(desktop.right),
            bottom: self.bottom.min(desktop.bottom),
        };
        if clipped.left >= clipped.right || clipped.top >= clipped.bottom {
            return Ok(None);
        }
        clipped.dimensions()?;
        Ok(Some(clipped))
    }
}
#[derive(Debug, PartialEq, Eq)]
struct Entry {
    hwnd: usize,
    owner: usize,
    pid: u32,
    created: String,
    exe: String,
    area: Area,
    owners: Vec<(usize, u32, String, String)>,
    protected: bool,
}
struct Snapshot {
    entries: Vec<Entry>,
    error: Option<Error>,
    desktop: Area,
}
unsafe extern "system" fn collect(hwnd: HWND, parameter: LPARAM) -> BOOL {
    let state = &mut *(parameter.0 as *mut Snapshot);
    if state.error.is_some() {
        return BOOL(0);
    }
    if !IsWindowVisible(hwnd).as_bool() || IsIconic(hwnd).as_bool() {
        return BOOL(1);
    }
    let result = (|| -> Result<Option<Entry>> {
        if state.entries.len() >= MAX_WINDOWS {
            return Err(failure("Too many visible windows"));
        }
        let mut r = RECT::default();
        GetWindowRect(hwnd, &mut r)?;
        let area = Area {
            left: r.left,
            top: r.top,
            right: r.right,
            bottom: r.bottom,
        };
        if area.visible_intersection(&state.desktop)?.is_none() {
            return Ok(None);
        }
        // Resolve identity only after proving that the candidate contributes
        // pixels. Unknown identities with any visible area still fail closed.
        let identity = super::describe(hwnd)?;
        if identity.executable.is_empty() {
            return Err(failure("Visible window executable identity is unknown"));
        }
        let mut affinity = 0;
        // A failed query is not permission to circumvent protection: BitBlt
        // retains Windows' capture restrictions. Known protected windows cause
        // the entire observation to fail, even when their app is not blocked.
        let protected = GetWindowDisplayAffinity(hwnd, &mut affinity).is_ok() && affinity != 0;
        let mut owners = Vec::new();
        let mut owner = GetWindow(hwnd, GW_OWNER).unwrap_or_default();
        while !owner.0.is_null() {
            if owners.len() >= 64
                || owner == hwnd
                || owners
                    .iter()
                    .any(|entry: &(usize, u32, String, String)| entry.0 == owner.0 as usize)
            {
                return Err(failure(
                    "Window owner chain is invalid or exceeds capture bounds",
                ));
            }
            let parent = super::describe(owner)?;
            owners.push((
                owner.0 as usize,
                parent.pid,
                parent.process_created,
                parent.executable.to_lowercase(),
            ));
            owner = GetWindow(owner, GW_OWNER).unwrap_or_default();
        }
        Ok(Some(Entry {
            hwnd: hwnd.0 as usize,
            owner: GetWindow(hwnd, GW_OWNER).unwrap_or_default().0 as usize,
            pid: identity.pid,
            created: identity.process_created,
            exe: identity.executable.to_lowercase(),
            area,
            owners,
            protected,
        }))
    })();
    match result {
        Ok(Some(entry)) => state.entries.push(entry),
        Ok(None) => (),
        Err(error) => {
            state.error = Some(error);
            return BOOL(0);
        }
    }
    BOOL(1)
}
fn snapshot(desktop: &Area) -> Result<Vec<Entry>> {
    let mut state = Snapshot {
        entries: Vec::new(),
        error: None,
        desktop: desktop.clone(),
    };
    let result = unsafe { EnumWindows(Some(collect), LPARAM(&mut state as *mut _ as isize)) };
    if let Some(error) = state.error {
        return Err(error);
    }
    result?;
    // EnumWindows preserves Z order, including owned top-level popups. Do not
    // filter overlapped windows: their entire rectangles remain sensitive.
    Ok(state.entries)
}
unsafe extern "system" fn changed(
    _: HWINEVENTHOOK,
    event: u32,
    _: HWND,
    object: i32,
    child: i32,
    _: u32,
    _: u32,
) {
    if (object == OBJID_WINDOW.0
        && child == 0
        && matches!(
            event,
            EVENT_OBJECT_CREATE
                | EVENT_OBJECT_DESTROY
                | EVENT_OBJECT_SHOW
                | EVENT_OBJECT_HIDE
                | EVENT_OBJECT_REORDER
                | EVENT_OBJECT_LOCATIONCHANGE
        ))
        || matches!(
            event,
            EVENT_SYSTEM_FOREGROUND
                | EVENT_SYSTEM_MOVESIZESTART
                | EVENT_SYSTEM_MOVESIZEEND
                | EVENT_SYSTEM_DESKTOPSWITCH
                | EVENT_SYSTEM_MINIMIZESTART
                | EVENT_SYSTEM_MINIMIZEEND
        )
    {
        CHANGED.with(|flag| flag.set(true));
    }
}
struct Monitor(HWINEVENTHOOK);
impl Drop for Monitor {
    fn drop(&mut self) {
        unsafe {
            let _ = UnhookWinEvent(self.0);
        }
    }
}
fn drain() -> Result<()> {
    unsafe {
        let mut message = MSG::default();
        for _ in 0..4096 {
            if !PeekMessageW(&mut message, None, 0, 0, PM_REMOVE).as_bool() {
                return Ok(());
            }
            if message.message == WM_QUIT {
                return Err(failure("Desktop monitor stopped"));
            }
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }
    Err(failure("Desktop event queue exceeded capture bounds"))
}
fn desktop_area() -> Result<Area> {
    unsafe {
        let x = GetSystemMetrics(SM_XVIRTUALSCREEN);
        let y = GetSystemMetrics(SM_YVIRTUALSCREEN);
        let width = GetSystemMetrics(SM_CXVIRTUALSCREEN);
        let height = GetSystemMetrics(SM_CYVIRTUALSCREEN);
        let area = Area {
            left: x,
            top: y,
            right: x
                .checked_add(width)
                .ok_or_else(|| failure("Invalid desktop width"))?,
            bottom: y
                .checked_add(height)
                .ok_or_else(|| failure("Invalid desktop height"))?,
        };
        area.dimensions()?;
        Ok(area)
    }
}
struct Surface {
    screen: HDC,
    dc: HDC,
    bitmap: HBITMAP,
    old: HGDIOBJ,
}
impl Drop for Surface {
    fn drop(&mut self) {
        unsafe {
            if !self.old.0.is_null() {
                SelectObject(self.dc, self.old);
            }
            if !self.bitmap.0.is_null() {
                let _ = DeleteObject(self.bitmap);
            }
            if !self.dc.0.is_null() {
                let _ = DeleteDC(self.dc);
            }
            if !self.screen.0.is_null() {
                ReleaseDC(None, self.screen);
            }
        }
    }
}
fn mask(pixels: &mut [u8], desktop: &Area, area: &Area) {
    let width = (desktop.right - desktop.left) as usize;
    let left = area.left.max(desktop.left).min(desktop.right);
    let right = area.right.min(desktop.right).max(desktop.left);
    let top = area.top.max(desktop.top).min(desktop.bottom);
    let bottom = area.bottom.min(desktop.bottom).max(desktop.top);
    if left >= right || top >= bottom {
        return;
    }
    for y in top..bottom {
        let start = ((y - desktop.top) as usize * width + (left - desktop.left) as usize) * 4;
        let end = start + (right - left) as usize * 4;
        for pixel in pixels[start..end].chunks_exact_mut(4) {
            pixel.copy_from_slice(&[0, 0, 0, 255]);
        }
    }
}
pub fn capture(blocked_apps: &[String]) -> Result<Value> {
    unsafe {
        let hook = SetWinEventHook(
            EVENT_MIN,
            EVENT_MAX,
            None,
            Some(changed),
            0,
            0,
            WINEVENT_OUTOFCONTEXT,
        );
        if hook.0.is_null() {
            return Err(failure("Cannot monitor desktop window changes"));
        }
        let _monitor = Monitor(hook);
        drain()?;
        CHANGED.with(|flag| flag.set(false));
        let desktop = desktop_area()?;
        let (width, height, length) = desktop.dimensions()?;
        let before = snapshot(&desktop)?;
        if before.iter().any(|window| window.protected) {
            return Err(failure("Desktop contains a capture-protected window"));
        }
        let mut surface = Surface {
            screen: GetDC(None),
            dc: HDC::default(),
            bitmap: HBITMAP::default(),
            old: HGDIOBJ::default(),
        };
        if surface.screen.0.is_null() {
            return Err(failure("Desktop DC is unavailable"));
        }
        surface.dc = CreateCompatibleDC(surface.screen);
        if surface.dc.0.is_null() {
            return Err(failure("Capture DC is unavailable"));
        }
        let info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width,
                biHeight: -height,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut bits = std::ptr::null_mut();
        surface.bitmap = CreateDIBSection(surface.dc, &info, DIB_RGB_COLORS, &mut bits, None, 0)?;
        if bits.is_null() {
            return Err(failure("Capture bitmap is unavailable"));
        }
        surface.old = SelectObject(surface.dc, surface.bitmap);
        if surface.old.0.is_null() || surface.old.0 as isize == -1 {
            return Err(failure("Cannot select capture bitmap"));
        }
        BitBlt(
            surface.dc,
            0,
            0,
            width,
            height,
            surface.screen,
            desktop.left,
            desktop.top,
            SRCCOPY | CAPTUREBLT,
        )?;
        if !GdiFlush().as_bool() {
            return Err(failure("Cannot synchronize capture bitmap"));
        }
        let frame_timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| failure("Capture clock unavailable"))?
            .as_millis()
            .to_string();
        let after = snapshot(&desktop)?;
        // OUTOFCONTEXT delivery is asynchronous. Drain twice with a bounded
        // grace period; this improves race detection without claiming atomicity.
        drain()?;
        std::thread::sleep(Duration::from_millis(20));
        drain()?;
        if before != after
            || after != snapshot(&desktop)?
            || desktop != desktop_area()?
            || CHANGED.with(Cell::get)
        {
            return Err(failure("Desktop changed during capture; observe again"));
        }
        let pixels = std::slice::from_raw_parts_mut(bits as *mut u8, length);
        let blocked: Vec<_> = blocked_apps.iter().map(|p| p.to_lowercase()).collect();
        let mut count = 0;
        for window in &before {
            // Hidden owners also contribute identity: an owned popup remains
            // sensitive even when its blocked parent is not visible itself.
            let sensitive = blocked.contains(&window.exe)
                || window.owners.iter().any(|entry| blocked.contains(&entry.3));
            if sensitive {
                mask(pixels, &desktop, &window.area);
                count += 1;
            }
        }
        // Only masked bytes reach the encoder or protocol. GDI memory is released
        // by Surface on every return path; no image files or cursor API are used.
        for pixel in pixels.chunks_exact_mut(4) {
            pixel.swap(0, 2);
            pixel[3] = 255;
        }
        let mut png = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut png, width as u32, height as u32);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder
                .write_header()
                .map_err(|_| failure("Cannot encode masked frame"))?;
            writer
                .write_image_data(pixels)
                .map_err(|_| failure("Cannot encode masked frame"))?;
        }
        Ok(
            json!({"image":{"mimeType":"image/png","data":base64::engine::general_purpose::STANDARD.encode(png)},
            "widthPx":width,"heightPx":height,"originX":desktop.left,"originY":desktop.top,
            "redacted":true,"maskedWindowCount":count,"frameTimestamp":frame_timestamp}),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn masking_clips_negative_desktop_origins_and_covers_borders() {
        let desktop = Area {
            left: -2,
            top: -1,
            right: 2,
            bottom: 1,
        };
        let mut pixels = vec![9; 32];
        mask(
            &mut pixels,
            &desktop,
            &Area {
                left: -8,
                top: -1,
                right: 0,
                bottom: 1,
            },
        );
        assert_eq!(&pixels[..8], &[0, 0, 0, 255, 0, 0, 0, 255]);
        assert_eq!(&pixels[8..16], &[9; 8]);
        assert_eq!(&pixels[16..24], &[0, 0, 0, 255, 0, 0, 0, 255]);
        assert_eq!(&pixels[24..], &[9; 8]);
    }
    #[test]
    fn invalid_or_excessive_geometry_is_rejected() {
        for area in [
            Area {
                left: 0,
                top: 0,
                right: 0,
                bottom: 1,
            },
            Area {
                left: i32::MIN,
                top: 0,
                right: i32::MAX,
                bottom: 1,
            },
            Area {
                left: 0,
                top: 0,
                right: 32768,
                bottom: 32768,
            },
        ] {
            assert!(area.dimensions().is_err());
        }
    }
    #[test]
    fn candidate_geometry_uses_visible_pixels_without_window_allocations() {
        let desktop = Area {
            left: -1920,
            top: 0,
            right: 1920,
            bottom: 1080,
        };
        // Oversized shell/utility windows may span far beyond the desktop.
        let huge = Area {
            left: -100_000,
            top: -100_000,
            right: 100_000,
            bottom: 100_000,
        };
        assert_eq!(
            huge.visible_intersection(&desktop).unwrap(),
            Some(desktop.clone())
        );
        for area in [
            Area {
                left: 0,
                top: 0,
                right: 0,
                bottom: 1080,
            },
            Area {
                left: 3000,
                top: 0,
                right: 6000,
                bottom: 1080,
            },
            Area {
                left: 0,
                top: -10,
                right: 1,
                bottom: 0,
            },
        ] {
            assert_eq!(area.visible_intersection(&desktop).unwrap(), None);
        }
        let edge = Area {
            left: 1919,
            top: 1079,
            right: 100_000,
            bottom: 100_000,
        };
        assert_eq!(
            edge.visible_intersection(&desktop).unwrap(),
            Some(Area {
                left: 1919,
                top: 1079,
                right: 1920,
                bottom: 1080
            })
        );
        for area in [
            Area {
                left: 1,
                top: 0,
                right: 0,
                bottom: 1,
            },
            Area {
                left: 0,
                top: 1,
                right: 1,
                bottom: 0,
            },
            Area {
                left: i32::MIN,
                top: 0,
                right: i32::MAX,
                bottom: 1,
            },
        ] {
            assert!(area.visible_intersection(&desktop).is_err());
        }
    }
}
