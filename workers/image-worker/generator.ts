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

export function generateEditorialHeroImage(payload: ImageJobPayload, seedOverride?: string): GeneratedImage {
  const width = 1600;
  const height = 900;
  const colors = palette(seedOverride ?? `${payload.category}:${payload.title}`);
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
  </g>
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
  };
}
