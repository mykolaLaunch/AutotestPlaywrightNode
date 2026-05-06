# Automated Query Testing Pipeline

## Overview

This document describes the approach for automating our query testing using Azure DevOps Pipelines. The goal is to catch regressions quickly on every commit and provide clear reporting to the team.

Testing is split into two concerns:

1. **LLM tool-calling quality** (Pipelines 1 & 2) — tested via the existing Bench tool with mock search results. These pipelines verify that prompt changes don't degrade the LLM's ability to choose the right tools, formulate good queries, and handle multi-turn conversations.
2. **End-to-end search correctness** (Pipelines 3 & 4) — tested via a separate xUnit integration test project (`tests/E2E`) that hits the real API with a seeded dataset. These pipelines catch regressions in the full search flow: categorisation, agent orchestration, search execution, top-k filtering, entity resolution, and response generation. A critical subset runs on every PR (Pipeline 3) to catch integration breakages before they land on main, while the full suite runs post-merge (Pipeline 4).

## Current State

The **Bench** tool (`tools/Bench`) already provides:

- CLI invocation: `dotnet run -- [options]`
- 263 preset queries across all interaction patterns (single-topic, collection, sequential, direct)
- Structured JSON output with pass/warn/fail scoring (`--output results.json`)
- Regression detection against baselines (`--compare baseline.json`)
- Mock mode by default (mock search results, no live backend required)
- Multi-run flakiness detection (`--runs N`)
- Multi-provider support (Gemini, OpenAI, OpenRouter)

## Architecture

```
Push to Azure Repos
        |
        v
Azure Pipeline triggers
        |
        v
  +-----+------+------------------+------------------+
  |             |                  |                  |
  v             v                  v                  v
Lightweight    Comprehensive      E2E Core           E2E Full
prompt tests   prompt tests       (PR gate,          (merge to main,
(every push,   (nightly + merge   self-hosted agent  self-hosted agent
 hosted agent)  to main,           + Neo4j            + Neo4j
                self-hosted)       + Postgres)        + Postgres)
  |             |                  |                  |
  v             v                  v                  v
Publish test results + artifacts
        |
        v
Notifications on failure (email / Teams)
```

### Pipeline 1: Per-Commit (Lightweight)

Runs on every push to any branch using a Microsoft-hosted agent.

