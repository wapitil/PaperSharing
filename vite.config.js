import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        index: "index.html",
        reader: "reader.html",
        admin: "admin.html",
        login: "login.html",
      },
    },
  },
});
