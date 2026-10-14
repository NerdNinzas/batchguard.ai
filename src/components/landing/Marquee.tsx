import { TechLogo } from "@/components/ui/TechLogo";

const ITEMS = [
  "Google Cloud",
  "Gemini on Vertex AI",
  "Agent Development Kit",
  "Cloud Run",
  "Pub/Sub",
  "BigQuery",
  "Firestore",
  "Cloud Storage",
  "Cloud Text-to-Speech",
  "Secret Manager",
  "Firebase Auth",
  "Cloud Logging",
  "Twilio Voice",
  "Next.js",
  "React",
  "Three.js",
  "FastAPI",
  "Blender",
];

export function Marquee() {
  const list = [...ITEMS, ...ITEMS];
  return (
    <div className="relative border-y border-line bg-white py-5">
      <div className="hazard absolute inset-x-0 top-0 h-[3px] opacity-70" />
      <div className="overflow-hidden">
        <div className="marquee flex w-max gap-4 whitespace-nowrap">
          {list.map((t, i) => (
            <span key={i} className="flex items-center gap-3 rounded-full border border-line bg-bg px-5 py-2.5 text-base font-semibold text-ink">
              <TechLogo name={t} size={28} />
              {t}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
