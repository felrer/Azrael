//! Comparable process-independent clocks, exclusively for a private child pipe
//! on the same running host/boot. Peer admission must enforce that boundary;
//! these timestamps must never be accepted from remote worker endpoints.
use crate::WireError;
use std::time::Duration;

/// Returns host boot-monotonic time without wall-clock conversion.
pub fn now() -> Result<Duration, WireError> {
    platform_now()
}

pub fn now_nanoseconds() -> Result<u128, WireError> {
    Ok(now()?.as_nanos())
}

pub fn elapsed_since(captured_at: Duration) -> Result<Duration, WireError> {
    now()?.checked_sub(captured_at).ok_or_else(|| {
        WireError("worker monotonic timestamp is in the future or from another boot".into())
    })
}

#[cfg(windows)]
fn platform_now() -> Result<Duration, WireError> {
    use windows_sys::Win32::System::Performance::QueryPerformanceCounter;
    use windows_sys::Win32::System::Performance::QueryPerformanceFrequency;
    let mut ticks = 0i64;
    let mut frequency = 0i64;
    // SAFETY: Both Windows functions receive valid writable i64 pointers.
    if unsafe { QueryPerformanceFrequency(&mut frequency) } == 0
        || unsafe { QueryPerformanceCounter(&mut ticks) } == 0
    {
        return Err(WireError("worker monotonic clock unavailable".into()));
    }
    counter_duration(ticks, frequency)
}

#[cfg(any(windows, test))]
fn counter_duration(ticks: i64, frequency: i64) -> Result<Duration, WireError> {
    let ticks =
        u128::try_from(ticks).map_err(|_| WireError("negative monotonic counter".into()))?;
    let frequency = u128::try_from(frequency)
        .ok()
        .filter(|value| *value != 0)
        .ok_or_else(|| WireError("invalid monotonic frequency".into()))?;
    let nanos = ticks
        .checked_mul(1_000_000_000)
        .ok_or_else(|| WireError("monotonic conversion overflow".into()))?
        / frequency;
    let secs = u64::try_from(nanos / 1_000_000_000)
        .map_err(|_| WireError("monotonic seconds overflow".into()))?;
    Ok(Duration::new(secs, (nanos % 1_000_000_000) as u32))
}

#[cfg(unix)]
fn platform_now() -> Result<Duration, WireError> {
    let mut value = std::mem::MaybeUninit::<libc::timespec>::uninit();
    // SAFETY: clock_gettime initializes the supplied timespec on success.
    if unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC, value.as_mut_ptr()) } != 0 {
        return Err(WireError(format!(
            "worker monotonic clock: {}",
            std::io::Error::last_os_error()
        )));
    }
    // SAFETY: successful clock_gettime initialized both fields.
    let value = unsafe { value.assume_init() };
    let secs =
        u64::try_from(value.tv_sec).map_err(|_| WireError("negative monotonic seconds".into()))?;
    let nanos = u32::try_from(value.tv_nsec)
        .ok()
        .filter(|value| *value < 1_000_000_000)
        .ok_or_else(|| WireError("invalid monotonic nanoseconds".into()))?;
    Ok(Duration::new(secs, nanos))
}

#[cfg(not(any(unix, windows)))]
fn platform_now() -> Result<Duration, WireError> {
    Err(WireError(
        "same-host monotonic clock unsupported on this platform".into(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn counter_conversion_retains_submillisecond_precision() {
        assert_eq!(
            counter_duration(12_345_678, 10_000_000).unwrap(),
            Duration::new(1, 234_567_800)
        );
        assert!(counter_duration(-1, 10).is_err());
        assert!(counter_duration(1, 0).is_err());
    }
}
