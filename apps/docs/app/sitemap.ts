import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = "https://docs.paylix.io";

  return [
    { url: baseUrl, lastModified: new Date(), changeFrequency: "weekly", priority: 1 },
    { url: `${baseUrl}/sdk-reference`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.9 },
    { url: `${baseUrl}/frameworks`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.85 },
    { url: `${baseUrl}/frameworks/nextjs-app-router`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
    { url: `${baseUrl}/frameworks/nextjs-pages-router`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
    { url: `${baseUrl}/frameworks/react-vite`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
    { url: `${baseUrl}/frameworks/sveltekit`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
    { url: `${baseUrl}/frameworks/nuxt`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
    { url: `${baseUrl}/frameworks/remix`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
    { url: `${baseUrl}/frameworks/express`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
    { url: `${baseUrl}/invoices`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.85 },
    { url: `${baseUrl}/webhooks`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.8 },
    { url: `${baseUrl}/self-hosting`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.7 },
    { url: `${baseUrl}/testnet`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.6 },
  ];
}
