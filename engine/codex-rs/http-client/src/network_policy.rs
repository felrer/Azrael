//! Application destination checks and revocation of outstanding network operations.
//!
//! The configuration owner publishes an already-composed policy. Transports retain only its
//! read side and a permit for each request; invalidation cannot leave an old request authorized.

use std::collections::BTreeSet;
use std::fmt;
use std::future::Future;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::MutexGuard;
use std::sync::Weak;

use reqwest::Url;
use tokio::sync::watch;

/// Effective application destinations, after the requirements owner has applied precedence.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DestinationPolicy {
    Unrestricted,
    /// Only HTTPS and WSS requests to these exact, normalized hosts are permitted.
    Restricted {
        allowed_hosts: BTreeSet<String>,
    },
}

impl DestinationPolicy {
    fn allows(&self, url: &Url) -> bool {
        match self {
            Self::Unrestricted => true,
            Self::Restricted { allowed_hosts } => {
                matches!(url.scheme(), "https" | "wss")
                    && url.host_str().is_some_and(|host| {
                        allowed_hosts.contains(host.strip_suffix('.').unwrap_or(host))
                    })
            }
        }
    }
}

/// A deterministic denial, distinct from retryable network failures.
#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
pub enum NetworkPolicyDenied {
    #[error("application network policy is unavailable")]
    Unavailable,
    #[error("destination denied by application network policy")]
    Destination,
    #[error("application network permission was revoked")]
    Revoked,
    #[error("this SDK transport is disabled by application network restrictions")]
    UnsupportedTransport,
}

/// Live destination authority supplied by the application owner, including across processes.
pub trait NetworkPolicyAuthority: Send + Sync {
    fn acquire(&self, url: &Url) -> Result<NetworkPermit, NetworkPolicyDenied>;
}

/// Read access to application policy. Clones observe the same updates.
#[derive(Clone, Default)]
pub struct NetworkPolicy {
    state: Option<Arc<Mutex<State>>>,
    authority: Option<Arc<dyn NetworkPolicyAuthority>>,
    endpoints: Option<Arc<BTreeSet<Url>>>,
    account: Option<u64>,
}

impl fmt::Debug for NetworkPolicy {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("NetworkPolicy")
            .field("managed", &self.is_managed())
            .finish_non_exhaustive()
    }
}

impl PartialEq for NetworkPolicy {
    fn eq(&self, other: &Self) -> bool {
        self.endpoints == other.endpoints
            && self.account == other.account
            && match (&self.authority, &other.authority) {
                (Some(left), Some(right)) => Arc::ptr_eq(left, right),
                (None, None) => true,
                _ => false,
            }
            && match (&self.state, &other.state) {
                (Some(left), Some(right)) => Arc::ptr_eq(left, right),
                (None, None) => true,
                (Some(_), None) | (None, Some(_)) => false,
            }
    }
}

impl Eq for NetworkPolicy {}

struct State {
    policy: Option<DestinationPolicy>,
    revision: u64,
    account: u64,
    permits: Vec<Weak<Permit>>,
    changes: watch::Sender<()>,
}

struct Permit {
    destination: PermitDestination,
    revoked: watch::Sender<bool>,
}

enum PermitDestination {
    Url(Url),
    UnrestrictedSdk,
}

impl PermitDestination {
    fn allowed_by(&self, policy: &DestinationPolicy) -> bool {
        match self {
            Self::Url(url) => policy.allows(url),
            Self::UnrestrictedSdk => matches!(policy, DestinationPolicy::Unrestricted),
        }
    }
}

/// Publication access retained by the account/configuration owner.
#[derive(Clone)]
pub struct NetworkPolicyController {
    state: Arc<Mutex<State>>,
}

/// Identifies the account/configuration generation that a load is allowed to publish into.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct NetworkPolicyRevision(u64);

impl Default for NetworkPolicyController {
    fn default() -> Self {
        Self {
            state: Arc::new(Mutex::new(State {
                policy: None,
                revision: 0,
                account: 0,
                permits: Vec::new(),
                changes: watch::channel(()).0,
            })),
        }
    }
}

fn lock_state(state: &Mutex<State>) -> MutexGuard<'_, State> {
    state
        .lock()
        .unwrap_or_else(|_| panic!("application network policy lock poisoned"))
}

impl NetworkPolicyController {
    pub fn policy(&self) -> NetworkPolicy {
        NetworkPolicy {
            state: Some(self.state.clone()),
            authority: None,
            endpoints: None,
            account: None,
        }
    }

