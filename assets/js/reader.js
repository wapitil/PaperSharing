import { PaperSharingSession } from "./session.js";
import { PaperSharingStorage } from "./storage.js";
import { renderRichTextDoc } from "./rich-editor.js";

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

const paperList = document.querySelector("#paperList");
const paperDetail = document.querySelector("#paperDetail");
const paperSearchInput = document.querySelector("#paperSearchInput");
const currentUserBox = document.querySelector("#currentUserBox");
let selectedPaperKey = "";
let savedNotes = [];

initReaderPage();

paperSearchInput.addEventListener("input", () => {
  selectedPaperKey = "";
  renderLibrary();
});

async function initReaderPage() {
  await PaperSharingSession.render(currentUserBox);
  savedNotes = await readSavedNotes();
  renderLibrary();
}

function renderLibrary() {
  const papers = sortPapersByRecentUpdate(filterPapers(groupByPaper(savedNotes), paperSearchInput.value));

  if (!papers.length) {
    paperList.innerHTML = `<p class="empty-state">没有匹配的论文。可以调整搜索词，或先去分享页保存一条。</p>`;
    paperDetail.innerHTML = "";
    return;
  }

  if (!selectedPaperKey || !papers.some((paper) => paper.key === selectedPaperKey)) {
    selectedPaperKey = papers[0].key;
  }

  paperList.innerHTML = papers
    .map(
      (paper) => `
        <button class="paper-list-item ${paper.key === selectedPaperKey ? "active" : ""}" type="button" data-paper-key="${escapeHtml(paper.key)}">
          <strong>${escapeHtml(paper.title)}</strong>
          <span>${paper.notes.length} 条经验</span>
        </button>
      `,
    )
    .join("");

  paperList.querySelectorAll("[data-paper-key]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedPaperKey = button.dataset.paperKey;
      renderLibrary();
    });
  });

  renderPaperDetail(papers.find((paper) => paper.key === selectedPaperKey));
}

function renderPaperDetail(paper) {
  const judgementCounts = countBy(paper.notes, "overallJudgement");

  paperDetail.innerHTML = `
    <article class="paper-detail-card">
      <header class="reader-paper-header">
        <h2>${escapeHtml(paper.title)}</h2>
        <p>${escapeHtml(joinText([paper.authors, paper.year, paper.link]))}</p>
      </header>

      <section class="reader-summary-grid">
        ${Object.keys(judgementText)
          .map(
            (key) => `
              <div class="summary-metric">
                <strong>${judgementCounts[key] || 0}</strong>
                <span>${escapeHtml(judgementText[key])}</span>
              </div>
            `,
          )
          .join("")}
      </section>

      <section class="reader-block">
        <h3>按分享者查看</h3>
        <div class="experience-list">
          ${sortNotesByUploadTime(paper.notes).map(renderExperienceCard).join("")}
        </div>
      </section>
    </article>
  `;
}

function renderExperienceCard(note) {
  return `
    <details class="experience-card">
      <summary class="experience-card-head">
        <div>
          <h4>${escapeHtml(note.contributorName || "未填写姓名")}</h4>
          <p>${escapeHtml(formatDateTime(note.uploadedAt))}</p>
        </div>
        <span>${escapeHtml(judgementText[note.overallJudgement] || "未判断")}</span>
      </summary>
      <div class="experience-card-body">
        ${renderTextBlock("为什么选择这一篇文章", note.choiceReasonDoc, note.choiceReason)}
        ${renderReadingPoints(note.readingPoints || [])}
        ${renderTextBlock("我的看法", note.personalUnderstandingDoc, note.personalUnderstanding)}
      </div>
    </details>
  `;
}

function renderTextBlock(title, doc, fallbackText = "") {
  const html = renderRichTextDoc(doc, fallbackText);
  if (!html) {
    return "";
  }

  return `
    <section class="reader-block compact-reader-block">
      <h5>${escapeHtml(title)}</h5>
      <div class="rich-content">${html}</div>
    </section>
  `;
}

function renderReadingPoints(points) {
  if (!points.length) {
    return "";
  }

  return `
    <section class="reader-block compact-reader-block">
      <h5>阅读时想记录的点</h5>
      <div class="experience-point-list">
        ${points
          .map(
            (point) => `
              <article class="experience-point">
                <strong>${escapeHtml(readingPointTypeText[point.type] || "阅读点")}</strong>
                <div class="rich-content">${renderRichTextDoc(point.contentDoc, point.content)}</div>
              </article>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
}

function groupByPaper(notes) {
  const groups = new Map();

  notes.forEach((note) => {
    const key = note.paperLink || note.paperIdentifier || note.paperTitle;
    if (!key) {
      return;
    }

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        title: note.paperTitle || "未命名论文",
        authors: note.paperAuthors || "",
        year: note.paperYear || "",
        link: note.paperLink || "",
        notes: [],
      });
    }

    groups.get(key).notes.push(note);
  });

  return [...groups.values()];
}

function filterPapers(papers, keyword) {
  const query = keyword.trim().toLowerCase();

  if (!query) {
    return papers;
  }

  return papers.filter((paper) =>
    [paper.title, paper.authors, paper.year, paper.link].some((value) =>
      String(value || "")
        .toLowerCase()
        .includes(query),
    ),
  );
}

function sortPapersByRecentUpdate(papers) {
  return papers.sort((a, b) => getLatestUploadTime(b.notes) - getLatestUploadTime(a.notes));
}

function sortNotesByUploadTime(notes) {
  return [...notes].sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0));
}

function getLatestUploadTime(notes) {
  return Math.max(...notes.map((note) => new Date(note.uploadedAt || 0).getTime()));
}

function countBy(items, key) {
  return items.reduce((counts, item) => {
    counts[item[key]] = (counts[item[key]] || 0) + 1;
    return counts;
  }, {});
}

function readSavedNotes() {
  return PaperSharingStorage.readNotes();
}

function joinText(parts) {
  return parts.filter(Boolean).join(" · ");
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
