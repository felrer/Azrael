//! Host-internal consent reminders. Activation only reports an existing request.
use crate::protocol::{Error, Result};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::mpsc,
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use windows::{
    core::{implement, IUnknown, Interface, GUID, HSTRING, PCWSTR},
    Data::Xml::Dom::XmlDocument,
    Foundation::{DateTime, IReference, PropertyValue, TypedEventHandler},
    Win32::{
        Foundation::{
            CloseHandle, GetLastError, BOOL, CLASS_E_NOAGGREGATION, ERROR_ALREADY_EXISTS,
            E_POINTER, HANDLE, WAIT_OBJECT_0,
        },
        System::{
            Com::*,
            Registry::*,
            Threading::{
                CreateEventW, OpenEventW, SetEvent, WaitForSingleObject, EVENT_MODIFY_STATE,
            },
            WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED},
        },
        UI::Notifications::*,
    },
    UI::Notifications::*,
};

const APP: &str = "Azrael.WindowUse";
const CLSID: GUID = GUID::from_u128(0x6bce7e81_fad2_493f_ae0f_98b0f0284a52);
const CLSID_TEXT: &str = "{6BCE7E81-FAD2-493F-AE0F-98B0F0284A52}";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Show {
    request_id: String,
    app_title: String,
    timeout_ms: u64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Hide {
    request_id: String,
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
fn invalid() -> Error {
    Error::new("invalid-params", "Expected UUID requestId, appTitle up to 512 characters, and integer timeoutMs in 1..300000")
}
pub fn validate_show(params: &Value) -> Result<()> {
    let p: Show = serde_json::from_value(params.clone()).map_err(|_| invalid())?;
    if !valid_id(&p.request_id)
        || p.app_title.chars().count() > 512
        || p.app_title.chars().any(|c| c.is_control())
        || !(1..=300000).contains(&p.timeout_ms)
    {
        return Err(invalid());
    }
    Ok(())
}
pub fn hide_without_notification(params: Value) -> Result<Value> {
    let p: Hide = serde_json::from_value(params).map_err(|_| invalid())?;
    if !valid_id(&p.request_id) {
        return Err(invalid());
    }
    Ok(json!({"hidden":false}))
}

#[implement(INotificationActivationCallback)]
struct Activation;
impl INotificationActivationCallback_Impl for Activation_Impl {
    fn Activate(
        &self,
        app: &PCWSTR,
        args: &PCWSTR,
        _: *const NOTIFICATION_USER_INPUT_DATA,
        _: u32,
    ) -> windows::core::Result<()> {
        let (app, id) = unsafe { (app.to_string()?, args.to_string()?) };
        if app != APP || !valid_id(&id) {
            return Ok(());
        }
        // COM may choose any Azrael worker. Signal the request owner's event;
        // only that worker can emit the host event while its deadline is live.
        let name = event_name(&id);
        if let Ok(handle) = unsafe { OpenEventW(EVENT_MODIFY_STATE, false, PCWSTR(name.as_ptr())) }
        {
            let event = OwnedEvent(handle);
            let _ = unsafe { SetEvent(event.0) };
        }
        Ok(())
    }
}
#[implement(IClassFactory)]
struct Factory;
impl IClassFactory_Impl for Factory_Impl {
    fn CreateInstance(
        &self,
        outer: Option<&IUnknown>,
        iid: *const GUID,
        result: *mut *mut std::ffi::c_void,
    ) -> windows::core::Result<()> {
        if result.is_null() || iid.is_null() {
            return Err(E_POINTER.into());
        }
        unsafe {
            *result = std::ptr::null_mut();
        }
        if outer.is_some() {
            return Err(CLASS_E_NOAGGREGATION.into());
        }
        let callback: INotificationActivationCallback = Activation.into();
        unsafe {
            (Interface::vtable(&callback).base__.QueryInterface)(
                Interface::as_raw(&callback),
                iid,
                result,
            )
            .ok()
        }
    }
    fn LockServer(&self, _: BOOL) -> windows::core::Result<()> {
        Ok(())
    }
}
fn register_identity() -> windows::core::Result<()> {
    // Modern unpackaged desktop registration; COM is registered with the running
    // worker, deliberately without an executable launch command for stale toasts.
    let key_path = HSTRING::from(format!("Software\\Classes\\AppUserModelId\\{APP}"));
    unsafe {
        // SCM resolves this real running class factory. No LocalServer32 command
        // is installed: an approval is meaningful only while its host is alive.
        let clsid_key = HSTRING::from(format!("Software\\Classes\\CLSID\\{CLSID_TEXT}"));
        let mut class_key = HKEY::default();
        RegCreateKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(clsid_key.as_ptr()),
            0,
            PCWSTR::null(),
            REG_OPTION_NON_VOLATILE,
            KEY_SET_VALUE,
            None,
            &mut class_key,
            None,
        )
        .ok()?;
        RegCloseKey(class_key).ok()?;
        let mut key = HKEY::default();
        RegCreateKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(key_path.as_ptr()),
            0,
            PCWSTR::null(),
            REG_OPTION_NON_VOLATILE,
            KEY_SET_VALUE,
            None,
            &mut key,
            None,
        )
        .ok()?;
        let result = (|| {
            for (name, value) in [
                ("DisplayName", "Azrael Window Use"),
                ("CustomActivator", CLSID_TEXT),
            ] {
                let name = HSTRING::from(name);
                let bytes: Vec<u8> = value
                    .encode_utf16()
                    .chain(Some(0))
                    .flat_map(u16::to_le_bytes)
                    .collect();
                RegSetValueExW(key, PCWSTR(name.as_ptr()), 0, REG_SZ, Some(&bytes)).ok()?;
            }
            Ok(())
        })();
        let _ = RegCloseKey(key);
        result
    }
}
enum Command {
    Show(Show, Instant, mpsc::Sender<Result<Value>>),
    Hide(String, mpsc::Sender<Result<Value>>),
}
pub struct Notifications {
    sender: Option<mpsc::Sender<Command>>,
    worker: Option<thread::JoinHandle<()>>,
}
impl Notifications {
    pub fn new() -> Result<Self> {
        let (sender, receiver) = mpsc::channel();
        let (ready_tx, ready_rx) = mpsc::channel();
        let worker = thread::spawn(move || run(receiver, ready_tx));
        ready_rx
            .recv()
            .map_err(|_| Error::new("native-error", "Notification worker stopped"))??;
        Ok(Self {
            sender: Some(sender),
            worker: Some(worker),
        })
    }
    pub fn call(&self, method: &str, params: Value) -> Result<Value> {
        let (reply, response) = mpsc::channel();
        let command = if method == "approvalNotificationShow" {
            validate_show(&params)?;
            let p: Show = serde_json::from_value(params).map_err(|_| invalid())?;
            let deadline = Instant::now() + Duration::from_millis(p.timeout_ms);
            Command::Show(p, deadline, reply)
        } else {
            let p: Hide = serde_json::from_value(params).map_err(|_| invalid())?;
            if !valid_id(&p.request_id) {
                return Err(invalid());
            }
            Command::Hide(p.request_id, reply)
        };
        self.sender
            .as_ref()
            .unwrap()
            .send(command)
            .map_err(|_| Error::new("native-error", "Notification worker stopped"))?;
        response
            .recv()
            .map_err(|_| Error::new("native-error", "Notification worker stopped"))?
    }
}
impl Drop for Notifications {
    fn drop(&mut self) {
        self.sender.take();
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}
fn event_name(id: &str) -> HSTRING {
    HSTRING::from(format!(
        "Local\\AzraelWindowUseApproval-{}",
        id.to_ascii_lowercase()
    ))
}
struct OwnedEvent(HANDLE);
impl OwnedEvent {
    fn create(id: &str) -> Result<Self> {
        let name = event_name(id);
        let handle = unsafe { CreateEventW(None, false, false, PCWSTR(name.as_ptr()))? };
        let event = Self(handle);
        if unsafe { GetLastError() } == ERROR_ALREADY_EXISTS {
            return Err(Error::new(
                "native-error",
                "Approval notification request is already owned",
            ));
        }
        Ok(event)
    }
}
impl Drop for OwnedEvent {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}
struct Entry {
    activation: OwnedEvent,
    toast: ToastNotification,
    deadline: Instant,
    seconds: u64,
}
fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
fn remaining(deadline: Instant) -> u64 {
    deadline
        .saturating_duration_since(Instant::now())
        .as_millis()
        .div_ceil(1000) as u64
}
fn data(seconds: u64) -> windows::core::Result<NotificationData> {
    let data = NotificationData::new()?;
    data.Values()?.Insert(
        &HSTRING::from("remaining"),
        &HSTRING::from(format!(
            "Expires in {seconds} seconds. Click to review in Azrael."
        )),
    )?;
    // One owning thread orders updates. Zero is the documented "always update"
    // value and avoids Windows service-assigned history sequence conflicts.
    data.SetSequenceNumber(0)?;
    Ok(data)
}
fn remove(notifier: &ToastNotifier, id: &str, entry: Entry) {
    let _ = notifier.Hide(&entry.toast);
    if let Ok(history) = ToastNotificationManager::History() {
        let _ = history.RemoveGroupedTagWithId(
            &HSTRING::from("approval"),
            &HSTRING::from(id),
            &HSTRING::from(APP),
        );
    }
}
fn run(receiver: mpsc::Receiver<Command>, ready: mpsc::Sender<Result<()>>) {
    let setup = (|| -> windows::core::Result<(ToastNotifier, u32)> {
        unsafe {
            RoInitialize(RO_INIT_MULTITHREADED)?;
        }
        register_identity()?;
        let factory: IClassFactory = Factory.into();
        let cookie = unsafe {
            CoRegisterClassObject(&CLSID, &factory, CLSCTX_LOCAL_SERVER, REGCLS_MULTIPLEUSE)?
        };
        match ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(APP)) {
            Ok(notifier) => Ok((notifier, cookie)),
            Err(error) => {
                unsafe {
                    let _ = CoRevokeClassObject(cookie);
                }
                Err(error)
            }
        }
    })();
    let (notifier, cookie) = match setup {
        Ok(v) => {
            let _ = ready.send(Ok(()));
            v
        }
        Err(e) => {
            let _ = ready.send(Err(e.into()));
            unsafe {
                RoUninitialize();
            }
            return;
        }
    };
    let mut entries: HashMap<String, Entry> = HashMap::new();
    loop {
        match receiver.recv_timeout(Duration::from_millis(100)) {
            Ok(Command::Show(p, deadline, reply)) => {
                let result = (|| -> Result<Value> {
                    if let Some(entry) = entries.remove(&p.request_id) {
                        remove(&notifier, &p.request_id, entry);
                    }
                    // A new unpackaged AUMID has no settings DB row until its
                    // first Show. Other setting failures remain explicit errors.
                    let setting = match notifier.Setting() {
                        Ok(setting) => setting,
                        Err(error) if error.code().0 == 0x80070490u32 as i32 => {
                            NotificationSetting::Enabled
                        }
                        Err(error) => return Err(error.into()),
                    };
                    if remaining(deadline) == 0 || setting != NotificationSetting::Enabled {
                        return Ok(json!({"shown":false}));
                    }
                    let xml = XmlDocument::new()?;
                    xml.LoadXml(&HSTRING::from(format!("<toast launch=\"{}\" activationType=\"foreground\" duration=\"long\"><visual><binding template=\"ToastGeneric\"><text>Window Use approval requested</text><text>{}</text><text>{{remaining}}</text></binding></visual><audio silent=\"true\"/></toast>",p.request_id,escape(&p.app_title))))?;
                    let toast = ToastNotification::CreateToastNotification(&xml)?;
                    toast.Failed(
                        &TypedEventHandler::<ToastNotification, ToastFailedEventArgs>::new(
                            |_, args| {
                                if let Some(args) = args {
                                    if let Ok(error) = args.ErrorCode() {
                                        eprintln!("Window Use toast delivery failed: {error}");
                                    }
                                }
                                Ok(())
                            },
                        ),
                    )?;
                    toast.SetTag(&HSTRING::from("approval"))?;
                    toast.SetGroup(&HSTRING::from(&p.request_id))?;
                    let unix = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap_or_default();
                    let ticks = 116444736000000000i64
                        + (unix.as_nanos() / 100) as i64
                        + (deadline
                            .saturating_duration_since(Instant::now())
                            .as_nanos()
                            / 100) as i64;
                    let expiration: IReference<DateTime> =
                        PropertyValue::CreateDateTime(DateTime {
                            UniversalTime: ticks,
                        })?
                        .cast()?;
                    toast.SetExpirationTime(&expiration)?;
                    let seconds = remaining(deadline);
                    toast.SetData(&data(seconds)?)?;
                    let activation = OwnedEvent::create(&p.request_id)?;
                    if let Err(e) = notifier.Show(&toast) {
                        return Err(Error::new(
                            "native-error",
                            format!("Toast Show: {}", e.code()),
                        ));
                    }
                    entries.insert(
                        p.request_id,
                        Entry {
                            activation,
                            toast,
                            deadline,
                            seconds,
                        },
                    );
                    Ok(json!({"shown":true}))
                })();
                let _ = reply.send(result);
            }
            Ok(Command::Hide(id, reply)) => {
                let hidden = if let Some(entry) = entries.remove(&id) {
                    remove(&notifier, &id, entry);
                    true
                } else {
                    false
                };
                let _ = reply.send(Ok(json!({"hidden":hidden})));
            }
            Err(mpsc::RecvTimeoutError::Timeout) => (),
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
        let expired: Vec<_> = entries
            .iter_mut()
            .filter_map(|(id, entry)| {
                let seconds = remaining(entry.deadline);
                if seconds == 0 {
                    return Some(id.clone());
                }
                if unsafe { WaitForSingleObject(entry.activation.0, 0) } == WAIT_OBJECT_0 {
                    let _ = crate::overlay::write_message(
                        &json!({"event":{"type":"approvalNotificationActivated","requestId":id}}),
                    );
                }
                if seconds != entry.seconds {
                    entry.seconds = seconds;
                    if let Ok(data) = data(seconds) {
                        let _ = notifier.UpdateWithTagAndGroup(
                            &data,
                            &HSTRING::from("approval"),
                            &HSTRING::from(id),
                        );
                    }
                }
                None
            })
            .collect();
        for id in expired {
            if let Some(entry) = entries.remove(&id) {
                remove(&notifier, &id, entry);
            }
        }
    }
    for (id, entry) in entries {
        remove(&notifier, &id, entry);
    }
    unsafe {
        let _ = CoRevokeClassObject(cookie);
        RoUninitialize();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "shows only owned verification notifications; explicit live acceptance"]
    fn live_notification_history_countdown_and_cleanup() {
        unsafe {
            RoInitialize(RO_INIT_MULTITHREADED).unwrap();
        }
        let notifications = Notifications::new().unwrap();
        let id = "adbce777-361b-4388-83fc-9d5a027b6890";
        let snapshot = || {
            let history = ToastNotificationManager::History()
                .unwrap()
                .GetHistoryWithId(&HSTRING::from(APP))
                .unwrap();
            (0..history.Size().unwrap()).find_map(|i| {
                let toast = history.GetAt(i).unwrap();
                if toast.Group().unwrap().to_string() != id {
                    return None;
                }
                let data = toast.Data().unwrap();
                Some((
                    data.SequenceNumber().unwrap(),
                    data.Values()
                        .unwrap()
                        .Lookup(&HSTRING::from("remaining"))
                        .unwrap()
                        .to_string(),
                ))
            })
        };
        assert_eq!(notifications.call("approvalNotificationShow",json!({"requestId":id,"appTitle":"Azrael live countdown verification","timeoutMs":6000})).unwrap(),json!({"shown":true}));
        thread::sleep(Duration::from_millis(400));
        let before = snapshot().expect("shown notification must be in OS history");
        thread::sleep(Duration::from_millis(1300));
        let after = snapshot().expect("live notification must remain in OS history");
        eprintln!("Native history countdown before={before:?}, after={after:?}");
        assert_ne!(after.1, before.1, "actual remaining text must advance");
        notifications
            .call("approvalNotificationHide", json!({"requestId":id}))
            .unwrap();
        assert!(snapshot().is_none(), "hide must remove OS history");
        assert_eq!(
            notifications
                .call(
                    "approvalNotificationShow",
                    json!({"requestId":id,"appTitle":"Azrael expiry verification","timeoutMs":1000})
                )
                .unwrap(),
            json!({"shown":true})
        );
        thread::sleep(Duration::from_millis(1300));
        assert!(snapshot().is_none(), "expiry must remove OS history");
        assert_eq!(
            notifications
                .call("approvalNotificationHide", json!({"requestId":id}))
                .unwrap(),
            json!({"hidden":false})
        );
        notifications
            .call(
                "approvalNotificationShow",
                json!({"requestId":id,"appTitle":"Azrael shutdown verification","timeoutMs":6000}),
            )
            .unwrap();
        drop(notifications);
        assert!(snapshot().is_none(), "shutdown must remove OS history");
        unsafe {
            RoUninitialize();
        }
    }
    #[test]
    fn validates_hide_without_initializing_windows() {
        assert_eq!(
            hide_without_notification(json!({"requestId":"12345678-1234-1234-1234-123456789abc"}))
                .unwrap(),
            json!({"hidden":false})
        );
        for id in [
            "approval:12345678-1234-1234-1234-123456789abc",
            "12345678-1234-1234-1234-123456789abz",
            "",
        ] {
            assert!(hide_without_notification(json!({"requestId":id})).is_err());
        }
    }
    #[test]
    fn escapes_app_titles_and_uses_deadline() {
        assert_eq!(escape("<&\"'"), "&lt;&amp;&quot;&apos;");
        assert_eq!(remaining(Instant::now() - Duration::from_secs(1)), 0);
        assert_eq!(remaining(Instant::now() + Duration::from_millis(1500)), 2);
    }
}
