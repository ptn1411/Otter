import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  base: "/dashboard/phong/",
  plugins: [react(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    port: 4317,
    strictPort: true,
    proxy: {
      "/otter": {
        target: "http://127.0.0.1:1993",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/otter/, ""),
      },
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 4317,
    strictPort: true,
  },
})
