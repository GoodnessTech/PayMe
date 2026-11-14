import React from "react";
import { AbsoluteFill, Easing, Freeze, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FPS, HEAD, LAYOUT, MONO, type Layout } from "../theme";

// ------------------------------------------------------------------ background

export const Background: React.FC = () => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(1200px 700px at 18% 12%, rgba(183,240,161,0.10), transparent 60%),
                   radial-gradient(1000px 800px at 85% 90%, rgba(232,200,244,0.09), transparent 60%),
                   linear-gradient(160deg, #191919 0%, ${C.bg} 55%, #101010 100%)`,
    }}
  />
);

// ------------------------------------------------------------------ fades

export const useFade = (durationInFrames: number, inF = 8, outF = 8) => {
  const f = useCurrentFrame();
  return interpolate(f, [0, inF, durationInFrames - outF, durationInFrames], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
};

// ------------------------------------------------------------------ chip

export const Chip: React.FC<{ text: string; status?: "green" | "red"; layout: Layout }> = ({ text, status = "green", layout }) => {
  const f = useCurrentFrame();
  const L = LAYOUT[layout];
  const op = interpolate(f, [4, 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const x = interpolate(f, [4, 16], [-14, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const dot = status === "red" ? C.red : C.greenDot;
  const pulse = 0.55 + 0.45 * Math.abs(Math.sin(f / 9));
  return (
    <div
      style={{
        position: "absolute",
        left: L.chip.left,
        top: L.chip.top,
        opacity: op,
        transform: `translateX(${x}px)`,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "9px 18px 9px 14px",
        borderRadius: 999,
        background: "rgba(14,14,14,0.92)",
        border: "1px solid rgba(255,255,255,0.14)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
        fontFamily: MONO,
        fontSize: L.chip.font,
        letterSpacing: "0.12em",
        color: "rgba(255,255,255,0.9)",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
        maxWidth: layout === "tall" ? 1020 : 1700,
        overflow: "hidden",
        textOverflow: "ellipsis",
        zIndex: 20,
      }}
    >
      <span style={{ width: 10, height: 10, borderRadius: 99, background: dot, opacity: pulse, boxShadow: `0 0 10px ${dot}` }} />
      {text}
    </div>
  );
};

// ------------------------------------------------------------------ caption

export const Caption: React.FC<{ text: string; durationInFrames: number; layout: Layout }> = ({ text, durationInFrames, layout }) => {
  const f = useCurrentFrame();
  const L = LAYOUT[layout];
  const op = interpolate(f, [0, 6, durationInFrames - 6, durationInFrames], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const y = interpolate(f, [0, 8], [12, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: L.caption.top, height: L.caption.height, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 15 }}>
      <div
        style={{
          opacity: op,
          transform: `translateY(${y}px)`,
          maxWidth: L.caption.maxWidth,
          padding: layout === "tall" ? "20px 34px" : "15px 32px",
          borderRadius: 26,
          background: "rgba(10,10,10,0.9)",
          border: "1px solid rgba(255,255,255,0.10)",
          boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
          color: C.white,
          fontFamily: HEAD,
          fontWeight: 600,
          fontSize: L.caption.font,
          lineHeight: 1.18,
          letterSpacing: "-0.015em",
          textAlign: "center",
          textWrap: "balance" as React.CSSProperties["textWrap"],
        }}
      >
        {text}
      </div>
    </div>
  );
};

export const Captions: React.FC<{ captions: { from: number; to: number; text: string }[]; layout: Layout }> = ({ captions, layout }) => (
  <>
    {captions.map((c) => {
      const from = Math.round(c.from * FPS);
      const dur = Math.max(1, Math.round((c.to - c.from) * FPS));
      return (
        <Sequence key={c.text} from={from} durationInFrames={dur} layout="none">
          <Caption text={c.text} durationInFrames={dur} layout={layout} />
        </Sequence>
      );
    })}
  </>
);

// ------------------------------------------------------------------ watermark

export const Watermark: React.FC<{ layout: Layout }> = ({ layout }) => {
  const f = useCurrentFrame();
  const L = LAYOUT[layout];
  return (
    <div
      style={{
        position: "absolute",
        right: L.watermark.right,
        bottom: L.watermark.bottom,
        display: "flex",
        alignItems: "center",
        gap: 9,
        fontFamily: MONO,
        fontSize: L.watermark.font,
        letterSpacing: "0.16em",
        color: "rgba(255,255,255,0.55)",
        zIndex: 30,
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: 99, background: C.red, opacity: 0.6 + 0.4 * Math.abs(Math.sin(f / 12)) }} />
      LIVE · TESTNET
    </div>
  );
};

// ------------------------------------------------------------------ browser frame + camera

export type CamKey = { t: number; zoom: number; x: number; y: number };

function camAt(t: number, keys: CamKey[]): CamKey {
  if (!keys.length) return { t, zoom: 1, x: 0.5, y: 0.5 };
  if (t <= keys[0].t) return keys[0];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (t <= b.t) {
      const p = Easing.inOut(Easing.cubic)((t - a.t) / Math.max(0.001, b.t - a.t));
      return { t, zoom: a.zoom + (b.zoom - a.zoom) * p, x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p };
    }
  }
  return keys[keys.length - 1];
}

export const BrowserFrame: React.FC<{ layout: Layout; url: string; children: React.ReactNode; light?: boolean }> = ({ layout, url, children, light = true }) => {
  const L = LAYOUT[layout].frame;
  return (
    <div
      style={{
        position: "absolute",
        left: L.x,
        top: L.y,
        width: L.w,
        height: L.h,
        borderRadius: 24,
        overflow: "hidden",
        background: light ? C.paper : "#0f0f0f",
        boxShadow: "0 40px 120px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.08)",
      }}
    >
      <div style={{ height: L.bar, background: "#202020", display: "flex", alignItems: "center", padding: "0 18px", gap: 9, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
          <span key={c} style={{ width: 12, height: 12, borderRadius: 99, background: c, opacity: 0.85 }} />
        ))}
        <div
          style={{
            margin: "0 auto",
            transform: "translateX(-30px)",
            padding: "5px 18px",
            borderRadius: 999,
            background: "rgba(255,255,255,0.07)",
            color: "rgba(255,255,255,0.72)",
            fontFamily: MONO,
            fontSize: layout === "tall" ? 17 : 15,
            maxWidth: L.w - 220,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          🔒 {url}
        </div>
      </div>
      <div style={{ position: "relative", width: L.w, height: L.h - L.bar, overflow: "hidden" }}>{children}</div>
    </div>
  );
};

/** Pans/zooms a source of size (srcW x srcH) inside the frame's content area. */
export const Camera: React.FC<{ layout: Layout; keys: CamKey[]; srcW: number; srcH: number; fit?: "cover" | "contain"; children: React.ReactNode }> = ({ layout, keys, srcW, srcH, fit = "cover", children }) => {
  const f = useCurrentFrame();
  const L = LAYOUT[layout].frame;
  const fw = L.w;
  const fh = L.h - L.bar;
  const cam = camAt(f / FPS, keys);
  const base = fit === "contain" ? Math.min(fw / srcW, fh / srcH) : Math.max(fw / srcW, fh / srcH);
  const s = base * cam.zoom;
  const rw = srcW * s;
  const rh = srcH * s;
  // Never show empty edges when the source covers the frame; centre it when smaller (contain).
  const tx = rw <= fw ? (fw - rw) / 2 : Math.min(0, Math.max(fw - rw, fw / 2 - cam.x * rw));
  const ty = rh <= fh ? (fh - rh) / 2 : Math.min(0, Math.max(fh - rh, fh / 2 - cam.y * rh));
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: srcW, height: srcH, transformOrigin: "0 0", transform: `translate(${tx}px, ${ty}px) scale(${s})` }}>
      {children}
    </div>
  );
};

// ------------------------------------------------------------------ clip playback

export type Segment = { from: number; to: number; rate?: number };

/** Plays clip segments back to back (seconds in the source), then holds the last frame. */
export const ClipSegments: React.FC<{ src: string; segments: Segment[]; total: number; w: number; h: number }> = ({ src, segments, total, w, h }) => {
  let at = 0;
  const parts: React.ReactNode[] = [];
  segments.forEach((s, i) => {
    const rate = s.rate ?? 1;
    const dur = Math.max(1, Math.round(((s.to - s.from) / rate) * FPS));
    parts.push(
      <Sequence key={i} from={at} durationInFrames={dur} layout="none">
        <OffthreadVideo src={staticFile(src)} startFrom={Math.round(s.from * FPS)} playbackRate={rate} muted style={{ width: w, height: h }} />
      </Sequence>,
    );
    at += dur;
  });
  if (at < total && segments.length) {
    const last = segments[segments.length - 1];
    parts.push(
      <Sequence key="hold" from={at} durationInFrames={total - at} layout="none">
        <Freeze frame={Math.max(0, Math.round(last.to * FPS) - 2)}>
          <OffthreadVideo src={staticFile(src)} muted style={{ width: w, height: h }} />
        </Freeze>
      </Sequence>,
    );
  }
  return <>{parts}</>;
};

export const SceneFade: React.FC<{ durationInFrames: number; children: React.ReactNode }> = ({ durationInFrames, children }) => {
  const op = useFade(durationInFrames, 8, 8);
  return <AbsoluteFill style={{ opacity: op }}>{children}</AbsoluteFill>;
};

export const useSize = () => {
  const { width, height } = useVideoConfig();
  return { width, height };
};

// ------------------------------------------------------------------ manual-clip overlays

/** Small in-frame chip shown while a sped-up part of a wallet recording plays. */
export const SpedUpChip: React.FC<{ layout: Layout; ranges: { from: number; to: number; rate: number }[] }> = ({ layout, ranges }) => {
  const f = useCurrentFrame();
  const t = f / FPS;
  const r = ranges.find((x) => t >= x.from - 0.05 && t <= x.to + 0.25);
  if (!r) return null;
  const L = LAYOUT[layout].frame;
  return (
    <div style={{ position: "absolute", left: L.x + L.w - 250, top: L.y + L.bar + 16, width: 230, display: "flex", justifyContent: "flex-end", zIndex: 25 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 16px", borderRadius: 999, background: "rgba(14,14,14,0.9)", border: "1px solid rgba(255,255,255,0.16)", fontFamily: MONO, fontSize: layout === "tall" ? 20 : 18, letterSpacing: "0.12em", color: "#fff" }}>
        <span style={{ width: 9, height: 9, borderRadius: 99, background: C.yellow }} />
        SPED UP {r.rate}×
      </div>
    </div>
  );
};

/** Quick crossfade over a hard cut inside one clip: the last frame before the cut fades out on top. */
export const CutFades: React.FC<{ src: string; cuts: number[]; w: number; h: number }> = ({ src, cuts, w, h }) => {
  const f = useCurrentFrame();
  return (
    <>
      {cuts.map((c) => {
        const cf = Math.round(c * FPS);
        if (f < cf || f > cf + 9) return null;
        const op = interpolate(f, [cf, cf + 9], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        return (
          <div key={c} style={{ position: "absolute", left: 0, top: 0, width: w, height: h, opacity: op }}>
            <Freeze frame={Math.max(0, cf - 2)}>
              <OffthreadVideo src={staticFile(src)} muted style={{ width: w, height: h }} />
            </Freeze>
          </div>
        );
      })}
    </>
  );
};
