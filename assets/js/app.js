import { PaperSharingSession } from "./session.js";
import { PaperSharingStorage } from "./storage.js";
import { createRichEditor, docFromText, isDocEmpty, plainTextFromDoc, renderRichTextDoc } from "./rich-editor.js";

const judgementText = {
  very_useful: "很有用",
  partial: "只用到一部分",
  not_helpful_yet: "暂时没帮上忙",
  unclear: "还没判断清楚",
};

const readingPointTypeText = {
  stuck: "我卡住的地方",
  important: "我觉得重要的地方",
  uncertain: "我不确定的判断",
  misunderstanding: "容易误解的点",
  research_related: "和自己课题有关的点",
  experiment: "复现/实验注意事项",
};

const form = document.querySelector("#shareForm");
const readerPage = document.querySelector("#readerPage");
const lookupButton = document.querySelector("#lookupButton");
const lookupStatus = document.querySelector("#lookupStatus");
const manualPaperFields = document.querySelector("#manualPaperFields");
const togglePaperFieldsButton = document.querySelector("#togglePaperFieldsButton");
const readingPointList = document.querySelector("#readingPointList");
const currentUserBox = document.querySelector("#currentUserBox");
const draftStorageKey = "paper-sharing-editor-draft";
let readingPointOrder = 0;
let choiceReasonEditor;
let personalUnderstandingEditor;

initSharePage();

async function initSharePage() {
  await PaperSharingSession.render(currentUserBox);
  initBaseEditors();
  restoreDraft();
  syncContributorName();
  renderPaperResult();
  renderReader();
}

window.addEventListener("paper-sharing-user-change", syncContributorName);

document.querySelectorAll("[data-add-point]").forEach((button) => {
  button.addEventListener("click", () => {
    addReadingPoint({ type: button.dataset.addPoint });
    renderReader();
  });
});

document.querySelector("#resetButton").addEventListener("click", () => {
  form.reset();
  readingPointList.replaceChildren();
  choiceReasonEditor.commands.clearContent();
  personalUnderstandingEditor.commands.clearContent();
  setRadioValue("overallJudgement", "very_useful");
  setLookupStatus("等待输入论文标识。");
  renderPaperResult();
  renderReader();
});

document.querySelector("#backToEditorButton").addEventListener("click", () => {
  showView("editor");
});

lookupButton.addEventListener("click", lookupPaper);

togglePaperFieldsButton.addEventListener("click", () => {
  manualPaperFields.hidden = !manualPaperFields.hidden;
  togglePaperFieldsButton.textContent = manualPaperFields.hidden ? "手动修正" : "收起修正";
});

form.addEventListener("input", () => {
  renderPaperResult();
  renderReader();
});

form.addEventListener("change", () => {
  updateReadingPointTitles();
  renderPaperResult();
  renderReader();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const userName = await PaperSharingSession.requireUserName();
  if (!userName) {
    saveDraft();
    setLookupStatus("正在前往登录页。", "error");
    return;
  }
  setValue("contributorName", userName);

  if (!validateBeforeSave()) {
    return;
  }

  // 保存时由后端绑定 ownerName；本地回退也使用同一份 Note 结构。
  const note = collectFormData();
  note.id = crypto.randomUUID();
  note.ownerName = userName;
  note.contributorName = userName;
  note.uploadedAt = new Date().toISOString();

  await createSavedNote(note);
  sessionStorage.removeItem(draftStorageKey);

  renderReader(note);
  showView("reader");
});

async function lookupPaper() {
  const identifier = valueOf("paperIdentifier");

  if (!identifier) {
    setLookupStatus("请先粘贴 DOI、arXiv ID 或论文链接。", "error");
    return;
  }

  setLookupStatus("正在识别论文...");
  lookupButton.disabled = true;

  try {
    const paper = await fetchPaperMetadata(identifier);
    fillPaperFields(paper);
    manualPaperFields.hidden = true;
    togglePaperFieldsButton.textContent = "手动修正";
    setLookupStatus("已识别论文。", "success");
  } catch (error) {
    setLookupStatus(error.message || "识别失败，请手动修正论文信息。", "error");
    manualPaperFields.hidden = false;
    togglePaperFieldsButton.textContent = "收起修正";
  } finally {
    lookupButton.disabled = false;
    renderPaperResult();
    renderReader();
  }
}

