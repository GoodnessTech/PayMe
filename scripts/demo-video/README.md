# PayMe demo video

The hackathon demo video. Playwright records the **live** site, and [Remotion](https://www.remotion.dev) edits it.

This is a separate package and isn't part of the app build. Recordings, renders and audio go to `demo-output/` and `public/`, both gitignored, so no media is ever committed.

## Pipeline

Run these from `scripts/demo-video/`:

```bash
npm install                      # Remotion, Playwright, msedge-tts (uses installed Chrome; no Chromium download needed)
node record.mjs                  # C1–C7 on https://payme-opal.vercel.app → public/clips/*.mp4 + *.json (event marks, element boxes)
node terminal.mjs                # runs npm run verify:sample + npm run contract:test, saves the real output → public/terminal.json
node trim-manual.mjs             # manual wallet recordings → demo-output/*-trimmed.mp4 + *-trimmed.json (cuts, sped-up ranges)
node prepare.mjs                 # (npm run assets) collects clips, trimmed recordings, terminal output, and on-chain data → src/generated/assets.json
node voiceover.mjs               # optional: draft narration per scene (Edge neural voice) → public/vo/*.mp3
npm run render:main              # 16:9 1920x1080 → demo-output/payme-demo-16x9.mp4
npm run render:vertical          # 4:5 1080x1350 → demo-output/payme-demo-4x5.mp4
npm run render:vo                # voiceover track aligned to the edit → demo-output/voiceover-draft.mp3
npm run mux:vo                   # 16:9 + voiceover → demo-output/payme-demo-16x9-voiceover.mp4
```

## Notes

- **The story.** Scene order, captions, chips, durations and narration all live in [`src/script.json`](src/script.json).
- **Recording.** Frames come from Chrome's screencast at 2560×1440, so the camera can zoom without blur. A visible cursor is injected into the page, and typing and mouse moves run at human speed. Each step waits for real UI state, not fixed sleeps.
- **Marks.** The recorder's event marks are wall-clock times and drift (by up to about 2.5 s) against the screencast video. The cut points that matter were read off the actual frames with `contact-sheet.mjs`, and [`mark-fixes.json`](mark-fixes.json) overrides the recorded values.
- **Speed and honesty.** Only the AI wait is sped up (3×), plus the wallet waits in the manual recordings, each shown with a "SPED UP n×" chip. Everything else plays in real time; jump cuts are allowed, speed changes are not. The end card says so.
- **Explorer.** testnet.nearblocks.io blocks automated browsers (Cloudflare), and this script doesn't try to get around that. Record `demo-output/manual-nearblocks.mp4` by hand. Without it, the video shows the same transaction read from NEAR RPC, with an honest chip.
- **ffmpeg.** The scripts use system ffmpeg if available, otherwise the copy bundled with Remotion. That copy has no freezedetect, setpts or xfade filters, so dead-time detection (`analyze-manual.mjs`), retiming and crossfades are implemented in these scripts instead.
- **Music slot.** Set `MUSIC` in [`src/Root.tsx`](src/Root.tsx) to a royalty-free track under `public/`. The default is no music.
