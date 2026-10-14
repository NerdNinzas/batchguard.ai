/* eslint-disable @next/next/no-img-element */

/**
 * Brand logos for the stack. Files live in /public/logos (Simple Icons, CC0).
 * Google Cloud products without their own mark fall back to the Google Cloud
 * logo; a few non-Google services get a lettered badge.
 */
const LOGO: Record<string, string> = {
  "Google Cloud": "googlecloud",
  "Vertex AI (Gemini)": "googlegemini",
  "Gemini on Vertex AI": "googlegemini",
  "Vertex AI (Gemini Flash + Pro)": "googlegemini",
  Gemini: "googlegemini",
  "Agent Development Kit": "googlegemini",
  "Firebase Auth": "firebase",
  "Firebase Authentication": "firebase",
  Firestore: "firebase",
  BigQuery: "googlebigquery",
  "BigQuery ML forecasting": "googlebigquery",
  "ML.DETECT_ANOMALIES": "googlebigquery",
  "BigQuery subscription": "googlepubsub",
  "Pub/Sub": "googlepubsub",
  "Cloud Storage": "googlecloudstorage",
  Dataflow: "googledataflow",
  "Next.js": "nextdotjs",
  React: "react",
  "Three.js": "threedotjs",
  TypeScript: "typescript",
  Tailwind: "tailwindcss",
  FastAPI: "fastapi",
  Python: "python",
  Blender: "blender",
};

const BADGE: Record<string, { letter: string; bg: string }> = {
  "Twilio Voice": { letter: "T", bg: "#F22F46" },
  Twilio: { letter: "T", bg: "#F22F46" },
  SendGrid: { letter: "S", bg: "#1A82E2" },
};

export function TechLogo({ name, size = 20, className = "" }: { name: string; size?: number; className?: string }) {
  const badge = BADGE[name];
  if (badge) {
    return (
      <span
        className={`inline-grid shrink-0 place-items-center rounded-md font-display font-bold text-white ${className}`}
        style={{ width: size, height: size, background: badge.bg, fontSize: size * 0.6 }}
        aria-hidden
      >
        {badge.letter}
      </span>
    );
  }
  const slug = LOGO[name] ?? "googlecloud";
  const px = slug === "googlegemini" ? Math.round(size * 1.2) : size; // the Gemini sparkle reads small; give it room
  return <img src={`/logos/${slug}.svg`} alt="" width={px} height={px} className={`shrink-0 ${className}`} loading="lazy" />;
}
