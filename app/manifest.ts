import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Kitchen Planner",
    short_name: "Kitchen",
    description: "Household inventory, AI-assisted meal planning and shopping.",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f1e8",
    theme_color: "#153f35",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
