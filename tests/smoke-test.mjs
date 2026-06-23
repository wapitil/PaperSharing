import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const pages = [
  {
    file: "index.html",
    title: "添加阅读经验",
    requiredText: ["添加阅读经验", "识别论文", "当前身份", "阅读时想记录的点", "发表"],
  },
  {
    file: "reader.html",
    title: "论文阅读经验库",
    requiredText: ["论文阅读经验库", "搜索论文", "添加阅读经验"],
  },
  {
    file: "admin.html",
    title: "阅读经验管理",
    requiredText: ["阅读经验管理", "导出 JSON", "导入 JSON", "清空全部"],
  },
  {
    file: "login.html",
    title: "登录 - 论文阅读经验库",
    requiredText: ["登录后发表和管理阅读经验", "阅读库公开可看", "先去阅读库"],
  },
];

const scripts = [
  "assets/js/session.js",
  "assets/js/storage.js",
  "assets/js/rich-editor.js",
  "assets/js/app.js",
  "assets/js/reader.js",
  "assets/js/admin.js",
  "assets/js/login.js",
  "server.js",
  "vite.config.js",
];

const staticDomContracts = [
  {
    html: "index.html",
    script: "assets/js/app.js",
    generatedIds: new Set(),
  },
  {
    html: "reader.html",
    script: "assets/js/reader.js",
    generatedIds: new Set(),
  },
  {
    html: "admin.html",
    script: "assets/js/admin.js",
    generatedIds: new Set(),
  },
  {
    html: "login.html",
    script: "assets/js/login.js",
    generatedIds: new Set(),
  },
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function read(relativePath) {
  return readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function checkHtmlReferences() {
  for (const page of pages) {
    const html = read(page.file);

    assert(html.includes(`<title>${page.title}</title>`), `${page.file} 缺少正确 title`);

    for (const text of page.requiredText) {
      assert(html.includes(text), `${page.file} 缺少关键文案：${text}`);
    }

    const resourcePaths = [...html.matchAll(/(?:href|src)="\.\/([^"]+)"/g)].map((match) => match[1]);
    for (const resourcePath of resourcePaths) {
      assert(existsSync(path.join(projectRoot, resourcePath)), `${page.file} 引用了不存在的资源：${resourcePath}`);
    }
  }
}

function checkJavaScriptSyntax() {
  for (const script of scripts) {
    execFileSync("node", ["--check", script], {
      cwd: projectRoot,
      stdio: "pipe",
    });
  }
}

function checkFeatureMarkers() {
  const shareJs = read("assets/js/app.js");
  const readerJs = read("assets/js/reader.js");
  const adminJs = read("assets/js/admin.js");
  const sessionJs = read("assets/js/session.js");
  const storageJs = read("assets/js/storage.js");
  const loginJs = read("assets/js/login.js");
  const richEditorJs = read("assets/js/rich-editor.js");
  const css = read("assets/css/styles.css");

  assert(shareJs.includes("fetchOpenAlexMetadata"), "分享端缺少 OpenAlex 论文识别逻辑");
  assert(shareJs.includes("createSavedNote(note)"), "分享端保存应通过后端创建接口");
  assert(shareJs.includes("ownerName"), "分享端保存缺少记录归属字段");
  assert(!shareJs.includes("setUploadTime"), "分享端残留已删除的上传时间预览逻辑");
  assert(!shareJs.includes("showReaderButton"), "分享端残留已删除的预览按钮逻辑");
  assert(readerJs.includes("groupByPaper"), "阅读端缺少按论文聚合逻辑");
  assert(readerJs.includes("renderExperienceCard"), "阅读端缺少按分享者经验卡片");
  assert(readerJs.includes("按分享者查看"), "阅读端缺少按分享者查看标题");
  assert(adminJs.includes("startEditRecord"), "管理端缺少编辑入口");
  assert(adminJs.includes("renderEditForm"), "管理端缺少表单式编辑界面");
  assert(adminJs.includes("collectAdminEditPoints"), "管理端缺少阅读点保存逻辑");
  assert(adminJs.includes("编辑"), "管理端详情展开没有进入编辑模式");
  assert(!adminJs.includes("JSON.stringify(note, null, 2)"), "管理端不应再展示原始 JSON");
  assert(!adminJs.includes("renderImagePlaceholder"), "管理端不应保留图片占位逻辑");
  assert(!adminJs.includes("collectAdminImages"), "管理端不应保留图片保存占位逻辑");
  assert(adminJs.includes("readMyNotes"), "管理端应只读取当前身份的记录");
  assert(adminJs.includes("updateSavedNote"), "管理端应通过单条接口保存修改");
  assert(adminJs.includes("deleteSavedNote"), "管理端应通过单条接口删除记录");
  assert(sessionJs.includes("/api/auth/"), "身份模块缺少认证接口");
  assert(loginJs.includes("authMode") && loginJs.includes("register"), "登录页缺少登录/注册模式切换");
  assert(sessionJs.includes("/api/auth/me"), "身份模块缺少当前用户接口");
  assert(richEditorJs.includes("@tiptap/core"), "富文本模块缺少 TipTap 编辑器");
  assert(richEditorJs.includes("handlePaste"), "富文本模块缺少粘贴图片处理");
  assert(shareJs.includes("choiceReasonDoc"), "分享端缺少结构化选择原因字段");
  assert(shareJs.includes("contentDoc"), "分享端缺少结构化阅读点字段");
  assert(readerJs.includes("renderRichTextDoc"), "阅读端缺少富文本渲染");
  assert(adminJs.includes("createRichEditor"), "管理端缺少富文本编辑器复用");
  assert(storageJs.includes("/api/notes"), "共享存储层缺少后端 API 地址");
  assert(storageJs.includes("/api/my-notes"), "共享存储层缺少当前用户记录接口");
  assert(!storageJs.includes("X-User-Name"), "共享存储层不应再伪造身份请求头");
  assert(css.includes(".admin-inline-edit"), "样式缺少管理端内嵌编辑区域");
  assert(css.includes(".user-chip"), "样式缺少当前身份区域");
  assert(!css.includes(".image-edit-placeholder"), "样式不应保留图片占位入口");
  assert(css.includes(".nav-action"), "样式缺少顶部操作按钮统一样式");
}

function checkStaticDomContracts() {
  for (const contract of staticDomContracts) {
    const html = read(contract.html);
    const script = read(contract.script);
    const htmlIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
    const queriedIds = new Set([...script.matchAll(/querySelector(?:All)?\(["']#([A-Za-z][\w-]*)["']\)/g)].map((match) => match[1]));

    for (const id of queriedIds) {
      if (contract.generatedIds.has(id)) {
        continue;
      }

      assert(htmlIds.has(id), `${contract.script} 查询了 ${contract.html} 中不存在的静态元素：#${id}`);
    }
  }
}

async function requestPage(relativePath) {
  const url = `http://127.0.0.1:8000/${relativePath}`;

  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    });

    request.on("error", reject);
    request.setTimeout(1500, () => {
      request.destroy(new Error(`请求超时：${url}`));
    });
  });
}

async function checkLocalServerIfRunning() {
  try {
    execFileSync("npm", ["run", "build"], {
      cwd: projectRoot,
      stdio: "pipe",
    });

    const pageStatusCodes = await Promise.all(pages.map((page) => requestPage(page.file)));

    for (const [index, statusCode] of pageStatusCodes.entries()) {
      assert(statusCode === 200, `${pages[index].file} 本地服务返回 ${statusCode}`);
    }

    const resources = new Set();
    for (const page of pages) {
      const html = read(page.file);
      [...html.matchAll(/(?:href|src)="\.\/([^"]+)"/g)].forEach((match) => resources.add(match[1]));
    }

    const resourceStatusCodes = await Promise.all([...resources].map((resource) => requestPage(resource)));
    [...resources].forEach((resource, index) => {
      assert(resourceStatusCodes[index] === 200, `${resource} 本地服务返回 ${resourceStatusCodes[index]}`);
    });

    return "本地 8000 服务可访问";
  } catch (error) {
    return `跳过本地服务检查：${error.message}`;
  }
}

checkHtmlReferences();
checkJavaScriptSyntax();
checkFeatureMarkers();
checkStaticDomContracts();
const serverStatus = await checkLocalServerIfRunning();

console.log("smoke test passed");
console.log(serverStatus);
