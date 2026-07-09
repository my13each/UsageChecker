const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('uc', {
  onUsage: (cb) => ipcRenderer.on('usage', (_e, data) => cb(data)),
  quit: () => ipcRenderer.send('uc-quit'),
  move: (dx, dy) => ipcRenderer.send('uc-move', { dx, dy }),
});
