'use strict';

const { parseJson } = require('./contracts');

function interpolate(value, msg) {
  return String(value || '').replace(/{{\s*([^}]+)\s*}}/g, (_, path) => path.trim().split('.').reduce((v, key) => v == null ? '' : v[key], msg));
}

async function request(node, config, msg, body) {
  const baseUrl = interpolate(config.url, msg);
  if (!baseUrl) throw new Error('A URL is required');
  const query = parseJson(config.queryParams, {});
  const search = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, interpolate(value, msg)])).toString();
  const url = search ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${search}` : baseUrl;
  const headers = { ...parseJson(config.headers, {}) };
  if (config.token) headers.authorization = `Bearer ${config.token}`;
  const retries = Math.max(0, Number(config.retries || 0));
  const retryDelay = Math.max(0, Number(config.retryDelay || 250));
  const retryStatuses = new Set(parseJson(config.retryStatuses, '[408,425,429,500,502,503,504]'));
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number(config.timeout || 30000));
    try {
      const response = await fetch(url, {
        method: config.method || 'POST', headers: { 'content-type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal
      });
      const responseText = await response.text();
      let data;
      try { data = responseText ? JSON.parse(responseText) : {}; } catch { data = responseText; }
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
        error.retryable = retryStatuses.has(response.status);
        throw error;
      }
      if (attempt) node.status({ fill: 'yellow', shape: 'ring', text: `recovered after ${attempt} retry${attempt === 1 ? '' : 'ies'}` });
      return data;
    } catch (error) {
      lastError = error;
      const retryable = error.name === 'AbortError' || error.retryable !== false;
      if (attempt >= retries || !retryable) throw error;
      const delay = retryDelay * (2 ** attempt) + Math.floor(Math.random() * Math.min(100, retryDelay));
      node.status({ fill: 'yellow', shape: 'ring', text: `retry ${attempt + 1}/${retries}` });
      await new Promise(resolve => setTimeout(resolve, delay));
    } finally { clearTimeout(timer); }
  }
  throw lastError;
}

module.exports = { request, interpolate };
