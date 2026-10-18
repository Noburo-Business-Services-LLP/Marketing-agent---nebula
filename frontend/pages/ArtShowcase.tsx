import React from 'react';
import Tile from '../components/Tile';
import TileGrid from '../components/TileGrid';
import DarkPanel from '../components/DarkPanel';
import * as Art from '../components/art';
import { TILE_ACCENTS } from '../utils/tiles';

/**
 * Developer page (only built in development and on the sample-data preview): every illustration
 * in the set, and the tile in each accent, variant and state, so they can be looked at together.
 * Route: /art-showcase. Not linked from the app.
 */
const PIECES: Array<[string, React.ComponentType<Art.ArtProps>]> = [
  ['Single post', Art.SinglePostArt], ['Campaign', Art.CampaignArt], ['Carousel', Art.CarouselArt], ['LinkedIn post', Art.LinkedInArt],
  ['Video', Art.VideoArt], ['Reel', Art.ReelArt], ['Photoshoot', Art.PhotoshootArt], ['Product', Art.ProductArt],
  ['Model', Art.ModelArt], ['Calendar', Art.CalendarArt], ['Inbox', Art.InboxArt], ['Reviews', Art.ReviewsArt],
  ['Automatic replies', Art.AutoReplyArt], ['Performance', Art.PerformanceArt], ['Plan', Art.PlanMapArt], ['Brand assets', Art.BrandAssetsArt],
  ['Growth Blueprint', Art.BlueprintArt], ['Memory', Art.MemoryArt], ['Competitors', Art.CompetitorsArt], ['Trending', Art.TrendingArt],
  ['Review queue', Art.ReviewQueueArt], ['Ideas', Art.IdeasArt],
];

const ACCENT_ART: Record<string, React.ReactNode> = {
  create: <Art.SinglePostArt />, review: <Art.ReviewQueueArt />, inbox: <Art.InboxArt />, performance: <Art.PerformanceArt />,
  plan: <Art.PlanMapArt />, brand: <Art.BrandAssetsArt />, competitors: <Art.CompetitorsArt />, video: <Art.VideoArt />, photoshoot: <Art.PhotoshootArt />,
};

const H: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h2 style={{ margin: '28px 0 12px', fontSize: 18, fontWeight: 700 }}>{children}</h2>
);

const ArtShowcase: React.FC = () => (
  <div style={{ maxWidth: 1100, margin: '0 auto', paddingBottom: 64 }}>
    <h1 style={{ fontSize: 26, fontWeight: 700 }}>Illustration set and tiles</h1>
    <p style={{ color: 'var(--gv-text-secondary)', marginTop: 6 }}>All {PIECES.length} pieces, then the tile in each accent, variant and state.</p>

    <H>The 22 pieces</H>
    <div data-testid="art-pieces" style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))' }}>
      {PIECES.map(([label, C]) => (
        <figure key={label} style={{ margin: 0 }}>
          <div className="nb-tile-art" style={{ borderRadius: 16, border: '1px solid var(--gv-border-subtle)' }}><span className="nb-tile-artwrap"><C /></span></div>
          <figcaption style={{ fontSize: 12.5, marginTop: 6, color: 'var(--gv-text-secondary)' }}>{label}</figcaption>
        </figure>
      ))}
    </div>

    <H>Each accent (standard)</H>
    <TileGrid columns={3}>
      {TILE_ACCENTS.map((a) => (
        <Tile key={a} accent={a} title={`Accent: ${a}`} subtitle="One line that says what this opens." footer="A small footer line" art={ACCENT_ART[a]} to="/art-showcase" />
      ))}
    </TileGrid>

    <H>Variants and states</H>
    <TileGrid columns={3}>
      <Tile variant="hero" accent="photoshoot" title="Hero tile" subtitle="Spans two columns on a tablet or desktop, with the picture beside the text." footer="4 photos, about 4 posts' worth" art={<Art.PhotoshootArt />} to="/art-showcase" badge="New" />
      <Tile accent="video" title="With a badge" subtitle="An add-on badge sits beside the title." badge="Add-on" art={<Art.VideoArt />} to="/art-showcase" />
      <Tile accent="competitors" title="Locked" subtitle="Needs a plan that includes it." locked art={<Art.CompetitorsArt />} to="/art-showcase" />
      <Tile accent="inbox" title="Not available" subtitle="This cannot be used right now." disabled art={<Art.InboxArt />} />
      <Tile accent="review" title="Selected" subtitle="The current choice in a switch." selected onClick={() => undefined} art={<Art.ReviewQueueArt />} />
      <Tile accent="performance" title="Count badge" subtitle="Shows how many are waiting." badge={12} art={<Art.PerformanceArt />} to="/art-showcase" />
      <Tile variant="compact" accent="plan" title="Compact" subtitle="A row with a small picture." art={<Art.PlanMapArt />} to="/art-showcase" />
      <Tile variant="compact" accent="brand" title="Compact with a longer title that wraps" subtitle="Check that the text does not overflow." art={<Art.BrandAssetsArt />} to="/art-showcase" />
      <Tile variant="idea" accent="create" title="Idea card" subtitle="A short idea for this week." footer="Post, about 1 post's worth" art={<Art.IdeasArt />} onClick={() => undefined} />
    </TileGrid>

    <H>Long titles in Tamil and Hindi</H>
    <TileGrid columns={3}>
      <Tile accent="create" title="உங்கள் வணிகத்திற்கான சமூக ஊடக பதிவை உருவாக்குங்கள்" subtitle="ஒரு படமும் ஒரு தலைப்பும் கொண்ட பதிவு, உடனே வெளியிடத் தயார்." footer="சுமார் 1 பதிவுக்குச் சமம்" art={<Art.SinglePostArt />} to="/art-showcase" />
      <Tile accent="video" title="अपने व्यवसाय के लिए सोशल मीडिया वीडियो बनाएँ" subtitle="एक छोटा वीडियो जो आपके उत्पाद की कहानी बताता है।" footer="लगभग 1 वीडियो के बराबर" badge="नया" art={<Art.VideoArt />} to="/art-showcase" />
      <Tile accent="plan" title="Averyveryveryverylongsingleworddoesnotbreakthelayoutofthetile" subtitle="Unbroken text must wrap inside the tile." art={<Art.PlanMapArt />} to="/art-showcase" />
    </TileGrid>

    <H>Feature panel</H>
    <DarkPanel eyebrow="Feature panel" title="A deep-ink panel with a gold glow border" action={<Tile variant="compact" accent="create" title="Action inside" subtitle="Tiles also work on ink." art={<Art.IdeasArt />} to="/art-showcase" />}>
      Use two or three of these on a page at most, for the one thing the page most wants noticed.
    </DarkPanel>
  </div>
);

export default ArtShowcase;
