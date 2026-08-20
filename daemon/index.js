import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import { createServer } from "node:http";
import { join, extname, basename } from "node:path";
import { existsSync, writeFileSync } from "node:fs";
import { Boom } from "@hapi/boom";
import qrcode from "qrcode-terminal";
import pino from "pino";
import * as Jimp from "jimp";
import { readFileSync } from "node:fs";

// generate JPEG thumbnail from an image file — used because Baileys can't
// find jimp via dynamic import() in Bun compiled binaries
// convert images to JPEG for WhatsApp (PNGs often get treated as documents)
// only resize if dimensions are extreme (>4096px)
const MAX_IMAGE_DIM = 4096;

async function prepareImage(filePath) {
  const buf = readFileSync(filePath);
  const img = await Jimp.Jimp.read(buf);
  const { width, height } = img;

  if (width > MAX_IMAGE_DIM || height > MAX_IMAGE_DIM) {
    const scale = MAX_IMAGE_DIM / Math.max(width, height);
    img.resize({ w: Math.round(width * scale), h: Math.round(height * scale) });
  }

  const image = await img.getBuffer("image/jpeg", { quality: 85 });
  // small thumbnail for the chat preview
  const thumbImg = img.clone();
  thumbImg.resize({ w: 100, h: Jimp.JimpMime.AUTO });
  const jpegThumbnail = await thumbImg.getBuffer("image/jpeg", { quality: 50 });

  return { image, jpegThumbnail };
}

const PORT = parseInt(process.env.PORT || "7272");
const AUTH_DIR = join(process.cwd(), "auth_info");
const CONTACTS_FILE = join(process.cwd(), "contacts.json");
const MAX_RECONNECT_DELAY = 60000;

const logger = pino({ level: process.env.DEBUG ? "debug" : "warn" });

let sock = null;
let connected = false;
let phoneNumber = null;
let currentQR = null;
let reconnectAttempt = 0;

const pendingMessages = [];
const contacts = new Map(); // jid -> { id, name, notify, verifiedName, lastMessageTs }

// load persisted contacts on startup
try {
  if (existsSync(CONTACTS_FILE)) {
    const saved = JSON.parse(readFileSync(CONTACTS_FILE, "utf8"));
    for (const c of saved) contacts.set(c.id, c);
    console.log(`loaded ${contacts.size} contacts from disk`);
  }
} catch {}

function saveContactsToDisk() {
  writeFileSync(CONTACTS_FILE, JSON.stringify([...contacts.values()]));
  console.log(`saved ${contacts.size} contacts to disk`);
}

function updateChatTimestamps(chats) {
  for (const chat of chats) {
    if (!chat.id?.endsWith("@s.whatsapp.net")) continue;
    const ts = Number(chat.conversationTimestamp || chat.lastMessageRecvTimestamp || 0);
    if (!ts) continue;
    const existing = contacts.get(chat.id) || { id: chat.id };
    // only update if newer
    if (!existing.lastMessageTs || ts > existing.lastMessageTs) {
      contacts.set(chat.id, { ...existing, lastMessageTs: ts });
      contactsDirty = true;
    }
  }
}

let contactsDirty = false;

function upsertContacts(list) {
  for (const c of list) {
    const existing = contacts.get(c.id) || {};
    contacts.set(c.id, { ...existing, ...c });
  }
  contactsDirty = true;
}

// save contacts periodically if dirty
setInterval(() => {
  if (contactsDirty && contacts.size > 0) {
    saveContactsToDisk();
    contactsDirty = false;
  }
}, 5000);

// save on exit
process.on("SIGINT", () => {
  if (contactsDirty) saveContactsToDisk();
  process.exit(0);
});
process.on("SIGTERM", () => {
  if (contactsDirty) saveContactsToDisk();
  process.exit(0);
});

function searchContacts(query) {
  const q = query.toLowerCase();
  const results = [];
  for (const c of contacts.values()) {
    // skip groups and non-user JIDs
    if (!c.id?.endsWith("@s.whatsapp.net")) continue;
    const name = c.name || c.notify || c.verifiedName || "";
    const phone = c.id.split("@")[0];
    if (!q || name.toLowerCase().includes(q) || phone.includes(q)) {
      results.push({
        jid: c.id,
        name: c.name || null,
        pushName: c.notify || null,
        verifiedName: c.verifiedName || null,
        phone,
        lastMessageTs: c.lastMessageTs || 0,
      });
    }
  }
  // sort by most recent message first
  results.sort((a, b) => (b.lastMessageTs || 0) - (a.lastMessageTs || 0));
  return results;
}

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);
const VIDEO_EXTS = new Set([".mp4", ".mov", ".avi", ".mkv", ".webm", ".3gp"]);
const AUDIO_EXTS = new Set([".mp3", ".ogg", ".m4a", ".wav", ".aac", ".opus"]);

const MIME_MAP = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".mkv": "video/x-matroska",
  ".webm": "video/webm",
  ".3gp": "video/3gpp",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".aac": "audio/aac",
  ".opus": "audio/opus",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".zip": "application/zip",
  ".txt": "text/plain",
};

