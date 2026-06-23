import { PaperSharingSession } from "./session.js";

const form = document.querySelector("#loginForm");
const emailInput = document.querySelector("#email");
const passwordInput = document.querySelector("#password");
const displayNameField = document.querySelector("#displayNameField");
const displayNameInput = document.querySelector("#displayName");
const statusBox = document.querySelector("#loginStatus");
const submitButton = document.querySelector("#submitAuthButton");
let authMode = "login";

initLoginPage();

async function initLoginPage() {
  const user = await PaperSharingSession.init();
  if (user) {
    redirectAfterLogin();
    return;
  }

  document.querySelectorAll("[data-auth-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      setAuthMode(button.dataset.authMode);
    });
  });

  form.addEventListener("submit", submitAuthForm);
}

function setAuthMode(nextMode) {
  authMode = nextMode === "register" ? "register" : "login";
  document.querySelectorAll("[data-auth-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.authMode === authMode);
  });
  displayNameField.hidden = authMode !== "register";
  displayNameInput.required = authMode === "register";
  submitButton.textContent = authMode === "register" ? "注册并进入" : "登录";
  statusBox.textContent = "";
}

async function submitAuthForm(event) {
  event.preventDefault();

  const body = {
    email: emailInput.value.trim(),
    password: passwordInput.value,
  };

  if (authMode === "register") {
    body.displayName = displayNameInput.value.trim();
  }

  setStatus(authMode === "register" ? "正在注册..." : "正在登录...");
  submitButton.disabled = true;

  try {
    const response = await fetch(`/api/auth/${authMode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "认证失败。");
    }

    PaperSharingSession.user = data.user;
    PaperSharingSession.initialized = true;
    redirectAfterLogin();
  } catch (error) {
    setStatus(error.message || "认证失败。");
  } finally {
    submitButton.disabled = false;
  }
}

function redirectAfterLogin() {
  window.location.href = safeNextPath() || "./reader.html";
}

function safeNextPath() {
  const next = new URLSearchParams(window.location.search).get("next") || "";
  if (!next || next.startsWith("http://") || next.startsWith("https://") || next.startsWith("//")) {
    return "";
  }
  return `./${next.replace(/^\.?\//, "")}`;
}

function setStatus(message) {
  statusBox.textContent = message;
}
