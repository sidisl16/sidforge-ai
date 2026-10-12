'use strict';

const { ensureRag, getPath, parseJson, normaliseDocument } = require('./lib/contracts');
const { request } = require('./lib/http');

const memoryStores = new Map();

function tokenScore(query, content) { const terms = String(query).toLowerCase().match(/[a-z0-9]{3,}/g) || []; if (!terms.length) return 0; const haystack = String(content || '').toLowerCase(); return terms.filter(term => haystack.includes(term)).length / terms.length; }

function initialise(RED, requestedType) {
  function resolveProvider(config) {
    const id = config.modelProvider || config.embeddingProvider || config.vectorStore || config.rerankerProvider;
    const provider = id && RED.nodes.getNode(id);
    if (!provider) return config;
    const providerType = provider.provider || provider.runtime;
    const defaults = providerType === 'ollama' ? { chatUrl: 'http://127.0.0.1:11434/api/chat', embeddingsUrl: 'http://127.0.0.1:11434/api/embed' } : {};
    return { ...config, providerType, url: config.url || provider.url || (config.modelProvider ? defaults.chatUrl : defaults.embeddingsUrl), model: config.model || provider.model, collection: config.collection || provider.collection, namespace: config.namespace || provider.namespace, token: config.token || provider.credentials && provider.credentials.apiKey, extra: config.extra || provider.options };
  }
  function register(type, handler) {
    if (requestedType && requestedType !== type) return;
    RED.nodes.registerType(type, function (config) {
      RED.nodes.createNode(this, config);
      this.on('input', async (msg, send, done) => {
        send = send || this.send.bind(this);
        try { await handler.call(this, msg, resolveProvider(config), send); done(); }
        catch (error) { this.status({ fill: 'red', shape: 'ring', text: error.message }); this.error(error, msg); done(error); }
      });
    });
  }

  register('rag-source', async function (msg, config, send) {
    const requestBody = config.body ? parseJson(config.body) : undefined;
    const data = await request(this, config, msg, requestBody);
    const records = Array.isArray(data) ? data : (getPath(data, config.recordsPath) || [data]);
    for (const record of records) {
      const document = normaliseDocument(config.contentPath ? getPath(record, config.contentPath) : record, { source: config.source || config.url, metadata: config.metadata ? parseJson(config.metadata) : {} });
      ensureRag(msg).document = document;
      send(RED.util.cloneMessage(msg));
    }
  });

  register('rag-normalize', function (msg, config, send) {
    const rag = ensureRag(msg);
    const input = getPath(msg, config.input || 'rag.document');
    const document = normaliseDocument(input);
    document.content = document.content.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').split('\n').map(line => line.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (config.stripHtml === 'true') document.content = document.content.replace(/<[^>]*>/g, ' ');
    if (config.preserveParagraphs === 'false') document.content = document.content.replace(/\n+/g, ' ');
    if (config.lowercase === 'true') document.content = document.content.toLowerCase();
    if (config.maxChars && document.content.length > Number(config.maxChars)) document.content = document.content.slice(0, Number(config.maxChars));
    rag.document = document;
    this.status({ fill: 'green', shape: 'dot', text: `${document.content.length} chars` });
    send(msg);
  });

  register('rag-chunker', function (msg, config, send) {
    const rag = ensureRag(msg); const document = normaliseDocument(getPath(msg, config.input || 'rag.document'));
    const size = Math.max(50, Number(config.chunkSize || 800)); const overlap = Math.max(0, Math.min(size - 1, Number(config.overlap || 120))); const minLength = Math.max(0, Number(config.minChunkLength || 0));
    const chunks = []; let offset = 0; let index = 0;
    while (offset < document.content.length) {
      let end = Math.min(document.content.length, offset + size);
      if (end < document.content.length && config.strategy !== 'fixed') { const boundary = Math.max(document.content.lastIndexOf('\n', end), document.content.lastIndexOf('. ', end), config.strategy === 'paragraph' ? document.content.lastIndexOf('\n\n', end) : -1); if (boundary > offset + size * 0.5) end = boundary + 1; }
      const content = document.content.slice(offset, end).trim();
      if (content.length >= minLength) chunks.push({ id: `${document.id}:${index++}`, content, metadata: { ...document.metadata, source: document.source, documentId: document.id, chunkIndex: index - 1, strategy: config.strategy || 'semantic' } });
      offset = end - overlap; if (end === document.content.length) break;
    }
    rag.chunks = chunks; this.status({ fill: 'green', shape: 'dot', text: `${chunks.length} chunks` }); send(msg);
  });

  register('rag-embed', async function (msg, config, send) {
    const rag = ensureRag(msg); const items = getPath(msg, config.input || 'rag.chunks') || [];
    const input = items.map(item => item.content || item.text || String(item)); const batchSize = Math.max(1, Number(config.batchSize || 64)); const vectors = [];
    for (let offset = 0; offset < input.length; offset += batchSize) {
      const body = { model: config.model || 'nomic-embed-text', input: input.slice(offset, offset + batchSize), ...(config.dimensions ? { dimensions: Number(config.dimensions) } : {}), ...parseJson(config.extra, {}) };
      const data = await request(this, config, msg, body);
      vectors.push(...(data.data ? data.data.map(item => item.embedding) : (data.embeddings || [data.embedding])));
    }
    if (vectors.length !== input.length) throw new Error('Embedding service returned an unexpected vector count');
    rag.vectors = items.map((item, index) => ({ ...item, vector: vectors[index] }));
    this.status({ fill: 'green', shape: 'dot', text: `${vectors.length} embedded` }); send(msg);
  });

  register('rag-vector-upsert', async function (msg, config, send) {
    const rag = ensureRag(msg); const points = getPath(msg, config.input || 'rag.vectors') || [];
    if (config.providerType === 'memory') {
      const key = `${config.collection || 'default'}:${config.namespace || 'default'}`; const existing = memoryStores.get(key) || new Map(); points.forEach(point => existing.set(String(point.id), point)); memoryStores.set(key, existing);
      rag.index = { providerResponse: { store: 'memory', key }, count: points.length }; this.status({ fill: 'green', shape: 'dot', text: `${points.length} indexed locally` }); send(msg); return;
    }
    const payloadPoints = config.format === 'qdrant' ? points.map(point => ({ id: point.id, vector: point.vector, payload: { content: point.content, ...point.metadata } })) : points;
    const data = await request(this, config, msg, { points: payloadPoints, collection: config.collection, namespace: config.namespace, wait: config.wait !== 'false', ...parseJson(config.extra, {}) });
    rag.index = { providerResponse: data, count: points.length }; this.status({ fill: 'green', shape: 'dot', text: `${points.length} indexed` }); send(msg);
  });

  register('rag-retrieve', async function (msg, config, send) {
    const rag = ensureRag(msg); const query = getPath(msg, config.query || 'payload');
    if (!query) throw new Error('A query is required');
    if (config.providerType === 'memory') {
      const key = `${config.collection || 'default'}:${config.namespace || 'default'}`; const candidates = [...(memoryStores.get(key) || new Map()).values()].map(item => ({ ...item, score: tokenScore(query, item.content) })).filter(item => item.score >= Number(config.minScore || 0)).sort((a, b) => b.score - a.score).slice(0, Number(config.topK || 8));
      rag.retrieval = { query, candidates, confidence: candidates.length ? candidates[0].score : 0, provider: 'memory' }; this.status({ fill: candidates.length ? 'green' : 'yellow', shape: 'dot', text: `${candidates.length} local matches` }); send(msg); return;
    }
    const data = await request(this, config, msg, { query, topK: Number(config.topK || 8), minScore: Number(config.minScore || 0), mode: config.mode || 'semantic', hybridWeight: Number(config.hybridWeight || 0.7), namespace: config.namespace, filters: parseJson(config.filters, {}), tenantId: rag.tenantId, ...parseJson(config.extra, {}) });
    rag.retrieval = { query, candidates: data.results || data.matches || data.points || data, confidence: 0 };
    send(msg);
  });

  register('rag-evidence-gate', function (msg, config, send) {
    const rag = ensureRag(msg); const candidates = rag.retrieval && rag.retrieval.candidates || [];
    const threshold = Number(config.minScore || 0.5); const seenDocuments = new Set(); const selected = candidates.filter(item => Number(item.score == null ? 1 : item.score) >= threshold).filter(item => { const id = item.metadata && item.metadata.documentId || item.documentId || item.id; if (config.diversify !== 'true' || !seenDocuments.has(id)) { seenDocuments.add(id); return true; } return false; }).slice(0, Number(config.topK || 5));
    rag.retrieval = { ...(rag.retrieval || {}), selected, confidence: selected.length ? Math.min(1, Number(selected[0].score == null ? 0.7 : selected[0].score)) : 0 };
    this.status({ fill: selected.length ? 'green' : 'yellow', shape: 'dot', text: selected.length ? `${selected.length} evidence items` : 'insufficient evidence' });
    send([selected.length ? msg : null, selected.length ? null : msg]);
  });

  register('rag-prompt', function (msg, config, send) {
    const rag = ensureRag(msg); const query = getPath(msg, config.query || 'payload'); const evidence = rag.retrieval && rag.retrieval.selected || [];
    let context = evidence.map((item, index) => `[${index + 1}] ${item.content || item.text || item.payload && item.payload.content || ''}${config.includeSource === 'true' ? `\nSource: ${item.metadata && item.metadata.source || item.source || 'unknown'}` : ''}`).join('\n\n');
    if (config.maxContextChars) context = context.slice(0, Number(config.maxContextChars));
    const template = config.template || '{{system}}\n\nEvidence:\n{{context}}\n\nQuestion: {{query}}';
    rag.prompt = template.replace('{{system}}', config.system || 'Answer only from the supplied evidence. Cite evidence numbers for factual claims. If evidence is insufficient, say so.').replace('{{context}}', context).replace('{{query}}', query);
    send(msg);
  });

  register('rag-generate', async function (msg, config, send) {
    const rag = ensureRag(msg); const prompt = getPath(msg, config.input || 'rag.prompt');
    const ollama = config.providerType === 'ollama'; const body = ollama ? { model: config.model, messages: [{ role: 'user', content: prompt }], stream: false, options: { temperature: Number(config.temperature || 0), top_p: config.topP ? Number(config.topP) : undefined, num_predict: config.maxTokens ? Number(config.maxTokens) : undefined, ...parseJson(config.extra, {}) } } : { model: config.model, messages: [{ role: 'user', content: prompt }], temperature: Number(config.temperature || 0), max_tokens: config.maxTokens ? Number(config.maxTokens) : undefined, top_p: config.topP ? Number(config.topP) : undefined, frequency_penalty: config.frequencyPenalty ? Number(config.frequencyPenalty) : undefined, presence_penalty: config.presencePenalty ? Number(config.presencePenalty) : undefined, ...(config.jsonMode === 'true' ? { response_format: { type: 'json_object' } } : {}), ...parseJson(config.extra, {}) };
    const data = await request(this, config, msg, body);
    rag.answer = { text: data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || data.message && data.message.content || data.response || data.text || String(data), citations: [] };
    send(msg);
  });

  register('rag-grounding', function (msg, config, send) {
    const rag = ensureRag(msg); const answer = rag.answer && rag.answer.text || ''; const evidence = rag.retrieval && rag.retrieval.selected || [];
    const terms = answer.toLowerCase().match(/[a-z0-9]{5,}/g) || []; const corpus = evidence.map(item => item.content || item.text || item.payload && item.payload.content || '').join(' ').toLowerCase();
    const supported = terms.length ? terms.filter(term => corpus.includes(term)).length / terms.length : 0;
    rag.answer = { ...(rag.answer || {}), groundedness: supported, citations: evidence.map((item, index) => ({ index: index + 1, id: item.id || item.metadata && item.metadata.documentId, source: item.metadata && item.metadata.source || item.source })) };
    const citationsRequired = config.requireCitations === 'true'; const pass = supported >= Number(config.minGroundedness || 0.55) && (!citationsRequired || evidence.length > 0);
    this.status({ fill: pass ? 'green' : 'yellow', shape: 'dot', text: `groundedness ${supported.toFixed(2)}` }); send([pass ? msg : null, pass ? null : msg]);
  });

  register('rag-policy', function (msg, config, send) {
    const rag = ensureRag(msg); const query = String(getPath(msg, config.input || 'payload') || ''); const blocked = parseJson(config.blockedPatterns, []).some(pattern => new RegExp(pattern, 'i').test(query)) || (config.maxQueryLength && query.length > Number(config.maxQueryLength));
    if (!rag.tenantId && config.requireTenant === 'true') { rag.policy = { decision: 'deny', reason: 'Missing tenant ID' }; return send([null, msg]); }
    rag.policy = { decision: blocked ? 'deny' : 'allow', reason: blocked ? 'Query matched blocked policy' : 'Policy checks passed' }; send([blocked ? null : msg, blocked ? msg : null]);
  });

  register('rag-observe', function (msg, config, send) {
    const rag = ensureRag(msg); rag.trace = { ...(rag.trace || {}), observedAt: new Date().toISOString(), node: config.label || this.id, event: config.event || 'rag.node.completed', environment: config.environment || undefined };
    this.status({ fill: 'blue', shape: 'dot', text: 'traced' }); send(msg);
  });
}

module.exports = function (RED) { initialise(RED); };
module.exports.register = function (RED, type) { initialise(RED, type); };
