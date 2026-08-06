import { ImageJobPayload } from "../shared/queues";
import { GeneratedImage } from "./types";

export function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function wrapText(text: string, maxChars: number, maxLines: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
    if (lines.length === maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines;
}

export function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

export function palette(seed: string) {
  const hue = hashString(seed) % 360;
  return {
    primary: `hsl(${hue}, 74%, 46%)`,
    secondary: `hsl(${(hue + 42) % 360}, 70%, 54%)`,
    accent: `hsl(${(hue + 184) % 360}, 78%, 48%)`,
    dark: "hsl(222, 47%, 11%)",
    ink: "hsl(215, 24%, 18%)",
  };
}

type Palette = ReturnType<typeof palette>;

function blobPanelLayout(colors: Palette): string {
  return `
  <path d="M1050 80 C1250 120 1400 250 1510 430 C1390 370 1220 385 1080 480 C945 570 820 680 610 690 C730 540 780 370 860 235 C910 150 970 105 1050 80Z" fill="${colors.secondary}" opacity="0.22"/>
  <path d="M1110 190 C1260 215 1380 330 1450 470 C1320 438 1200 470 1090 548 C960 640 835 740 650 750 C760 605 830 440 910 315 C960 240 1025 205 1110 190Z" fill="${colors.accent}" opacity="0.28"/>
  <g opacity="0.18" stroke="white" stroke-width="2">
    <path d="M870 235 L1168 308 L1390 470 L1092 548 L650 750"/>
    <path d="M1168 308 L1092 548 L910 315"/>
    <circle cx="870" cy="235" r="8" fill="white"/>
    <circle cx="1168" cy="308" r="8" fill="white"/>
    <circle cx="1390" cy="470" r="8" fill="white"/>
    <circle cx="1092" cy="548" r="8" fill="white"/>
    <circle cx="650" cy="750" r="8" fill="white"/>
  </g>`;
}

function diagonalSplitLayout(colors: Palette): string {
  return `
  <polygon points="960,0 1600,0 1600,900 520,900" fill="${colors.secondary}" opacity="0.24"/>
  <polygon points="1140,0 1600,0 1600,900 760,900" fill="${colors.accent}" opacity="0.26"/>
  <line x1="960" y1="0" x2="520" y2="900" stroke="white" stroke-width="2" opacity="0.16"/>
  <line x1="1140" y1="0" x2="760" y2="900" stroke="white" stroke-width="2" opacity="0.16"/>
  <line x1="1320" y1="0" x2="1000" y2="900" stroke="white" stroke-width="2" opacity="0.1"/>`;
}

function gridMeshLayout(colors: Palette): string {
  const lines: string[] = [];
  for (let x = 980; x <= 1560; x += 60) {
    lines.push(`<line x1="${x}" y1="40" x2="${x}" y2="860" stroke="white" stroke-width="1" opacity="0.1"/>`);
  }
  for (let y = 60; y <= 840; y += 60) {
    lines.push(`<line x1="960" y1="${y}" x2="1560" y2="${y}" stroke="white" stroke-width="1" opacity="0.1"/>`);
  }
  return `
  <rect x="960" y="0" width="640" height="900" fill="${colors.secondary}" opacity="0.12"/>
  ${lines.join("")}
  <circle cx="1260" cy="450" r="220" fill="${colors.accent}" opacity="0.22"/>
  <circle cx="1260" cy="450" r="140" fill="${colors.primary}" opacity="0.18"/>`;
}

function cornerRadialLayout(colors: Palette): string {
  return `
  <circle cx="1560" cy="120" r="420" fill="${colors.secondary}" opacity="0.3"/>
  <circle cx="1560" cy="120" r="280" fill="${colors.accent}" opacity="0.28"/>
  <circle cx="1560" cy="120" r="150" fill="${colors.primary}" opacity="0.3"/>
  <circle cx="1250" cy="780" r="8" fill="white" opacity="0.4"/>
  <circle cx="1420" cy="700" r="5" fill="white" opacity="0.3"/>
  <circle cx="1500" cy="820" r="6" fill="white" opacity="0.35"/>`;
}

function waveRibbonsLayout(colors: Palette): string {
  return `
  <path d="M900 620 C1080 560 1260 560 1440 630 C1520 660 1580 700 1600 730 L1600 900 L900 900Z" fill="${colors.secondary}" opacity="0.26"/>
  <path d="M850 700 C1050 650 1260 660 1460 730 C1540 758 1580 780 1600 800 L1600 900 L850 900Z" fill="${colors.accent}" opacity="0.3"/>
  <path d="M950 780 C1150 745 1350 755 1550 810 L1600 830 L1600 900 L950 900Z" fill="${colors.primary}" opacity="0.32"/>`;
}

const FALLBACK_LAYOUTS = [
  "blob-panel",
  "diagonal-split",
  "grid-mesh",
  "corner-radial",
  "wave-ribbons",
] as const;

export type FallbackLayout = (typeof FALLBACK_LAYOUTS)[number];

const FALLBACK_LAYOUT_RENDERERS: Record<FallbackLayout, (colors: Palette) => string> = {
  "blob-panel": blobPanelLayout,
  "diagonal-split": diagonalSplitLayout,
  "grid-mesh": gridMeshLayout,
  "corner-radial": cornerRadialLayout,
  "wave-ribbons": waveRibbonsLayout,
};

/** Rotates the decorative background composition deterministically per seed - same hash-index pattern as ai-generator.ts's selectStyleDirection, so retries with a salted seed also get a genuinely different layout, not just a different hue. */
export function selectFallbackLayout(seed: string): FallbackLayout {
  const index = hashString(seed) % FALLBACK_LAYOUTS.length;
  return FALLBACK_LAYOUTS[index];
}

export function generateEditorialHeroImage(payload: ImageJobPayload, seedOverride?: string): GeneratedImage {
  const width = 1600;
  const height = 900;
  const seed = seedOverride ?? `${payload.category}:${payload.title}`;
  const colors = palette(seed);
  const layout = selectFallbackLayout(seed);
  const decoration = FALLBACK_LAYOUT_RENDERERS[layout](colors);
  const titleLines = wrapText(payload.title, 34, 3);
  const excerptLines = wrapText(payload.excerpt || "AI-generated technical analysis for developers.", 58, 2);
  const titleTspans = titleLines
    .map((line, index) => `<tspan x="118" dy="${index === 0 ? 0 : 72}">${escapeXml(line)}</tspan>`)
    .join("");
  const excerptTspans = excerptLines
    .map((line, index) => `<tspan x="122" dy="${index === 0 ? 0 : 34}">${escapeXml(line)}</tspan>`)
    .join("");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(payload.title)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${colors.dark}"/>
      <stop offset="52%" stop-color="${colors.ink}"/>
      <stop offset="100%" stop-color="${colors.primary}"/>
    </linearGradient>
    <linearGradient id="panel" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="rgba(255,255,255,0.18)"/>
      <stop offset="100%" stop-color="rgba(255,255,255,0.06)"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="28" stdDeviation="32" flood-color="rgba(2,6,23,0.35)"/>
    </filter>
  </defs>
  <rect width="1600" height="900" fill="url(#bg)"/>
  ${decoration}
  <rect x="82" y="92" width="835" height="716" rx="34" fill="url(#panel)" stroke="rgba(255,255,255,0.24)" filter="url(#shadow)"/>
  <text x="120" y="155" font-family="Inter, Arial, sans-serif" font-size="25" font-weight="800" letter-spacing="3" fill="rgba(255,255,255,0.72)">${escapeXml(payload.category.toUpperCase())}</text>
  <text x="118" y="270" font-family="Inter, Arial, sans-serif" font-size="62" font-weight="900" fill="white">${titleTspans}</text>
  <text x="122" y="575" font-family="Inter, Arial, sans-serif" font-size="25" font-weight="500" fill="rgba(255,255,255,0.78)">${excerptTspans}</text>
  <g transform="translate(122 698)">
    <rect width="258" height="48" rx="14" fill="rgba(255,255,255,0.14)" stroke="rgba(255,255,255,0.22)"/>
    <text x="24" y="31" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="800" fill="white">DevKit Market Analysis</text>
  </g>
  <text x="1420" y="830" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="800" text-anchor="end" fill="rgba(255,255,255,0.62)">Generated editorial hero</text>
</svg>`;

  return {
    buffer: Buffer.from(svg),
    fileName: "hero.svg",
    mimeType: "image/svg+xml",
    width,
    height,
    layout,
  };
}
