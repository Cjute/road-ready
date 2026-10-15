import { createFileRoute } from "@tanstack/react-router";
import DrivingSim from "@/components/DrivingSim";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Körsimulator – öva omkörning" },
      { name: "description", content: "Öva säker omkörning: avstånd, blinkers, mötande trafik och heldragen linje." },
      { property: "og:title", content: "Körsimulator – öva omkörning" },
      { property: "og:description", content: "Öva säker omkörning i webbläsaren." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  ssr: false,
  component: DrivingSim,
});
