# Testing Summary (Launch.AI)

This document is a testing-oriented summary for future AI agents. It is based on `E:\LaunchAi` sources and references the existing API overview in `E:\Launch\playwright_node\docs\api-overview.md`. Tests in `E:\LaunchAi\tests` were **not** inspected per instruction.

## Primary Test Surfaces
1. **LocalApi (localhost REST)**
   - Connector definitions and instances (CRUD, enable/disable, rescan plugins)
   - OAuth start/callback flows
   - Chat, attachments, answer logs
   - Prompt packages and prompt templates (CRUD, import/export)

2. **Proxy API (hosted)**
   - Google token exchange/refresh endpoints
   - Slack token exchange endpoint

3. **Connector Settings Schema (UI-driven config)**
   - JSON Schema + `x-ui` fields
   - Dynamic data sources (API-backed selects/tree views)
   - Field dependencies and conditional data sources

4. **Ingestion Pipeline**
   - Connector plugins (Gmail, Drive, Slack, FileSystem)
   - Raw content storage (Postgres) + graph/vector storage (Neo4j)
   - Embeddings + rerank (ONNX models)

5. **Retrieval & Chat Orchestration**
   - Agent-based search routing (single/collection/sequential)
   - Follow-up orchestration and caching
   - Tool-calling LLM clients

## High-Risk Areas / Common Failure Modes
- OAuth flows: redirect URI mismatch, token refresh failures, expired tokens.
- Plugin loading: missing plugin bundles, stale plugin catalog after updates.
- DataSource-backed UI fields: API contract mismatches for select/treeview options.
- Ingestion dependency drift: Postgres schema, Neo4j availability, or missing ONNX models.
- Retrieval configuration: provider/model mismatches; prompt template errors.
- Image parsing and OCR: large files, multi-page images, embedded document images.

## Environment & Dependencies for Testing
- **Postgres**: required for connector metadata and raw content state.
- **Neo4j**: required for ingestion and retrieval.
- **Secrets store**: OS keychain or local encrypted file.
- **ONNX models**: embeddings and optional reranker models on disk.
- **LocalApi** default port: `5199` (configurable in appsettings).
- **Proxy API**: hosted service for OAuth token exchange.

## Suggested Test Strategy (conceptual)
- **Contract/API tests** for LocalApi and Proxy endpoints (auth, payload shape, status codes).
- **Integration tests** for ingestion with real or mocked connectors, validating Postgres + Neo4j side effects.
- **UI-driven schema tests** that validate dynamic settings forms against `CONNECTOR_SCHEMA.md` expectations.
- **Regression tests** for recent features (prompt packages, image parsing, follow-up orchestration).

## Test Data & Fixtures
- OAuth-enabled connector credentials (Google/Slack) and test accounts.
- Seed data in Postgres + Neo4j for deterministic retrieval tests.
- Sample documents and images (multi-page TIFF, embedded images in DOCX/PPTX/PDF).

## References
- API inventory: `E:\Launch\playwright_node\docs\api-overview.md`
- Connector settings schema: `E:\LaunchAi\docs\CONNECTOR_SCHEMA.md`
- App entrypoints: `E:\LaunchAi\src\Api\LocalApi\Program.cs`, `E:\LaunchAi\src\Api\Proxy\Program.cs`
- Change drivers and test notes: `E:\LaunchAi\CHANGELOG.md`

## Codex-Based CLI QA (Experimental)
- Architecture: cases in `qa/codex/cases/<type>/TC-*.json`, runner `qa/codex/runner/run-case.ts`, steps in `qa/codex/steps/`.
- Single-command execution: `npx ts-node qa/codex/runner/run-case.ts --case-file <path>`.
- Output bundles stored in `qa/logs/YYYY-MM-DD/<caseId>/run-<id>.json` for manual Codex judgement.