    /// Fails a requirements load without changing the current account identity.
    pub fn unavailable(&self, revision: NetworkPolicyRevision) {
        let mut state = lock_state(&self.state);
        if state.revision != revision.0 {
            return;
        }
        if state.policy.take().is_some() {
            state.changes.send_replace(());
        }
        for permit in state
            .permits
            .drain(..)
            .filter_map(|permit| permit.upgrade())
        {
            permit.revoked.send_replace(/*value*/ true);
        }
    }

    /// Publishes a successful load only if its account/configuration generation is still current.
    pub fn publish(&self, revision: NetworkPolicyRevision, policy: DestinationPolicy) -> bool {
        let mut state = lock_state(&self.state);
        if state.revision != revision.0 {
            return false;
        }
        state.permits.retain(|permit| {
            let Some(permit) = permit.upgrade() else {
                return false;
            };
            if !permit.destination.allowed_by(&policy) {
                permit.revoked.send_replace(/*value*/ true);
            }
            true
        });
        if state.policy.as_ref() != Some(&policy) {
            state.policy = Some(policy);
            state.changes.send_replace(());
        }
        true
    }
}

impl NetworkPolicy {
    pub const fn unmanaged() -> Self {
        Self {
            state: None,
            authority: None,
            endpoints: None,
            account: None,
        }
    }

    /// Uses a live owner for every acquisition instead of reconstructing its policy.
    pub fn from_authority(authority: Arc<dyn NetworkPolicyAuthority>) -> Self {
        Self {
            authority: Some(authority),
            ..Self::unmanaged()
        }
    }

    /// Narrows a bootstrap client's existing local policy to exact endpoint URLs.
    /// This cannot grant access to a destination denied by the underlying policy.
    pub fn restrict_to_endpoints(mut self, endpoints: BTreeSet<Url>) -> Self {
        self.endpoints = Some(Arc::new(match &self.endpoints {
            Some(existing) => existing.intersection(&endpoints).cloned().collect(),
            None => endpoints,
        }));
        self
    }

    /// Binds a content client to the current account so retained credentials cannot
    /// be used after another workspace's policy has been installed.
    pub fn for_current_account(mut self) -> Self {
        self.account = self.state.as_ref().map(|state| lock_state(state).account);
        self
    }

    /// Whether destination-aware transport is required by a live or static policy.
    pub fn is_managed(&self) -> bool {
        self.state.is_some() || self.authority.is_some()
    }

    /// Watches effective changes; unmanaged callers have no application policy owner.
    pub fn changes(&self) -> Option<watch::Receiver<()>> {
        self.state
            .as_ref()
            .map(|state| lock_state(state).changes.subscribe())
    }

    pub fn revision(&self) -> NetworkPolicyRevision {
        NetworkPolicyRevision(
            self.state
                .as_ref()
                .map_or(0, |state| lock_state(state).revision),
        )
    }

    /// Revokes outstanding operations before an account change or a failed requirements load.
    /// This read-side operation can only remove access; publication stays with the controller.
    pub fn invalidate(&self) {
        if let Some(state) = &self.state {
            let mut state = lock_state(state);
            state.revision += 1;
            state.account += 1;
            state.policy = None;
            state.changes.send_replace(());
            for permit in state
                .permits
                .drain(..)
                .filter_map(|permit| permit.upgrade())
            {
                permit.revoked.send_replace(/*value*/ true);
            }
        }
    }

    /// Checks a destination before proxy resolution, DNS, or transport work starts.
    pub fn acquire(&self, url: &Url) -> Result<NetworkPermit, NetworkPolicyDenied> {
        if self
            .endpoints
            .as_ref()
            .is_some_and(|endpoints| !endpoints.contains(url))
        {
            return Err(NetworkPolicyDenied::Destination);
        }
        if let Some(authority) = &self.authority {
            return authority.acquire(url);
        }
        self.acquire_destination(PermitDestination::Url(url.clone()))
    }

    /// Disables SDKs without destination enforcement whenever restrictions apply.
    /// The returned permit also cancels work if an unrestricted policy changes.
    pub fn acquire_for_unsupported_sdk(&self) -> Result<NetworkPermit, NetworkPolicyDenied> {
        if self.authority.is_some() || self.endpoints.is_some() {
            return Err(NetworkPolicyDenied::UnsupportedTransport);
        }
        self.acquire_destination(PermitDestination::UnrestrictedSdk)
    }