async function fetchPaperMetadata(identifier) {
  const arxivId = extractArxivId(identifier);

  if (arxivId) {
    return fetchArxivMetadata(arxivId);
  }

  const doi = extractDoi(identifier);

  if (doi) {
    const arxivIdFromDoi = extractArxivIdFromDoi(doi);
    if (arxivIdFromDoi) {
      return fetchArxivMetadata(arxivIdFromDoi);
    }

    return fetchDoiMetadata(doi);
  }

  throw new Error("没有识别出 DOI 或 arXiv ID，请检查输入。");
}

async function fetchArxivMetadata(arxivId) {
  try {
    return await fetchOpenAlexMetadata(`10.48550/arXiv.${arxivId}`);
  } catch {
    // OpenAlex 对浏览器跨域更友好；如果查不到，再退回 arXiv 官方接口。
  }

  const url = `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("arXiv 识别失败，请稍后再试或手动填写。");
  }

  const xmlText = await response.text();
  const xml = new DOMParser().parseFromString(xmlText, "application/xml");
  const entry = xml.querySelector("entry");

  if (!entry) {
    throw new Error("arXiv 没有返回论文信息，请手动填写。");
  }

  const title = textFrom(entry, "title").replace(/\s+/g, " ");
  const authors = [...entry.querySelectorAll("author name")].map((node) => node.textContent.trim());
  const published = textFrom(entry, "published");

  return {
    paperTitle: title,
    paperAuthors: authors.join(", "),
    paperYear: published ? new Date(published).getFullYear().toString() : "",
    paperLink: `https://arxiv.org/abs/${arxivId}`,
  };
}

async function fetchDoiMetadata(doi) {
  try {
    return await fetchOpenAlexMetadata(doi);
  } catch {
    // Crossref 作为后备源；部分 arXiv DOI 在 Crossref 中不可用。
  }

  const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("DOI 识别失败，请稍后再试或手动填写。");
  }

  const data = await response.json();
  const item = data.message;
  const authors = (item.author || [])
    .map((author) => joinText([author.given, author.family], " "))
    .filter(Boolean);
  const year = item.published?.["date-parts"]?.[0]?.[0] || item.issued?.["date-parts"]?.[0]?.[0] || "";

  return {
    paperTitle: item.title?.[0] || "",
    paperAuthors: authors.join(", "),
    paperYear: year ? String(year) : "",
    paperLink: item.URL || `https://doi.org/${doi}`,
  };
}

async function fetchOpenAlexMetadata(doi) {
  const normalizedDoi = doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
  const url = `https://api.openalex.org/works/https://doi.org/${encodeURIComponent(normalizedDoi)}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("OpenAlex 识别失败。");
  }

  const item = await response.json();
  const authors = (item.authorships || [])
    .map((authorship) => authorship.author?.display_name)
    .filter(Boolean);
  const arxivId = item.doi ? extractArxivIdFromDoi(item.doi) : "";

  return {
    paperTitle: item.display_name || item.title || "",
    paperAuthors: authors.join(", "),
    paperYear: item.publication_year ? String(item.publication_year) : "",
    paperLink: arxivId ? `https://arxiv.org/abs/${arxivId}` : item.doi || item.primary_location?.landing_page_url || "",
  };
}

function extractArxivId(input) {
  const value = input.trim();
  const match = value.match(/arxiv\.org\/(?:abs|pdf)\/([0-9]{4}\.[0-9]{4,5})(?:v\d+)?/i);
  const plain = value.match(/^([0-9]{4}\.[0-9]{4,5})(?:v\d+)?$/i);
  const legacy = value.match(/arxiv:([a-z-]+\/[0-9]{7}|[0-9]{4}\.[0-9]{4,5})(?:v\d+)?/i);
  const arxivDoi = extractArxivIdFromDoi(value);

  return match?.[1] || plain?.[1] || legacy?.[1] || arxivDoi || "";
}

function extractArxivIdFromDoi(input) {
  const match = input.match(/10\.48550\/arxiv\.([0-9]{4}\.[0-9]{4,5}|[a-z-]+\/[0-9]{7})(?:v\d+)?/i);
  return match?.[1] || "";
}

function extractDoi(input) {
  const value = input.trim();
  const match = value.match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i);
  return match ? match[0].replace(/[.,;]+$/, "") : "";
}

function fillPaperFields(paper) {
  setValue("paperTitle", paper.paperTitle);
  setValue("paperAuthors", paper.paperAuthors);
  setValue("paperYear", paper.paperYear);
  setValue("paperLink", paper.paperLink);
}

