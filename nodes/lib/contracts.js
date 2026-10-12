'use strict';

function getPath(object, path) {
  return String(path || '').split('.').filter(Boolean).reduce((value, key) => value == null ? undefined : value[key], object);
}

function setPath(object, path, value) {
  const keys = String(path || '').split('.').filter(Boolean);
  const last = keys.pop();
  const target = keys.reduce((value, key) => value[key] || (value[key] = {}), object);
  target[last] = value;
  return value;
}

function ensureRag(msg) {
  msg.rag = msg.rag || {};
  msg.rag.meta = msg.rag.meta || {};
  return msg.rag;
}

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { throw new Error('Expected valid JSON configuration'); }
}

function normaliseDocument(input, defaults = {}) {
  const doc = typeof input === 'string' ? { content: input } : { ...input };
  if (!doc.content && doc.text) doc.content = doc.text;
  if (typeof doc.content !== 'string') throw new Error('Document content must be a string');
  return {
    id: doc.id || defaults.id || `doc-${Date.now()}`,
    content: doc.content,
    metadata: { ...(defaults.metadata || {}), ...(doc.metadata || {}) },
    source: doc.source || defaults.source || 'unknown'
  };
}

module.exports = { ensureRag, getPath, setPath, parseJson, normaliseDocument };
