# ADR 0005: Content as code, compiled to immutable versioned bundles

- **Status:** Accepted
- **Date:** 2026-09-25

## Context

A course is thousands of interlinked items: lexemes, sentences, letters, audio, images and
accepted-answer patterns. Quality depends on review. Learners' in-flight sessions must not change
when content is republished. AI drafts content, so every item must carry its approval state.

## Decision

- **Source:** YAML in git under `content/fa-en/`, validated by zod schemas (`packages/content-schema`) and `tools/content-cli validate` in CI. Every entity carries `status` (draft → approved) and `provenance`.
- **Build:** `content-cli build` compiles immutable bundles (a manifest, one bundle per unit, a letters bundle, guidebooks, `pathMigrations`). `publish` uploads them to `/v{N}/` on Storage/CDN with immutable caching.
- **Pointer:** the current version comes from `content_versions`, served by `GET /api/meta` with `no-store`, never from a cached file.
- **Sessions** store `content_version + seed + challenge_refs` and are rebuilt from the immutable bundle for re-grading. Enrollments migrate lazily through `pathMigrations`.
- **Release:**
  - Content PR → CI validation + a preview of changed items → native reviewer approval (`CODEOWNERS`).
  - Then publish to staging → QA → approved promotion to production.
  - **Rollback** means republishing the old content as vN+1, never moving the pointer backwards.

## Alternatives considered

- **A headless CMS or database-first authoring.** Friendlier for non-developers, but review, diffing and versioning are harder early on. A Studio app (P3) can emit the same bundle format later.
- **Hand-authoring every exercise.** Doesn't scale. Instead, sessions are generated from lexemes, sentences and lesson specs.

## Consequences

- **Positive:** PR review with diffs, reproducible builds, cheap static hosting, and stable in-flight sessions.
- **Negative:** editing Persian RTL text in YAML is awkward for non-developers. Mitigation: a CSV/Sheets importer now and a Studio app in P3.
- **Negative:** stable IDs and path migrations need discipline, which `validate` enforces.
