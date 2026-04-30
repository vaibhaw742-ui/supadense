const stage = process.env.SST_STAGE || "dev"

export default {
  url: stage === "production" ? "https://supadense.com" : "http://localhost:4097",
  console: stage === "production" ? "https://supadense.com/auth" : "http://localhost:3000",
  email: "contact@supadense.com",
  socialCard: "https://social-cards.sst.dev",
  github: "https://github.com/anomalyco/opencode",
  discord: "https://opencode.ai/discord",
  headerLinks: [
    { name: "app.header.home", url: "/" },
    { name: "app.header.docs", url: "/docs/" },
  ],
}
