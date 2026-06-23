import { PaperSharingSession } from "./session.js";
import { PaperSharingStorage } from "./storage.js";
import { createRichEditor, docFromText, isDocEmpty, plainTextFromDoc } from "./rich-editor.js";

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

const recordList = document.querySelector("#adminRecordList");
const adminStatus = document.querySelector("#adminStatus");
const currentUserBox = document.querySelector("#currentUserBox");
let editingRecordId = "";
let savedNotes = [];

initAdminPage();
window.addEventListener("paper-sharing-user-change", initAdminPage);

document.querySelector("#exportDataButton").addEventListener("click", exportData);
document.querySelector("#clearAllButton").addEventListener("click", async () => {
  await Promise.all(savedNotes.map((note) => deleteSavedNote(note.id)));
  savedNotes = [];
  closeEditPanel();
  setStatus("已清空当前身份的本地数据。");
  renderAdminRecords();
});

document.querySelector("#importDataInput").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!Array.isArray(data)) {
      throw new Error("JSON 根节点必须是数组。");
    }

    const userName = await ensureUserName();
    if (!userName) {
      return;
    }

    await Promise.all(data.map((note) => createSavedNote({ ...note, id: note.id || crypto.randomUUID(), ownerName: userName, contributorName: userName })));
    savedNotes = await readSavedNotes();
    closeEditPanel();
    setStatus(`已导入 ${data.length} 条记录。`);
    renderAdminRecords();
  } catch (error) {
    setStatus(`导入失败：${error.message}`);
  } finally {
    event.target.value = "";
  }
});

recordList.addEventListener("click", (event) => {
  const summary = event.target.closest("[data-record-summary]");
  if (summary) {
    const detail = summary.closest("[data-record-detail]");
    if (detail && !detail.open) {
      startEditRecord(detail.dataset.recordId);
    }
    return;
  }

  const deleteButton = event.target.closest("[data-delete-record]");
  if (!deleteButton) {
    return;
  }

  deleteRecord(deleteButton.dataset.deleteRecord);
});

async function initAdminPage() {
  await PaperSharingSession.render(currentUserBox);
  const user = await PaperSharingSession.requireLogin("admin.html");
  if (!user) {
    return;
  }
  savedNotes = await readSavedNotes();
  renderAdminRecords();
}

function renderAdminRecords() {
  const notes = savedNotes;

  if (!notes.length) {
    recordList.innerHTML = `<p class="empty-state">还没有本地记录。</p>`;
    return;
  }

  recordList.innerHTML = notes
    .map(
      (note) => `
        <article class="admin-record-card">
          <div class="admin-record-main">
            <div class="admin-record-head">
              <div>
                <h2>${escapeHtml(note.paperTitle || "未命名论文")}</h2>
                <p>${escapeHtml([note.contributorName, judgementText[note.overallJudgement], formatDateTime(note.uploadedAt)].filter(Boolean).join(" · "))}</p>
              </div>
              <div class="admin-record-actions">
                <button class="small-button danger-button" type="button" data-delete-record="${escapeAttribute(note.id)}">删除</button>
              </div>
            </div>
            <details class="admin-record-detail" data-record-detail data-record-id="${escapeAttribute(note.id)}">
              <summary data-record-summary>编辑</summary>
              <div class="admin-inline-edit" data-record-edit-body></div>
            </details>
          </div>
        </article>
      `,
    )
    .join("");
}

function startEditRecord(recordId) {
  const note = savedNotes.find((item) => item.id === recordId);
  const detail = recordList.querySelector(`[data-record-detail][data-record-id="${cssEscape(recordId)}"]`);
  const editBody = detail?.querySelector("[data-record-edit-body]");

  if (!note || !editBody) {
    setStatus("没有找到要编辑的记录。");
    return;
  }

  editingRecordId = recordId;
  editBody.innerHTML = renderEditForm(note);

  const form = editBody.querySelector("[data-admin-edit-form]");
  const pointList = editBody.querySelector("[data-admin-edit-point-list]");
  (note.readingPoints || []).forEach((point) => addAdminEditPoint(pointList, point));
  bindEditFormEvents(form);
}

