//! One persisted reservation per account, driven by the connected extension's background tick.
use super::usage_window_inference;
use super::usage_window_store::Record;
use super::usage_window_store::Store;
use super::*;
use codex_app_server_protocol::AzraelUsageWindowSchedule;
use codex_app_server_protocol::AzraelUsageWindowStatus as Status;
use codex_app_server_protocol::GetAccountRateLimitsResponse;
use std::collections::HashSet;

impl AccountRequestProcessor {
    pub(super) fn usage_window_status(
        &self,
    ) -> Result<Vec<AzraelUsageWindowSchedule>, JSONRPCErrorError> {
        let profiles = self
            .azrael
            .store
            .list()
            .map_err(|_| internal_error("Account profiles could not be read."))?;
        let mut identities = HashSet::new();
        let mut schedules = Vec::new();
        for profile in &profiles {
            if !identities.insert((
                profile.workspace_account_id.clone(),
                profile.user_id.clone(),
            )) {
                continue;
            }
            // Aliases share policy; recognized plan evidence must not depend on list order.
            let mut owner = profile.clone();
            if !Record::confirmed_paid(&owner)
                && let Some(alias) = profiles.iter().find(|alias| {
                    alias.workspace_account_id == profile.workspace_account_id
                        && alias.user_id == profile.user_id
                        && Record::confirmed_paid(alias)
                })
            {
                owner.plan_type.clone_from(&alias.plan_type);
            }
            match Store::status(&self.config.codex_home, &owner) {
                Ok(record) => schedules.push(record.schedule),
                Err(_) => {
                    return Err(internal_error(
                        "Automatic timer reservations could not be read.",
                    ));
                }
            }
        }
        Ok(schedules)
    }

    pub(super) fn usage_window_set_enabled(
        &self,
        profile_id: &str,
        enabled: bool,
    ) -> Result<(), JSONRPCErrorError> {
        let profiles = self
            .azrael
            .store
            .list()
            .map_err(|_| internal_error("Account profiles could not be read."))?;
        let profile = profiles
            .iter()
            .find(|profile| profile.id == profile_id)
            .ok_or_else(|| invalid_request("account profile is unavailable"))?;
        let store = Store::open(&self.config.codex_home, profile).map_err(reservation_error)?;
        let mut record = store
            .load(profile)
            .map_err(reservation_error)?
            .unwrap_or_else(|| Record::new(profile));
        record.set_enabled(enabled);
        store.save(&record).map_err(reservation_error)
    }

    pub(super) fn usage_window_observe(
        &self,
        profile_id: &str,
        data: &GetAccountRateLimitsResponse,
        observed_at: i64,
    ) {
        // A tick holds this same OS lock while querying; observations cannot re-arm its work.
        let result = (|| -> std::io::Result<()> {
            let profiles = self.azrael.store.list()?;
            let profile = profiles
                .iter()
                .find(|profile| profile.id == profile_id)
                .ok_or(std::io::ErrorKind::NotFound)?;
            let store = Store::open(&self.config.codex_home, profile)?;
            let mut record = store.load(profile)?.unwrap_or_else(|| Record::new(profile));
            record.reserve(Record::capture(data, observed_at));
            store.save(&record)
        })();
        if let Err(error) = result
            && error.kind() != std::io::ErrorKind::WouldBlock
        {
            tracing::warn!(kind = ?error.kind(), "automatic timer observation could not be persisted");
        }
    }

    pub(super) async fn usage_window_tick(&self) -> Result<(), JSONRPCErrorError> {
        let schedules = self.usage_window_status()?;
        let now = chrono::Utc::now().timestamp();
        let mut due: Vec<_> = schedules
            .into_iter()
            .filter(|schedule| schedule.enabled && schedule.next_run_at.is_some_and(|at| at <= now))
            .collect();
        due.sort_by_key(|schedule| schedule.next_run_at);
        for schedule in due {
            let profiles = self
                .azrael
                .store
                .list()
                .map_err(|_| internal_error("Account profiles could not be read."))?;
            let Some(profile) = profiles
                .iter()
                .find(|profile| profile.id == schedule.profile_id)
            else {
                continue;
            };
            let store = match Store::open(&self.config.codex_home, profile) {
                Ok(store) => store,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => continue,
                Err(error) => return Err(reservation_error(error)),
            };
            let Some(mut record) = store.load(profile).map_err(reservation_error)? else {
                continue;
            };
            if !record.schedule.enabled || record.schedule.next_run_at.is_none_or(|at| at > now) {
                continue;
            }
            let result = tokio::time::timeout(
                Duration::from_secs(/*secs*/ 45),
                self.usage_window_step(&store, &mut record),
            )
            .await;
            if !matches!(result, Ok(Ok(()))) {
                record.failures = record.failures.saturating_add(1);
                record.schedule.error = Some(
                    "자동 타이머 조회 또는 저장에 실패했습니다. 모델 요청은 재전송하지 않습니다."
                        .to_string(),
                );
                // Keep Confirming across timeout/crash so the next step can only query.
                record.schedule.next_run_at = Some(
                    chrono::Utc::now().timestamp()
                        + (30_i64 * 2_i64.pow(record.failures.min(5))).min(600),
                );
                store.save(&record).map_err(reservation_error)?;
            }
            // One due account per RPC bounds work below the bridge's deadline.
            break;
        }
        Ok(())
    }