async function buildMessage(payload) {
  const { text, filePath, caption } = payload;

  // text-only message
  if (!filePath) {
    return { text: text || "" };
  }

  const ext = extname(filePath).toLowerCase();
  const fileName = basename(filePath);
  // read file into buffer — avoids Bun stream compatibility issues
  const buffer = readFileSync(filePath);

  if (IMAGE_EXTS.has(ext)) {
    const { image, jpegThumbnail } = await prepareImage(filePath);
    return { image, mimetype: "image/jpeg", caption, jpegThumbnail };
  }
  if (VIDEO_EXTS.has(ext)) {
    return { video: buffer, mimetype: MIME_MAP[ext] || "video/mp4", caption };
  }
  if (AUDIO_EXTS.has(ext)) {
    return { audio: buffer, mimetype: MIME_MAP[ext] || "audio/mpeg" };
  }
  // everything else as document
  return {
    document: buffer,
    mimetype: MIME_MAP[ext] || "application/octet-stream",
    fileName,
    caption,
  };
}

async function sendMsg(jid, payload) {
  const msg = await buildMessage(payload);
  await sock.sendMessage(jid, msg);
  const label = payload.filePath ? basename(payload.filePath) : (payload.text || "").slice(0, 80);
  console.log(`sent: ${label}`);
}

async function flushPending() {
  while (pendingMessages.length > 0 && connected && sock) {
    const { jid, payload } = pendingMessages[0];
    try {
      await sendMsg(jid, payload);
      pendingMessages.shift();
    } catch (err) {
      console.error("failed to flush queued message:", err.message);
      break;
    }
  }
}

const FALLBACK_WA_VERSION = [2, 3000, 1043857760];

async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const version = await fetchLatestBaileysVersion()
    .then((r) => r.version)
    .catch(() => FALLBACK_WA_VERSION);

  sock = makeWASocket({
    auth: state,
    logger,
    version,
    syncFullHistory: true,
  });

  sock.ev.on("creds.update", saveCreds);

  // accumulate contacts and chat timestamps
  sock.ev.on("messaging-history.set", (data) => {
    console.log(
      `messaging-history.set: ${data.contacts?.length || 0} contacts, ${data.chats?.length || 0} chats`,
    );
    if (data.contacts?.length) {
      upsertContacts(data.contacts);
      console.log(`synced ${data.contacts.length} contacts (total: ${contacts.size})`);
    }
    if (data.chats?.length) {
      updateChatTimestamps(data.chats);
    }
  });

  sock.ev.on("contacts.upsert", (list) => {
    upsertContacts(list);
    console.log(`contacts.upsert: +${list.length} (total: ${contacts.size})`);
  });

  sock.ev.on("contacts.update", (updates) => {
    upsertContacts(updates);
  });

  sock.ev.on("chats.upsert", (chats) => {
    updateChatTimestamps(chats);
  });

  sock.ev.on("chats.update", (updates) => {
    updateChatTimestamps(updates);
  });

  // update timestamp when we send a message
  sock.ev.on("messages.upsert", ({ messages }) => {
    for (const msg of messages) {
      const jid = msg.key?.remoteJid;
      if (!jid?.endsWith("@s.whatsapp.net")) continue;
      const ts = msg.messageTimestamp;
      if (ts) {
        const existing = contacts.get(jid) || { id: jid };
        contacts.set(jid, { ...existing, lastMessageTs: Number(ts) });
        contactsDirty = true;
      }
    }
  });

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      currentQR = qr;
      console.log("\nscan this QR code with WhatsApp:\n");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      connected = true;
      currentQR = null;
      reconnectAttempt = 0;
      phoneNumber = sock.user?.id?.split(":")[0] || sock.user?.id;
      console.log(`connected as ${phoneNumber}`);
      flushPending();
    }

    if (connection === "close") {
      connected = false;
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;

      if (reason === DisconnectReason.loggedOut) {
        console.log("logged out — delete auth_info/ and re-scan QR");
        process.exit(1);
      }

      reconnectAttempt++;
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempt - 1), MAX_RECONNECT_DELAY);
      console.log(`disconnected (reason ${reason}), reconnecting in ${delay}ms...`);
      setTimeout(startWhatsApp, delay);
    }
  });
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        connected,
        phoneNumber,
        hasQR: !!currentQR,
        pendingMessages: pendingMessages.length,
      }),
    );
    return;
  }

  if (req.method === "GET" && req.url === "/qr") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ qr: currentQR, connected }));
    return;
  }

  if (req.method === "GET" && req.url?.startsWith("/contacts")) {
    const url = new URL(req.url, "http://localhost");
    const query = url.searchParams.get("q") || "";
    const results = query ? searchContacts(query) : searchContacts("");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(results.slice(0, 50)));
    return;
  }

  if (req.method === "POST" && req.url === "/send") {
    let body = "";
    for await (const chunk of req) body += chunk;

    try {
      const { text, filePath, caption, phoneNumber: targetPhone } = JSON.parse(body);

      if (!text && !filePath) {
        res.writeHead(400);
        res.end("Missing text or filePath");
        return;
      }

      if (filePath && !existsSync(filePath)) {
        res.writeHead(400);
        res.end(`File not found: ${filePath}`);
        return;
      }

      const jid = targetPhone
        ? `${targetPhone.replace(/[^0-9]/g, "")}@s.whatsapp.net`
        : sock?.user?.id;

      if (!jid) {
        res.writeHead(503);
        res.end("WhatsApp not connected and no phone number provided");
        return;
      }

      const payload = { text, filePath, caption };

      if (connected && sock) {
        await sendMsg(jid, payload);
      } else {
        pendingMessages.push({ jid, payload });
        console.log(`queued (offline): ${filePath || text}`);
      }

      res.writeHead(200);
      res.end("ok");
    } catch (err) {
      console.error("send error:", err);
      res.writeHead(500);
      res.end(err.message || "Send failed");
    }
    return;
  }

  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`daemon listening on http://127.0.0.1:${PORT}`);
  console.log("starting WhatsApp connection...");
});

startWhatsApp();
