import { defineConfig } from "astro/config";
import react from "@astrojs/react";

export default defineConfig({
  site: "https://anastasiiatulentseva.github.io",
  ...(process.env.GITHUB_PAGES === "true" ? { base: "/plan-weekly" } : {}),
  integrations: [react()],
  output: "static"
});