// 管理端编辑表单复用分享端的字段结构，避免管理员直接改 JSON。
function renderEditForm(note) {
  return `
    <form class="admin-edit-form" data-admin-edit-form data-record-id="${escapeAttribute(note.id)}">
      <div class="admin-edit-header">
        <div>
          <p class="result-label">编辑记录</p>
          <h2>${escapeHtml(note.paperTitle || "未命名论文")}</h2>
        </div>
      </div>

      <section class="admin-edit-grid">
        <label class="field">
          <span>论文标题 <strong>*</strong></span>
          <input data-field="paperTitle" value="${escapeAttribute(note.paperTitle)}" required />
        </label>
        <label class="field">
          <span>当前身份 <strong>*</strong></span>
          <input data-field="contributorName" value="${escapeAttribute(note.contributorName)}" required />
        </label>
        <label class="field">
          <span>作者</span>
          <input data-field="paperAuthors" value="${escapeAttribute(note.paperAuthors)}" />
        </label>
        <label class="field">
          <span>年份</span>
          <input data-field="paperYear" value="${escapeAttribute(note.paperYear)}" />
        </label>
        <label class="field admin-edit-full">
          <span>论文链接</span>
          <input data-field="paperLink" value="${escapeAttribute(note.paperLink)}" />
        </label>
      </section>

      <section class="admin-edit-section">
        <h3>我的整体判断</h3>
        <div class="judgement-options">
          ${Object.keys(judgementText)
            .map(
              (key) => `
                <label>
                  <input type="radio" name="editOverallJudgement" value="${key}" ${note.overallJudgement === key ? "checked" : ""} />
                  <span>${escapeHtml(judgementText[key])}</span>
                </label>
              `,
            )
            .join("")}
        </div>
      </section>

      <section class="admin-edit-section">
        <h3>为什么选择这一篇文章</h3>
        <div class="rich-editor" data-field="choiceReason"></div>
      </section>

      <section class="admin-edit-section">
        <h3>阅读时想记录的点</h3>
        <div class="point-add-toolbar">
          ${Object.keys(readingPointTypeText)
            .map((type) => `<button class="small-button" type="button" data-admin-add-point="${type}">${escapeHtml(readingPointTypeText[type])}</button>`)
            .join("")}
        </div>
        <div class="reading-point-list" data-admin-edit-point-list></div>
      </section>

      <section class="admin-edit-section">
        <h3>我的看法</h3>
        <div class="rich-editor" data-field="personalUnderstanding"></div>
      </section>

      <div class="form-actions admin-edit-actions">
        <button class="primary-button" type="submit">保存修改</button>
      </div>
    </form>
  `;
}

function bindEditFormEvents(form) {
  const pointList = form.querySelector("[data-admin-edit-point-list]");
  form.choiceReasonEditor = createRichEditor({
    element: form.querySelector('[data-field="choiceReason"]'),
    content: currentEditNote(form).choiceReasonDoc || docFromText(currentEditNote(form).choiceReason || ""),
  });
  form.personalUnderstandingEditor = createRichEditor({
    element: form.querySelector('[data-field="personalUnderstanding"]'),
    content: currentEditNote(form).personalUnderstandingDoc || docFromText(currentEditNote(form).personalUnderstanding || ""),
  });

  form.querySelectorAll("[data-admin-add-point]").forEach((button) => {
    button.addEventListener("click", () => {
      addAdminEditPoint(pointList, { type: button.dataset.adminAddPoint });
    });
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    saveEditedRecord(form);
  });
}

function addAdminEditPoint(pointList, point = {}) {
  const node = document.createElement("article");
  const type = point.type || "stuck";
  const maxOrder = getMaxPointOrder(pointList);
  const order = point.order || maxOrder + 1;

  node.className = "reading-point";
  node.dataset.adminEditPoint = "";
  node.dataset.type = type;
  node.dataset.order = order;
  node.innerHTML = `
    <div class="reading-point-head">
      <h3>${escapeHtml(readingPointTypeText[type])}</h3>
      <button class="icon-button" type="button" data-remove-admin-point title="删除这一条">×</button>
    </div>
    <div class="rich-editor" data-field="content"></div>
  `;
  node.richEditor = createRichEditor({
    element: node.querySelector('[data-field="content"]'),
    content: point.contentDoc || docFromText(point.content || ""),
  });

  node.querySelector("[data-remove-admin-point]").addEventListener("click", () => {
    node.remove();
  });

  // 编辑时新条目放在最前，保存时仍按 order 恢复阅读端展示顺序。
  pointList.prepend(node);
}

