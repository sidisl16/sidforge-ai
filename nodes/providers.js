'use strict';

module.exports = function (RED) {
  function configType(type) {
    RED.nodes.registerType(type, function (config) { RED.nodes.createNode(this, config); Object.assign(this, config); }, { credentials: { apiKey: { type: 'password' } } });
  }
  configType('rag-model-provider');
  configType('rag-embedding-provider');
  configType('rag-vector-store');
  configType('rag-reranker-provider');
  configType('rag-cache-provider');
  configType('rag-project');
  configType('rag-policy-profile');
};
