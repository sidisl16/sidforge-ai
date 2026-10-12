'use strict';

const crypto = require('crypto');
const { ensureRag, getPath, parseJson, setPath } = require('./lib/contracts');

module.exports = function (RED) {
  function node(type, outputs, work) {
    RED.nodes.registerType(type, function (config) {
      RED.nodes.createNode(this, config);
      this.on('input', (msg, send, done) => {
        send = send || this.send.bind(this);
        try { work.call(this, msg, config, send); done(); }
        catch (error) { this.error(error, msg); done(error); }
      });
    });
  }
  const text = (msg, path = 'payload') => String(getPath(msg, path) || '');
  const chunks = msg => ensureRag(msg).retrieval && ensureRag(msg).retrieval.candidates || [];

  node('rag-metadata-validator', 2, function (msg, config, send) {
    const document = ensureRag(msg).document || {}; const required = parseJson(config.requiredFields, '["id","content","source"]');
    const missing = required.filter(field => getPath(document, field) == null || getPath(document, field) === '');
    ensureRag(msg).validation = { valid: missing.length === 0, missing };
    send([missing.length ? null : msg, missing.length ? msg : null]);
  });
  node('rag-pii-detector', 2, function (msg, config, send) {
    const value = text(msg, config.input || 'rag.document.content'); const findings = [];
    [['email', /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g], ['phone', /\b(?:\+?\d[ -]?){8,15}\b/g], ['card', /\b(?:\d[ -]?){13,19}\b/g]].forEach(([kind, pattern]) => { const matches = value.match(pattern) || []; matches.forEach(match => findings.push({ kind, match })); });
    ensureRag(msg).pii = { findings, detected: findings.length > 0 }; send([findings.length ? null : msg, findings.length ? msg : null]);
  });
  node('rag-pii-redactor', 1, function (msg, config, send) {
    const path = config.input || 'rag.document.content'; let value = text(msg, path); const replacement = config.replacement || '[REDACTED]';
    value = value.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, replacement).replace(/\b(?:\d[ -]?){13,19}\b/g, replacement); setPath(msg, path, value); ensureRag(msg).pii = { ...(ensureRag(msg).pii || {}), redacted: true }; send(msg);
  });
  node('rag-duplicate-detector', 2, function (msg, config, send) {
    const document = ensureRag(msg).document || {}; const hash = crypto.createHash('sha256').update(document.content || '').digest('hex'); const seen = this.context().get('hashes') || {}; const duplicate = Boolean(seen[hash]); seen[hash] = document.id || hash; this.context().set('hashes', seen); ensureRag(msg).duplicate = { hash, duplicate }; send([duplicate ? null : msg, duplicate ? msg : null]);
  });
  node('rag-document-versioner', 1, function (msg, _config, send) {
    const document = ensureRag(msg).document || {}; const checksum = crypto.createHash('sha256').update(document.content || '').digest('hex'); document.metadata = { ...(document.metadata || {}), checksum, versionedAt: new Date().toISOString() }; ensureRag(msg).document = document; send(msg);
  });
  node('rag-chunk-quality-filter', 2, function (msg, config, send) {
    const minimum = Number(config.minimumLength || 40); const all = ensureRag(msg).chunks || []; const accepted = all.filter(chunk => String(chunk.content || '').trim().length >= minimum); ensureRag(msg).chunks = accepted; ensureRag(msg).rejectedChunks = all.length - accepted.length; send([accepted.length ? msg : null, accepted.length ? null : msg]);
  });
  node('rag-query-normalizer', 1, function (msg, config, send) {
    const original = text(msg, config.input || 'payload'); const normalized = original.normalize('NFKC').replace(/\s+/g, ' ').trim(); ensureRag(msg).query = { ...(ensureRag(msg).query || {}), original, normalized, language: config.language || 'auto' }; setPath(msg, config.output || 'payload', normalized); send(msg);
  });
  node('rag-query-safety', 2, function (msg, config, send) {
    const value = text(msg, config.input || 'payload'); const patterns = parseJson(config.patterns, '["ignore (all )?previous instructions","system prompt","reveal.*secret"]'); const matched = patterns.find(pattern => new RegExp(pattern, 'i').test(value)); ensureRag(msg).safety = { safe: !matched, matched }; send([matched ? null : msg, matched ? msg : null]);
  });
  node('rag-tenant-context', 2, function (msg, config, send) {
    const tenantId = getPath(msg, config.input || 'tenantId') || config.defaultTenant; ensureRag(msg).tenantId = tenantId; send([tenantId ? msg : null, tenantId ? null : msg]);
  });
  node('rag-acl-filter', 2, function (msg, config, send) {
    const roles = getPath(msg, config.rolesPath || 'rag.user.roles') || []; const selected = chunks(msg).filter(item => { const acl = item.metadata && item.metadata.acl || []; return !acl.length || acl.some(role => roles.includes(role)); }); ensureRag(msg).retrieval = { ...(ensureRag(msg).retrieval || {}), candidates: selected }; send([selected.length ? msg : null, selected.length ? null : msg]);
  });
  node('rag-result-deduplicator', 1, function (msg, _config, send) {
    const seen = new Set(); const selected = chunks(msg).filter(item => { const key = item.id || crypto.createHash('sha1').update(item.content || '').digest('hex'); if (seen.has(key)) return false; seen.add(key); return true; }); ensureRag(msg).retrieval = { ...(ensureRag(msg).retrieval || {}), candidates: selected }; send(msg);
  });
  node('rag-evidence-packer', 1, function (msg, config, send) {
    const limit = Number(config.maxChars || 6000); let used = 0; const selected = []; for (const item of chunks(msg)) { const size = String(item.content || '').length; if (used + size > limit) continue; selected.push(item); used += size; } ensureRag(msg).retrieval = { ...(ensureRag(msg).retrieval || {}), selected }; send(msg);
  });
  node('rag-claim-extractor', 1, function (msg, config, send) {
    const answer = text(msg, config.input || 'rag.answer.text'); ensureRag(msg).answer = { ...(ensureRag(msg).answer || {}), claims: answer.split(/(?<=[.!?])\s+/).filter(Boolean) }; send(msg);
  });
  node('rag-citation-validator', 2, function (msg, _config, send) {
    const answer = ensureRag(msg).answer || {}; const sources = new Set((ensureRag(msg).retrieval && ensureRag(msg).retrieval.selected || []).map(item => item.id)); const citations = answer.citations || []; const valid = citations.length > 0 && citations.every(citation => sources.has(citation.id) || sources.has(citation.sourceId)); ensureRag(msg).citations = { valid, count: citations.length }; send([valid ? msg : null, valid ? null : msg]);
  });
  node('rag-confidence-scorer', 1, function (msg, _config, send) {
    const rag = ensureRag(msg); const retrieval = rag.retrieval || {}; const answer = rag.answer || {}; const score = ((Number(retrieval.confidence || 0) + Number(answer.groundedness || 0) + (answer.citations && answer.citations.length ? 1 : 0)) / 3); rag.confidence = Math.round(score * 100) / 100; send(msg);
  });
  node('rag-abstention', 1, function (msg, config, send) { const rag = ensureRag(msg); rag.answer = { ...(rag.answer || {}), status: 'abstained', text: config.message || 'I could not find enough evidence to answer that safely.' }; send(msg); });
  node('rag-secret-redactor', 1, function (msg, config, send) { const path = config.input || 'payload'; setPath(msg, path, text(msg, path).replace(/(?:sk-|api[_-]?key[=:]\s*)[\w-]{8,}/gi, '[REDACTED_SECRET]')); send(msg); });
  node('rag-rate-limiter', 2, function (msg, config, send) { const key = String(getPath(msg, config.keyPath || 'rag.tenantId') || 'default'); const now = Date.now(); const interval = Number(config.windowMs || 60000); const limit = Number(config.limit || 60); const bucket = this.context().get('bucket') || {}; const items = (bucket[key] || []).filter(time => now - time < interval); items.push(now); bucket[key] = items; this.context().set('bucket', bucket); ensureRag(msg).rateLimit = { key, remaining: Math.max(0, limit - items.length) }; send([items.length <= limit ? msg : null, items.length <= limit ? null : msg]); });
  node('rag-idempotency-guard', 2, function (msg, config, send) { const key = String(getPath(msg, config.keyPath || 'rag.requestId') || crypto.createHash('sha1').update(JSON.stringify(msg.payload || '')).digest('hex')); const seen = this.context().get('seen') || {}; const duplicate = Boolean(seen[key]); seen[key] = Date.now(); this.context().set('seen', seen); ensureRag(msg).idempotency = { key, duplicate }; send([duplicate ? null : msg, duplicate ? msg : null]); });
  node('rag-retrieval-evaluator', 1, function (msg, config, send) { const expected = parseJson(config.expectedIds, '[]'); const ids = chunks(msg).map(item => item.id); const hits = expected.filter(id => ids.includes(id)); ensureRag(msg).evaluation = { ...(ensureRag(msg).evaluation || {}), recall: expected.length ? hits.length / expected.length : null, hits }; send(msg); });
  node('rag-feedback', 1, function (msg, config, send) { ensureRag(msg).feedback = { rating: getPath(msg, config.ratingPath || 'payload.rating'), correction: getPath(msg, config.correctionPath || 'payload.correction'), receivedAt: new Date().toISOString() }; send(msg); });
};
