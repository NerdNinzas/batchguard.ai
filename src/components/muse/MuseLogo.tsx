/* eslint-disable @next/next/no-img-element */

/** Muse's head, cropped from the character render, as a square logo. */
export function MuseLogo({ size = 40, className = "" }: { size?: number; className?: string }) {
  // head box is ~70.8% of the image width starting at the top-left corner
  const imgW = size / 0.708;
  return (
    <span className={`relative inline-block shrink-0 overflow-hidden rounded-xl bg-sky-soft ${className}`} style={{ width: size, height: size }} aria-hidden>
      <img src="/muse.webp" alt="" style={{ position: "absolute", width: imgW, maxWidth: "none", left: size * 0.02, top: size * 0.02 }} />
    </span>
  );
}