    fn acquire_destination(
        &self,
        destination: PermitDestination,
    ) -> Result<NetworkPermit, NetworkPolicyDenied> {
        let Some(state) = &self.state else {
            return Ok(NetworkPermit {
                inner: None,
                revocation: None,
            });
        };
        let mut state = lock_state(state);
        if self.account.is_some_and(|account| account != state.account) {
            return Err(NetworkPolicyDenied::Revoked);
        }
        let policy = state
            .policy
            .as_ref()
            .ok_or(NetworkPolicyDenied::Unavailable)?;
        if !destination.allowed_by(policy) {
            return Err(match destination {
                PermitDestination::Url(_) => NetworkPolicyDenied::Destination,
                PermitDestination::UnrestrictedSdk => NetworkPolicyDenied::UnsupportedTransport,
            });
        }
        let (revoked, _) = watch::channel(/*init*/ false);
        let permit = Arc::new(Permit {
            destination,
            revoked,
        });
        state.permits.retain(|permit| permit.strong_count() != 0);
        state.permits.push(Arc::downgrade(&permit));
        Ok(NetworkPermit {
            inner: Some(permit),
            revocation: None,
        })
    }
}

/// Authorization retained for the entire operation, including response or WebSocket streaming.
#[derive(Clone)]
pub struct NetworkPermit {
    inner: Option<Arc<Permit>>,
    revocation: Option<watch::Receiver<bool>>,
}

impl fmt::Debug for NetworkPermit {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("NetworkPermit").finish_non_exhaustive()
    }
}

impl NetworkPermit {
    /// Retains a remote owner's live permission. Loss of the sender fails closed.
    pub fn from_revocation(revocation: watch::Receiver<bool>) -> Self {
        Self {
            inner: None,
            revocation: Some(revocation),
        }
    }

    pub fn check(&self) -> Result<(), NetworkPolicyDenied> {
        if self
            .revocation
            .as_ref()
            .is_some_and(|receiver| *receiver.borrow() || receiver.has_changed().is_err())
            || self
                .inner
                .as_ref()
                .is_some_and(|permit| *permit.revoked.borrow())
        {
            Err(NetworkPolicyDenied::Revoked)
        } else {
            Ok(())
        }
    }

    pub async fn revoked(&self) {
        if let Some(receiver) = &self.revocation {
            let mut receiver = receiver.clone();
            let _ = receiver.wait_for(|revoked| *revoked).await;
            return;
        }
        match &self.inner {
            Some(permit) => {
                let _ = permit
                    .revoked
                    .subscribe()
                    .wait_for(|revoked| *revoked)
                    .await;
            }
            None => std::future::pending().await,
        }
    }

    pub async fn run<T>(
        &self,
        operation: impl Future<Output = T>,
    ) -> Result<T, NetworkPolicyDenied> {
        tokio::select! {
            biased;
            _ = self.revoked() => Err(NetworkPolicyDenied::Revoked),
            result = operation => Ok(result),
        }
    }
}

#[cfg(test)]
#[path = "network_policy_tests.rs"]
mod tests;

#[cfg(test)]
mod external_authority_tests {
    use super::*;

    #[tokio::test]
    async fn external_permit_revokes_when_owner_disconnects() {
        let (sender, receiver) = watch::channel(false);
        let permit = NetworkPermit::from_revocation(receiver);
        let cloned = permit.clone();
        assert!(permit.check().is_ok());
        drop(sender);
        assert_eq!(permit.check(), Err(NetworkPolicyDenied::Revoked));
        assert_eq!(
            cloned.run(async { 42 }).await,
            Err(NetworkPolicyDenied::Revoked)
        );
    }

    #[test]
    fn external_authority_keeps_local_restrictions_and_live_denials() {
        struct Authority;
        impl NetworkPolicyAuthority for Authority {
            fn acquire(&self, _: &Url) -> Result<NetworkPermit, NetworkPolicyDenied> {
                Err(NetworkPolicyDenied::Unavailable)
            }
        }
        let exact = Url::parse("https://b.example/allowed").unwrap();
        let policy = NetworkPolicy::from_authority(Arc::new(Authority))
            .restrict_to_endpoints(BTreeSet::from([exact.clone()]));
        assert!(policy.is_managed());
        assert_eq!(policy.clone(), policy);
        assert_ne!(NetworkPolicy::from_authority(Arc::new(Authority)), policy);
        assert_eq!(
            policy.acquire(&exact).unwrap_err(),
            NetworkPolicyDenied::Unavailable
        );
        assert_eq!(
            policy
                .acquire(&Url::parse("https://b.example/other").unwrap())
                .unwrap_err(),
            NetworkPolicyDenied::Destination
        );
        assert_eq!(
            policy.acquire_for_unsupported_sdk().unwrap_err(),
            NetworkPolicyDenied::UnsupportedTransport
        );
    }
}
