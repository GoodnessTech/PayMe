import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import script from "./script.json";
import assets from "./generated/assets.json";
import vo from "./generated/vo.json";
import { Background, BrowserFrame, Camera, Captions, Chip, ClipSegments, CutFades, SceneFade, SpedUpChip, Watermark, type CamKey, type Segment } from "./components/ui";
import { ColdOpen, EndCard, OnChainCard, Problem, TamperIntro, Terminal, TxCard } from "./scenes/Graphics";
import { FPS, type Layout } from "./theme";

export const LIVE_HOST = "payme-opal.vercel.app";
const OVERLAP = 8; // frames of crossfade between scenes

type Box = { x: number; y: number; w: number; h: number };
type ClipMeta = { src: string; duration: number; width: number; height: number; marks: Record<string, number>; boxes?: Record<string, Box> };
type ManualMeta = { src: string; duration: number; width: number; height: number; trimmed?: boolean; cuts?: number[]; sped?: { from: number; to: number; rate: number }[] };
type Caption = { from: number; to: number; text: string };
type SceneDef = (typeof script.scenes)[number] & { kinetic?: Caption[]; clip?: string; manual?: string; chip?: { text: string; status: string } };

const clips = assets.clips as unknown as Record<string, ClipMeta>;
const manual = assets.manual as unknown as Record<string, ManualMeta>;

const k = (t: number, zoom: number, x = 0.5, y = 0.5): CamKey => ({ t, zoom, x, y });
const at = (b: Box | undefined, fallback: { x: number; y: number }) => (b ? { x: b.x, y: b.y } : fallback);

// One browser "shot": a clip (or manual recording) played through segments with a camera.
type Shot = { src: string; w: number; h: number; url: string; segments: Segment[]; keys: CamKey[]; seconds: number; manual?: { cuts: number[]; sped: { from: number; to: number; rate: number }[] } };

const shotFromClip = (name: string, url: string, segments: (c: ClipMeta) => Segment[], keys: (c: ClipMeta) => CamKey[], seconds: number): Shot | null => {
  const c = clips[name];
  if (!c) return null;
  return { src: c.src, w: c.width, h: c.height, url, segments: segments(c), keys: keys(c), seconds };
};

const shotFromManual = (name: string, url: string, seconds: number): Shot | null => {
  const m = manual[name];
  if (!m) return null;
  // Trimmed recordings (trim-manual.mjs) play whole; untrimmed ones use their end.
  const len = m.trimmed ? m.duration - 0.05 : Math.min(seconds, m.duration);
  const from = m.trimmed ? 0 : Math.max(0, m.duration - len - 0.1);
  return { src: m.src, w: m.width, h: m.height, url, segments: [{ from, to: from + len }], keys: [k(0, 1.0), k(len, 1.04)], seconds: len, manual: { cuts: m.trimmed ? m.cuts ?? [] : [], sped: m.trimmed ? m.sped ?? [] : [] } };
};

const ShotView: React.FC<{ shot: Shot; layout: Layout }> = ({ shot, layout }) => (
  <>
    <BrowserFrame layout={layout} url={shot.url}>
      {/* Wide wallet recordings: slight crop in 16:9, fitted (no crop) in 4:5. */}
      <Camera layout={layout} keys={shot.keys} srcW={shot.w} srcH={shot.h} fit={shot.manual && layout === "tall" ? "contain" : "cover"}>
        <ClipSegments src={shot.src} segments={shot.segments} total={Math.round(shot.seconds * FPS)} w={shot.w} h={shot.h} />
        {shot.manual && <CutFades src={shot.src} cuts={shot.manual.cuts} w={shot.w} h={shot.h} />}
      </Camera>
    </BrowserFrame>
    {shot.manual && <SpedUpChip layout={layout} ranges={shot.manual.sped} />}
  </>
);

/** Several shots back to back inside one scene. */
const Shots: React.FC<{ shots: Shot[]; layout: Layout }> = ({ shots, layout }) => {
  let from = 0;
  return (
    <>
      {shots.map((s, i) => {
        const dur = Math.round(s.seconds * FPS);
        const el = (
          <Sequence key={i} from={from} durationInFrames={dur} layout="none">
            <ShotView shot={s} layout={layout} />
          </Sequence>
        );
        from += dur;
        return el;
      })}
    </>
  );
};

