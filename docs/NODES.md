# SidForge AI Node Reference

This reference accompanies the Help panel bundled with every node. It describes the message contract, expected placement, and the operational purpose of each node.

## Common message contract

Nodes place their durable state under `msg.rag`: `document`, `chunks`, `vectors`, `retrieval`, `prompt`, `answer`, and governance data. Start query flows with `msg.payload` as the question and set `msg.rag.tenantId` and `msg.rag.user.roles` before retrieval.

## Ingestion and indexing

| Node | Definition | Typical usage |
| --- | --- | --- |
| Source | Fetches HTTP records and normalizes each to `rag.document`. | Set record/content paths, then connect to Metadata Validator or Normalize Document. |
| Normalize Document | Cleans whitespace, HTML, paragraphs, and casing. | Use before Chunk Document. |
| Chunk Document | Creates traceable, overlapping chunks. | Choose semantic boundaries for prose; connect to Chunk Quality Filter or Embed Chunks. |
| Embed Chunks | Calls an embedding provider and writes `rag.vectors`. | Use a local Ollama `nomic-embed-text` provider, then connect to Vector Upsert. |
| Vector Upsert | Persists vectors to a configured store. | Use Built-in memory for demos; configure an open-source persistent store in production. |
| Metadata Validator | Routes incomplete documents to output 2. | Run immediately after a source or local document function. |
| PII Detector | Finds common email, phone, and card-like strings. | Send either branch to PII Redactor if ingestion may proceed. |
| PII Redactor | Replaces common sensitive strings at a chosen path. | Place after PII detection and before indexing. |
| Duplicate Detector | Detects content hashes already seen in local context. | Route output 2 to audit/debug rather than indexing again. |
| Document Versioner | Adds checksum and ingest timestamp metadata. | Use before chunking to preserve provenance. |
| Chunk Quality Filter | Removes chunks below a minimum length. | Run after Chunk Document; output 2 represents an empty usable set. |

## Query, retrieval, and access control

| Node | Definition | Typical usage |
| --- | --- | --- |
| Query Normalizer | Normalizes Unicode and whitespace. | Put first in a question flow. |
| Query Safety | Detects configured prompt-injection patterns. | Route output 2 to a safe policy response. |
| Policy Gate | Applies tenant, length, and blocked-pattern checks. | Run before retrieval; output 2 is denied. |
| Tenant Context | Resolves a tenant from the message or default. | Run before tenant-scoped retrieval. |
| Rate Limiter | Enforces local per-key request limits. | Use tenant ID or user ID as key; output 2 is over limit. |
| Idempotency Guard | Detects duplicate request identifiers. | Use before expensive retrieval or generation. |
| Retrieve Evidence | Searches the configured vector store. | Set namespace, top K, score threshold, and optional filters. |
| Retrieval Evaluator | Measures retrieved IDs against expected IDs. | Use in regression/evaluation flows. |
| ACL Filter | Restricts evidence to caller roles and document ACLs. | Place before Evidence Gate. |
| Result Deduplicator | Removes duplicate retrieval candidates. | Put before Evidence Packer. |
| Evidence Gate | Requires enough credible evidence to continue. | Output 2 should connect to Abstention. |
| Evidence Packer | Fits selected evidence to a context budget. | Place directly before Grounded Prompt. |

## Generation, hallucination controls, and response safety

| Node | Definition | Typical usage |
| --- | --- | --- |
| Grounded Prompt | Builds a prompt from question plus selected evidence. | Use a template containing `{{system}}`, `{{context}}`, and `{{query}}`. |
| Generate Answer | Calls a configured chat-model provider. | Prefer local Ollama, vLLM, TGI, LocalAI, or llama.cpp; keep temperature low for factual answers. |
| Claim Extractor | Splits the generated answer into sentence-like claims. | Use for audit, evaluation, or downstream checking. |
| Citation Validator | Ensures answer citations refer to selected evidence. | Route output 2 to Abstention or human review. |
| Confidence Scorer | Derives confidence from retrieval, grounding, and citations. | Use as a response annotation, not a safety substitute. |
| Grounding Check | Tests answer support against retrieved evidence and attaches citations. | Route output 2 to Abstention. |
| Abstention | Emits a configurable safe fallback answer. | Merge low-evidence, invalid-citation, and failed-grounding branches here. |
| Secret Redactor | Removes common API-key-like strings. | Place immediately before public output and logging. |
| Observe | Adds a lightweight trace event to `rag.trace`. | Add after success and fallback response paths merge. |
| Feedback Capture | Captures rating and correction data from message paths. | Connect a feedback form or endpoint; forward `rag.feedback` to your analytics system. |

## Local runtime and configuration nodes

| Node | Definition | Typical usage |
| --- | --- | --- |
| Local Model Manager | Lists, verifies, pulls, or health-checks local model runtimes. | Use Ollama CLI/API to pull a model; use Health for vLLM, TGI, LocalAI, or custom servers. |
| Model Provider | Shared chat model connection. | Configure local Ollama or an OpenAI-compatible local server; select it in Generate Answer. |
| Embedding Provider | Shared embedding model connection. | Configure `nomic-embed-text` in Ollama or an open Hugging Face embedding endpoint. |
| Vector Store | Shared vector database defaults. | Use the same configuration in Upsert and Retrieve. |
| Reranker Provider | Shared local reranking endpoint. | Configure a BGE reranker or cross-encoder when your retrieval setup uses one. |
| Cache Provider | Shared memory, Valkey, or Redis configuration. | Use in composed cache-aware flows. |
| RAG Project | Stores common tenant, language, and context conventions. | Use as a flow-level profile. |
| Policy Profile | Stores reusable grounded-response policy targets. | Use when standardizing Grounding Check settings. |

## Open-model quick start

1. Start Ollama: `ollama serve`.
2. Pull an embedding model: `ollama pull nomic-embed-text`.
3. Pull a chat model: `ollama pull llama3.2:3b`.
4. Configure the Model Provider and Embedding Provider nodes, or use the **Open Models — All Nodes RAG** local example.
5. Run ingestion before sending questions. Built-in memory data is cleared when Node-RED restarts.

For production, use persistent context storage, a persistent vector store, tenant-scoped collections/namespaces, and an operational error/alert path for all rejected outputs.
