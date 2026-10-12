# SidForge AI

See the complete node definitions and usage guide in [docs/NODES.md](docs/NODES.md). Every node also includes the same contextual guidance in the Node-RED Help sidebar.

**SidForge AI** is a free and open-source, production-minded RAG palette for [Node-RED](https://nodered.org/). It provides configurable nodes for turning documents into evidence-backed answers without locking an integrator to a commercial AI or vector-database vendor.

[![CI](https://github.com/sidisl16/sidforge-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/sidisl16/sidforge-ai/actions/workflows/ci.yml) [![Coverage](https://img.shields.io/badge/coverage-enforced%2080%25-brightgreen)](https://github.com/sidisl16/sidforge-ai/actions/workflows/ci.yml) [![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

> Repository: `https://github.com/sidisl16/sidforge-ai` · Package name: `node-red-contrib-sidforge-ai`

## Design goals

- **Local-first:** operate Ollama from a flow, route Hugging Face models through local vLLM/TGI/LocalAI/llama.cpp servers, and use a built-in memory vector store without a network dependency.
- **Production-oriented:** bounded requests, timeouts, error output, trace metadata, deterministic defaults, and policy/grounding gates.
- **Integrator-friendly:** each node has a small basic form, JSON-based advanced fields, and `msg.rag.*` contracts that work across all nodes.
- **Free software:** Apache-2.0 licensed. The package contains no mandatory account, telemetry, license key, or paid API dependency.

SidForge does not claim that a heuristic can eliminate hallucinations. Its defaults encourage evidence gates, citations, low-temperature generation, claim grounding checks, and abstention/review paths. High-risk deployments should add an independent LLM/NLI evaluator and human approval process.

## Install

```bash
npm install node-red-contrib-sidforge-ai
```

Restart Node-RED, then find the **SidForge AI** category in the palette. For local development:

```bash
git clone https://github.com/sidisl16/sidforge-ai.git
cd sidforge-ai
npm ci
npm run verify
```

## Node groups

### Ingestion and preparation

| Node | Role |
|---|---|
| `Source` | Loads HTTP records and maps request data, content, source, and metadata into documents. |
| `Normalize Document` | Cleans text with HTML, case, paragraph, and length controls. |
| `Chunk Document` | Creates traceable chunks using semantic, paragraph, or fixed-window policies. |

Use `Source` for any free or self-hosted integration exposed over HTTP: filesystem gateways, S3-compatible stores, Gitea/GitLab, MediaWiki, OpenProject, Nextcloud, Apache Kafka REST Proxy, databases behind an API, and custom internal services. Native provider-specific connectors can be added as separate optional packages without bloating this base package.

### Indexing and retrieval

| Node | Role |
|---|---|
| `Embed Chunks` | Calls an embedding endpoint with model, dimension, batch, and provider options. |
| `Vector Upsert` | Writes to a collection/namespace using generic or Qdrant payloads. |
| `Retrieve Evidence` | Performs semantic, keyword, or hybrid tenant-aware retrieval. |
| `Evidence Gate` | Applies relevance, maximum-evidence, and document-diversity policies. |

Select **Built-in memory** in a Vector Store configuration node for a self-contained development or test flow. It indexes vectors in the Node-RED runtime and provides lexical retrieval without an HTTP service. It is intentionally non-persistent; choose Qdrant, pgvector, LanceDB, or another configured store for durable production data.

### Local model runtime

| Node/configuration | Role |
|---|---|
| `Local Model Manager` | Runs `ollama pull`, `ollama list`, and `ollama show` directly from a Node-RED flow, or checks a local runtime API. |
| `Model Provider` | Selects Ollama, vLLM, TGI, LocalAI, llama.cpp, OpenAI-compatible, or custom local inference. Ollama uses built-in endpoint defaults. |
| `Embedding Provider` | Selects a local embedding runtime and model for embedding operations. |

The manager uses a safe argument-array process spawn—never a shell—to invoke the configured local CLI. `pull` is deliberately restricted to Ollama. To run Hugging Face models locally, start vLLM, Hugging Face Text Generation Inference, LocalAI, or llama.cpp on the same machine, then select that provider in the editor. This keeps the model/runtime choice inside Node-RED while avoiding bundled model binaries and paid APIs.

### Grounded generation

| Node | Role |
|---|---|
| `Grounded Prompt` | Builds a template-driven evidence prompt with sources and context budget controls. |
| `Generate Answer` | Calls chat completions with sampling, penalties, output budget, and JSON controls. |
| `Grounding Check` | Validates answer support and can require citations before it passes. |

### Governance and operations

| Node | Role |
|---|---|
| `Policy Gate` | Requires a tenant and blocks configurable unsafe patterns or oversized queries. |
| `Observe` | Adds a timestamped event and environment marker for observability adapters. |

## Standard contract

Nodes read/write a stable `msg.rag` envelope. Provider-specific payloads remain contained inside an adapter node.

```js
msg.rag = {
  tenantId: "acme",
  document: { id: "policy-v4", content: "…", source: "handbook.pdf", metadata: {} },
  chunks: [{ id: "policy-v4:0", content: "…", metadata: {} }],
  vectors: [{ id: "policy-v4:0", vector: [0.1], content: "…" }],
  retrieval: { query: "…", selected: [], confidence: 0.92 },
  answer: { text: "…", citations: [], groundedness: 0.86 }
};
```

### Configuration and runtime overrides

All nodes provide defaults in the editor. Advanced fields include timeouts, retry count, exponential-backoff delay, retryable status codes, request headers, filters, JSON options, and provider overrides. URL strings support `{{msg.path}}` interpolation, but URLs are optional when using an in-process store or a local provider default. For environment-specific configuration, put secrets in Node-RED credential/config nodes or environment variables—never hard-code secrets in a flow.

Use `msg.rag.tenantId` on every externally reachable query flow. The policy node can enforce it, but a vector/search adapter must independently apply the same tenant and ACL filters.

## Hallucination-control baseline

For public-facing production flows, retain this order:

1. Policy/identity gate and tenant lookup.
2. Retrieve with access filters and hybrid/reranked results.
3. Evidence gate; send no/weak evidence directly to an abstention response.
4. Grounded prompt and low-temperature generation.
5. Grounding/citation check; route a failed check to review or a safe fallback.

Do not treat model confidence as factual confidence. Track retrieval score, source freshness, citation coverage, grounding score, and negative user feedback separately.

## Published sample flow

Import [`examples/grounded-rag-guardrails.json`](examples/grounded-rag-guardrails.json) through **Menu → Import → Clipboard**. It runs locally without a model or paid service and demonstrates the evidence → grounded prompt → answer check → pass/review branching pattern.

Before publishing the flow at [flows.nodered.org](https://flows.nodered.org/), create the package release, then paste this description:

> **SidForge AI — Grounded RAG guardrails**: a provider-free demonstration of evidence-aware prompting and hallucination routing. Install `node-red-contrib-sidforge-ai`, import the flow, and replace the demo retrieval result with your retrieval/generation adapters.

Use the GitHub project URL `https://github.com/sidisl16/sidforge-ai` and select `node-red-contrib-sidforge-ai` as the module dependency in the flow-library entry.

## Testing and coverage

The test suite runs actual Node-RED nodes using `node-red-node-test-helper`; `test:integration` starts a local Node-RED runtime and executes the grounded-answer safety flow. No remote service or paid credentials are required.

```bash
npm test                 # unit tests
npm run test:coverage    # c8 report + enforced 80% line/function coverage, 40% branch coverage
npm run test:integration # local Node-RED integration test
npm run verify           # lint + coverage + integration test
npm run pack:check       # inspect the publishable npm tarball
```

Coverage output is written to `coverage/lcov-report/index.html`. The CI workflow uploads it as a GitHub Actions artifact.

## Release and Node-RED publication

Node-RED nodes are distributed through npm. Once this GitHub repository exists and the first GitHub release is tagged (`v0.1.0`), configure an `NPM_TOKEN` repository secret with permission to publish the scoped/unscoped package. The release workflow verifies the package and runs `npm publish --access public`; after npm indexes it, it becomes discoverable in the Node-RED palette manager and [flows.nodered.org](https://flows.nodered.org/).

The supplied workflow never publishes from a pull request. It publishes only on a published GitHub release, and npm provenance is enabled.

## Security notes

- Do not put API keys in exported flows; use Node-RED credentials/environment variables.
- Enforce document ACLs and tenant scope inside the backend search request, not solely with UI nodes.
- Redact or block PII before embedding when policy requires it.
- Treat retrieved text as untrusted input; protect against prompt injection and document source poisoning.
- Set timeouts, request budgets, rate limits, and circuit breakers in your gateway/proxy and Node-RED deployment.
- Add audit logging and human review for regulated, legal, medical, financial, or destructive actions.

## Contributing

Run `npm run verify` before opening a pull request. New nodes must include runtime validation, editor help, unit tests, local integration coverage, error-path behavior, and documentation of their `msg.rag` contract.
