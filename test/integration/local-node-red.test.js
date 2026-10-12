'use strict';

const helper = require('node-red-node-test-helper');
const nodes = require('../../nodes');

describe('local Node-RED integration', function () {
  afterEach(async function () { await helper.unload(); });

  it('runs a no-provider grounded-answer safety flow locally', function (done) {
    const flow = [
      { id: 'prompt', type: 'rag-prompt', query: 'payload', system: 'Use sources only.', wires: [['ground']] },
      { id: 'ground', type: 'rag-grounding', minGroundedness: '0.2', wires: [['pass'], ['fail']] },
      { id: 'pass', type: 'helper' }, { id: 'fail', type: 'helper' }
    ];
    helper.load(nodes, flow, () => {
      helper.getNode('pass').on('input', msg => {
        if (!msg.rag.prompt.includes('Refunds are available for 30 days.')) return done(new Error('Evidence was not passed into the grounded prompt'));
        done();
      });
      helper.getNode('prompt').receive({ payload: 'When can I request a refund?', rag: { retrieval: { selected: [{ id: 'policy-1', score: 0.95, content: 'Refunds are available for 30 days.' }] }, answer: { text: 'Refunds are available for 30 days.' } } });
    });
  });
});
