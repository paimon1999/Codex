import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import gitApiPlugin from "./vite-plugin-git-api";

// Git 仓库路径：默认为当前项目根目录
const GIT_REPO_PATH = process.env.GIT_REPO_PATH || '/Users/paimon/Rustrover/Codex';

export default defineConfig({
  plugins: [
    react(),
    gitApiPlugin(GIT_REPO_PATH),
  ],
  server: { port: 5174 },
});
