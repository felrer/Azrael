use crate::protocol::{Error, Result};
use base64::Engine;
use std::time::{Duration, Instant};
use windows::{
    core::*,
    Graphics::{
        Capture::*,
        DirectX::{Direct3D11::IDirect3DDevice, DirectXPixelFormat},
    },
    Win32::{
        Foundation::HWND,
        Graphics::{Direct3D::*, Direct3D11::*, Dxgi::*},
        System::{
            Performance::*,
            WinRT::{Direct3D11::*, Graphics::Capture::*},
        },
        UI::WindowsAndMessaging::*,
    },
};

pub struct Frame {
    pub timestamp: i64,
    pub width: i32,
    pub height: i32,
    pub data: String,
    pub protection: &'static str,
}
struct Capture {
    session: GraphicsCaptureSession,
    pool: Direct3D11CaptureFramePool,
}
impl Drop for Capture {
    fn drop(&mut self) {
        let _ = self.session.Close();
        let _ = self.pool.Close();
    }
}

pub fn capture(hwnd: HWND, previous_timestamp: i64) -> Result<Frame> {
    unsafe {
        let mut affinity = 0;
        let protection_before = protection_state(
            GetWindowDisplayAffinity(hwnd, &mut affinity).is_ok(),
            affinity,
        )?;
        if !GraphicsCaptureSession::IsSupported()? {
            return Err(Error::new(
                "capture-unsupported",
                "Windows Graphics Capture is unavailable",
            ));
        }
        let interop: IGraphicsCaptureItemInterop =
            factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()?;
        // The only capture entry point is the exact selected HWND, never a monitor or desktop.
        let item: GraphicsCaptureItem = interop.CreateForWindow(hwnd)?;
        let size = item.Size()?;
        validate_size(size.Width, size.Height)?;
        let mut device = None;
        let mut context = None;
        D3D11CreateDevice(
            None,
            D3D_DRIVER_TYPE_HARDWARE,
            None,
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            None,
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            Some(&mut context),
        )?;
        let device = device.ok_or_else(|| {
            Error::new("capture-device", "D3D device creation returned no device")
        })?;
        let context = context.ok_or_else(|| {
            Error::new("capture-device", "D3D device creation returned no context")
        })?;
        let dxgi: IDXGIDevice = device.cast()?;
        let projected: IDirect3DDevice = CreateDirect3D11DeviceFromDXGIDevice(&dxgi)?.cast()?;
        let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
            &projected,
            DirectXPixelFormat::B8G8R8A8UIntNormalized,
            2,
            size,
        )?;
        let session = pool.CreateCaptureSession(&item)?;
        let guard = Capture { session, pool };
        // This excludes cursor pixels from our capture stream; it does not hide/change the real cursor.
        guard.session.SetIsCursorCaptureEnabled(false)?;
        let mut frequency = 0;
        let mut counter = 0;
        QueryPerformanceFrequency(&mut frequency)?;
        QueryPerformanceCounter(&mut counter)?;
        if frequency <= 0 {
            return Err(Error::new(
                "capture-clock",
                "Invalid monotonic capture clock frequency",
            ));
        }
        let fresh_after = ((counter as i128 * 10_000_000) / frequency as i128) as i64;
        guard.session.StartCapture()?;
        let deadline = Instant::now() + Duration::from_secs(3);
        let frame = loop {
            if let Ok(frame) = guard.pool.TryGetNextFrame() {
                if frame.SystemRelativeTime()?.Duration > previous_timestamp.max(fresh_after) {
                    break frame;
                }
                frame.Close()?;
            }
            if item.Size()? != size {
                return Err(Error::new(
                    "capture-size-changed",
                    "Window resized while capturing; observe again",
                ));
            }
            if Instant::now() >= deadline {
                return Err(Error::new(
                    "capture-timeout",
                    "Selected HWND did not provide a fresh WGC frame within 3 seconds",
                ));
            }
            std::thread::sleep(Duration::from_millis(10));
        };
        let timestamp = frame.SystemRelativeTime()?.Duration;
        let content = frame.ContentSize()?;
        validate_size(content.Width, content.Height)?;
        if content != size {
            return Err(Error::new(
                "capture-size-changed",
                "Capture frame dimensions changed; observe again",
            ));
        }
        let access: IDirect3DDxgiInterfaceAccess = frame.Surface()?.cast()?;
        let source: ID3D11Texture2D = access.GetInterface()?;
        let mut description = D3D11_TEXTURE2D_DESC::default();
        source.GetDesc(&mut description);
        if description.Width != content.Width as u32
            || description.Height != content.Height as u32
            || description.Format
                != windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_B8G8R8A8_UNORM
        {
            return Err(Error::new(
                "capture-format",
                "Unexpected WGC texture size or format",
            ));
        }
        description.Usage = D3D11_USAGE_STAGING;
        description.BindFlags = 0;
        description.CPUAccessFlags = D3D11_CPU_ACCESS_READ.0 as u32;
        description.MiscFlags = 0;
        let mut staging = None;
        device.CreateTexture2D(&description, None, Some(&mut staging))?;
        let staging = staging.ok_or_else(|| Error::new("capture-device", "No staging texture"))?;
        context.CopyResource(&staging, &source);
        let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
        context.Map(&staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped))?;
        let converted = (|| -> Result<Vec<u8>> {
            let width = content.Width as usize;
            let height = content.Height as usize;
            if mapped.pData.is_null() || (mapped.RowPitch as usize) < width * 4 {
                return Err(Error::new(
                    "capture-format",
                    "Invalid mapped texture stride",
                ));
            }
            let mut pixels = vec![0; width * height * 4];
            for y in 0..height {
                let row = std::slice::from_raw_parts(
                    (mapped.pData as *const u8).add(y * mapped.RowPitch as usize),
                    width * 4,
                );
                for x in 0..width {
                    let source = &row[x * 4..x * 4 + 4];
                    let dest = &mut pixels[(y * width + x) * 4..(y * width + x) * 4 + 4];
                    dest.copy_from_slice(&[source[2], source[1], source[0], source[3]]);
                }
            }
            Ok(pixels)
        })();
        context.Unmap(&staging, 0);
        let pixels = converted?;
        let mut output = Vec::new();
        {
            let mut encoder =
                png::Encoder::new(&mut output, content.Width as u32, content.Height as u32);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder
                .write_header()
                .map_err(|_| Error::new("capture-encode", "PNG header encoding failed"))?;
            writer
                .write_image_data(&pixels)
                .map_err(|_| Error::new("capture-encode", "PNG image encoding failed"))?;
        }
        frame.Close()?;
        affinity = 0;
        let protection_after = protection_state(
            GetWindowDisplayAffinity(hwnd, &mut affinity).is_ok(),
            affinity,
        )?;
        Ok(Frame {
            timestamp,
            width: content.Width,
            height: content.Height,
            data: base64::engine::general_purpose::STANDARD.encode(output),
            protection: if protection_before == "unknown" || protection_after == "unknown" {
                "unknown"
            } else {
                "noneDetected"
            },
        })
    }
}
// Query is documented to be unavailable for ordinary non-layered windows. WGC remains the
// sole capture path and enforces OS protection; unknown metadata is not a bypass switch.
fn protection_state(query_succeeded: bool, affinity: u32) -> Result<&'static str> {
    if !query_succeeded {
        return Ok("unknown");
    }
    if affinity != WDA_NONE.0 {
        return Err(Error::new(
            "protected-target",
            "Selected window has capture protection",
        ));
    }
    Ok("noneDetected")
}
fn validate_size(width: i32, height: i32) -> Result<()> {
    if width <= 0
        || height <= 0
        || width > 16384
        || height > 16384
        || width as i64 * height as i64 > 32 * 1024 * 1024
    {
        return Err(Error::new(
            "capture-size",
            "Zero or excessive selected-window capture dimensions",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reject_empty_and_excessive_frames() {
        assert!(validate_size(1920, 1080).is_ok());
        assert!(validate_size(0, 480).is_err());
        assert!(validate_size(16384, 16384).is_err());
    }
    #[test]
    fn unavailable_affinity_query_retains_unknown_diagnostic() {
        assert_eq!(protection_state(false, 0).unwrap(), "unknown");
        assert_eq!(protection_state(true, 0).unwrap(), "noneDetected");
        assert!(protection_state(true, 1).is_err());
        assert!(protection_state(true, 17).is_err());
    }
}
