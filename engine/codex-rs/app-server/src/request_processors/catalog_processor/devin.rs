use super::CatalogRequestProcessor;
use codex_app_server_protocol::ClientResponsePayload;
use codex_app_server_protocol::DevinAccountAction;
use codex_app_server_protocol::DevinAccountParams;
use codex_app_server_protocol::DevinAccountResponse;
use codex_app_server_protocol::JSONRPCErrorError;
use codex_models_manager::manager::RefreshStrategy;

impl CatalogRequestProcessor {
    pub(crate) async fn devin_account(
        &self,
        params: DevinAccountParams,
    ) -> Result<Option<ClientResponsePayload>, JSONRPCErrorError> {
        let action = match params.action {
            DevinAccountAction::Status => "status",
            DevinAccountAction::Login => "login",
            DevinAccountAction::LoginCancel => "loginCancel",
            DevinAccountAction::Logout => "logout",
            DevinAccountAction::Refresh => "refresh",
        };
        let status = codex_core::manage_devin_account(action)
            .await
            .map_err(|err| crate::error_code::invalid_params(err.to_string()))?;
        if action != "status" && action != "loginCancel" {
            self.thread_manager
                .list_models(RefreshStrategy::Online, self.config.http_client_factory())
                .await;
        }
        Ok(Some(
            DevinAccountResponse {
                enabled: status.enabled,
                logged_in: status.logged_in,
                email: status.email,
                plan: status.plan,
            }
            .into(),
        ))
    }
}
