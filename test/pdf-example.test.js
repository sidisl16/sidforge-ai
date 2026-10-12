'use strict';

const fs = require('fs');
const path = require('path');
require('should');
const helper = require('node-red-node-test-helper');
const nodes = require('../nodes');
const providers = require('../nodes/providers');

const examplePath = path.join(__dirname, '..', 'examples', 'pdf-document-rag.json');
const example = JSON.parse(fs.readFileSync(examplePath, 'utf8'));

describe('PDF RAG example flow', function () {
  afterEach(async function () { await helper.unload(); });

  it('is importable by a local Node-RED runtime and has a non-overlapping layout', function (done) {
    const flowNodes = example.filter(node => node.z === 'pdf-rag-tab');
    const ids = flowNodes.map(node => node.id);
    new Set(ids).size.should.equal(ids.length);
    new Set(flowNodes.filter(node => node.x && node.y).map(node => `${node.x}:${node.y}`)).size.should.equal(flowNodes.filter(node => node.x && node.y).length);
    flowNodes.filter(node => node.type !== 'comment' && node.type !== 'debug').forEach(node => {
      (node.wires || []).length.should.be.aboveOrEqual(0);
    });
    helper.load(RED => { nodes(RED); providers(RED); }, example, () => done());
  });
});
