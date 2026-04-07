import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      // 开发时将所有 /api 请求转发到后端，消除跨域问题
      "/api": {
        target: "http://localhost:3456",
        changeOrigin: true,
      },
    },
  },
});
