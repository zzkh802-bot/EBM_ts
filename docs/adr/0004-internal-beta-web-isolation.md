# ADR-0004: Internal beta web isolation and feedback

## Status

Accepted for the internal annotation beta.

## Context

The initial ADRs described a single local user and deferred the web product. The internal beta now serves several annotators through one private deployment, so the web runtime needs lightweight account and session ownership without introducing a multi-tenant database or a second agent runtime.

## Decisions

1. Each annotator registers a generated `u-...` ID and password. The shared invite key is only a beta registration gate; it is never used as a user identity.
2. Research sessions, runs, feedback, attachments and workspace files are associated with the authenticated user. The shared source library remains global and read-only from the user's perspective.
3. JSON/files remain the source of truth. `data/internal-users.json`, session ownership metadata and per-session workspaces are protected with restrictive permissions and are not exposed through the model.
4. Local development may run without auth on loopback only. A non-loopback server bind must have `EBM_INTERNAL_ACCESS_KEY` or refuse to start.
5. Native Pi file tools are constrained to the active session workspace for research data. Project instruction files are read-only; evidence/source directories are written through domain tools.
6. Uploads are user- and session-bound, subject to per-file and per-user quotas. Unprocessed orphan uploads are temporary and cleaned after the retention window; processed originals remain available for beta review.
7. The feedback questionnaire appears once per session, is linked to the first formal report/query, and requires all nine 1–5 rubrics. The global feature switch remains `EBM_FEEDBACK_ENABLED`.

## Consequences

- This is an internal-beta boundary, not an enterprise multi-tenant security model.
- The web API must test cross-user/session access and feedback/run linkage.
- The earlier single-user/web-future statements in ADR-0002 are superseded for this beta; the Pi-first runtime and file/JSON storage decisions remain in force.
