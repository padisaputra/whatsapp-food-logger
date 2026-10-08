import makeWASocket, {
  useMultiFileAuthState, fetchLatestBaileysVersion, makeCacheableSignalKeyStore,
  DisconnectReason, downloadMediaMessage, Browsers,
} from 'baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { handleMessage } from './commands.js';
import { wasProcessed, markProcessed, pruneProcessed } from './db.js';
import { isActiveClient, listClients } from './clients.js';

const log = pino({ level: process.env.LOG_LEVEL || 'info' });
const wlog = pino({ level: 'silent' }); // Baileys' own internal logging is very noisy

function digitsOf(jid) {
  return String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
}

function unwrap(message) {
  let msg = message;
  for (let i = 0; i < 4 && msg; i++) {
    const inner = msg.ephemeralMessage?.message || msg.viewOnceMessage?.message || msg.viewOnceMessageV2?.message;
    if (!inner) break;
    msg = inner;
  }
  return msg || {};
}

function textOf(msg) {
  return msg.conversation || msg.extendedTextMessage?.text || msg.imageMessage?.caption || '';
}

function imageOf(msg) {
  return msg.imageMessage || null;
}

function extFromMime(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('webp')) return 'webp';
  return 'jpg';
}

// Saves the photo twice: a persisted copy under DATA_DIR/photos (for the dashboard, kept
// after the reply) and a throwaway copy in a fresh temp dir (so the AI's Read-only, cwd-
// confined CLI call never sees anything else on disk). Caller must clean up tempDir.
function saveIncomingPhoto(buf, mediaType, photosDir) {
  const ext = extFromMime(mediaType);
  const id = randomUUID();

  fs.mkdirSync(photosDir, { recursive: true });
  const persistedAbs = path.join(photosDir, `${id}.${ext}`);
  fs.writeFileSync(persistedAbs, buf);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfl-photo-'));
  const tempPath = path.join(tempDir, `photo.${ext}`);
  fs.writeFileSync(tempPath, buf);

  return { photoPath: path.join('photos', `${id}.${ext}`), tempDir, tempPath };
}

// Simple per-sender token-bucket-ish limiter: at most `limit` messages per rolling minute.
// Guards against a stuck client (or redelivery storm) spawning a heavy CLI process per message.
function createRateLimiter(limit) {
  const windows = new Map(); // clientId -> { start, count }
  return function allow(clientId) {
    const now = Date.now();
    const w = windows.get(clientId);
    if (!w || now - w.start > 60_000) {
      windows.set(clientId, { start: now, count: 1 });
      return true;
    }
    w.count++;
    return w.count <= limit;
  };
}

function friendlyError(e) {
  const msg = String(e?.message || e || '');
  if (msg.startsWith('AUTH:')) return msg.slice(5).trim();
  if (msg.startsWith('TIMEOUT:')) return "that took too long to analyze, try again — if it keeps happening, the Claude CLI might be slow or stuck.";
  return `sorry, something went wrong: ${msg.slice(0, 200)}`;
}

// Requests a pairing code once the socket is actually ready for it. Baileys fires
// 'connecting' on process.nextTick, before the websocket has even opened — requesting
// then throws "Connection Closed". The first 'connection.update' carrying a real `qr`
// value only arrives once the noise handshake + registration round-trip with WhatsApp's
// server has completed (confirmed by probing a live socket), which is the earliest
// moment requestPairingCode will actually succeed. Exported standalone (sock passed in,
// no network calls of its own) so it's testable with a fake socket/EventEmitter.
export function wirePairingCode(sock, config, state, onPairingCode) {
  let requested = false;
  const request = async () => {
    try {
      const raw = await sock.requestPairingCode(config.pairingNumber);
      const code = raw.match(/.{1,4}/g).join('-');
      log.info('pairing code requested');
      onPairingCode?.(code, request, null);
    } catch (e) {
      log.error({ err: String(e) }, 'failed to request pairing code');
      onPairingCode?.(null, request, e);
    }
  };
  sock.ev.on('connection.update', (update) => {
    if (update.qr && !state.creds.registered && !requested) {
      requested = true;
      request();
    }
  });
  return request;
}

