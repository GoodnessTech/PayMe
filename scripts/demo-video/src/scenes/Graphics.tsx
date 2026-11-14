import React from "react";
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame } from "remotion";
import { C, FPS, HEAD, LAYOUT, MONO, type Layout } from "../theme";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

// ------------------------------------------------------------------ cold open: kinetic type

const Kinetic: React.FC<{ text: string; start: number; end: number; size: number; accent: string[]; maxWidth: number }> = ({ text, start, end, size, accent, maxWidth }) => {
  const f = useCurrentFrame();
  const words = text.split(" ");
  const out = interpolate(f, [end * FPS - 10, end * FPS], [1, 0], clamp);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: `0 ${size * 0.26}px`, maxWidth, opacity: out }}>
      {words.map((w, i) => {
        const t0 = start * FPS + i * 4;
        const p = spring({ frame: f - t0, fps: FPS, config: { damping: 18, stiffness: 120 } });
        const isAccent = accent.some((a) => w.toLowerCase().includes(a));
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              opacity: p,
              transform: `translateY(${(1 - p) * 34}px)`,
              filter: `blur(${(1 - p) * 8}px)`,
              color: isAccent ? C.green : C.white,
              fontFamily: HEAD,
              fontWeight: 800,
              fontSize: size,
              lineHeight: 1.06,
              letterSpacing: "-0.04em",
            }}
          >
            {w}
          </span>
        );
      })}
    </div>
  );
};

export const ColdOpen: React.FC<{ layout: Layout; lines: { from: number; to: number; text: string }[] }> = ({ layout, lines }) => {
  const f = useCurrentFrame();
  const L = LAYOUT[layout];
  const size = layout === "wide" ? 92 : 84;
  const showFirst = f < lines[1].from * FPS;
  const l = showFirst ? lines[0] : lines[1];
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: 80 }}>
      <div style={{ position: "absolute", top: layout === "wide" ? 70 : 90, fontFamily: MONO, fontSize: 20, letterSpacing: "0.22em", color: "rgba(255,255,255,0.45)", opacity: interpolate(f, [0, 15], [0, 1], clamp) }}>
        NEAR HACKATHON 2026 · REAL-WORLD MONEY · PRIVACY & PRIVATE AI
      </div>
      <Kinetic
        key={l.text}
        text={l.text}
        start={l.from}
        end={l.to}
        size={size}
        accent={showFirst ? ["money", "work?"] : ["africa."]}
        maxWidth={L.width - 200}
      />
    </AbsoluteFill>
  );
};

// ------------------------------------------------------------------ problem diagram

