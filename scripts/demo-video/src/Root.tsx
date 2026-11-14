import React from "react";
import { Composition } from "remotion";
import { PayMeVideo, TOTAL_FRAMES, type VideoProps } from "./Video";
import { FPS } from "./theme";

// MUSIC SLOT: set `music` to a royalty-free track placed under public/ (e.g. "music/track.mp3").
// Default is no music.
const MUSIC: string | null = null;

export const Root: React.FC = () => (
  <>
    <Composition id="PayMeDemo" component={PayMeVideo} durationInFrames={TOTAL_FRAMES} fps={FPS} width={1920} height={1080} defaultProps={{ layout: "wide", voiceover: false, music: MUSIC } satisfies VideoProps} />
    <Composition id="PayMeDemoVertical" component={PayMeVideo} durationInFrames={TOTAL_FRAMES} fps={FPS} width={1080} height={1350} defaultProps={{ layout: "tall", voiceover: false, music: MUSIC } satisfies VideoProps} />
    <Composition id="PayMeDemoVoiceover" component={PayMeVideo} durationInFrames={TOTAL_FRAMES} fps={FPS} width={1920} height={1080} defaultProps={{ layout: "wide", voiceover: true, music: MUSIC } satisfies VideoProps} />
  </>
);
