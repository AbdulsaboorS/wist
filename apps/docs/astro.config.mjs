import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://docs.wist.fyi",
  integrations: [
    starlight({
      title: "Wist",
      description: "Hand your coding agent's work to your personal assistant.",
      favicon: "/favicon.svg",
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/AbdulsaboorS/wist" }],
      editLink: { baseUrl: "https://github.com/AbdulsaboorS/wist/edit/main/apps/docs/" },
      customCss: ["@wist/ui/fonts.css", "@wist/ui/tokens.css", "./src/styles/wist.css"],
      // The docs share the landing page's single light theme.
      components: {
        ThemeProvider: "./src/components/ThemeProvider.astro",
        ThemeSelect: "./src/components/ThemeSelect.astro",
        SocialIcons: "./src/components/SocialIcons.astro",
      },
      sidebar: [
        { label: "Start here", items: ["index", "get-started"] },
        {
          label: "Guides",
          items: ["guides/hand-off", "guides/connect-muse", "guides/update-and-revoke"],
        },
        { label: "Concepts", items: ["concepts/what-is-shared"] },
        {
          label: "Reference",
          items: ["reference/commands", "reference/for-assistants", "reference/troubleshooting"],
        },
        "security",
      ],
    }),
  ],
});