async function saveEditedRecord(form) {
  const notes = [...savedNotes];
  const recordId = form.dataset.recordId;
  const index = notes.findIndex((note) => note.id === recordId);

  if (index === -1 || !form) {
    setStatus("保存失败：记录不存在。");
    return;
  }

  const original = notes[index];
  const updated = {
    ...original,
    paperTitle: valueOf(form, "paperTitle"),
    contributorName: valueOf(form, "contributorName"),
    paperAuthors: valueOf(form, "paperAuthors"),
    paperYear: valueOf(form, "paperYear"),
    paperLink: valueOf(form, "paperLink"),
    overallJudgement: getRadioValue(form, "editOverallJudgement"),
    choiceReason: plainTextFromDoc(form.choiceReasonEditor.getJSON()),
    choiceReasonDoc: form.choiceReasonEditor.getJSON(),
    readingPoints: collectAdminEditPoints(form),
    personalUnderstanding: plainTextFromDoc(form.personalUnderstandingEditor.getJSON()),
    personalUnderstandingDoc: form.personalUnderstandingEditor.getJSON(),
  };

  if (!updated.paperTitle || !updated.contributorName) {
    setStatus("保存失败：论文标题和当前身份不能为空。");
    return;
  }

  notes[index] = updated;
  savedNotes = notes;
  await updateSavedNote(updated);
  setStatus("已保存修改。");
  savedNotes = await readSavedNotes();
  renderAdminRecords();
}

function collectAdminEditPoints(form) {
  // DOM 顺序是编辑顺序，阅读展示顺序以最初添加顺序为准。
  return [...form.querySelectorAll("[data-admin-edit-point]")]
    .sort((a, b) => (Number(a.dataset.order) || 0) - (Number(b.dataset.order) || 0))
    .map((item) => ({
      type: item.dataset.type,
      order: Number(item.dataset.order) || 0,
      content: plainTextFromDoc(item.richEditor.getJSON()),
      contentDoc: item.richEditor.getJSON(),
    }))
    .filter((point) => point.content || !isDocEmpty(point.contentDoc));
}

function closeEditPanel() {
  editingRecordId = "";
  recordList.querySelectorAll("[data-record-edit-body]").forEach((body) => {
    const form = body.querySelector("[data-admin-edit-form]");
    destroyEditFormEditors(form);
    body.innerHTML = "";
  });
}

async function deleteRecord(recordId) {
  if (!recordId) {
    setStatus("无法删除：记录缺少 ID。");
    return;
  }

  const nextNotes = savedNotes.filter((note) => note.id !== recordId);
  savedNotes = nextNotes;
  await deleteSavedNote(recordId);
  if (editingRecordId === recordId) {
    closeEditPanel();
  }
  setStatus("已删除 1 条记录。");
  renderAdminRecords();
}

function exportData() {
  const notes = savedNotes;
  const blob = new Blob([JSON.stringify(notes, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `paper-sharing-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  setStatus(`已导出 ${notes.length} 条记录。`);
}

function setStatus(message) {
  adminStatus.textContent = message;
}

function readSavedNotes() {
  return PaperSharingStorage.readMyNotes();
}

function createSavedNote(note) {
  return PaperSharingStorage.createNote(note);
}

function updateSavedNote(note) {
  return PaperSharingStorage.updateNote(note);
}

function deleteSavedNote(noteId) {
  return PaperSharingStorage.deleteNote(noteId);
}

async function ensureUserName(promptIfMissing = true) {
  return promptIfMissing ? PaperSharingSession.requireUserName() : PaperSharingSession.getUserName();
}

function currentEditNote(form) {
  return savedNotes.find((note) => note.id === form.dataset.recordId) || {};
}

function destroyEditFormEditors(form) {
  if (!form) {
    return;
  }

  form.choiceReasonEditor?.destroy();
  form.personalUnderstandingEditor?.destroy();
  form.querySelectorAll("[data-admin-edit-point]").forEach((item) => {
    item.richEditor?.destroy();
  });
}

function getMaxPointOrder(pointList) {
  return Math.max(0, ...[...pointList.querySelectorAll("[data-admin-edit-point]")].map((item) => Number(item.dataset.order) || 0));
}

function valueOf(form, fieldName) {
  return form.querySelector(`[data-field="${fieldName}"]`)?.value.trim() || "";
}

function getRadioValue(form, name) {
  return form.querySelector(`input[name="${name}"]:checked`)?.value || "";
}

function formatDateTime(dateString) {
  if (!dateString) {
    return "未保存";
  }

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

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("\n", " ");
}

function cssEscape(value) {
  if (window.CSS?.escape) {
    return CSS.escape(value || "");
  }

  return String(value || "").replaceAll('"', '\\"');
}