// ------------------------------------------------------------------ scene builders

type Built = { id: string; voOffset?: number; seconds: number; chip?: { text: string; status: "green" | "red" }; captions: Caption[]; render: (layout: Layout) => React.ReactNode };

function buildScenes(): Built[] {
  const out: Built[] = [];
  const invoiceUrl = `${LIVE_HOST}/pay/${assets.invoice.id}#…`;
  for (const s of script.scenes as SceneDef[]) {
    const chip = s.chip ? { text: s.chip.text, status: (s.chip.status === "red" ? "red" : "green") as "green" | "red" } : undefined;
    const base = { id: s.id, voOffset: (s as { voOffset?: number }).voOffset ?? 0, seconds: s.duration, chip, captions: s.captions as Caption[] };
    switch (s.id) {
      case "coldOpen":
        out.push({ ...base, render: (l) => <ColdOpen layout={l} lines={s.kinetic as Caption[]} /> });
        break;
      case "problem":
        out.push({ ...base, render: (l) => <Problem layout={l} /> });
        break;
      case "landing": {
        const shot = shotFromClip("c1_landing", LIVE_HOST, () => [{ from: 0.2, to: 0.2 + s.duration }], () => [k(0, 1.0, 0.5, 0.45), k(s.duration, 1.14, 0.5, 0.42)], s.duration);
        if (shot) out.push({ ...base, render: (l) => <Shots shots={[shot]} layout={l} /> });
        break;
      }
      case "create": {
        const shot = shotFromClip(
          "c2_create",
          `${LIVE_HOST}/new`,
          (c) => [
            { from: Math.max(0, c.marks.typeStart - 0.7), to: c.marks.aiStart },
            { from: c.marks.aiStart, to: c.marks.aiEnd, rate: 3 },
            { from: c.marks.aiEnd, to: c.duration },
          ],
          (c) => {
            const typed = c.marks.aiStart - Math.max(0, c.marks.typeStart - 0.7);
            const ai = (c.marks.aiEnd - c.marks.aiStart) / 3;
            const ta = at(c.boxes?.textarea, { x: 0.5, y: 0.5 });
            const fields = at(c.boxes?.fieldsCard, { x: 0.5, y: 0.5 });
            const badge = at(c.boxes?.badge, { x: 0.5, y: 0.6 });
            return [
              k(0, 1.0, 0.5, 0.5),
              k(0.7, 1.45, ta.x, ta.y),
              k(typed - 0.6, 1.45, ta.x, ta.y),
              k(typed + 0.3, 1.0, 0.5, 0.5),
              k(typed + ai + 0.2, 1.0, 0.5, 0.5),
              k(typed + ai + 1.6, 1.22, fields.x, Math.min(0.62, fields.y)),
              k(c.marks.badge - c.marks.aiEnd + typed + ai - 0.4, 1.22, fields.x, 0.6),
              k(c.marks.badge - c.marks.aiEnd + typed + ai + 0.8, 1.3, badge.x, badge.y),
              k(s.duration, 1.3, badge.x, badge.y),
            ];
          },
          s.duration,
        );
        if (shot) out.push({ ...base, render: (l) => <Shots shots={[shot]} layout={l} /> });
        break;
      }
      case "proof": {
        const shot = shotFromClip(
          "c3_proof",
          `${LIVE_HOST}/new`,
          (c) => [
            { from: Math.max(0, c.marks.modalOpen - 0.6), to: c.marks.topEnd },
            { from: c.marks.checksScrollFrom, to: c.marks.checksEnd },
          ],
          (c) => {
            const m = at(c.boxes?.modal, { x: 0.5, y: 0.5 });
            return [k(0, 1.0, m.x, m.y), k(0.8, 1.0, m.x, m.y), k(2.0, 1.5, m.x, m.y), k(s.duration, 1.55, m.x, m.y)];
          },
          s.duration,
        );
        if (shot) out.push({ ...base, render: (l) => <Shots shots={[shot]} layout={l} /> });
        break;
      }
      case "manualCreate": {
        const shot = shotFromManual("manual-create", `${LIVE_HOST}/new`, s.duration);
        if (shot) out.push({ ...base, seconds: Math.max(4, shot.seconds), render: (l) => <Shots shots={[shot]} layout={l} /> });
        break;
      }
      case "breakIt": {
        const intro = 4.6;
        const shot = shotFromClip(
          "c5_tampered",
          `${LIVE_HOST}/pay/${assets.invoice.id}#…(edited)`,
          () => [{ from: 0.1, to: clips.c5_tampered?.duration ?? 5 }],
          (c) => {
            const w = at(c.boxes?.warning, { x: 0.5, y: 0.45 });
            return [k(0, 1.0), k(1.2, 1.0), k(2.6, 1.5, w.x, w.y), k(s.duration - intro, 1.5, w.x, w.y)];
          },
          s.duration - intro,
        );
        out.push({
          ...base,
          render: (l) => (
            <>
              <Sequence durationInFrames={Math.round(intro * FPS) + 6} layout="none">
                <TamperIntro layout={l} original={assets.tamper.original} invoiceId={assets.invoice.id} durationInFrames={Math.round(intro * FPS) + 6} />
              </Sequence>
              {shot && (
                <Sequence from={Math.round(intro * FPS)} layout="none">
                  <Shots shots={[shot]} layout={l} />
                </Sequence>
              )}
            </>
          ),
        });
        break;
      }
      case "realLink": {
        const shot = shotFromClip(
          "c5_original",
          invoiceUrl,
          (c) => [{ from: 0.1, to: c.duration }],
          (c) => {
            const v = at(c.boxes?.verified, { x: 0.35, y: 0.7 });
            return [k(0, 1.0), k(1.6, 1.55, v.x, v.y), k(s.duration, 1.6, v.x, v.y)];
          },
          s.duration,
        );
        if (shot) out.push({ ...base, render: (l) => <Shots shots={[shot]} layout={l} /> });
        break;
      }
      case "quotes": {
        const c = clips.c6_quotes;
        if (!c) break;
        // Real time throughout; one jump cut inside the ~4 s Base-quote spinner.
        const a1: Segment = { from: Math.max(0, c.marks.baseRequested - 1.0), to: c.marks.baseLoadingCut };
        const a2: Segment = { from: c.marks.baseResume, to: c.marks.baseQuote + 2.2 };
        const aLen = a1.to - a1.from + (a2.to - a2.from);
        const b: Segment = { from: Math.max(c.marks.solRequested - 0.8, a2.to), to: Math.min(c.duration, c.marks.solQuote + 3.0) };
        // Centre between both payment cards so no empty page edge shows.
        const q = { x: 0.5, y: at(c.boxes?.quoteCard, { x: 0.5, y: 0.6 }).y };
        const shotA: Shot = { src: c.src, w: c.width, h: c.height, url: invoiceUrl, segments: [a1, a2], keys: [k(0, 1.0, 0.5, q.y), k(1.0, 1.28, q.x, q.y), k(aLen, 1.3, q.x, q.y)], seconds: aLen };
        const shotB: Shot = { src: c.src, w: c.width, h: c.height, url: invoiceUrl, segments: [b], keys: [k(0, 1.3, q.x, q.y), k(s.duration - aLen, 1.34, q.x, q.y)], seconds: s.duration - aLen };
        out.push({ ...base, render: (l) => <Shots shots={[shotA, shotB]} layout={l} /> });
        break;
      }
      case "pay": {
        const nbUrl = `testnet.nearblocks.io/txns/${assets.invoice.payTx.slice(0, 10)}…`;
        const first =
          shotFromManual("manual-pay", invoiceUrl, 7.5) ??
          shotFromClip(
            "c4_verified",
            invoiceUrl,
            (c) => [{ from: Math.max(0, c.marks.paidBox - 0.5), to: c.duration }],
            (c) => {
              const p = at(c.boxes?.paid, { x: 0.35, y: 0.6 });
              return [k(0, 1.0), k(1.0, 1.45, p.x, p.y), k(6, 1.5, p.x, p.y)];
            },
            6,
          );
        const rest = s.duration - (first?.seconds ?? 0);
        // C7: the pay transaction. Prefer a real nearblocks recording (manual, since the
        // explorer blocks automated browsers); otherwise show the same tx read from NEAR RPC.
        const nb =
          shotFromManual("manual-nearblocks", nbUrl, rest) ??
          shotFromClip("c7_nearblocks", nbUrl, (c) => [{ from: 0.1, to: c.duration }], () => [k(0, 1.0, 0.5, 0.4), k(rest, 1.25, 0.45, 0.42)], rest);
        const firstFrames = Math.round((first?.seconds ?? 0) * FPS);
        const chipText = nb ? "ON-CHAIN · TESTNET.NEARBLOCKS.IO" : "ON-CHAIN · REAL TESTNET TX · payme-invoices.testnet";
        out.push({
          ...base,
          chip: { text: chipText, status: "green" },
          render: (l) => (
            <>
              {first && <Shots shots={[first]} layout={l} />}
              <Sequence from={firstFrames} layout="none">
                {nb ? <Shots shots={[{ ...nb, seconds: rest }]} layout={l} /> : <TxCard layout={l} tx={assets.payTxInfo as never} />}
              </Sequence>
            </>
          ),
        });
        break;
      }
      case "dashboard": {
        const shot = shotFromManual("manual-dashboard", "localhost:5173/dashboard (local build)", s.duration);
        if (shot) out.push({ ...base, render: (l) => <Shots shots={[shot]} layout={l} /> });
        else
          out.push({
            ...base,
            chip: { text: "ON-CHAIN · get_invoice · payme-invoices.testnet", status: "green" },
            render: (l) => <OnChainCard layout={l} invoice={assets.invoice as never} />,
          });
        break;
      }
      case "terminal":
        if (assets.terminal) out.push({ ...base, render: (l) => <Terminal layout={l} blocks={assets.terminal!.blocks} /> });
        break;
      case "endCard":
        out.push({ ...base, render: (l) => <EndCard layout={l} liveUrl={LIVE_HOST} /> });
        break;
    }
  }
  return out;
}

