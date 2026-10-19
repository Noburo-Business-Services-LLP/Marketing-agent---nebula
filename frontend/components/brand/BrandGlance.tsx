import React, { useEffect, useMemo, useState } from 'react';
import { aiMemoryAPI, inventoryAPI } from '../../services/api';
import { brandProgress, brandTiles, tileSpans, type BrandTab, type StatusTile } from '../../utils/brandTiles';
import { StatusTileCard, StatusTileGrid, type StatusTileCardProps } from './StatusTiles';
import { BrandLogoArt } from '../art/brand/Logo';
import { BrandPaletteArt } from '../art/brand/Palette';
import { BrandFontsArt } from '../art/brand/Fonts';
import { BrandBulbArt } from '../art/brand/Bulb';
import { PlanPeopleArt } from '../art/plan/People';
import { PlanShopArt } from '../art/plan/Shop';
import { PlanProductsArt } from '../art/plan/Products';

/**
 * "Your brand at a glance" on Brand assets: seven tiles (Logo, Colours, Fonts, People, Places, Products, Brand memory),
 * each with a status word from stored rows and small pictures when present. Logos, the brand profile and the asset
 * rows come from the page (it loads them already); products and Brand memory are read here. A failed call shows
 * "Could not check", never "Missing". Rules in utils/brandTiles.ts.
 */
const ART: Record<string, React.ReactNode> = {
  logo: <BrandLogoArt />, colours: <BrandPaletteArt />, fonts: <BrandFontsArt />, people: <PlanPeopleArt />,
  places: <PlanShopArt />, products: <PlanProductsArt />, memory: <BrandBulbArt />,
};
const TONE: Record<string, StatusTileCardProps['tone']> = {
  logo: 'pink', colours: 'gold', fonts: 'lilac', people: 'teal', places: 'coral', products: 'sage', memory: 'gold',
};

const BrandGlance: React.FC<{
  logos: any[] | null;
  profile: any | null;
  profileFailed: boolean;
  assets: any[] | null;
  /** Changes when the page reloads or a tab changes, so product counts follow edits made on the Products tab. */
  refreshKey: string;
  onOpenTab: (tab: BrandTab) => void;
}> = ({ logos, profile, profileFailed, assets, refreshKey, onOpenTab }) => {
  const [products, setProducts] = useState<any[] | null | undefined>(undefined);
  const [memory, setMemory] = useState<{ notes: number; tracked: number } | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    inventoryAPI.getProducts()
      .then((r: any) => {
        if (!live) return;
        const list = Array.isArray(r?.data) ? r.data : Array.isArray(r?.products) ? r.products : null;
        setProducts(r && r.success !== false ? list || [] : null);
      })
      .catch(() => { if (live) setProducts(null); });
    return () => { live = false; };
  }, [refreshKey]);

  useEffect(() => {
    let live = true;
    aiMemoryAPI.getSummary()
      .then((r: any) => {
        if (!live) return;
        if (!r || r.success === false) { setMemory(null); return; }
        const notes = Array.isArray(r?.brandMemory?.learnedNotes) ? r.brandMemory.learnedNotes.filter((n: any) => n && String(n.text || '').trim()).length : 0;
        setMemory({ notes, tracked: Number(r?.summary?.performanceMemories) || 0 });
      })
      .catch(() => { if (live) setMemory(null); });
    return () => { live = false; };
  }, []);

  const tiles: StatusTile[] = useMemo(() => brandTiles({
    logos, profile, profileFailed, assets,
    // Still loading counts as "checking": shown as unknown until the answer arrives.
    products: products === undefined ? null : products,
    memory: memory === undefined ? null : memory,
  }).map((t) => ((t.key === 'products' && products === undefined) || (t.key === 'memory' && memory === undefined)
    ? { ...t, status: 'Checking', line: t.key === 'products' ? 'Counting your products' : 'What Nebulaa has learned' }
    : t)), [logos, profile, profileFailed, assets, products, memory]);
  const progress = brandProgress(tiles);
  const s4 = tileSpans(tiles.length, 4);
  const s2 = tileSpans(tiles.length, 2);

  return (
    <section className="nb-brand-glance" aria-labelledby="brand-glance-h">
      <div className="nb-brand-glance-head">
        <h2 id="brand-glance-h">Your brand at a glance</h2>
        <p>{tiles.some((t) => t.status === 'Checking') ? 'Checking what is set up.' : progress.text}</p>
      </div>
      <StatusTileGrid label="Your brand at a glance" wide={4}>
        {tiles.map((t, i) => (
          <StatusTileCard
            key={t.key} dataKey={t.key} index={i} title={t.title} status={t.status} state={t.state} line={t.line}
            art={ART[t.key]} tone={TONE[t.key]} thumbs={t.thumbs} swatches={t.swatches} font={t.font}
            span4={s4[i]} span2={s2[i]}
            to={t.to} onClick={t.tab ? () => onOpenTab(t.tab as BrandTab) : undefined}
          />
        ))}
      </StatusTileGrid>
    </section>
  );
};

export default BrandGlance;