function addReadingPoint(values = {}) {
  const template = document.querySelector("#readingPointTemplate");
  const node = template.content.firstElementChild.cloneNode(true);
  node.dataset.type = values.type || "stuck";
  node.dataset.order = values.order || String(++readingPointOrder);
  node.richEditor = createRichEditor({
    element: node.querySelector('[data-field="content"]'),
    content: values.contentDoc || docFromText(values.content || ""),
    onUpdate: renderReader,
  });
  readingPointOrder = Math.max(readingPointOrder, Number(node.dataset.order) || 0);

  // 阅读点只有类型和正文。类型由添加按钮决定，标题编号根据同类条目自动更新。
  node.querySelector("[data-remove]").addEventListener("click", () => {
    node.remove();
    updateReadingPointTitles();
    renderReader();
  });

  readingPointList.prepend(node);
  updateReadingPointTitles();
}

function initBaseEditors() {
  choiceReasonEditor = createRichEditor({
    element: document.querySelector("#choiceReason"),
    content: docFromText(""),
    onUpdate: renderReader,
  });
  personalUnderstandingEditor = createRichEditor({
    element: document.querySelector("#personalUnderstanding"),
    content: docFromText(""),
    onUpdate: renderReader,
  });
}

function updateReadingPointTitles() {
  const counts = {};
  getReadingPointNodesInReadingOrder().forEach((item) => {
    const type = item.dataset.type;
    counts[type] = (counts[type] || 0) + 1;
    item.querySelector("[data-title]").textContent = `${readingPointTypeText[type]} ${counts[type]}`;
  });
}

function collectFormData() {
  // 页面所有输入都汇总成一个 Note 对象，后续接后端时可以直接沿用这个结构。
  return {
    paperIdentifier: valueOf("paperIdentifier"),
    paperTitle: valueOf("paperTitle"),
    paperAuthors: valueOf("paperAuthors"),
    paperYear: valueOf("paperYear"),
    paperLink: valueOf("paperLink"),
    contributorName: valueOf("contributorName"),
    uploadedAt: "",
    overallJudgement: getRadioValue("overallJudgement"),
    choiceReason: plainTextFromDoc(choiceReasonEditor.getJSON()),
    choiceReasonDoc: choiceReasonEditor.getJSON(),
    readingPoints: collectReadingPoints(),
    personalUnderstanding: plainTextFromDoc(personalUnderstandingEditor.getJSON()),
    personalUnderstandingDoc: personalUnderstandingEditor.getJSON(),
  };
}

function syncContributorName() {
  const userName = PaperSharingSession.getUserName();
  if (userName) {
    setValue("contributorName", userName);
  }
}

function collectReadingPoints() {
  return getReadingPointNodesInReadingOrder()
    .map((item) => ({
      type: item.dataset.type,
      order: Number(item.dataset.order) || 0,
      content: plainTextFromDoc(item.richEditor.getJSON()),
      contentDoc: item.richEditor.getJSON(),
    }))
    .filter((item) => item.content || !isDocEmpty(item.contentDoc));
}

function fillForm(note) {
  setValue("paperIdentifier", note.paperIdentifier);
  setValue("paperTitle", note.paperTitle);
  setValue("paperAuthors", note.paperAuthors);
  setValue("paperYear", note.paperYear);
  setValue("paperLink", note.paperLink);
  setValue("contributorName", note.contributorName);
  setRadioValue("overallJudgement", note.overallJudgement);
  choiceReasonEditor.commands.setContent(note.choiceReasonDoc || docFromText(note.choiceReason || ""));
  personalUnderstandingEditor.commands.setContent(note.personalUnderstandingDoc || docFromText(note.personalUnderstanding || ""));

  readingPointList.replaceChildren();
  readingPointOrder = 0;
  (note.readingPoints || []).forEach((item) => addReadingPoint(item));
}

function saveDraft() {
  try {
    sessionStorage.setItem(draftStorageKey, JSON.stringify(collectFormData()));
  } catch {
    // Draft recovery is best effort.
  }
}

function restoreDraft() {
  try {
    const draft = JSON.parse(sessionStorage.getItem(draftStorageKey) || "null");
    if (!draft) {
      return;
    }

    fillForm(draft);
    setLookupStatus("已恢复登录前的草稿。", "success");
  } catch {
    sessionStorage.removeItem(draftStorageKey);
  }
}

function validateBeforeSave() {
  if (!valueOf("paperIdentifier")) {
    setLookupStatus("请先填写 DOI、arXiv ID 或论文链接。", "error");
    return false;
  }

  if (!valueOf("paperTitle")) {
    manualPaperFields.hidden = false;
    togglePaperFieldsButton.textContent = "收起修正";
    setLookupStatus("请先识别论文，或手动填写论文标题。", "error");
    return false;
  }

  if (!valueOf("contributorName")) {
    document.querySelector("#contributorName").focus();
    return false;
  }

  if (!hasExperienceContent()) {
    setLookupStatus("请至少填写选择原因、一个阅读点或我的看法。", "error");
    return false;
  }

  return true;
}

