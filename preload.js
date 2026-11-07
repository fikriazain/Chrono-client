const { contextBridge, ipcRenderer } = require('electron');

// renderer.js expects these. In the receiver they do nothing.
contextBridge.exposeInMainWorld('mini', {
  click() {}, dragStart() {}, dragBegin() {}, dragMove() {}, dragEnd() {}, onSleep() {},
});

contextBridge.exposeInMainWorld('bubble', {
  send: (text) => ipcRenderer.invoke('chat-send', text),
  hidden: () => ipcRenderer.send('bubble-hidden'),
  touch: () => ipcRenderer.send('bubble-touch'),
  onOpen: (cb) => ipcRenderer.on('bubble-open', (e, text) => cb(text)),
  onClose: (cb) => ipcRenderer.on('bubble-close', () => cb()),
  onSay: (cb) => ipcRenderer.on('bubble-say', (e, text) => cb(text)),
});

contextBridge.exposeInMainWorld('fxApi', {
  onStart: (cb) => ipcRenderer.on('fx-start', (e, d) => cb(d)),
  ready: () => ipcRenderer.send('fx-ready'),
  arrive: () => ipcRenderer.send('fx-arrive'),
  done: () => ipcRenderer.send('fx-done'),
});

contextBridge.exposeInMainWorld('setup', {
  save: (name, token) => ipcRenderer.send('setup-save', { name, token }),
});