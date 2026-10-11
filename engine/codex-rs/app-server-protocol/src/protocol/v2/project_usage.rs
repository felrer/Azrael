use crate::JsonSchema;
use crate::TS;
use serde::Deserialize;
use serde::Serialize;

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "v2/")]
pub struct ProjectUsageParams {
    pub year: i32,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "v2/")]
pub struct ProjectUsageResponse {
    pub currency: String,
    pub days: Vec<ProjectUsageDay>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "v2/")]
pub struct ProjectUsageDay {
    pub date: String,
    pub projects: Vec<ProjectUsageProject>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "v2/")]
pub struct ProjectUsageProject {
    pub id: String,
    pub name: String,
    pub amount: f64,
    #[ts(type = "number")]
    pub unpriced: i64,
    pub models: Vec<ProjectUsageModel>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "v2/")]
pub struct ProjectUsageModel {
    pub provider: String,
    pub model: String,
    pub amount: f64,
    #[ts(type = "number")]
    pub unpriced: i64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn project_usage_models_are_required_and_roundtrip() {
        let project = json!({
            "id": "project", "name": "Project", "amount": 1.5, "unpriced": 2,
            "models": [{ "provider": "provider", "model": "model", "amount": 1.5, "unpriced": 2 }]
        });
        let decoded: ProjectUsageProject = serde_json::from_value(project.clone()).unwrap();
        assert_eq!(decoded.models.len(), 1);
        assert_eq!(serde_json::to_value(decoded).unwrap(), project);
        let mut missing_models = project;
        missing_models.as_object_mut().unwrap().remove("models");
        assert!(serde_json::from_value::<ProjectUsageProject>(missing_models).is_err());
    }
}