function hasExperienceContent() {
  return Boolean(!isDocEmpty(choiceReasonEditor.getJSON()) || !isDocEmpty(personalUnderstandingEditor.getJSON()) || collectReadingPoints().length);
}

function renderPaperResult() {
  const title = valueOf("paperTitle");
  const meta = joinText([valueOf("paperAuthors"), valueOf("paperYear"), valueOf("paperLink")]);

  document.querySelector("#resultTitle").textContent = title || "尚未识别论文";
  document.querySelector("#resultMeta").textContent = meta || "输入 DOI / arXiv 后会自动补全标题、作者和年份。";
}

function renderReader(note = collectFormData()) {
  const title = note.paperTitle || "未填写论文标题";
  const contributor = note.contributorName || "未填写姓名";
  const uploadedAt = note.uploadedAt ? formatDateTime(note.uploadedAt) : "未保存";

  readerPage.innerHTML = `
    <header class="reader-paper-header">
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(joinText([note.paperAuthors, note.paperYear, note.paperLink])) || "论文信息待补充"}</p>
    </header>

    <section class="reader-note-header">
      <h3>${escapeHtml(contributor)}的阅读经验</h3>
      <div class="reader-meta">
        <span>${escapeHtml(judgementText[note.overallJudgement])}</span>
        <span>上传时间：${escapeHtml(uploadedAt)}</span>
      </div>
    </section>

    ${renderTextBlock("为什么选择这一篇文章", note.choiceReasonDoc, note.choiceReason)}
    ${renderReadingPoints(note.readingPoints)}
    ${renderTextBlock("我怎么理解这篇文章", note.personalUnderstandingDoc, note.personalUnderstanding)}
  `;
}

function renderTextBlock(title, doc, fallbackText = "") {
  const html = renderRichTextDoc(doc, fallbackText);
  if (!html) {
    return "";
  }

  return `
    <section class="reader-block">
      <h3>${escapeHtml(title)}</h3>
      <div class="rich-content">${html}</div>
    </section>
  `;
}

function renderReadingPoints(points) {
  const grouped = groupReadingPoints(points);
  const types = Object.keys(grouped);

  if (!types.length) {
    return "";
  }

  return `
    <section class="reader-block">
      <h3>阅读时想记录的点</h3>
      <div class="reader-point-groups">
        ${types
          .map(
            (type) => `
              <section class="reader-point-group">
                <h4>${escapeHtml(readingPointTypeText[type])}</h4>
                <ol>
                  ${grouped[type].map((point) => `<li><div class="rich-content">${renderRichTextDoc(point.contentDoc, point.content)}</div></li>`).join("")}
                </ol>
              </section>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
}

function groupReadingPoints(points) {
  return points.reduce((groups, point) => {
    if (!groups[point.type]) {
      groups[point.type] = [];
    }
    groups[point.type].push(point);
    return groups;
  }, {});
}

function showView(viewName) {
  document.querySelector("#editorView").classList.toggle("active", viewName === "editor");
  document.querySelector("#readerView").classList.toggle("active", viewName === "reader");
}

function getReadingPointNodesInReadingOrder() {
  return [...readingPointList.querySelectorAll("[data-reading-point]")].sort(
    (a, b) => (Number(a.dataset.order) || 0) - (Number(b.dataset.order) || 0),
  );
}

function setLookupStatus(message, type = "") {
  lookupStatus.textContent = message;
  lookupStatus.className = `lookup-status ${type}`.trim();
}

function readSavedNotes() {
  return PaperSharingStorage.readNotes();
}

function createSavedNote(note) {
  return PaperSharingStorage.createNote(note);
}

function valueOf(id) {
  return document.querySelector(`#${id}`).value.trim();
}

function setValue(id, value) {
  document.querySelector(`#${id}`).value = value || "";
}

function getRadioValue(name) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value || "";
}

function setRadioValue(name, value) {
  const radio = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (radio) {
    radio.checked = true;
  }
}

function textFrom(root, selector) {
  return root.querySelector(selector)?.textContent.trim() || "";
}

function joinText(parts, separator = " · ") {
  return parts.filter(Boolean).join(separator);
}

function formatDateTime(dateString) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(dateString));
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
