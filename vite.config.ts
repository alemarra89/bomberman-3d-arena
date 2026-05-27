import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const base = env.VITE_BASE_PATH?.trim() || (mode === "static" ? "/bomberman-3d-arena/" : "/");

  return {
    base,
    plugins: [
      react({
        babel: {
          plugins: ["babel-plugin-reactylon"]
        }
      })
    ],
    server: {
      port: 5173,
      proxy: {
        "/api": "http://localhost:8787"
      }
    }
  };
});
