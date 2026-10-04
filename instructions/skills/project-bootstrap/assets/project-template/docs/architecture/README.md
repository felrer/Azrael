# Architecture

Find system structure, behavior models, deployment boundaries, and significant design decisions.

## Scope

Document structure, boundaries, interfaces, constraints, quality attributes, and design decisions. Distinguish current
implementation, intended design, and review proposals using [the project's document-state guidance](../README.md#document-state-and-ownership).
An approved design may still be unimplemented.

Keep implementation order, task assignments, schedules, progress, and migration steps in the project's work artifacts
or procedural owners. This category describes the design, not the implementation plan.

## Organization

- Keep this README as a router with useful reading paths rather than the full design.
- Organize first by independently understandable or changing targets, such as a product, service, subsystem, or shared platform. Use subdirectories when a target has several documents or needs separate ownership.
- Within a target, separate architectural concerns when they need distinct explanations: context, static structure, runtime flows, deployment, cross-cutting concerns, and decisions. Keep their responsibilities clear even when a short document combines them.
- Split documents when readers, ownership, change cadence, or abstraction level differ enough to benefit from independent review. Keep short, closely related content together.
- Link to [work maps](../maps/README.md) for code locations and [operations](../ops/README.md) for executable procedures. Keep each contract with one owner.
- Create files and directories only for actual content, and link only existing documents.

## Choose A Suitable Structure

Consider the system's size, design targets, and readers. Use only the relevant parts of established approaches:

- [C4](https://c4model.com/diagrams) can distinguish system context, containers, and components for structural views; not every level is required.
- [arc42](https://docs.arc42.org/home/) can organize context, strategy, building blocks, runtime, deployment, cross-cutting concerns, quality requirements, and risks.
- [Architecture Decision Records](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions) can preserve the context and consequences of significant individual choices, including links from superseded decisions to their replacements.

Do not copy an entire framework outline mechanically. Extend an existing coherent structure rather than introducing
a parallel one. If another category already owns approved target designs, preserve that boundary and link to it.

No detailed architecture documents are registered yet. Link them here with the appropriate scope and reading path
when designs or verified structural descriptions are available.
