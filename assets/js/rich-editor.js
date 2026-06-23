import { Editor } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { Fragment, Slice } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import { generateHTML } from "@tiptap/html";

const extensions = [
  StarterKit,
  Image.configure({
    allowBase64: true,
    HTMLAttributes: {
      class: "rich-content-image",
    },
  }),
];

const emptyDoc = { type: "doc", content: [{ type: "paragraph" }] };
const maxPastedImageBytes = 3 * 1024 * 1024;

export function createRichEditor({ element, content, onUpdate }) {
  return new Editor({
    element,
    extensions,
    content: normalizeDoc(content),
    editorProps: {
      attributes: {
        class: "rich-editor-content rich-content",
      },
      handlePaste(view, event) {
        const files = [...(event.clipboardData?.files || [])].filter((file) => file.type.startsWith("image/"));
        if (!files.length) {
          const text = event.clipboardData?.getData("text/plain") || "";
          if (!text) {
            return false;
          }

          event.preventDefault();
          insertPlainText(view, text);
          return true;
        }

        event.preventDefault();
        files.forEach((file) => insertImageFile(view, file));
        return true;
      },
    },
    onUpdate: ({ editor }) => onUpdate?.(editor),
  });
}

export function docFromText(text) {
  const value = String(text || "").trim();
  if (!value) {
    return cloneEmptyDoc();
  }

  return {
    type: "doc",
    content: value.split(/\n{2,}/).map((paragraph) => ({
      type: "paragraph",
      content: [{ type: "text", text: paragraph.replace(/\n/g, " ") }],
    })),
  };
}

export function normalizeDoc(doc, fallbackText = "") {
  if (doc?.type === "doc") {
    return doc;
  }
  return docFromText(fallbackText);
}

export function isDocEmpty(doc) {
  return !plainTextFromDoc(doc) && !hasImage(doc);
}

export function plainTextFromDoc(doc) {
  const parts = [];
  walkDoc(normalizeDoc(doc), (node) => {
    if (node.type === "text" && node.text) {
      parts.push(node.text);
    }
  });
  return parts.join(" ").trim();
}

export function renderRichTextDoc(doc, fallbackText = "") {
  const normalized = normalizeDoc(doc, fallbackText);
  if (isDocEmpty(normalized)) {
    return "";
  }
  return generateHTML(normalized, extensions);
}

function insertImageFile(view, file) {
  if (file.size > maxPastedImageBytes) {
    window.alert("单张图片不能超过 3MB。请先压缩后再粘贴。");
    return;
  }

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    const src = reader.result;
    const node = view.state.schema.nodes.image.create({ src, alt: file.name });
    const transaction = view.state.tr.replaceSelectionWith(node).scrollIntoView();
    view.dispatch(transaction);
  });
  reader.readAsDataURL(file);
}

function insertPlainText(view, text) {
  const paragraphs = String(text)
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\n/g, " ").trim())
    .filter(Boolean);

  if (!paragraphs.length) {
    return;
  }

  const { schema } = view.state;
  const nodes = paragraphs.map((paragraph) => schema.nodes.paragraph.create(null, schema.text(paragraph)));
  const slice = new Slice(Fragment.fromArray(nodes), 0, 0);
  const transaction = view.state.tr.replaceSelection(slice);
  view.dispatch(transaction.scrollIntoView());
}

function hasImage(doc) {
  let found = false;
  walkDoc(normalizeDoc(doc), (node) => {
    if (node.type === "image" && node.attrs?.src) {
      found = true;
    }
  });
  return found;
}

function walkDoc(node, visit) {
  visit(node);
  (node.content || []).forEach((child) => walkDoc(child, visit));
}

function cloneEmptyDoc() {
  return JSON.parse(JSON.stringify(emptyDoc));
}
