//! Durable, storage-neutral operation queue and idle dispatch.

use std::sync::Arc;

use codex_extension_api::ExtensionRegistryBuilder;

mod service;

pub use service::QueueServiceError;
pub use service::QueuedInput;
pub use service::QueuedItem;
pub use service::QueuedItemService;
pub use service::QueuedItemSubmission;

/// Registers the caller-owned queue before lower-priority idle contributors.
pub fn install<C>(registry: &mut ExtensionRegistryBuilder<C>, service: Arc<QueuedItemService>)
where
    C: Send + Sync + 'static,
{
    let watcher = Arc::downgrade(&service);
    registry.thread_lifecycle_contributor(service);
    tokio::spawn(QueuedItemService::watch_external_messages(watcher));
}
