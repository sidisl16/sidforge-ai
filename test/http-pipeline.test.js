'use strict';

const http = require('http');
const helper = require('node-red-node-test-helper');
require('should');
const nodes = require('../nodes');

function startMockService() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      requests.push({ url: req.url, body: raw ? JSON.parse(raw) : undefined });
      const responses = {
        '/source': [{ id: 'refund-policy', source: 'policy.md', content: 'Refunds may be requested within thirty calendar days.' }],
        '/embed': { data: [{ embedding: [0.1, 0.2] }] },
        '/upsert': { status: 'ok' },
        '/retrieve': { results: [{ id: 'refund-policy:0', score: 0.95, content: 'Refunds may be requested within thirty calendar days.', metadata: { source: 'policy.md' } }] },
        '/generate': { choices: [{ message: { content: 'Refunds may be requested within thirty calendar days.' } }] }
      };
      const payload = responses[req.url] || { error: 'not found' };
      res.writeHead(responses[req.url] ? 200 : 404, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, requests, base: `http://127.0.0.1:${server.address().port}` })));
}

describe('SidForge AI HTTP adapter pipeline', function () {
  let mock;
  before(async function () { mock = await startMockService(); });
  after(async function () { await new Promise(resolve => mock.server.close(resolve)); });
  afterEach(async function () { await helper.unload(); });

  it('runs source, embedding, index, retrieval, generation, and grounding against local endpoints', function (done) {
    const flow = [
      { id: 'source', type: 'rag-source', url: `${mock.base}/source`, method: 'GET', wires: [['normalize']] },
      { id: 'normalize', type: 'rag-normalize', input: 'rag.document', wires: [['chunk']] },
      { id: 'chunk', type: 'rag-chunker', input: 'rag.document', chunkSize: '100', overlap: '10', wires: [['embed']] },
      { id: 'embed', type: 'rag-embed', url: `${mock.base}/embed`, input: 'rag.chunks', model: 'local-model', wires: [['upsert']] },
      { id: 'upsert', type: 'rag-vector-upsert', url: `${mock.base}/upsert`, input: 'rag.vectors', collection: 'policies', wires: [['retrieve']] },
      { id: 'retrieve', type: 'rag-retrieve', url: `${mock.base}/retrieve`, query: 'payload', topK: '3', wires: [['gate']] },
      { id: 'gate', type: 'rag-evidence-gate', minScore: '0.8', topK: '2', wires: [['prompt'], ['failedEvidence']] },
      { id: 'prompt', type: 'rag-prompt', query: 'payload', wires: [['generate']] },
      { id: 'generate', type: 'rag-generate', url: `${mock.base}/generate`, input: 'rag.prompt', model: 'local-chat', wires: [['ground']] },
      { id: 'ground', type: 'rag-grounding', minGroundedness: '0.5', wires: [['pass'], ['review']] },
      { id: 'pass', type: 'helper' }, { id: 'review', type: 'helper' }, { id: 'failedEvidence', type: 'helper' }
    ];
    helper.load(nodes, flow, () => {
      helper.getNode('pass').on('input', msg => {
        try {
          msg.rag.answer.groundedness.should.be.above(0.5);
          msg.rag.index.count.should.equal(1);
          mock.requests.map(request => request.url).should.containEql('/upsert');
          done();
        } catch (error) { done(error); }
      });
      helper.getNode('source').receive({ payload: 'When can I request a refund?', rag: { tenantId: 'demo' } });
    });
  });
});
