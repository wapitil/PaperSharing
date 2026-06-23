import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.join(rootDir, "dist");
const dataDir = path.join(rootDir, "data");
const dbFile = process.env.DB_FILE ? path.resolve(rootDir, process.env.DB_FILE) : path.join(dataDir, "papersharing.sqlite");
const port = Number(process.env.PORT || 8000);
const sessionMaxAgeMs = 1000 * 60 * 60 * 24 * 14;
const maxRequestBodyBytes = 12_000_000;
const maxNoteDataBytes = 10_000_000;

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

await mkdir(dataDir, { recursive: true });
const db = new DatabaseSync(dbFile);
initDatabase();

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    if (url.pathname === "/api/health") {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (url.pathname === "/api/auth/register") {
      await handleRegister(request, response);
      return;
    }

    if (url.pathname === "/api/auth/login") {
      await handleLogin(request, response);
      return;
    }

    if (url.pathname === "/api/auth/logout") {
      await handleLogout(request, response);
      return;
    }

    if (url.pathname === "/api/auth/me") {
      await handleMe(request, response);
      return;
    }

    if (url.pathname === "/api/notes") {
      await handleNotes(request, response);
      return;
    }

    if (url.pathname === "/api/my-notes") {
      await handleMyNotes(request, response);
      return;
    }

    if (url.pathname.startsWith("/api/notes/")) {
      await handleSingleNote(request, response, decodeURIComponent(url.pathname.replace("/api/notes/", "")));
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      sendText(response, 405, "Method Not Allowed");
      return;
    }

    await serveStatic(url.pathname, request, response);
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: "服务器内部错误。" });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`PaperSharing server listening on http://127.0.0.1:${port}`);
});

function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
}

async function handleRegister(request, response) {
  if (request.method !== "POST") {
    sendText(response, 405, "Method Not Allowed");
    return;
  }

  const body = JSON.parse((await readRequestBody(request)) || "{}");
  const email = normalizeEmail(body.email);
  const displayName = String(body.displayName || "").trim();
  const password = String(body.password || "");

  if (!email || !displayName || password.length < 8) {
    sendJson(response, 400, { error: "请填写邮箱、显示名，并使用至少 8 位密码。" });
    return;
  }

  try {
    const user = {
      id: randomUUID(),
      email,
      displayName,
      role: "member",
      createdAt: new Date().toISOString(),
    };
    db.prepare(
      `INSERT INTO users (id, email, display_name, password_hash, role, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(user.id, user.email, user.displayName, hashPassword(password), user.role, user.createdAt);

    const session = createSession(user.id);
    setSessionCookie(response, session.id, session.expiresAt);
    sendJson(response, 201, { user });
  } catch (error) {
    if (String(error.message).includes("UNIQUE")) {
      sendJson(response, 409, { error: "这个邮箱已经注册。" });
      return;
    }
    throw error;
  }
}

async function handleLogin(request, response) {
  if (request.method !== "POST") {
    sendText(response, 405, "Method Not Allowed");
    return;
  }

  const body = JSON.parse((await readRequestBody(request)) || "{}");
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  const row = db.prepare("SELECT * FROM users WHERE email = ?").get(email);

  if (!row || !verifyPassword(password, row.password_hash)) {
    sendJson(response, 401, { error: "邮箱或密码不正确。" });
    return;
  }

  const session = createSession(row.id);
  setSessionCookie(response, session.id, session.expiresAt);
  sendJson(response, 200, { user: userFromRow(row) });
}

async function handleLogout(request, response) {
  if (request.method !== "POST") {
    sendText(response, 405, "Method Not Allowed");
    return;
  }

  const sessionId = getSessionId(request);
  if (sessionId) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
  }
  clearSessionCookie(response);
  sendJson(response, 200, { ok: true });
}

async function handleMe(request, response) {
  if (request.method !== "GET") {
    sendText(response, 405, "Method Not Allowed");
    return;
  }

  const user = getCurrentUser(request);
  sendJson(response, 200, { user });
}

async function handleNotes(request, response) {
  if (request.method === "GET") {
    sendJson(response, 200, readAllNotes());
    return;
  }

  if (request.method === "POST") {
    const user = requireUser(request, response);
    if (!user) {
      return;
    }

    const body = JSON.parse((await readRequestBody(request)) || "{}");
    if (!isAcceptableNotePayload(body)) {
      sendJson(response, 413, { error: "内容过大。请压缩图片后再发表。" });
      return;
    }
    const now = new Date().toISOString();
    const note = normalizeNoteForOwner(body, user, body.id || randomUUID(), now, now);

    db.prepare(
      `INSERT INTO notes (id, owner_user_id, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(note.id, user.id, JSON.stringify(note), now, now);

    sendJson(response, 201, note);
    return;
  }

  sendText(response, 405, "Method Not Allowed");
}

async function handleMyNotes(request, response) {
  if (request.method !== "GET") {
    sendText(response, 405, "Method Not Allowed");
    return;
  }

  const user = requireUser(request, response);
  if (!user) {
    return;
  }

  if (canManageAll(user)) {
    sendJson(response, 200, readAllNotes());
    return;
  }

  sendJson(response, 200, readNotesByOwner(user.id));
}

async function handleSingleNote(request, response, noteId) {
  const user = requireUser(request, response);
  if (!user) {
    return;
  }

  const row = db.prepare("SELECT * FROM notes WHERE id = ?").get(noteId);
  if (!row) {
    sendJson(response, 404, { error: "记录不存在。" });
    return;
  }

  if (!canEditNote(user, row)) {
    sendJson(response, 403, { error: "只能修改或删除自己发表的阅读经验。" });
    return;
  }

  if (request.method === "PUT") {
    const body = JSON.parse((await readRequestBody(request)) || "{}");
    if (!isAcceptableNotePayload(body)) {
      sendJson(response, 413, { error: "内容过大。请压缩图片后再保存。" });
      return;
    }
    const createdAt = row.created_at;
    const updatedAt = new Date().toISOString();
    const note = normalizeNoteForOwner({ ...JSON.parse(row.data), ...body }, userFromId(row.owner_user_id), row.id, createdAt, updatedAt);

    db.prepare("UPDATE notes SET data = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(note), updatedAt, row.id);
    sendJson(response, 200, note);
    return;
  }

  if (request.method === "DELETE") {
    db.prepare("DELETE FROM notes WHERE id = ?").run(row.id);
    sendJson(response, 200, { ok: true });
    return;
  }

  sendText(response, 405, "Method Not Allowed");
}

function readAllNotes() {
  return db
    .prepare("SELECT data FROM notes ORDER BY updated_at DESC")
    .all()
    .map((row) => JSON.parse(row.data));
}

function readNotesByOwner(ownerUserId) {
  return db
    .prepare("SELECT data FROM notes WHERE owner_user_id = ? ORDER BY updated_at DESC")
    .all(ownerUserId)
    .map((row) => JSON.parse(row.data));
}

function normalizeNoteForOwner(note, user, id, createdAt, updatedAt) {
  return {
    ...note,
    id,
    ownerUserId: user.id,
    ownerName: user.displayName,
    contributorName: user.displayName,
    createdAt: note.createdAt || createdAt,
    updatedAt,
  };
}

function isAcceptableNotePayload(note) {
  return Buffer.byteLength(JSON.stringify(note || {}), "utf8") <= maxNoteDataBytes;
}

function createSession(userId) {
  const session = {
    id: randomUUID(),
    userId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + sessionMaxAgeMs).toISOString(),
  };
  db.prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(
    session.id,
    session.userId,
    session.expiresAt,
    session.createdAt,
  );
  return session;
}

function getCurrentUser(request) {
  const sessionId = getSessionId(request);
  if (!sessionId) {
    return null;
  }

  const row = db
    .prepare(
      `SELECT users.*
       FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE sessions.id = ? AND sessions.expires_at > ?`,
    )
    .get(sessionId, new Date().toISOString());

  return row ? userFromRow(row) : null;
}

function requireUser(request, response) {
  const user = getCurrentUser(request);
  if (!user) {
    sendJson(response, 401, { error: "请先登录。" });
    return null;
  }
  return user;
}

function userFromId(userId) {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  return row ? userFromRow(row) : { id: userId, displayName: "未知用户", role: "member" };
}

function userFromRow(row) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
  };
}

