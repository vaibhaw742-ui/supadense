// @ts-check
// Docker/static build config — outputs plain HTML/CSS/JS, no SSR adapter needed
import { defineConfig } from "astro/config"
import starlight from "@astrojs/starlight"
import solidJs from "@astrojs/solid-js"
import theme from "toolbeam-docs-theme"
import config from "./config.mjs"
import { rehypeHeadingIds } from "@astrojs/markdown-remark"
import rehypeAutolinkHeadings from "rehype-autolink-headings"

export default defineConfig({
  site: "https://supadense.com",
  base: "/docs",
  output: "static",
  devToolbar: { enabled: false },
  image: { service: { entrypoint: "astro/assets/services/noop" } },
  markdown: {
    rehypePlugins: [rehypeHeadingIds, [rehypeAutolinkHeadings, { behavior: "wrap" }]],
  },
  integrations: [
    solidJs(),
    starlight({
      title: "Supadense",
      defaultLocale: "root",
      locales: {
        root: { label: "English", lang: "en", dir: "ltr" },
        ar: { label: "العربية", lang: "ar", dir: "rtl" },
        bs: { label: "Bosanski", lang: "bs-BA", dir: "ltr" },
        da: { label: "Dansk", lang: "da-DK", dir: "ltr" },
        de: { label: "Deutsch", lang: "de-DE", dir: "ltr" },
        es: { label: "Español", lang: "es-ES", dir: "ltr" },
        fr: { label: "Français", lang: "fr-FR", dir: "ltr" },
        it: { label: "Italiano", lang: "it-IT", dir: "ltr" },
        ja: { label: "日本語", lang: "ja-JP", dir: "ltr" },
        ko: { label: "한국어", lang: "ko-KR", dir: "ltr" },
        nb: { label: "Norsk Bokmål", lang: "nb-NO", dir: "ltr" },
        pl: { label: "Polski", lang: "pl-PL", dir: "ltr" },
        "pt-br": { label: "Português (Brasil)", lang: "pt-BR", dir: "ltr" },
        ru: { label: "Русский", lang: "ru-RU", dir: "ltr" },
        th: { label: "ไทย", lang: "th-TH", dir: "ltr" },
        tr: { label: "Türkçe", lang: "tr-TR", dir: "ltr" },
        "zh-cn": { label: "简体中文", lang: "zh-CN", dir: "ltr" },
        "zh-tw": { label: "繁體中文", lang: "zh-TW", dir: "ltr" },
      },
      favicon: "/favicon-v3.svg",
      head: [
        { tag: "link", attrs: { rel: "icon", href: "/favicon-v3.ico", sizes: "32x32" } },
        { tag: "link", attrs: { rel: "icon", type: "image/png", href: "/favicon-96x96-v3.png", sizes: "96x96" } },
        { tag: "link", attrs: { rel: "apple-touch-icon", href: "/apple-touch-icon-v3.png", sizes: "180x180" } },
      ],
      lastUpdated: true,
      expressiveCode: { themes: ["github-light", "github-dark"] },
      social: [],
      markdown: { headingLinks: false },
      customCss: ["./src/styles/custom.css"],
      logo: {
        light: "./src/assets/logo-light.svg",
        dark: "./src/assets/logo-dark.svg",
        replacesTitle: true,
      },
      sidebar: [
        { label: "Introduction", link: "" },
        { label: "Get Started", link: "get-started" },
        { label: "KB Structure", link: "kb-structure" },
        { label: "Wiki Page", link: "wiki" },
        {
          label: "Knowledge Base",
          items: [
            { label: "Managing Categories", link: "categories" },
            { label: "Ingestion", link: "ingestion" },
            { label: "Retrieving", link: "retrieving" },
            { label: "Groups", link: "groups" },
            { label: "Sources & Images", link: "sources" },
            { label: "GitHub Sync", link: "kb-github-sync" },
          ],
        },
        {
          label: "Platform",
          items: [
            { label: "Workspaces & Sessions", link: "workspaces" },
          ],
        },
      ],
      components: {
        Hero: "./src/components/Hero.astro",
        Head: "./src/components/Head.astro",
        Header: "./src/components/Header.astro",
        Footer: "./src/components/Footer.astro",
        SiteTitle: "./src/components/SiteTitle.astro",
      },
      plugins: [theme({ headerLinks: config.headerLinks })],
    }),
  ],
})
