<a id="앱-로그와-오류-진단-playbook"></a>
# App Logging and Error Diagnosis Playbook

Applicability: Applies to initial implementation of a new app, work that adds or changes logging itself, and diagnosis where missing logs make an error's cause difficult to trace. For ordinary implementation and fixes, only check whether existing logs can trace failures in the changed paths; make other logging improvements only when included in the approved plan.

<a id="기본-원칙"></a>
## Basic Principles

- Apps must have a logging system that can trace execution flow and causes when errors occur. Include it in the initial implementation of new apps.
  When an existing app lacks sufficient logs, present the evidence and improvement scope as a decision in the work plan, and improve only the approved scope.
  If full adoption is needed, specify the remaining scope and adoption plan; do not report checks of some paths as a complete implementation.
- First inspect and reuse existing loggers, framework and platform logging capabilities, and collection paths. Manage log levels,
  fields and output policies consistently across the app; do not leave temporary console output or individual file writes as permanent diagnostic mechanisms.
  Do not introduce unnecessary custom frameworks or external services solely for logging.

<a id="기록할-정보와-경계"></a>
## Information to Record and Boundaries

- Use structured records that support searching and filtering. Basic fields are a timestamp with an explicit time zone, log level,
  component, stable event name, description, and app version and execution environment. Reuse common metadata supplied by the platform.
- Assign correlation identifiers to execution units such as requests, tasks and sessions, and propagate them so related records
  remain connected across asynchronous work, processes and communication boundaries. Apply this to boundaries present in the environment; do not use personal information as identifiers.
- Record startup and shutdown, major operation results and duration, state transitions, and failures in external communication, storage and background work.
  For errors, retain diagnostic context such as the operation name, error type and code, cause chains and available stacks, and retry and recovery results.
  Collect unhandled exceptions at the execution environment's error boundary, and do not silently swallow caught errors.
- Use DEBUG for detailed diagnosis, INFO for major normal operations, WARN for recoverable anomalies, and ERROR for operation failures.
  Define recording responsibility to avoid repeating the same error at every layer; distinguish retry records from final failures.
  Do not treat an operation as successful after merely logging its failure; separate user-facing errors from internal diagnostic details.

<a id="출력보관안전성"></a>
## Output, Retention and Safety

- Define output destinations, default levels, and ways to enable and disable detailed logging for development and deployed environments. Logs must be
  retrievable after a problem occurs in a deployed app. Use files, platform log stores, collected standard output or another method suited to the environment;
  do not consider a transient development console sufficient.
- Define storage limits, retention periods, rotation and deletion policies, and restrict access. Do not record tokens, passwords, authentication headers, personal information,
  or raw requests and responses verbatim. Select allowed fields and apply necessary masking to output and
  export paths, including error objects, URLs and stacks. External transmission must follow the project's data handling policy and authorized scope.
- Limit or aggregate excessive repeated records, and state the impact on error tracing when sampling is used. Bound buffers and queues so logging
  does not block the UI or main execution paths. Prevent storage or collection failures from causing recursive errors or app failures,
  and define a minimal way to detect lost logs and handle pending records at shutdown.

<a id="검증과-운영-문서"></a>
## Verification and Operational Documentation

- Reproduce representative errors in paths where logging was added or changed, and verify that the actual output can trace the failure point, cause and related execution flow.
  Verify retention, retrieval or export paths in the applicable environment and the exclusion of sensitive information;
  check material risks such as storage failures and capacity limits to the extent needed for the change. The presence of logger calls alone is insufficient.
- Record log locations and retrieval methods, level changes and restoration, retention and deletion, and safe collection and sharing procedures in project operational documentation.
  Connect error reports to the occurrence time and time zone, app version, reproduction steps, correlation identifier and required log range.
  Manage operational policies for app diagnostic logs and artifact retention policies for test and build logs produced during work in their respective owning documents.
