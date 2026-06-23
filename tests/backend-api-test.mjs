import { execFileSync, spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 8123;
const testDbFile = path.join("data", "test-papersharing.sqlite");
const baseUrl = `http://127.0.0.1:${port}`;

await rm(path.join(projectRoot, testDbFile), { force: true });
execFileSync("npm", ["run", "build"], {
  cwd: projectRoot,
  stdio: "pipe",
});

const server = spawn(process.execPath, ["server.js"], {
  cwd: projectRoot,
  env: {
    ...process.env,
    DB_FILE: testDbFile,
    PORT: String(port),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

try {
  await waitForServer();

  let response = await fetch(`${baseUrl}/api/health`);
  assert(response.ok, "健康检查失败");

  response = await fetch(`${baseUrl}/api/notes`);
  assert(response.ok, "读取空 notes 失败");
  assert(JSON.stringify(await response.json()) === "[]", "初始 notes 应为空数组");

  const aliceCookie = await registerUser("alice@example.test", "Alice");
  const bobCookie = await registerUser("bob@example.test", "Bob");

  const note = {
    id: "test-note",
    paperTitle: "Test Paper",
    contributorName: "测试用户",
    uploadedAt: new Date("2026-06-18T00:00:00.000Z").toISOString(),
    overallJudgement: "unclear",
    choiceReasonDoc: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Rich text reason" }] }],
    },
    readingPoints: [
      {
        type: "important",
        order: 1,
        content: "Rich point",
        contentDoc: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Rich point" }] }],
        },
      },
    ],
    personalUnderstandingDoc: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Rich text understanding" }] }],
    },
  };

  response = await fetch(`${baseUrl}/api/notes`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: aliceCookie,
    },
    body: JSON.stringify(note),
  });
  assert(response.status === 201, "创建 note 失败");

  response = await fetch(`${baseUrl}/api/notes`);
  assert(response.ok, "再次读取 notes 失败");
  let notes = await response.json();
  assert(notes.length === 1 && notes[0].ownerName === "Alice", "创建后 ownerName 不正确");
  assert(notes[0].choiceReasonDoc?.type === "doc", "结构化富文本字段没有保存");

  response = await fetch(`${baseUrl}/api/my-notes`, {
    headers: {
      Cookie: aliceCookie,
    },
  });
  assert(response.ok, "读取 Alice 自己的 notes 失败");
  assert((await response.json()).length === 1, "Alice 应该能看到自己的记录");

  response = await fetch(`${baseUrl}/api/my-notes`, {
    headers: {
      Cookie: bobCookie,
    },
  });
  assert(response.ok, "读取 Bob 自己的 notes 失败");
  assert((await response.json()).length === 0, "Bob 不应该看到 Alice 的管理记录");

  response = await fetch(`${baseUrl}/api/notes/test-note`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Cookie: bobCookie,
    },
    body: JSON.stringify({ paperTitle: "Bob Changed" }),
  });
  assert(response.status === 403, "Bob 不应该能修改 Alice 的记录");

  response = await fetch(`${baseUrl}/api/notes/test-note`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Cookie: aliceCookie,
    },
    body: JSON.stringify({ paperTitle: "Alice Changed" }),
  });
  assert(response.ok, "Alice 应该能修改自己的记录");

  response = await fetch(`${baseUrl}/api/notes/test-note`, {
    method: "DELETE",
    headers: {
      Cookie: bobCookie,
    },
  });
  assert(response.status === 403, "Bob 不应该能删除 Alice 的记录");

  response = await fetch(`${baseUrl}/api/notes`);
  notes = await response.json();
  assert(notes[0].paperTitle === "Alice Changed", "Alice 修改后的标题没有保存");

  response = await fetch(`${baseUrl}/index.html`);
  assert(response.ok, "静态页面服务失败");

  console.log("backend api test passed");
} finally {
  server.kill();
  await rm(path.join(projectRoot, testDbFile), { force: true });
}

async function registerUser(email, displayName) {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, displayName, password: "password123" }),
  });

  assert(response.status === 201, `${displayName} 注册失败`);
  const setCookie = response.headers.get("set-cookie") || "";
  const sessionCookie = setCookie.split(";")[0];
  assert(sessionCookie.startsWith("ps_session="), `${displayName} 没有拿到 session cookie`);
  return sessionCookie;
}

async function waitForServer() {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 5000) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        return;
      }
    } catch {
      await delay(100);
    }
  }

  throw new Error("后端启动超时。");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