// Fires `start` again after `delay` ms with an incremented attempt count. A rejection from
// that attempt (startBot itself throwing — e.g. a broken auth dir) is caught and logged here
// instead of becoming an unhandled rejection: Node terminates the whole process on those by
// default (since v15), which would turn one transient reconnect failure into a full outage.
export function scheduleReconnect(start, config, deps, attempt, delay) {
  return setTimeout(() => {
    start(config, deps, attempt + 1).catch((e) => {
      log.error({ err: String(e).slice(0, 300) }, 'reconnect attempt failed');
    });
  }, delay);
}

export async function startBot(config, deps, attempt = 0) {
  const { db } = deps;
  pruneProcessed(db);
  const allow = deps.rateLimiter || createRateLimiter(config.rateLimitPerMinute);
  const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));

  const sock = makeWASocket({
    version,
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, wlog) },
    logger: wlog,
    browser: Browsers.macOS('Chrome'),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
  });

  sock.ev.on('creds.update', saveCreds);

  if (!state.creds.registered && config.pairingNumber) {
    wirePairingCode(sock, config, state, deps.onPairingCode);
  }

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'open') {
      log.info('connected to WhatsApp');
      log.debug({ me: sock.user?.id }, 'connection details'); // own number — kept out of default-level logs
      attempt = 0;
      if (deps.onOpen) deps.onOpen(sock);
    }
    if (connection === 'close') {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      log.warn({ code }, 'connection closed');
      if (code === DisconnectReason.loggedOut) {
        log.error('logged out — run `npm run relink` to pair again');
        process.exit(1);
      }
      const delay = Math.min(30_000, 3000 * 2 ** attempt) + Math.floor(Math.random() * 1000);
      scheduleReconnect(startBot, config, deps, attempt, delay);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const m of messages) {
      let tempDir = null;
      try {
        if (!m.message || m.key.fromMe || !m.key.id) continue;
        const jid = m.key.remoteJid || '';
        if (jid.endsWith('@g.us') || jid === 'status@broadcast' || jid.endsWith('@newsletter')) continue; // groups ignored

        const sender = digitsOf(jid);
        if (!isActiveClient(db, sender)) continue; // not an active client (unknown, paused, or removed) — ignore, don't log who tried

        if (wasProcessed(db, m.key.id)) { log.info('duplicate message, ignoring redelivery'); continue; }
        markProcessed(db, m.key.id);

        const msg = unwrap(m.message);
        const text = textOf(msg);
        const imgNode = imageOf(msg);

        if (!allow(sender)) {
          await sock.sendMessage(jid, { text: "you're sending messages faster than I can log them — give it a few seconds." });
          continue;
        }

        let image = null;
        if (imgNode) {
          try {
            const buf = await downloadMediaMessage(m, 'buffer', {}, { logger: wlog, reuploadRequest: sock.updateMediaMessage });
            const saved = saveIncomingPhoto(buf, imgNode.mimetype, config.photosDir);
            tempDir = saved.tempDir;
            image = { tempPath: saved.tempPath, photoPath: saved.photoPath };
          } catch (e) {
            log.error({ err: String(e).slice(0, 300) }, 'failed to download photo');
            await sock.sendMessage(jid, { text: "couldn't download that photo — try sending it again." });
            continue;
          }
        }

        if (!text && !image) continue;

        const result = await handleMessage({
          db,
          extractFood: deps.extractFood,
          tz: config.tz,
          clientId: sender,
          isAdmin: config.coachNumber === sender,
          allowedNumbers: listClients(db).map((c) => c.client_id),
          defaultTargets: config.defaultTargets,
          defaultCountryCode: config.defaultCountryCode,
          botNumber: digitsOf(sock.user?.id || ''),
          text,
          image,
        });

        if (result.file) {
          await sock.sendMessage(jid, {
            document: Buffer.from(result.file.content, 'utf8'),
            fileName: result.file.name,
            mimetype: 'text/csv',
            caption: result.reply,
          });
        } else {
          await sock.sendMessage(jid, { text: result.reply });
        }

        if (result.welcomeTo) {
          try {
            await sock.sendMessage(`${result.welcomeTo.clientId}@s.whatsapp.net`, { text: result.welcomeTo.text });
          } catch (e) {
            log.error({ err: String(e).slice(0, 300) }, 'failed to send welcome message to new client');
          }
        }
      } catch (e) {
        log.error({ err: String(e).slice(0, 500) }, 'failed to handle message');
        try {
          await sock.sendMessage(m.key.remoteJid, { text: friendlyError(e) });
        } catch {}
      } finally {
        if (tempDir) fs.rm(tempDir, { recursive: true, force: true }, () => {});
      }
    }
  });

  return sock;
}
