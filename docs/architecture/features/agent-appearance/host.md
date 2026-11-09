# Agent Appearance Host

<!-- architecture: {"id":"arch.agent-appearance.host","feature":"agent-appearance","layers":["ui","host"]} -->

## Student avatar initialization

Photo subscriptions authorize both bundled avatar directories and the custom storage root at initial subscription, retaining webview options when existing resource roots already cover them. Imports do not add new resource roots. Adding a redundant descendant root reloads the webview and loses the active settings route.

Design preferences use one store per webview. Subscribe in a microtask after the native bridge initializes, or when the first avatar or design settings hook renders, whichever comes first. The pinned UI initializes shared dependencies lazily across cyclic module imports, so the injected module must not call bundle initialization functions during module evaluation. A webview closed before the store is used must also dispose safely.
