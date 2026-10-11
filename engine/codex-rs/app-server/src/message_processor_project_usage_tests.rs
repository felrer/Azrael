use super::aggregate_project_usage;
use codex_state::ProjectUsageDailyRow;

fn row(provider: &str, model: &str, amount: i64, unpriced: i64) -> ProjectUsageDailyRow {
    ProjectUsageDailyRow {
        date: "2026-10-09".to_owned(),
        project_id: "project-a".to_owned(),
        project_name: "Project A".to_owned(),
        provider: provider.to_owned(),
        model: model.to_owned(),
        amount_nano_usd: amount,
        priced_requests: 0,
        unpriced_requests: unpriced,
    }
}

#[test]
fn project_usage_groups_models_by_provider_and_preserves_totals() {
    let response = aggregate_project_usage(vec![
        row("provider-b", "shared-model", 2_000_000_000, 0),
        row("provider-a", "shared-model", 1_000_000_000, 1),
        row("provider-a", "shared-model", 500_000_000, 2),
        row("provider-a", "unpriced-model", 0, 3),
        row("provider-a", "zero-model", 0, 0),
    ])
    .unwrap();
    assert_eq!(response.currency, "USD");
    let project = &response.days[0].projects[0];
    assert_eq!(project.id, "project-a");
    assert_eq!(project.name, "Project A");
    assert_eq!(project.amount, 3.5);
    assert_eq!(project.unpriced, 6);
    let models: Vec<_> = project
        .models
        .iter()
        .map(|model| {
            (
                model.provider.as_str(),
                model.model.as_str(),
                model.amount,
                model.unpriced,
            )
        })
        .collect();
    assert_eq!(
        models,
        vec![
            ("provider-a", "shared-model", 1.5, 3),
            ("provider-a", "unpriced-model", 0.0, 3),
            ("provider-a", "zero-model", 0.0, 0),
            ("provider-b", "shared-model", 2.0, 0),
        ]
    );
}

#[test]
fn project_usage_keeps_project_and_day_groups_separate() {
    let first = row("provider", "model", 1_000_000_000, 1);
    let mut second_project = first.clone();
    second_project.project_id = "project-b".to_owned();
    let mut second_day = first.clone();
    second_day.date = "2026-10-10".to_owned();
    let response = aggregate_project_usage(vec![second_day, second_project, first]).unwrap();
    assert_eq!(response.days.len(), 2);
    assert_eq!(response.days[0].date, "2026-10-09");
    assert_eq!(response.days[0].projects.len(), 2);
    assert_eq!(response.days[1].date, "2026-10-10");
    for day in response.days {
        for project in day.projects {
            assert_eq!(project.amount, 1.0);
            assert_eq!(project.unpriced, 1);
            assert_eq!(project.models.len(), 1);
            assert_eq!(project.models[0].amount, 1.0);
            assert_eq!(project.models[0].unpriced, 1);
        }
    }
    assert!(aggregate_project_usage(vec![]).unwrap().days.is_empty());
}

#[test]
fn project_usage_rejects_negative_and_overflowing_aggregates() {
    for rows in [
        vec![row("a", "m", -1, 0)],
        vec![row("a", "m", 0, -1)],
        vec![row("a", "m", i64::MAX, 0), row("a", "m", 1, 0)],
        vec![row("a", "m", i64::MAX, 0), row("b", "m", 1, 0)],
        vec![row("a", "m", 0, 9_007_199_254_740_992)],
        vec![row("a", "m", 0, 9_007_199_254_740_991), row("b", "m", 0, 1)],
    ] {
        assert!(aggregate_project_usage(rows).is_err());
    }
    assert_eq!(
        aggregate_project_usage(vec![row("a", "m", i64::MAX, 9_007_199_254_740_991)])
            .unwrap()
            .days[0]
            .projects[0]
            .models[0]
            .unpriced,
        9_007_199_254_740_991,
    );
}
