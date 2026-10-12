'use strict';

const { request } = require('./lib/http');
const { ensureRag, getPath } = require('./lib/contracts');
const { spawn } = require('child_process');

function runCli(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false }); let stdout = ''; let stderr = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`${command} timed out`)); }, timeoutMs);
    child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
    child.on('error', error => { clearTimeout(timer); reject(error); }); child.on('close', code => { clearTimeout(timer); code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr || `${command} exited ${code}`)); });
  });
}

module.exports = function (RED) {
  RED.nodes.registerType('rag-local-model', function (config) {
    RED.nodes.createNode(this, config);
    this.on('input', async (msg, send, done) => {
      send = send || this.send.bind(this);
      try {
        const base = String(config.runtimeUrl || 'http://127.0.0.1:11434').replace(/\/$/, '');
        const model = String(config.model || getPath(msg, config.modelPath || '') || '');
        if (!model) throw new Error('A model name is required');
        const action = config.action || 'verify';
        let result;
        if (config.runtime === 'ollama' && config.execution === 'cli') {
          const args = action === 'pull' ? ['pull', model] : action === 'list' ? ['list'] : ['show', model]; result = await runCli(config.command || 'ollama', args, Number(config.timeout || 600000));
        } else if (config.runtime === 'ollama') {
          if (action === 'pull') result = await request(this, { ...config, url: `${base}/api/pull`, method: 'POST', timeout: config.timeout || '600000' }, msg, { name: model, stream: false, insecure: config.insecure === 'true' });
          else if (action === 'list') result = await request(this, { ...config, url: `${base}/api/tags`, method: 'GET' }, msg);
          else {
            const list = await request(this, { ...config, url: `${base}/api/tags`, method: 'GET' }, msg);
            result = { available: (list.models || []).some(item => item.name === model || item.model === model), models: list.models || [] };
            if (!result.available && config.requireAvailable === 'true') throw new Error(`Ollama model is not installed: ${model}`);
          }
        } else {
          const healthPath = config.healthPath || '/health';
          result = await request(this, { ...config, url: `${base}${healthPath}`, method: 'GET' }, msg);
        }
        const rag = ensureRag(msg); rag.localModel = { runtime: config.runtime || 'ollama', action, model, result, checkedAt: new Date().toISOString() };
        this.status({ fill: 'green', shape: 'dot', text: `${model} ${action} ok` }); send(msg); done();
      } catch (error) { this.status({ fill: 'red', shape: 'ring', text: error.message }); this.error(error, msg); done(error); }
    });
  });
};
