import { loadFont as loadInterTight } from "@remotion/google-fonts/InterTight";
import { loadFont as loadDMMono } from "@remotion/google-fonts/DMMono";

export const HEAD = loadInterTight("normal", { weights: ["500", "600", "700", "800"], subsets: ["latin"] }).fontFamily;
export const MONO = loadDMMono("normal", { weights: ["400", "500"], subsets: ["latin"] }).fontFamily;

// PayMe brand (from src/index.css + App.tsx in the app)
export const C = {
  bg: "#141414",
  bg2: "#1c1c1c",
  white: "#ffffff",
  muted: "rgba(255,255,255,0.62)",
  green: "#b7f0a1",
  greenDot: "#6fdc8c",
  purple: "#e8c8f4",
  blue: "#c7e7fa",
  yellow: "#f5e9a9",
  red: "#ff6b5e",
  paper: "#f2f1ed",
};

export const FPS = 30;

export type Layout = "wide" | "tall";

export const LAYOUT = {
  wide: {
    width: 1920,
    height: 1080,
    chip: { left: 280, top: 18, font: 22 },
    frame: { x: 280, y: 74, w: 1360, h: 805, bar: 40 },
    caption: { top: 893, height: 172, font: 50, maxWidth: 1560 },
    watermark: { right: 34, bottom: 26, font: 17 },
    title: 86,
  },
  tall: {
    width: 1080,
    height: 1350,
    chip: { left: 30, top: 28, font: 20 },
    frame: { x: 20, y: 92, w: 1040, h: 880, bar: 44 },
    caption: { top: 992, height: 300, font: 60, maxWidth: 1000 },
    watermark: { right: 26, bottom: 22, font: 18 },
    title: 76,
  },
} as const;
