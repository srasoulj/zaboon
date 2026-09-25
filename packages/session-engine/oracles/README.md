# Session-engine oracles (read-only)

Owned by the orchestrator and **read-only** for workers (`**/oracles/**` is protected in
`ops/ownership.json`).

- `mvp-sessions.golden.json` + `mvp-sessions.oracle.test.ts`: sessions for fixed seeds and learners
  on the frozen fixture course, recorded from the MVP engine. While every Wave 3 feature is off
  (`GenerateInput.features` absent or all false), `generateSession` must reproduce them exactly:
  the same refs and the same challenges (answer graphs excluded; they belong to `@zaboon/grader`).
  A worker who needs an MVP session to change asks the orchestrator under
  `## Contract change request`; only the orchestrator re-records (`ZABOON_RECORD_GOLDEN=1`).
