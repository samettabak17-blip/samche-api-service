import { EventEmitter } from 'events';
import pool from '../config/db.js';

const events = new EventEmitter();
let listenerClient = null;
let reconnectTimer = null;

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void startLiveEventListener();
  }, 3000);
}

export async function startLiveEventListener() {
  if (listenerClient) return;

  try {
    const client = await pool.connect();
    listenerClient = client;
    client.on('notification', (notification) => {
      if (notification.channel !== 'samche_live_events') return;
      try {
        const event = JSON.parse(notification.payload);
        if (event?.tenant_id && event?.conversation_id && event?.type) events.emit(event.tenant_id, event);
      } catch {
        // Notification payloads are internal hints. Ignore malformed payloads.
      }
    });
    client.on('error', () => {
      if (listenerClient === client) listenerClient = null;
      scheduleReconnect();
    });
    client.on('end', () => {
      if (listenerClient === client) listenerClient = null;
      scheduleReconnect();
    });
    await client.query('LISTEN samche_live_events');
  } catch {
    listenerClient = null;
    scheduleReconnect();
  }
}

export function subscribeTenantEvents(tenantId, callback) {
  events.on(tenantId, callback);
  return () => events.off(tenantId, callback);
}
