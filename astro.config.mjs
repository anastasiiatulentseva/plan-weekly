import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import node from "@astrojs/node";

export default defineConfig({
  site: "https://plans.tulentsev.com",
  integrations: [react()],
  output: "server",
  session: false,
  adapter: node({ mode: "standalone" })
});
