const STORAGE_KEY = "paper-sharing-notes";

const judgementText = {
  very_useful: "很有用",
  partial: "只用到一部分",
  not_helpful_yet: "暂时没帮上忙",
  unclear: "还没判断清楚",
};

const recordList = document.querySelector("#adminRecordList");
const adminStatus = document.querySelector("#adminStatus");

renderAdminRecords();

document.querySelector("#exportDataButton").addEventListener("click", exportData);
document.querySelector("#clearAllButton").addEventListener("click", () => {
  localStorage.removeItem(STORAGE_KEY);
  setStatus("已清空本地数据。");
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

    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    setStatus(`已导入 ${data.length} 条记录。`);
    renderAdminRecords();
  } catch (error) {
    setStatus(`导入失败：${error.message}`);
  } finally {
    event.target.value = "";
  }
});

recordList.addEventListener("click", (event) => {
  const deleteButton = event.target.closest("[data-delete-record]");
  if (!deleteButton) {
    return;
  }

  deleteRecord(deleteButton.dataset.deleteRecord);
});

function renderAdminRecords() {
  const notes = readSavedNotes();

  if (!notes.length) {
    recordList.innerHTML = `<p class="empty-state">还没有本地记录。</p>`;
    return;
  }

  recordList.innerHTML = notes
    .map(
      (note) => `
        <article class="admin-record-card">
          <div>
            <h2>${escapeHtml(note.paperTitle || "未命名论文")}</h2>
            <p>${escapeHtml([note.contributorName, judgementText[note.overallJudgement], formatDateTime(note.uploadedAt)].filter(Boolean).join(" · "))}</p>
          </div>
          <button class="small-button danger-button" type="button" data-delete-record="${escapeHtml(note.id || "")}">删除</button>
        </article>
      `,
    )
    .join("");
}

function deleteRecord(recordId) {
  if (!recordId) {
    setStatus("无法删除：记录缺少 ID。");
    return;
  }

  const nextNotes = readSavedNotes().filter((note) => note.id !== recordId);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(nextNotes));
  setStatus("已删除 1 条记录。");
  renderAdminRecords();
}

function exportData() {
  const notes = readSavedNotes();
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
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
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