- **Scope**: Core regression subset (see [Query Set for Pipeline 1](#query-set-for-pipeline-1) below)
- **Mode**: Mock (no live backend needed)
- **Provider**: Primary provider only (Gemini)
- **Runs**: 1 (fast feedback)
- **Trigger**: Push to any branch
- **Expected duration**: Under 10 minutes

```yaml
# azure-pipelines-query-tests.yml (indicative structure)
trigger:
  branches:
    include: ['*']

pool:
  vmImage: 'ubuntu-latest'

steps:
  - task: UseDotNet@2
    inputs:
      version: '8.x'

  - script: |
      cd tools/Bench
      dotnet run -- \
        --provider gemini \
        --tier 1 \
        --suite core \
        --output $(Build.ArtifactStagingDirectory)/results.json \
        --output-junit $(Build.ArtifactStagingDirectory)/results.xml \
        --compare baseline-single-gemini-v2.json \
        --fail-threshold fail-thresholds.json
    displayName: 'Run query regression tests'
    env:
      GOOGLE_API_KEY: $(GoogleApiKey)

  - task: PublishTestResults@2
    inputs:
      testResultsFormat: 'JUnit'
      testResultsFiles: '$(Build.ArtifactStagingDirectory)/results.xml'
      testRunTitle: 'Query Regression Tests'
    condition: always()

  - task: PublishBuildArtifacts@1
    inputs:
      pathToPublish: '$(Build.ArtifactStagingDirectory)/results.json'
      artifactName: 'query-test-results'
    condition: always()
```

### Pipeline 2: Comprehensive (Scheduled / Merge to Main)

Runs nightly and on merges to main. Targets a self-hosted agent for more powerful hardware when comprehensive tests require it.

- **Scope**: Full query suite including all tiers, all providers, multi-run flakiness detection
- **Mode**: Mock (prompt/tool-calling quality only — full search flow is covered by Pipelines 3 & 4)
- **Providers**: All (Gemini, OpenAI, OpenRouter)
- **Runs**: 3 (flakiness detection)
- **Trigger**: Nightly schedule + merge to main
- **Agent**: Self-hosted pool (labelled for higher-spec hardware)

```yaml
# azure-pipelines-comprehensive-tests.yml (indicative structure)
trigger:
  branches:
    include: ['main']

schedules:
  - cron: '0 2 * * *'
    displayName: 'Nightly comprehensive run'
    branches:
      include: ['main']

pool:
  name: 'HighSpec'  # Self-hosted agent pool

steps:
  - task: UseDotNet@2
    inputs:
      version: '8.x'

  - script: |
      cd tools/Bench
      dotnet run -- \
        --provider all \
        --tier 0 \
        --runs 3 \
        --output $(Build.ArtifactStagingDirectory)/results-comprehensive.json \
        --output-junit $(Build.ArtifactStagingDirectory)/results-comprehensive.xml \
        --compare baseline-single-gemini-v2.json
    displayName: 'Run comprehensive query tests'
    env:
      GOOGLE_API_KEY: $(GoogleApiKey)
      OPENAI_API_KEY: $(OpenAiApiKey)
      OPENROUTER_API_KEY: $(OpenRouterApiKey)

  - task: PublishTestResults@2
    inputs:
      testResultsFormat: 'JUnit'
      testResultsFiles: '$(Build.ArtifactStagingDirectory)/results-comprehensive.xml'
      testRunTitle: 'Comprehensive Query Tests'
    condition: always()

  - task: PublishBuildArtifacts@1
    inputs:
      pathToPublish: '$(Build.ArtifactStagingDirectory)/results-comprehensive.json'
      artifactName: 'comprehensive-test-results'
    condition: always()
```

### Pipeline 3: E2E Core (PR Gate)

Runs on every pull request targeting main. Exercises the **full search flow** end-to-end — from HTTP request through categorisation, agent orchestration, search execution against real databases, and response generation. This catches integration regressions **before** they land on main: search tool bugs, top-k filtering issues, entity resolution failures, context chunk retrieval problems, and breakages between components.

Pipeline 3 runs a critical subset of the E2E scenarios to keep PR feedback fast. The full E2E suite runs in Pipeline 4 after merge.

- **Scope**: ~10 critical E2E scenarios — one per query category (single-topic, collection, sequential, direct) plus entity resolution, citation correctness, and a relative-time query
- **Mode**: Real backend with seeded test data (Neo4j + Postgres)
- **LLM**: Real LLM calls (primary provider only)
- **Trigger**: Pull request targeting main
- **Agent**: Self-hosted pool (with Docker for database containers)
- **Expected duration**: 5-10 minutes (including infrastructure setup)

```yaml
# azure-pipelines-e2e-pr.yml (indicative structure)
trigger: none

pr:
  branches:
    include: ['main']

pool:
  name: 'HighSpec'  # Self-hosted agent pool (Docker required)

steps:
  - task: UseDotNet@2
    inputs:
      version: '8.x'

  - script: docker compose -f docker-compose.e2e.yml up -d --wait
    displayName: 'Start Neo4j + Postgres containers'

  - script: |
      dotnet test tests/E2E/E2E.csproj \
        --configuration Release \
        --filter "Category=Core" \
        --logger "trx;LogFileName=e2e-pr-results.trx" \
        --results-directory $(Build.ArtifactStagingDirectory)
    displayName: 'Run core E2E tests'
    env:
      E2E_NEO4J_URI: bolt://localhost:7687
      E2E_NEO4J_USER: neo4j
      E2E_NEO4J_PASSWORD: testpassword
      E2E_POSTGRES_CONNECTION: "Host=localhost;Port=5433;Database=launchai_test;Username=launchai;Password=launchai"
      GOOGLE_API_KEY: $(GoogleApiKey)
      ANTHROPIC_API_KEY: $(AnthropicApiKey)

  - task: PublishTestResults@2
    inputs:
      testResultsFormat: 'VSTest'
      testResultsFiles: '$(Build.ArtifactStagingDirectory)/e2e-pr-results.trx'
      testRunTitle: 'E2E Core Tests (PR)'
    condition: always()

  - script: docker compose -f docker-compose.e2e.yml down -v
    displayName: 'Tear down containers'
    condition: always()
```

#### Selecting the core E2E subset

Tests in the `Core` category are tagged with `[Trait("Category", "Core")]`. The core subset should cover each major integration seam with minimal redundancy:

| Scenario | Why it's in the core set |
|---|---|
| Single-topic: known email lookup | Exercises categorizer → SingleTopicPathRunner → vector search → response |
| Collection: multi-source summary | Exercises categorizer → CollectionPathRunner → multi-tool calls → aggregation |
| Sequential: follow-up query | Exercises categorizer → SequentialPathRunner → context carry-over |
| Direct: greeting / non-search | Exercises categorizer → direct path (no search) |
| Entity resolution: ambiguous name | Exercises graph entity matching — a common source of regressions |
| Citation correctness: cited source exists | Exercises citation mapping back to source chunks |
| Relative time: "last week" query | Exercises date interpretation + time-range filtering (via fixed clock) |

The remaining ~10 scenarios (edge cases, additional data types, cross-reference queries) run only in Pipeline 4.

### Pipeline 4: E2E Full (Merge to Main)

Runs on merges to main. Exercises the **full E2E scenario suite** including edge cases, all data types, cross-document references, and multi-turn sequential chains. This is the comprehensive counterpart to Pipeline 3's critical subset.

- **Scope**: ~20 targeted E2E scenarios covering each query category and search path
- **Mode**: Real backend with seeded test data (Neo4j + Postgres)
- **LLM**: Real LLM calls (primary provider only)
- **Trigger**: Merge to main
- **Agent**: Self-hosted pool (with Docker for database containers)
- **Expected duration**: 10-20 minutes (including infrastructure setup)

#### What Pipelines 3 & 4 test that Pipelines 1 & 2 do not

| Component | Pipelines 1 & 2 | Pipelines 3 & 4 |
|---|---|---|
| LLM tool-calling quality | Tested (core focus) | Indirectly tested |
| QueryCategorizer → path runner routing | Not tested (Bench drives the LLM directly) | Tested |
| SearchToolExecutor + Neo4j vector search | Mocked | Tested against seeded data |
| Top-k filtering and ranking | Mocked | Tested |
| Entity resolution against graph | Mocked | Tested |
| AgentLoopRunner orchestration | Not tested | Tested |
| PromptOrchestrator response generation | Not tested | Tested |
| Citation mapping to source chunks | Not tested | Tested |
| Chat session persistence (Postgres) | Not tested | Tested |
| Full HTTP request/response contract | Not tested | Tested |
| Relative time query interpretation | Not tested (mock results ignore dates) | Tested via fixed clock |

#### Test project: `tests/E2E`

The E2E tests live in the existing `tests/E2E` project (currently a stub). They use xUnit and `WebApplicationFactory<Program>` to host the full application stack (LocalApi + AgentHost) in-process, with Docker containers for Neo4j and Postgres.

**Test structure:**

```
tests/E2E/
├── E2E.csproj
├── Infrastructure/
│   ├── E2EFixture.cs            # Shared fixture: starts containers, ingests seed data, creates HttpClient
│   ├── TestContainerSetup.cs    # Docker container lifecycle (Neo4j + Postgres)
│   └── SeedData.cs              # Feeds seed documents through the ingestion pipeline
├── SeedData/
│   ├── seed-documents.json      # ~50-100 seed documents (emails, messages, files, events)
│   └── seed-entities.json       # Known entities and relationships for the graph
├── Tests/
│   ├── SingleTopicSearchTests.cs
│   ├── CollectionSearchTests.cs
│   ├── SequentialSearchTests.cs
│   ├── DirectQueryTests.cs
│   ├── EntityResolutionTests.cs
│   └── CitationTests.cs
└── Assertions/
    └── ChatResponseAssertions.cs  # Helpers: AssertAnswerContains, AssertCitesSource, etc.
```

**Key design decisions:**

1. **Full-stack in-process hosting via `WebApplicationFactory`** — the fixture hosts both LocalApi and AgentHost in-process. AgentHost runs the real ingestion pipeline (normalise → chunk → embed via ONNX → store in Neo4j) against the seed documents during setup. This means E2E tests exercise the full stack — including ingestion, embedding generation, and vector index creation — not just the search path. All service overrides (including the fixed clock — see below) are scoped to the test process and cannot affect any other running instance.

2. **Testcontainers for .NET** — uses the [Testcontainers](https://dotnet.testcontainers.org/) library to spin up Neo4j and Postgres Docker containers per test run. Containers are started once in the shared fixture and torn down after all tests complete.

3. **Seeded, deterministic dataset** — a small but representative dataset (~50-100 documents) covering emails, Slack messages, calendar events, and files. Seed documents are fed through the real `IngestionPipeline` so that chunks, embeddings, and entity relationships are created exactly as they would be in production. Each document has known content so assertions can be precise (e.g., "a query for 'Q3 budget review' should return the seeded finance email and cite it").

4. **Ingestion readiness gate** — the fixture must wait for ingestion to complete before handing off to test execution. After feeding seed documents through the pipeline, the fixture polls Neo4j for the expected chunk count (derived from the seed dataset) and only proceeds once all chunks have been indexed with embeddings. This prevents flaky test failures caused by queries running before ingestion finishes.

5. **Fixed clock for time-sensitive queries** — many real queries use relative time references ("last week", "yesterday", "this morning"). Rather than skipping these or dynamically regenerating seed data, the test fixture overrides .NET 8's `TimeProvider` to fix "now" to a known date. Seed documents have fixed dates anchored around this clock, so relative references resolve deterministically. See [Fixed clock for time-sensitive queries](#fixed-clock-for-time-sensitive-queries) below for details.

6. **Assertions on response quality, not exact text** — tests assert on structural properties of `ChatResponse`:
   - `Answer` contains expected key facts or entity names
   - `Citations` reference expected source documents
   - Response does not hallucinate entities absent from the seed data
   - Multi-turn sequential queries build on prior context correctly

7. **Real LLM calls** — the response LLM is called for real (not mocked). This is necessary because the test is verifying the full pipeline produces a correct answer, not just that the right tools were called. To manage flakiness from LLM non-determinism, assertions check for factual presence ("answer mentions X") rather than exact string matching.

#### Example tests

```csharp
[Collection("E2E")]
public class SingleTopicSearchTests(E2EFixture fixture) : IClassFixture<E2EFixture>
{
    [Fact]
    [Trait("Category", "Core")]  // Runs in Pipeline 3 (PR) and Pipeline 4 (merge)
    public async Task Search_ForKnownEmail_ReturnsRelevantAnswerWithCitation()
    {
        // The seed data contains an email from alice@example.com
        // about "Q3 budget review" sent on 2026-01-15
        var response = await fixture.Client.PostAsJsonAsync("/chat", new
        {
            Query = "What did Alice say about the Q3 budget?",
            IncludeAnswerLog = true
        });

        response.EnsureSuccessStatusCode();
        var chat = await response.Content.ReadFromJsonAsync<ChatResponse>();

        chat.AssertAnswerContains("budget", "Q3");
        chat.AssertCitesSourceContaining("Q3 budget review");
        chat.AssertNoCitationFrom("unknown-source");
    }

    [Fact]
    [Trait("Category", "Core")]  // Runs in Pipeline 3 (PR) and Pipeline 4 (merge)
    public async Task Search_WithRelativeTimeReference_FindsSeededDocument()
    {
        // Clock is fixed to 2026-01-22. Seed data has Mariana's status
        // update email dated 2026-01-15 (i.e., "last week").
        var response = await fixture.Client.PostAsJsonAsync("/chat", new
        {
            Query = "What did Mariana say about the deployment in her status update last week?",
            IncludeAnswerLog = true
        });

        response.EnsureSuccessStatusCode();
        var chat = await response.Content.ReadFromJsonAsync<ChatResponse>();

        chat.AssertAnswerContains("deployment", "Mariana");
        chat.AssertCitesSourceContaining("status update");
    }

    [Fact]
    // No "Core" trait — runs only in Pipeline 4 (merge to main)
    public async Task Search_ForSlackMessage_ReturnsChannelContext()
    {
        // ...
    }
}
```

#### Seed data design

The seed dataset is small enough to load in seconds but covers the key axes:

| Axis | Coverage |
|---|---|
| Data types | Email, Slack message, calendar event, Google Doc, PDF |
| Sources | Gmail, Slack (2 channels), Google Drive, Google Calendar |
| Entities | ~10 people with known relationships (team, manager, collaborator) |
| Time range | Anchored around the fixed clock date (see below) to support relative-time queries |
| Topics | ~5 distinct topics (budget, deployment, hiring, standup, incident) |
| Relationships | Cross-references between documents (e.g., email references a Slack thread) |

Each seed document has a unique identifier and known content, making assertions deterministic even though the LLM's phrasing varies.

#### Fixed clock for time-sensitive queries

Many real-world queries use relative time references ("last week", "yesterday", "this morning"). Skipping these would leave a significant blind spot — date interpretation, date-range filtering, and time-based search ranking would all go untested.

**Solution:** Fix the application clock to a known date during E2E tests using .NET 8's built-in `TimeProvider` abstraction.

**How it works:**

1. **Production code** registers `TimeProvider.System` (the real clock) in DI and uses `TimeProvider.GetUtcNow()` instead of `DateTime.UtcNow` / `DateTimeOffset.UtcNow` directly. In production, behaviour is identical — `TimeProvider.System` returns the real time.

2. **The E2E fixture** overrides `TimeProvider` with a fixed value via `WebApplicationFactory.ConfigureServices`. This override is scoped entirely to the in-process test host — it cannot affect any other running instance of the application, locally or elsewhere.

3. **Seed data** has fixed dates anchored around the test clock date, so relative time references in queries resolve to the expected documents.

**Fixture implementation:**

```csharp
public class E2EFixture : WebApplicationFactory<Program>, IAsyncLifetime
{
    // All seed data dates are anchored around this fixed "now"
    public static readonly DateTimeOffset FixedNow =
        new(2026, 1, 22, 9, 0, 0, TimeSpan.Zero);

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.ConfigureServices(services =>
        {
            // Override clock — scoped to this test host only
            services.RemoveAll<TimeProvider>();
            services.AddSingleton<TimeProvider>(
                new FakeTimeProvider(FixedNow));

            // Override connection strings for test containers
            // ...
        });
    }

    public async Task InitializeAsync()
    {
        // 1. Start Neo4j + Postgres containers
        // 2. Feed seed documents through IngestionPipeline
        // 3. Wait for ingestion readiness (poll for expected chunk count)
    }

    public async Task DisposeAsync()
    {
        // Tear down containers
    }
}
```

**Production-side change required:**

Register `TimeProvider` in `Program.cs` and replace direct `DateTime.UtcNow` / `DateTimeOffset.UtcNow` calls with `TimeProvider.GetUtcNow()`. The key call sites are:

- System prompt construction (where "today is X" is injected for the LLM)
- Any server-side date filtering or date-range calculation in search

This is a small, mechanical refactor. `TimeProvider.System.GetUtcNow()` returns the same value as `DateTimeOffset.UtcNow` — there is no behaviour change in production.

**Seed document dates anchored to the fixed clock (2026-01-22):**

| Relative reference | Resolved date range | Example seed document |
|---|---|---|
| "yesterday" | Jan 21 | Slack message from Carlos about incident |
| "last week" | Jan 13–19 | Mariana's status update email (Jan 15) |
| "this week" | Jan 19–22 | Standup notes in Google Doc (Jan 20) |
| "this morning" | Jan 22 AM | Calendar event at 08:00 |
| "last month" | Dec 2025 | Hiring review PDF (Dec 18) |
| "two weeks ago" | Jan 5–11 | Budget Slack thread (Jan 8) |

**Isolation guarantee:** `WebApplicationFactory` creates an isolated in-process host with its own DI container. The `TimeProvider` override exists only within this container. It does not modify any global state, environment variable, or shared resource. Other instances of the application — running locally, on a dev machine, or deployed — are completely unaffected.

#### Docker Compose for CI

A `docker-compose.e2e.yml` file in the repo root provides the test infrastructure. Testcontainers can use this, or the pipeline can start containers directly.

```yaml
# docker-compose.e2e.yml
services:
  neo4j:
    image: neo4j:5-community
    environment:
      NEO4J_AUTH: neo4j/testpassword
      NEO4J_PLUGINS: '[]'
    ports:
      - "7687:7687"
      - "7474:7474"
    healthcheck:
      test: ["CMD", "cypher-shell", "-u", "neo4j", "-p", "testpassword", "RETURN 1"]
      interval: 5s
      retries: 10

  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: launchai_test
      POSTGRES_USER: launchai
      POSTGRES_PASSWORD: launchai
    ports:
      - "5433:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U launchai -d launchai_test"]
      interval: 5s
      retries: 10
```

Note: Postgres uses port **5433** on the host to avoid conflicts with any local Postgres instance on 5432.

#### Running E2E tests locally

Developers can run the same E2E tests locally before pushing. Prerequisites:

- **Docker** — for Neo4j and Postgres containers
- **ONNX embedding model** — `~/.launchai/models/embeddings.onnx` (the same model used for local development)
- **LLM API keys** — `GOOGLE_API_KEY` and `ANTHROPIC_API_KEY` set in the environment

**Quick run (Core subset only — same as Pipeline 3):**

```bash
# Start test containers
docker compose -f docker-compose.e2e.yml up -d --wait

# Run core E2E tests
dotnet test tests/E2E/E2E.csproj --filter "Category=Core"

# Tear down
docker compose -f docker-compose.e2e.yml down -v
```

**Full run (all E2E tests — same as Pipeline 4):**

```bash
docker compose -f docker-compose.e2e.yml up -d --wait
dotnet test tests/E2E/E2E.csproj
docker compose -f docker-compose.e2e.yml down -v
```

A helper script (`scripts/run-e2e.sh`) wraps these steps and handles container teardown on failure:

```bash
#!/usr/bin/env bash
set -euo pipefail

FILTER="${1:---filter Category=Core}"

docker compose -f docker-compose.e2e.yml up -d --wait
trap 'docker compose -f docker-compose.e2e.yml down -v' EXIT

dotnet test tests/E2E/E2E.csproj $FILTER
```

Usage:

```bash
./scripts/run-e2e.sh                          # Core subset (default)
./scripts/run-e2e.sh ""                        # All E2E tests
./scripts/run-e2e.sh "--filter Category=Core"  # Explicit filter
```

#### Pipeline 4 YAML

```yaml
# azure-pipelines-e2e-full.yml (indicative structure)
trigger:
  branches:
    include: ['main']

pool:
  name: 'HighSpec'  # Self-hosted agent pool (Docker required)

steps:
  - task: UseDotNet@2
    inputs:
      version: '8.x'

  - script: docker compose -f docker-compose.e2e.yml up -d --wait
    displayName: 'Start Neo4j + Postgres containers'

  - script: |
      dotnet test tests/E2E/E2E.csproj \
        --configuration Release \
        --logger "trx;LogFileName=e2e-results.trx" \
        --results-directory $(Build.ArtifactStagingDirectory)
    displayName: 'Run full E2E integration tests'
    env:
      E2E_NEO4J_URI: bolt://localhost:7687
      E2E_NEO4J_USER: neo4j
      E2E_NEO4J_PASSWORD: testpassword
      E2E_POSTGRES_CONNECTION: "Host=localhost;Port=5433;Database=launchai_test;Username=launchai;Password=launchai"
      GOOGLE_API_KEY: $(GoogleApiKey)
      ANTHROPIC_API_KEY: $(AnthropicApiKey)

  - task: PublishTestResults@2
    inputs:
      testResultsFormat: 'VSTest'
      testResultsFiles: '$(Build.ArtifactStagingDirectory)/e2e-results.trx'
      testRunTitle: 'E2E Full Integration Tests'
    condition: always()

  - script: docker compose -f docker-compose.e2e.yml down -v
    displayName: 'Tear down containers'
    condition: always()
```

#### Managing LLM non-determinism

E2E tests make real LLM calls, which introduces non-determinism. Strategies to keep tests reliable:

1. **Assert on facts, not phrasing** — check that the answer contains key terms or entity names, not exact sentences
2. **Assert on citations structurally** — verify the right source documents are cited, not the exact citation text
3. **Use temperature 0** — configure the test LLM client with temperature 0 to reduce variation
4. **Allow soft retries for flaky assertions** — if a test fails on content assertion, retry once before marking as failed. This handles cases where the LLM gives a correct but differently-structured answer
5. **Flag flaky tests explicitly** — if a test fails intermittently across multiple runs, mark it with `[Trait("Flaky", "true")]` and track in the threshold config rather than deleting the test

#### Latency regression detection

None of the Bench pipelines (1 & 2) can catch performance regressions — a bad Cypher query, a missing index, or an accidentally serialised parallel path could make search 10x slower while still producing correct results. The E2E tests are the natural place to catch this since they hit the real stack.

**Per-test timeouts:** Every E2E test should have a timeout that catches gross regressions. Core tests (Pipeline 3) use a tighter budget since they gate merges:

```csharp
[Fact]
[Trait("Category", "Core")]
[Timeout(15_000)]  // 15s — fail fast on performance regressions
public async Task Search_ForKnownEmail_ReturnsRelevantAnswerWithCitation()
{
    // ...
}
```

**Response time tracking:** The `E2EFixture` should log the wall-clock time for each `/chat` request. The pipeline publishes these as a build artifact (`e2e-latency.json`) so that response times can be trended over time. This doesn't gate merges initially, but provides visibility into gradual performance drift.

```json
{
  "tests": [
    { "name": "Search_ForKnownEmail_ReturnsRelevantAnswerWithCitation", "latencyMs": 2340 },
    { "name": "Search_WithRelativeTimeReference_FindsSeededDocument", "latencyMs": 3120 }
  ],
  "meanLatencyMs": 2730,
  "p95LatencyMs": 4100
}
```

**Future enhancement:** Once enough data has been collected to establish a stable baseline, add a `--max-p95-latency` threshold to fail the pipeline if the 95th percentile response time exceeds a configured limit (e.g., 10 seconds).

## Query Set for Pipeline 1

**Problem**: The tool currently has 263 preset queries. Running all of them at tier 2 (multi-turn) with a single provider takes an estimated 30-60 minutes — too slow for per-commit feedback.

**No existing "core" subset exists.** We need to define one. Options:

1. **Curated core suite** (recommended): Define a `--suite core` flag that selects ~20-30 representative queries spanning each interaction pattern (single-topic, collection, sequential, direct). This keeps per-commit runs under 10 minutes while still covering all code paths.
2. **Tier 1 only**: Run all 263 queries but only at tier 1 (single-turn smoke test), which is much faster than tier 2 multi-turn. Less thorough but broader coverage.
3. **Category filtering**: Use `--category` to run a subset (e.g., `--category action,seq,coll,calendar`), though this is ad-hoc and may miss important patterns.

**Recommendation**: Option 1 — add a `--suite` flag with a curated `core` query list. The full 263-query suite runs in Pipeline 2 (comprehensive).

## Changes Required to Bench

### 1. Exit Codes (verify / add)

The pipeline needs a non-zero exit code when tests fail so Azure Pipelines marks the step as failed. Verify that `Program.cs` returns non-zero on FAILs. If not, add:

- Exit code `0`: All tests PASS or WARN (within threshold)
- Exit code `1`: Failures exceed configured threshold
- Exit code `2`: Regressions detected (when using `--compare`)

### 2. JUnit XML Output (add)

Azure Pipelines' `PublishTestResults` task renders test reports in the pipeline UI. It expects JUnit XML format. Add a `--output-format junit` flag (or a separate `--output-junit <path>` flag) that writes results as JUnit XML.

Example output:

```xml
<testsuites>
  <testsuite name="gemini-tier2" tests="145" failures="0" warnings="2">
    <testcase name="action-items / Tool Coverage" classname="single-topic">
      <system-out>Searched for action items across sources</system-out>
    </testcase>
    <testcase name="daily-digest / Search Diversity" classname="single-topic">
      <failure message="Redundant searches detected">
        Turn 2 repeated same query as Turn 1
      </failure>
    </testcase>
  </testsuite>
</testsuites>
```

### 3. Core Query Suite (add)

Add a `--suite` flag that selects a named subset of queries:

- `--suite core`: ~20-30 curated queries covering each interaction pattern. Used by Pipeline 1.
- `--suite all` (default): All 263 preset queries. Used by Pipeline 2.

The core suite should be defined as a list in the tool, easy to update as queries are added or retired.

### 4. Configurable Failure Thresholds (add)

Add a `--fail-threshold <path>` flag that loads a JSON config defining acceptable failure targets. This allows the pipeline to pass even when known limitations produce expected failures.

```json
{
  "maxFailures": 0,
  "maxWarnings": 5,
  "allowedFailures": [
    {
      "queryLabel": "seq-mike-deployment-followup",
      "criterion": "Search Diversity",
      "reason": "Known Flash-Lite limitation, tracked in backlog"
    }
  ]
}
```

**Behaviour**:
- Failures matching an entry in `allowedFailures` are excluded from the failure count
- The pipeline fails (non-zero exit) only if remaining failures exceed `maxFailures` or warnings exceed `maxWarnings`
- The threshold file is committed to the repo and reviewed like code — adding an allowed failure requires a reason

### 5. Summary Line (add)

Write a concise summary line to stdout at the end of each run for easy pipeline log scanning:

```
SUMMARY: 143 PASS, 2 WARN, 0 FAIL (0 above threshold) | 0 regressions | mean latency 1250ms
```

## Runtime Dependencies and Costs

### What "mock mode" actually means

Mock mode (`--live` flag omitted) only mocks the **search results** fed back to the LLM. The tool still makes **real HTTP calls to LLM provider APIs** (Gemini, OpenAI, OpenRouter) on every query and every turn. This is by design — the purpose is to test how the model handles tool-calling, not the search backend.

### CI agent requirements

| Dependency | Required? | Notes |
|---|---|---|
| .NET 8.0 runtime | Yes | No additional NuGet packages needed |
| LLM API keys | Yes | Validated at startup; tool exits with code 1 if missing for any enabled provider |
| Outbound HTTPS to LLM APIs | Yes | `generativelanguage.googleapis.com`, `api.openai.com`, `openrouter.ai` |
| Live backend (`localhost:5198`) | No | Only needed with `--live` flag |
| Prompt files from `src/Api/LocalApi/prompts/` | No | Falls back to embedded prompts if not found |
| Docker | Pipelines 3 & 4 | Required for Neo4j and Postgres test containers |
| ONNX embedding model | Pipelines 3 & 4 | `bge-small-en-v1.5` model file (`~/.launchai/models/embeddings.onnx`). Must be pre-installed on the self-hosted agent or downloaded during pipeline setup |

Microsoft-hosted Azure agents have outbound HTTPS by default. Self-hosted agents behind a corporate firewall will need the LLM API endpoints allowed.

### API cost per run

Every pipeline run incurs real LLM API costs. Rough estimates:

| Scenario | Queries | Turns (approx) | Providers | Runs | Est. API calls |
|---|---|---|---|---|---|
| Pipeline 1 (per-commit) | ~25 core | ~25 (tier 1, single-turn) | 1 (Gemini) | 1 | ~25 |
| Pipeline 2 (comprehensive) | 263 | ~800 (tier 0, multi-turn) | 3 | 3 | ~7,200 |
| Pipeline 3 (E2E core, PR) | ~10 scenarios | ~10-30 (multi-turn) | 1 (primary) | 1 | ~30 |
| Pipeline 4 (E2E full, merge) | ~20 scenarios | ~20-60 (multi-turn) | 1 (primary) | 1 | ~60 |

**Daily volume note:** On a busy day with ~10 pushes, Pipeline 1 generates ~250 LLM calls — negligible at Flash-Lite pricing. Pipeline 3 adds ~30 calls per PR update, also negligible. If the core suite size or provider is changed later, revisit this estimate.

**Mitigation strategies:**
- Pipeline 1 uses a small core suite with a single provider to keep per-commit costs low
- Pipeline 2 runs only nightly or on merge to main, not on every push
- Pipeline 3 uses a small E2E subset (~10 scenarios) to keep PR feedback fast and costs low
- Use the cheapest viable model (e.g., Flash-Lite) for regression detection — the test is whether behaviour changed, not whether the model is best-in-class
- Monitor API usage dashboards and set billing alerts on each provider
- Consider provider rate limits — Pipeline 2's ~7,200 calls may need request throttling or sequential provider execution to avoid hitting limits

## Notifications

Pipelines 1, 2, and 4 are **advisory, not merge-gating** — failures send notifications but do not block merges. Pipeline 3 (E2E Core on PR) is intended as a **required check** on pull requests targeting main. This ensures that integration regressions in the search flow are caught before merge, while prompt-only regressions (Pipelines 1 & 2) remain advisory to avoid blocking on LLM non-determinism.

Handled entirely by Azure Pipelines (no email logic needed in the tool):

- **Email**: Configure pipeline notification subscriptions in Azure DevOps project settings. Notify on build failure or specific conditions.
- **Teams**: Use the built-in Teams notification integration or a webhook task.
- **Custom reports**: A pipeline task can parse `results.json` and format a richer message body if the default notifications are too terse.

## API Key Management

Store API keys as pipeline secret variables or in Azure Key Vault linked to the pipeline:

| Variable | Source |
|---|---|
| `GoogleApiKey` | Azure Key Vault or pipeline secret variable |
| `OpenAiApiKey` | Azure Key Vault or pipeline secret variable |
| `OpenRouterApiKey` | Azure Key Vault or pipeline secret variable |
| `AnthropicApiKey` | Azure Key Vault or pipeline secret variable |

These are mapped to environment variables (`GOOGLE_API_KEY`, `ANTHROPIC_API_KEY`, etc.) in the pipeline step. Pipelines 3 and 4 require the API key for whichever provider is configured as the primary response LLM (currently Anthropic for Claude Sonnet) and the search agent LLM (currently Google for Flash-Lite).

## Baseline Management

The `--compare` flag compares results against a **curated baseline JSON file committed to the repo** — not against the previous commit's results. This is an important distinction:

- **Baselines are deliberate snapshots** of known-good results, stored at `tools/Bench/baseline-*.json`
- A "regression" means the current run is worse than this curated baseline, not worse than the last commit
- Baselines are updated explicitly when a change intentionally shifts results (e.g., new prompt tuning improves scores). The updated baseline is committed alongside the code change
- This means a regression introduced in commit A will continue to be flagged in commits B, C, etc. until either fixed or the baseline is updated to reflect the new expected state

## Future: Self-Hosted Agent for Comprehensive + E2E Tests

Pipelines 2, 3, and 4 all target a self-hosted agent pool. Pipeline 3 runs on every PR, so the agent pool must have enough capacity to handle concurrent PR builds without queuing. When setting up:

1. **Provision a VM** (Azure VM or on-prem machine) with .NET 8 runtime
2. **Install Docker** — required for Pipelines 3 and 4's Neo4j and Postgres containers
3. **Install the ONNX embedding model** — `bge-small-en-v1.5` at `~/.launchai/models/embeddings.onnx` (required for Pipelines 3 and 4's ingestion step)
4. **Install the Azure Pipelines agent** and register it in a named pool (e.g., `HighSpec`)
5. **Target the pool** in the comprehensive and E2E pipeline `pool:` sections
5. **Scale set agents** (Azure VM Scale Sets) can auto-provision and tear down on demand if cost is a concern

This allows lightweight tests to run on free/cheap hosted agents while comprehensive and E2E suites run on hardware sized for the workload.

## Implementation Priority

### Phase 1: Per-Commit Pipeline (Bench)

1. **Define core query suite** — curate ~20-30 representative queries, add `--suite` flag
2. **Verify/add exit codes** in Bench `Program.cs`
3. **Add JUnit XML output** (`--output-junit`) to Bench
4. **Add configurable failure thresholds** (`--fail-threshold`) to Bench
5. **Add summary line** to console output
6. **Write the per-commit pipeline YAML** and configure in Azure DevOps
7. **Configure notifications** in Azure DevOps project settings

### Phase 2: Self-Hosted Agent + Comprehensive Pipeline

8. **Set up self-hosted agent** with .NET 8 + Docker
9. **Write the comprehensive pipeline YAML** targeting self-hosted pool

### Phase 3: E2E Integration Tests + PR Gate

10. **Add `TimeProvider` to production code** — register `TimeProvider.System` in `Program.cs`, replace `DateTime.UtcNow` / `DateTimeOffset.UtcNow` call sites with `TimeProvider.GetUtcNow()` (system prompt construction, date filtering logic)
11. **Create `docker-compose.e2e.yml`** for Neo4j + Postgres test containers
12. **Ensure ONNX model is available on CI** — pre-install `bge-small-en-v1.5` on the self-hosted agent or add a pipeline step to download it
13. **Design and create seed dataset** — ~50-100 documents with dates anchored around the fixed clock (2026-01-22), covering all data types, sources, entities, and topics
14. **Build E2E test infrastructure** in `tests/E2E/` — `E2EFixture` hosting full stack (LocalApi + AgentHost) with `FakeTimeProvider` override, container setup, ingestion of seed data through the real `IngestionPipeline`, and readiness gate polling for expected chunk count before test execution
15. **Write core E2E test scenarios** — ~10 tests tagged `[Trait("Category", "Core")]` covering one scenario per query category plus entity resolution, citation correctness, and relative-time queries. These form the Pipeline 3 (PR gate) subset. Each core test should include a `[Timeout(15_000)]` to catch gross latency regressions
16. **Write remaining E2E test scenarios** — ~10 additional tests for edge cases, additional data types, cross-document references, and multi-turn sequential chains. These run only in Pipeline 4 (merge to main)
17. **Write custom assertions** — `ChatResponseAssertions` for fact-presence and citation checks
18. **Add latency tracking** — log per-test response times in `E2EFixture`, publish `e2e-latency.json` as a pipeline artifact for trend visibility
19. **Create `scripts/run-e2e.sh`** helper script for local development
20. **Write the Pipeline 3 (PR) YAML** (`azure-pipelines-e2e-pr.yml`) — configure as a required check on PRs targeting main in Azure DevOps
21. **Write the Pipeline 4 (merge) YAML** (`azure-pipelines-e2e-full.yml`) — runs the full suite on merge to main
22. **Tune flakiness handling** — identify any tests that need soft retries or flaky-tagging based on initial runs. Core tests (Pipeline 3) must be highly stable since they gate merges — move flaky tests out of the `Core` category if they cannot be stabilised