export const SCENES = buildScenes();

/** Start frame of each scene (scenes overlap by OVERLAP frames for crossfades). */
export const TIMELINE = (() => {
  let from = 0;
  return SCENES.map((s, i) => {
    const dur = Math.round(s.seconds * FPS);
    const entry = { ...s, from, dur };
    from += dur - (i < SCENES.length - 1 ? OVERLAP : 0);
    return entry;
  });
})();

export const TOTAL_FRAMES = TIMELINE.length ? TIMELINE[TIMELINE.length - 1].from + TIMELINE[TIMELINE.length - 1].dur : 1;

export type VideoProps = { layout: Layout; voiceover: boolean; music: string | null };

export const PayMeVideo: React.FC<VideoProps> = ({ layout, voiceover, music }) => (
  <AbsoluteFill style={{ backgroundColor: "#141414" }}>
    <Background />
    {TIMELINE.map((s) => (
      <Sequence key={s.id} from={s.from} durationInFrames={s.dur} layout="none">
        <SceneFade durationInFrames={s.dur}>
          {s.render(layout)}
          {s.chip && <Chip text={s.chip.text} status={s.chip.status} layout={layout} />}
          <Captions captions={s.captions} layout={layout} />
        </SceneFade>
      </Sequence>
    ))}
    <Watermark layout={layout} />
    {/* MUSIC SLOT: pass a file under public/ as the `music` prop (e.g. "music/track.mp3"). Off by default. */}
    {music && <Audio src={staticFile(music)} volume={0.18} loop />}
    {voiceover &&
      TIMELINE.map((s) => {
        const file = (vo as Record<string, { file: string; seconds: number }>)[s.id];
        return file ? (
          <Sequence key={`vo-${s.id}`} from={s.from + 6 + Math.round((s.voOffset ?? 0) * FPS)} layout="none">
            <Audio src={staticFile(file.file)} />
          </Sequence>
        ) : null;
      })}
  </AbsoluteFill>
);
