export const PaperSharingSession = {
  user: null,
  initialized: false,

  async init() {
    if (this.initialized) {
      return this.user;
    }

    try {
      const response = await fetch("/api/auth/me");
      if (response.ok) {
        const data = await response.json();
        this.user = data.user || null;
      }
    } catch {
      this.user = null;
    }

    this.initialized = true;
    return this.user;
  },

  getUserName() {
    return this.user?.displayName || "";
  },

  async requireLogin(nextPath = currentPagePath()) {
    await this.init();
    if (this.user) {
      return this.user;
    }

    this.redirectToLogin(nextPath);
    return null;
  },

  async requireUserName(nextPath = currentPagePath()) {
    const user = await this.requireLogin(nextPath);
    return user?.displayName || "";
  },

  redirectToLogin(nextPath = currentPagePath()) {
    const next = normalizeNextPath(nextPath);
    window.location.href = `./login.html?next=${encodeURIComponent(next)}`;
  },

  async render(container) {
    await this.init();

    if (this.user) {
      container.innerHTML = `
        <span>当前身份：${escapeSessionHtml(this.user.displayName)}</span>
        <button class="small-button" type="button" data-logout>退出</button>
      `;

      container.querySelector("[data-logout]").addEventListener("click", async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        this.user = null;
        this.initialized = true;
        this.render(container);
        this.dispatchChange();
      });
      return;
    }

    container.innerHTML = `<a class="small-button" href="./login.html?next=${encodeURIComponent(currentPagePath())}">登录</a>`;
  },

  dispatchChange() {
    window.dispatchEvent(new CustomEvent("paper-sharing-user-change", { detail: { user: this.user, userName: this.getUserName() } }));
  },
};

window.PaperSharingSession = PaperSharingSession;

function currentPagePath() {
  return `${window.location.pathname.split("/").pop() || "reader.html"}${window.location.search || ""}`;
}

function normalizeNextPath(nextPath) {
  const value = String(nextPath || "reader.html").trim();
  if (!value || value.startsWith("http://") || value.startsWith("https://") || value.startsWith("//")) {
    return "reader.html";
  }
  return value.replace(/^\.?\//, "") || "reader.html";
}

function escapeSessionHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
