export function createProcessingBridge(opts = {}) {
  let url = typeof opts.url === 'string' && opts.url ? opts.url : 'ws://localhost:8081';
  let fps = Number.isFinite(opts.fps) && opts.fps > 0 ? opts.fps : 20;
  let socket = null;
  let status = 'disconnected';
  let manualDisconnect = false;
  let reconnectTimer = null;
  let reconnectDelay = 1000;
  let lastSendAt = 0;

  const clearReconnectTimer = () => {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const isActiveSocket = (candidate) => socket && candidate === socket;

  const scheduleReconnect = () => {
    if (manualDisconnect || reconnectTimer !== null) return;
    status = 'connecting';
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (!manualDisconnect) connect();
    }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 15000);
  };

  const cleanupSocket = (candidate) => {
    if (!candidate) return;
    try { candidate.onopen = null; } catch (_) {}
    try { candidate.onclose = null; } catch (_) {}
    try { candidate.onerror = null; } catch (_) {}
    try { candidate.onmessage = null; } catch (_) {}
    if (isActiveSocket(candidate)) socket = null;
  };

  const connect = () => {
    if (manualDisconnect) manualDisconnect = false;
    // Re-entrancy is already prevented by the live `socket` handle; we must NOT
    // also bail on status==='connecting', because scheduleReconnect() sets that
    // status before the retry timer fires (with socket=null) — bailing here
    // would silently kill auto-reconnect.
    if (status === 'open' || socket) return;

    clearReconnectTimer();
    status = 'connecting';

    let ws;
    try {
      ws = new WebSocket(url);
    } catch (_) {
      socket = null;
      scheduleReconnect();
      return;
    }

    socket = ws;

    ws.onopen = () => {
      if (!isActiveSocket(ws)) return;
      status = 'open';
      reconnectDelay = 1000;
    };

    ws.onclose = () => {
      const wasManual = manualDisconnect;
      cleanupSocket(ws);
      status = 'disconnected';
      if (!wasManual) scheduleReconnect();
    };

    ws.onerror = () => {
      if (!isActiveSocket(ws)) return;
      try { ws.close(); } catch (_) {}
    };

    ws.onmessage = () => {};
  };

  const disconnect = () => {
    manualDisconnect = true;
    clearReconnectTimer();
    status = 'disconnected';

    const ws = socket;
    cleanupSocket(ws);
    if (!ws) return;

    try { ws.close(); } catch (_) {}
  };

  const send = (frame) => {
    try {
      if (!socket || status !== 'open' || socket.readyState !== WebSocket.OPEN) return;

      const intervalMs = 1000 / fps;
      const now = Date.now();
      if (now - lastSendAt < intervalMs) return;

      const payload = JSON.stringify(frame);
      socket.send(payload);
      lastSendAt = now;
    } catch (_) {}
  };

  return {
    connect,
    disconnect,
    send,
    isOpen() {
      try {
        return !!socket && status === 'open' && socket.readyState === WebSocket.OPEN;
      } catch (_) {
        return false;
      }
    },
    getStatus() {
      return status;
    },
    setUrl(next) {
      if (typeof next !== 'string' || !next || next === url) return;
      url = next;
      reconnectDelay = 1000;
      const shouldReconnect = status === 'open' || status === 'connecting' || reconnectTimer !== null;
      disconnect();
      if (shouldReconnect) {
        manualDisconnect = false;
        connect();
      }
    },
  };
}
