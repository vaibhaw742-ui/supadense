// @ts-check
import { defineConfig } from "astro/config"
import starlight from "@astrojs/starlight"
import solidJs from "@astrojs/solid-js"
import cloudflare from "@astrojs/cloudflare"
import theme from "toolbeam-docs-theme"
import config from "./config.mjs"
import { rehypeHeadingIds } from "@astrojs/markdown-remark"
import rehypeAutolinkHeadings from "rehype-autolink-headings"
import { spawnSync } from "child_process"

// https://astro.build/config
export default defineConfig({
  site: config.url,
  base: "/docs",
  output: "server",
  adapter: cloudflare({
    imageService: "passthrough",
  }),
  devToolbar: {
    enabled: false,
  },
  server: {
    host: "0.0.0.0",
    port: 4097,
  },
  markdown: {
    rehypePlugins: [rehypeHeadingIds, [rehypeAutolinkHeadings, { behavior: "wrap" }]],
  },
  build: {},
  integrations: [
    configSchema(),
    solidJs(),
    starlight({
      title: "Supadense",
      defaultLocale: "root",
      locales: {
        root: {
          label: "English",
          lang: "en",
          dir: "ltr",
        },
        ar: {
          label: "العربية",
          lang: "ar",
          dir: "rtl",
        },
        bs: {
          label: "Bosanski",
          lang: "bs-BA",
          dir: "ltr",
        },
        da: {
          label: "Dansk",
          lang: "da-DK",
          dir: "ltr",
        },
        de: {
          label: "Deutsch",
          lang: "de-DE",
          dir: "ltr",
        },
        es: {
          label: "Espa\u00f1ol",
          lang: "es-ES",
          dir: "ltr",
        },
        fr: {
          label: "Fran\u00e7ais",
          lang: "fr-FR",
          dir: "ltr",
        },
        it: {
          label: "Italiano",
          lang: "it-IT",
          dir: "ltr",
        },
        ja: {
          label: "日本語",
          lang: "ja-JP",
          dir: "ltr",
        },
        ko: {
          label: "한국어",
          lang: "ko-KR",
          dir: "ltr",
        },
        nb: {
          label: "Norsk Bokm\u00e5l",
          lang: "nb-NO",
          dir: "ltr",
        },
        pl: {
          label: "Polski",
          lang: "pl-PL",
          dir: "ltr",
        },
        "pt-br": {
          label: "Portugu\u00eas (Brasil)",
          lang: "pt-BR",
          dir: "ltr",
        },
        ru: {
          label: "Русский",
          lang: "ru-RU",
          dir: "ltr",
        },
        th: {
          label: "ไทย",
          lang: "th-TH",
          dir: "ltr",
        },
        tr: {
          label: "T\u00fcrk\u00e7e",
          lang: "tr-TR",
          dir: "ltr",
        },
        "zh-cn": {
          label: "简体中文",
          lang: "zh-CN",
          dir: "ltr",
        },
        "zh-tw": {
          label: "繁體中文",
          lang: "zh-TW",
          dir: "ltr",
        },
      },
      favicon: "/favicon-v3.svg",
      head: [
        {
          tag: "link",
          attrs: {
            rel: "icon",
            href: "/favicon-v3.ico",
            sizes: "32x32",
          },
        },
        {
          tag: "link",
          attrs: {
            rel: "icon",
            type: "image/png",
            href: "/favicon-96x96-v3.png",
            sizes: "96x96",
          },
        },
        {
          tag: "link",
          attrs: {
            rel: "apple-touch-icon",
            href: "/apple-touch-icon-v3.png",
            sizes: "180x180",
          },
        },
      ],
      lastUpdated: true,
      expressiveCode: { themes: ["github-light", "github-dark"] },
      social: [
        { icon: "github", label: "GitHub", href: config.github },
        { icon: "discord", label: "Discord", href: config.discord },
      ],
      editLink: {
        baseUrl: `${config.github}/edit/dev/packages/web/`,
      },
      markdown: {
        headingLinks: false,
      },
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
      plugins: [
        theme({
          headerLinks: config.headerLinks,
        }),
      ],
    }),
  ],
})

function configSchema() {
  return {
    name: "configSchema",
    hooks: {
      "astro:build:done": async () => {
        console.log("generating config schema")
        spawnSync("../opencode/script/schema.ts", ["./dist/config.json", "./dist/tui.json"])
      },
    },
  }
}