    async fn usage_window_step(
        &self,
        store: &Store,
        record: &mut Record,
    ) -> Result<(), JSONRPCErrorError> {
        let data = tokio::time::timeout(
            Duration::from_secs(/*secs*/ 10),
            self.azrael_usage(&record.schedule.profile_id, /*include_details*/ false),
        )
        .await
        .map_err(|_| internal_error("Automatic timer usage query timed out."))??;
        let now = chrono::Utc::now().timestamp();
        let observation = Record::capture(&data, now);
        if observation.windows.is_empty() {
            record.schedule.status = Status::Blocked;
            record.schedule.next_run_at = None;
            record.schedule.error = Some("대상 한도와 기간을 확인할 수 없습니다.".to_string());
            return store.save(record).map_err(reservation_error);
        }
        record.failures = 0;
        let confirming = record.schedule.status == Status::Confirming;
        if confirming {
            if record.confirm_started(&observation) {
                record.schedule.status = Status::Started;
                record.schedule.error = None;
                record.finish_cycle(observation);
            } else {
                record.checks += 1;
                record.observation = observation.clone();
                if record.checks < 2 {
                    record.schedule.next_run_at = Some(now + 45);
                } else {
                    record.schedule.status = Status::Unconfirmed;
                    if record.schedule.error.is_none() {
                        record.schedule.error = Some(
                            "짧은 요청을 시도했으나 한도 타이머 시작은 확인되지 않았습니다."
                                .to_string(),
                        );
                    }
                    record.finish_cycle(observation);
                }
            }
            return store.save(record).map_err(reservation_error);
        }
        let dormant = record.dormant(&observation);
        if dormant.is_empty() {
            let future = observation
                .windows
                .iter()
                .all(|window| window.reset.is_some_and(|reset| reset > now));
            if future && !record.confirm_started(&observation) {
                record.schedule.status = Status::Checking;
                record.schedule.next_run_at = Some(now + 15);
                record.suspected_slots.clear();
                record.observation = observation;
                return store.save(record).map_err(reservation_error);
            }
            record.schedule.status = if future {
                Status::Started
            } else {
                Status::Unconfirmed
            };
            record.schedule.error = None;
            record.finish_cycle(observation);
            return store.save(record).map_err(reservation_error);
        }
        if record.schedule.status != Status::Checking
            || now - record.observation.observed_at < 10
            || !dormant
                .iter()
                .any(|slot| record.suspected_slots.contains(slot))
        {
            record.schedule.status = Status::Checking;
            record.schedule.next_run_at = Some(now + 15);
            record.suspected_slots = dormant;
            record.observation = observation;
            return store.save(record).map_err(reservation_error);
        }
        if data.ordinary_usage_allowed != Some(true)
            || data.rate_limits.spend_control_reached == Some(true)
        {
            record.schedule.status = Status::Blocked;
            record.schedule.error = Some(
                "포함 사용량으로 요청할 수 있는지 확인되지 않아 시작 요청을 보류했습니다."
                    .to_string(),
            );
            record.finish_cycle(observation);
            return store.save(record).map_err(reservation_error);
        }
        let model = data
            .rate_limits
            .normal_model_slug
            .clone()
            .or_else(|| self.config.model.clone())
            .filter(|model| !model.is_empty() && !model.to_lowercase().contains("spark"))
            .ok_or_else(|| {
                invalid_request("An ordinary OpenAI model is required for automatic timer start.")
            })?;
        let profile = self
            .azrael_profile_auth(&record.schedule.profile_id)
            .await?;
        // Atomic persistence must succeed BEFORE any model request may leave this process.
        let confirmed_dormant: Vec<_> = dormant
            .into_iter()
            .filter(|slot| record.suspected_slots.contains(slot))
            .collect();
        record.record_attempt(&observation, &confirmed_dormant);
        store.save(record).map_err(reservation_error)?;
        if let Err(error) = usage_window_inference::start_window(profile, model).await {
            record.schedule.error = Some(error);
        }
        store.save(record).map_err(reservation_error)
    }
}

fn reservation_error(error: std::io::Error) -> JSONRPCErrorError {
    if error.kind() == std::io::ErrorKind::WouldBlock {
        invalid_request("이 계정의 자동 타이머 작업이 실행 중입니다. 완료 후 다시 시도해주세요.")
    } else {
        internal_error("자동 타이머 예약을 읽거나 저장할 수 없습니다.")
    }
}
