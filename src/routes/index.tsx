import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Omkörningsövning – öva omkörning och parkering" },
      { name: "description", content: "Öva säker omkörning, fickparkering och backning i webbläsaren." },
      { property: "og:title", content: "Omkörningsövning" },
      { property: "og:description", content: "Öva omkörning, fickparkering och backning i webbläsaren." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

function Home() {
  return (
    <iframe
      src="/omkorning.html"
      title="Omkörningsövning"
      className="fixed inset-0 h-screen w-screen border-0"
      allow="fullscreen"
    />
  );
}