const Person: React.FC<{ initial: string; name: string; place: string; tag: string; tagColor: string; x: number; y: number; appear: number }> = ({ initial, name, place, tag, tagColor, x, y, appear }) => {
  const f = useCurrentFrame();
  const p = spring({ frame: f - appear, fps: FPS, config: { damping: 16 } });
  return (
    <div style={{ position: "absolute", left: x - 120, top: y - 110, width: 240, display: "flex", flexDirection: "column", alignItems: "center", opacity: p, transform: `scale(${0.85 + 0.15 * p})` }}>
      <div style={{ width: 132, height: 132, borderRadius: 99, background: "#262626", border: "2px solid rgba(255,255,255,0.18)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: HEAD, fontWeight: 800, fontSize: 58, color: C.white }}>{initial}</div>
      <div style={{ marginTop: 16, fontFamily: HEAD, fontWeight: 700, fontSize: 34, color: C.white }}>{name}</div>
      <div style={{ fontFamily: MONO, fontSize: 19, letterSpacing: "0.14em", color: C.muted, textTransform: "uppercase" }}>{place}</div>
      <div style={{ marginTop: 12, padding: "7px 16px", borderRadius: 99, background: tagColor, color: "#121212", fontFamily: MONO, fontSize: 19, fontWeight: 500 }}>{tag}</div>
    </div>
  );
};

export const Problem: React.FC<{ layout: Layout }> = ({ layout }) => {
  const f = useCurrentFrame();
  const L = LAYOUT[layout];
  const W = L.width;
  const top = layout === "wide" ? 70 : 120;
  const H = layout === "wide" ? 780 : 820;
  const yRow = top + (layout === "wide" ? 430 : 520);
  const xL = layout === "wide" ? 430 : 200;
  const xR = W - xL;
  // money line (client -> freelancer)
  const draw = interpolate(f, [30, 70], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const xMid = (xL + xR) / 2;
  const cross = spring({ frame: f - 85, fps: FPS, config: { damping: 12 } });
  const fee = spring({ frame: f - 120, fps: FPS, config: { damping: 14 } });
  // invoice -> black box (second half)
  const t2 = 7 * FPS;
  const fly = interpolate(f, [t2 + 15, t2 + 70], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const box = spring({ frame: f - t2, fps: FPS, config: { damping: 15 } });
  const boxY = top + (layout === "wide" ? 70 : 90);
  const invStart = { x: xR, y: yRow - 60 };
  const invEnd = { x: xMid, y: boxY + 70 };
  const invX = invStart.x + (invEnd.x - invStart.x) * fly;
  const invY = invStart.y + (invEnd.y - invStart.y) * fly - Math.sin(fly * Math.PI) * 120;
  const dim = interpolate(f, [t2 - 10, t2 + 10], [1, 0.35], clamp);
  const eye = 0.6 + 0.4 * Math.abs(Math.sin(f / 10));
  return (
    <AbsoluteFill style={{ transform: `scale(${layout === "wide" ? 1.16 : 1.05})`, transformOrigin: "50% 42%" }}>
      <div style={{ position: "absolute", left: 0, top, width: W, height: H }} />
      {/* money line with bridge */}
      <svg width={W} height={L.height} style={{ position: "absolute", left: 0, top: 0, opacity: f < t2 ? 1 : dim }}>
        <defs>
          <marker id="arr" markerWidth="12" markerHeight="12" refX="9" refY="6" orient="auto">
            <path d="M0,0 L12,6 L0,12 z" fill="rgba(255,255,255,0.7)" />
          </marker>
        </defs>
        <line x1={xL + 110} y1={yRow - 40} x2={xL + 110 + (xR - xL - 220) * draw} y2={yRow - 40} stroke="rgba(255,255,255,0.55)" strokeWidth={4} strokeDasharray="14 12" markerEnd={draw > 0.98 ? "url(#arr)" : undefined} />
        {/* bridge arch */}
        <path d={`M ${xMid - 110} ${yRow - 40} Q ${xMid} ${yRow - 170} ${xMid + 110} ${yRow - 40}`} fill="none" stroke={C.yellow} strokeWidth={6} opacity={draw} />
        {[-70, -35, 0, 35, 70].map((dx) => (
          <line key={dx} x1={xMid + dx} y1={yRow - 40} x2={xMid + dx} y2={yRow - 40 - (1 - (dx / 110) ** 2) * 130 * 0.98} stroke={C.yellow} strokeWidth={3} opacity={draw * 0.7} />
        ))}
      </svg>
      {/* red X on the bridge */}
      <div style={{ position: "absolute", left: xMid - 50, top: yRow - 190, width: 100, height: 100, borderRadius: 99, background: C.red, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: HEAD, fontWeight: 800, fontSize: 64, transform: `scale(${cross})`, boxShadow: "0 12px 30px rgba(255,107,94,0.45)", opacity: f < t2 ? 1 : dim }}>✕</div>
      {/* fee tag */}
      <div style={{ position: "absolute", left: xMid - 160, top: yRow + 10, width: 320, display: "flex", flexDirection: "column", alignItems: "center", opacity: fee * (f < t2 ? 1 : dim), transform: `translateY(${(1 - fee) * 20}px)` }}>
        <div style={{ padding: "10px 22px", borderRadius: 16, background: C.yellow, color: "#1a1a1a", fontFamily: HEAD, fontWeight: 800, fontSize: 44 }}>8–9% fees</div>
        <div style={{ marginTop: 10, fontFamily: MONO, fontSize: 15, color: C.muted, textAlign: "center", lineHeight: 1.35, whiteSpace: "pre-line" }}>avg. cost to send $200 to Sub-Saharan Africa{"\n"}(World Bank, Remittance Prices Worldwide)</div>
      </div>
      <div style={{ opacity: f < t2 ? 1 : dim }}>
        <Person initial="C" name="Client" place="London" tag="USDC · on Base" tagColor={C.blue} x={xL} y={yRow} appear={4} />
        <Person initial="T" name="Tunde" place="Lagos · designer" tag="on NEAR" tagColor={C.green} x={xR} y={yRow} appear={14} />
      </div>
      {/* black-box AI with an eye */}
      <div style={{ position: "absolute", left: xMid - 190, top: boxY, width: 380, height: 170, borderRadius: 22, background: "#050505", border: "2px solid rgba(255,255,255,0.22)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", opacity: box, transform: `scale(${0.8 + 0.2 * box})`, boxShadow: "0 20px 50px rgba(0,0,0,0.6)" }}>
        <svg width="110" height="60" viewBox="0 0 110 60">
          <path d="M5 30 Q55 -12 105 30 Q55 72 5 30 Z" fill="none" stroke="#fff" strokeWidth="4" />
          <circle cx="55" cy="30" r={13 * eye} fill={C.red} />
        </svg>
        <div style={{ marginTop: 8, fontFamily: MONO, fontSize: 17, letterSpacing: "0.12em", color: C.muted, whiteSpace: "nowrap" }}>WHO READS YOUR INVOICE?</div>
      </div>
      {/* flying invoice */}
      <div style={{ position: "absolute", left: invX - 60, top: invY - 75, width: 120, height: 150, borderRadius: 12, background: "#fff", boxShadow: "0 14px 30px rgba(0,0,0,0.5)", opacity: f < t2 ? 0 : 1 - Math.max(0, fly - 0.85) * 6, transform: `rotate(${-8 + fly * 16}deg) scale(${1 - fly * 0.35})`, padding: 14 }}>
        <div style={{ fontFamily: HEAD, fontWeight: 800, fontSize: 16, color: "#111" }}>INVOICE</div>
        {[70, 90, 60, 80, 50].map((w, i) => (
          <div key={i} style={{ marginTop: 9, height: 7, width: `${w}%`, borderRadius: 4, background: i === 3 ? C.green : "#ddd" }} />
        ))}
      </div>
    </AbsoluteFill>
  );
};

// ------------------------------------------------------------------ tamper overlay (decode -> edit -> re-encode)

export const TamperIntro: React.FC<{ layout: Layout; original: string; invoiceId: string; durationInFrames: number }> = ({ layout, original, invoiceId, durationInFrames }) => {
  const f = useCurrentFrame();
  const L = LAYOUT[layout];
  const fr = L.frame;
  const pretty = JSON.parse(original) as Record<string, unknown>;
  const strike = interpolate(f, [40, 52], [0, 1], clamp);
  const newVal = spring({ frame: f - 52, fps: FPS, config: { damping: 13 } });
  const op = interpolate(f, [0, 8, durationInFrames - 8, durationInFrames], [0, 1, 1, 0], clamp);
  const fs = layout === "wide" ? 30 : 27;
  return (
    <div style={{ position: "absolute", left: fr.x, top: fr.y, width: fr.w, height: fr.h, borderRadius: 24, background: "#0d0d0d", boxShadow: "0 40px 120px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.08)", opacity: op, padding: layout === "wide" ? "54px 70px" : "48px 40px", fontFamily: MONO, color: "rgba(255,255,255,0.86)" }}>
      <div style={{ fontSize: 20, letterSpacing: "0.14em", color: C.muted }}>THE LINK · payme-opal.vercel.app/pay/{invoiceId}#…</div>
      <div style={{ marginTop: 10, fontSize: 20, color: "rgba(255,255,255,0.45)" }}>everything after # decoded (base64url → JSON):</div>
      <div style={{ marginTop: 28, fontSize: fs, lineHeight: 1.75 }}>
        {"{"}
        {Object.entries(pretty).map(([k, v]) => {
          const isAmt = k === "amountUsd";
          return (
            <div key={k} style={{ paddingLeft: 36, background: isAmt ? "rgba(255,107,94,0.12)" : "transparent", borderRadius: 8 }}>
              <span style={{ color: C.blue }}>"{k}"</span>: {isAmt ? (
                <>
                  <span style={{ position: "relative", color: C.yellow }}>
                    5
                    <span style={{ position: "absolute", left: -4, right: -4, top: "52%", height: 4, background: C.red, transform: `scaleX(${strike})`, transformOrigin: "left" }} />
                  </span>
                  <span style={{ display: "inline-block", marginLeft: 18, color: C.red, fontWeight: 500, opacity: newVal, transform: `scale(${0.6 + 0.4 * newVal})` }}>500</span>
                  <span style={{ marginLeft: 22, fontSize: fs * 0.6, color: C.red, opacity: newVal }}>← edited</span>
                </>
              ) : (
                <span style={{ color: C.green }}>{JSON.stringify(v)}</span>
              )}
              ,
            </div>
          );
        })}
        {"}"}
      </div>
    </div>
  );
};

// ------------------------------------------------------------------ terminal overlay

type TermBlock = { command: string; lines: string[] };

export const Terminal: React.FC<{ layout: Layout; blocks: TermBlock[] }> = ({ layout, blocks }) => {
  const f = useCurrentFrame();
  const L = LAYOUT[layout];
  const fr = L.frame;
  const fs = layout === "wide" ? 25 : 23;
  // Build a flat list of rows with appear times.
  const rows: { text: string; kind: "cmd" | "pass" | "ok" | "plain"; at: number }[] = [];
  let t = 6;
  for (const b of blocks) {
    rows.push({ text: `$ ${b.command}`, kind: "cmd", at: t });
    t += 22;
    const picked = b.command.includes("contract")
      ? [...["refunds_excess_to_payer", "rejects_paying_twice", "rejects_underpayment", "on_payout_failure_reopens"].map((n) => b.lines.find((l) => l.includes(n))).filter((l): l is string => Boolean(l)), "…", ...b.lines.filter((l) => /^test result: ok. [1-9]/.test(l)).slice(0, 1)]
      : b.lines;
    for (const l of picked) {
      rows.push({ text: l, kind: l.startsWith("PASS") ? "pass" : /test result: ok|re-verified/.test(l) ? "ok" : "plain", at: t });
      t += 6;
    }
    t += 14;
  }
  const cta = spring({ frame: f - (t + 6), fps: FPS, config: { damping: 15 } });
  return (
    <>
      <div style={{ position: "absolute", left: fr.x, top: fr.y, width: fr.w, height: fr.h, borderRadius: 24, overflow: "hidden", background: "#0b0b0b", boxShadow: "0 40px 120px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.08)" }}>
        <div style={{ height: fr.bar, background: "#202020", display: "flex", alignItems: "center", padding: "0 18px", gap: 9 }}>
          {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
            <span key={c} style={{ width: 12, height: 12, borderRadius: 99, background: c, opacity: 0.85 }} />
          ))}
          <span style={{ margin: "0 auto", transform: "translateX(-30px)", fontFamily: MONO, fontSize: 15, color: "rgba(255,255,255,0.55)" }}>~/PayMe — terminal (output captured from a real run)</span>
        </div>
        <div style={{ padding: layout === "wide" ? "22px 40px 110px" : "24px 26px 120px", fontFamily: MONO, fontSize: fs, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {rows.map((r, i) => {
            const vis = f >= r.at;
            const chars = r.kind === "cmd" ? Math.floor(Math.max(0, f - r.at) * 2.2) : Infinity;
            const text = r.kind === "cmd" ? r.text.slice(0, chars) : r.text;
            const color = r.kind === "cmd" ? C.white : r.kind === "pass" || r.kind === "ok" ? C.green : "rgba(255,255,255,0.62)";
            return (
              <div key={i} style={{ opacity: vis ? 1 : 0, color, marginTop: r.kind === "cmd" && i > 0 ? 14 : 0 }}>
                {r.kind === "pass" ? (
                  <>
                    <span style={{ background: C.green, color: "#0d2a10", padding: "1px 8px", borderRadius: 5, marginRight: 10 }}>PASS</span>
                    {r.text.replace(/^PASS\s+/, "")}
                  </>
                ) : (
                  text
                )}
              </div>
            );
          })}
        </div>
        <div style={{ position: "absolute", left: 0, right: 0, bottom: layout === "wide" ? 34 : 40, display: "flex", justifyContent: "center", opacity: cta, transform: `translateY(${(1 - cta) * 16}px)` }}>
          <div style={{ padding: "14px 26px", borderRadius: 16, background: "rgba(183,240,161,0.12)", border: `1px solid ${C.green}`, fontFamily: MONO, fontSize: layout === "wide" ? 26 : 24, color: C.green }}>
            Check it yourself: <span style={{ color: C.white }}>npm run verify:sample</span>
          </div>
        </div>
      </div>
    </>
  );
};

// ------------------------------------------------------------------ on-chain card (dashboard fallback)

export const OnChainCard: React.FC<{ layout: Layout; invoice: { id: string; onChain: { status: string; amount_yocto: string; amount_usd_cents: number; recipient: string; payer: string | null } } }> = ({ layout, invoice }) => {
  const f = useCurrentFrame();
  const fr = LAYOUT[layout].frame;
  const p = spring({ frame: f - 4, fps: FPS, config: { damping: 16 } });
  const near = (Number(BigInt(invoice.onChain.amount_yocto) / 10n ** 18n) / 1e6).toString();
  return (
    <div style={{ position: "absolute", left: fr.x, top: fr.y, width: fr.w, height: fr.h, borderRadius: 24, background: "#0b0b0b", boxShadow: "0 40px 120px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.08)", padding: layout === "wide" ? "60px 90px" : "50px 40px", fontFamily: MONO, color: "rgba(255,255,255,0.8)", opacity: p, display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <div style={{ fontSize: layout === "wide" ? 28 : 24, color: C.muted }}>$ npm run invoice -- {invoice.id}</div>
      <div style={{ marginTop: 30, fontSize: layout === "wide" ? 36 : 28, lineHeight: 1.6 }}>
        <div>status: <span style={{ color: C.green }}>"{invoice.onChain.status}"</span></div>
        <div>recipient: "{invoice.onChain.recipient}"</div>
        <div>payer: "{invoice.onChain.payer}"</div>
        <div>amount: {near} NEAR (${(invoice.onChain.amount_usd_cents / 100).toFixed(2)})</div>
        <div style={{ color: C.muted }}>client name / description: not stored on-chain</div>
      </div>
      <div style={{ marginTop: 44, alignSelf: "flex-start", display: "inline-block", padding: "14px 24px", borderRadius: 16, background: C.green, color: "#132110", fontFamily: HEAD, fontWeight: 800, fontSize: 40 }}>Paid ✓</div>
    </div>
  );
};

// ------------------------------------------------------------------ end card

export const EndCard: React.FC<{ layout: Layout; liveUrl: string }> = ({ layout, liveUrl }) => {
  const f = useCurrentFrame();
  const L = LAYOUT[layout];
  const a = (d: number) => spring({ frame: f - d, fps: FPS, config: { damping: 16 } });
  const wide = layout === "wide";
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", padding: wide ? 60 : 50 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 26, opacity: a(2), transform: `scale(${0.9 + 0.1 * a(2)})` }}>
        <div style={{ width: wide ? 112 : 104, height: wide ? 112 : 104, borderRadius: "50%", background: "radial-gradient(circle at 35% 26%, #fff0a3, transparent 18%), linear-gradient(140deg,#f6dc72,#bd8e2b)", border: "4px solid #f9e8a1", boxShadow: "inset -7px -9px 0 rgba(124,79,16,.25), 0 18px 32px rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", gap: 14, transform: `rotate(${-9 + Math.sin(f / 18) * 3}deg)` }}>
          <span style={{ width: 11, height: 18, borderRadius: 99, background: "#2b1d06" }} />
          <span style={{ width: 11, height: 18, borderRadius: 99, background: "#2b1d06" }} />
        </div>
        <div style={{ fontFamily: HEAD, fontWeight: 800, fontSize: wide ? 110 : 100, letterSpacing: "-0.06em", color: C.white }}>PayMe</div>
      </div>
      <div style={{ marginTop: wide ? 36 : 44, fontFamily: HEAD, fontWeight: 800, fontSize: wide ? L.title : 70, letterSpacing: "-0.04em", color: C.white, textAlign: "center", opacity: a(14), transform: `translateY(${(1 - a(14)) * 20}px)`, lineHeight: 1.05 }}>
        Paste it. Share it. <span style={{ color: C.green }}>Get paid.</span>
      </div>
      <div style={{ marginTop: wide ? 40 : 50, display: "flex", flexDirection: "column", alignItems: "center", gap: 14, opacity: a(30) }}>
        <div style={{ padding: "14px 30px", borderRadius: 999, background: C.green, color: "#132110", fontFamily: HEAD, fontWeight: 800, fontSize: wide ? 34 : 34 }}>Try it live · {liveUrl}</div>
        <div style={{ fontFamily: MONO, fontSize: wide ? 28 : 28, color: C.white }}>github.com/GoodnessTech/PayMe</div>
      </div>
      <div style={{ marginTop: wide ? 36 : 46, fontFamily: MONO, fontSize: wide ? 20 : 19, letterSpacing: "0.1em", color: C.muted, textAlign: "center", opacity: a(42), lineHeight: 1.6, maxWidth: wide ? 1600 : 980 }}>
        BUILT FOR NEAR HACKATHON 2026 · NEAR AI CLOUD · NEAR INTENTS · NEAR TESTNET
      </div>
      <div style={{ position: "absolute", bottom: wide ? 70 : 80, left: 60, right: 60, textAlign: "center", fontFamily: MONO, fontSize: wide ? 20 : 19, color: "rgba(255,255,255,0.5)", opacity: a(54), lineHeight: 1.5 }}>
        Recorded on the live testnet build (dashboard: local build, same contract). AI call shown at 3×; wallet steps sped up; everything else real time. Cross-chain quotes are dry runs.
      </div>
    </AbsoluteFill>
  );
};

// ------------------------------------------------------------------ tx card (fallback when nearblocks can't be recorded)

type TxInfo = { hash: string; signer: string; receiver: string; method: string; args: Record<string, unknown>; deposit: string; success: boolean; returnValue: string | null; events: { event: string; data: Record<string, unknown> }[] };

export const TxCard: React.FC<{ layout: Layout; tx: TxInfo }> = ({ layout, tx }) => {
  const f = useCurrentFrame();
  const fr = LAYOUT[layout].frame;
  const row = (i: number) => spring({ frame: f - 6 - i * 5, fps: FPS, config: { damping: 16 } });
  const near = (Number(BigInt(tx.deposit) / 10n ** 18n) / 1e6).toString();
  const wide = layout === "wide";
  const rows: [string, React.ReactNode][] = [
    ["Transaction", <span style={{ color: C.white }}>{tx.hash}</span>],
    ["Status", <span style={{ color: tx.success ? C.green : C.red }}>{tx.success ? "Success" : "Failed"} · returned {tx.returnValue}</span>],
    ["From", tx.signer],
    ["To (contract)", tx.receiver],
    ["Method", <span style={{ color: C.blue }}>{tx.method}({JSON.stringify(tx.args)})</span>],
    ["Deposit", `${near} NEAR`],
    ["Event", <span style={{ color: C.green }}>{tx.events.map((e) => `${e.event} → ${String(e.data.recipient)}`).join(", ")}</span>],
  ];
  return (
    <div style={{ position: "absolute", left: fr.x, top: fr.y, width: fr.w, height: fr.h, borderRadius: 24, background: "#0b0b0b", boxShadow: "0 40px 120px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.08)", padding: wide ? "54px 70px" : "44px 34px", fontFamily: MONO, color: "rgba(255,255,255,0.75)", display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <div style={{ fontSize: wide ? 22 : 20, letterSpacing: "0.14em", color: C.muted }}>NEAR TESTNET · TRANSACTION (read from NEAR RPC)</div>
      <div style={{ marginTop: wide ? 30 : 26, display: "grid", gridTemplateColumns: wide ? "260px 1fr" : "1fr", rowGap: wide ? 24 : 8, columnGap: 24, fontSize: wide ? 30 : 23 }}>
        {rows.map(([k, v], i) => (
          <React.Fragment key={k}>
            <div style={{ color: C.muted, opacity: row(i), marginTop: wide ? 0 : 10 }}>{k}</div>
            <div style={{ opacity: row(i), wordBreak: "break-all" }}>{v}</div>
          </React.Fragment>
        ))}
      </div>
      <div style={{ position: "absolute", left: wide ? 64 : 34, bottom: wide ? 40 : 34, fontSize: wide ? 22 : 19, color: C.muted, opacity: row(8) }}>
        Verify: testnet.nearblocks.io/txns/{tx.hash.slice(0, 12)}…
      </div>
    </div>
  );
};
