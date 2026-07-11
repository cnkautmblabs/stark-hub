import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import JavaScriptObfuscator from "javascript-obfuscator";

function starkHubObfuscator() {
  return {
    name: "stark-hub-obfuscator",
    apply: "build",
    enforce: "post",
    generateBundle(_, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "chunk" || !chunk.fileName.endsWith(".js")) continue;
        if (chunk.fileName.includes("workbox") || chunk.fileName.includes("sw")) continue;
        if (/(jspdf|html2canvas|purify|index\.es|workbox-window)/i.test(chunk.fileName)) continue;
        const result = JavaScriptObfuscator.obfuscate(chunk.code, {
          compact: true,
          controlFlowFlattening: false,
          deadCodeInjection: false,
          debugProtection: false,
          disableConsoleOutput: false,
          identifierNamesGenerator: "hexadecimal",
          numbersToExpressions: true,
          renameGlobals: false,
          selfDefending: false,
          simplify: true,
          splitStrings: false,
          splitStringsChunkLength: 16,
          stringArray: true,
          stringArrayCallsTransform: true,
          stringArrayEncoding: [],
          stringArrayRotate: true,
          stringArrayShuffle: true,
          stringArrayThreshold: 0.75,
          transformObjectKeys: true
        });
        chunk.code = result.getObfuscatedCode();
      }
    }
  };
}

export default defineConfig({
  base: "/stark-hub/",
  plugins: [
    react(),
    starkHubObfuscator(),
    VitePWA({
      registerType: "autoUpdate",
      workbox: {
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024
      },
      includeAssets: ["icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png"],
      manifest: {
        name: "Stark Hub",
        short_name: "StarkHub",
        description: "Plataforma de governança, QA e produtividade da equipe.",
        theme_color: "#0b1220",
        background_color: "#0b1220",
        display: "standalone",
        start_url: "./",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" }
        ]
      }
    })
  ]
});
