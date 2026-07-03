const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  spotifyLogin:   (clientId) => ipcRenderer.invoke('spotify:login', clientId),
  spotifyRefresh: (tokens)   => ipcRenderer.invoke('spotify:refresh', tokens),
  spotifyFetch:   (args)     => ipcRenderer.invoke('spotify:fetch', args),

  // Ponte com a extensão de navegador (veja main.js: servidor local /event)
  getPairingInfo:        () => ipcRenderer.invoke('yts:pairing-info'),
  regeneratePairingToken: () => ipcRenderer.invoke('yts:regenerate-pairing-token'),

  // Assina eventos de "música tocando" enviados pela extensão real.
  // Retorna uma função para cancelar a assinatura.
  onTrackEvent: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('yts:track', handler);
    return () => ipcRenderer.removeListener('yts:track', handler);
  }
});