function canManageAll(user) {
  return user.role === "admin";
}

function canEditNote(user, noteRow) {
  return canManageAll(user) || noteRow.owner_user_id === user.id;
}

async function serveStatic(pathname, request, response) {
  const normalizedPath = pathname === "/" ? "/reader.html" : decodeURIComponent(pathname);
  const filePath = path.normalize(path.join(staticDir, normalizedPath));

  if (!filePath.startsWith(staticDir)) {
    sendText(response, 403, "Forbidden");
    return;
  }

  try {
    const content = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
    });

    if (request.method === "HEAD") {
      response.end();
      return;
    }

    response.end(content);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EISDIR") {
      sendText(response, 404, "Not Found");
      return;
    }

    throw error;
  }
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > maxRequestBodyBytes) {
        request.destroy(new Error("请求体过大。"));
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, passwordHash) {
  const [algorithm, salt, hash] = String(passwordHash || "").split(":");
  if (algorithm !== "scrypt" || !salt || !hash) {
    return false;
  }

  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function setSessionCookie(response, sessionId, expiresAt) {
  response.setHeader("Set-Cookie", `ps_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(expiresAt).toUTCString()}`);
}

function clearSessionCookie(response) {
  response.setHeader("Set-Cookie", "ps_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
}

function getSessionId(request) {
  const cookie = String(request.headers.cookie || "");
  return (
    cookie
      .split(";")
      .map((item) => item.trim())
      .find((item) => item.startsWith("ps_session="))
      ?.replace("ps_session=", "") || ""
  );
}

function normalizeEmail(email) {
  const value = String(email || "").trim().toLowerCase();
  return value.includes("@") ? value : "";
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

function sendText(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
  });
  response.end(body);
}
