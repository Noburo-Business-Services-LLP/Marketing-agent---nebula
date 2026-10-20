import React from 'react';
import CoverTile, { type CoverPalette } from '../CoverTile';
import { SinglePostArt } from '../art/SinglePost';
import { CarouselArt } from '../art/Carousel';
import { CampaignArt } from '../art/Campaign';
import { VideoArt } from '../art/Video';
import { PhotoshootArt } from '../art/Photoshoot';
import { LinkedInArt } from '../art/LinkedIn';
import { createPhoto } from '../../utils/samplePhotos';
import { LANDING_ROUTES, MAKE, type MakeKey } from '../../constants/landingCopy';
import { SectionHead } from './LandingBits';

/** The same art, palette and photo slot as the app's Create content tiles, so the page shows what the app looks like. */
const LOOK: Record<MakeKey, { art: React.ReactNode; palette: CoverPalette; overlay?: 'play' | 'slides' }> = {
  single: { art: <SinglePostArt />, palette: 'gold' },
  carousel: { art: <CarouselArt />, palette: 'teal', overlay: 'slides' },
  campaign: { art: <CampaignArt />, palette: 'coral' },
  video: { art: <VideoArt />, palette: 'ink', overlay: 'play' },
  photoshoot: { art: <PhotoshootArt />, palette: 'plum' },
  linkedin: { art: <LinkedInArt />, palette: 'blue' },
};

/** "What you can make": six cover tiles, two rows of three (three rows of two on a phone), each opening sign-up. */
const MakeSection: React.FC = () => (
  <section className="nb-land-section nb-land-make" id="make" aria-labelledby="make-title">
    <div className="nb-land-wrap">
      <SectionHead id="make-title" eyebrow={MAKE.eyebrow} title={MAKE.title} emphasis={MAKE.emphasis} />
      <div className="nb-cover-grid nb-land-make-grid">
        {MAKE.tiles.map((t) => {
          const look = LOOK[t.key];
          return (
            <CoverTile
              key={t.key} title={t.title} subtitle={t.line} price={t.chip} art={look.art} palette={look.palette}
              image={createPhoto(t.key)} overlay={look.overlay} to={LANDING_ROUTES.signUp}
            />
          );
        })}
      </div>
      <p className="nb-land-note">{MAKE.note}</p>
    </div>
  </section>
);

export default MakeSection;
