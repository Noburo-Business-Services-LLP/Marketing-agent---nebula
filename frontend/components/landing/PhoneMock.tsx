import React from 'react';
import { Check, PenLine } from 'lucide-react';
import { PackFestivalArt } from '../art/packs/PackFestival';
import { PHONE } from '../../constants/landingCopy';

/**
 * The hero's phone: an illustrative Review and approve screen drawn in CSS with the app's own tile art.
 * No real business, customer or photo. One label for screen readers; the drawing inside is decorative.
 */
const PhoneMock: React.FC = () => (
  <div className="nb-phone-stage" role="img" aria-label={PHONE.label}>
    <span className="nb-phone-halo" aria-hidden="true" />
    <div className="nb-phone" aria-hidden="true">
      <div className="nb-phone-screen">
        <span className="nb-phone-notch" />
        <div className="nb-phone-top">
          <span className="nb-phone-title">{PHONE.title}</span>
          <span className="nb-phone-chip">{PHONE.example}</span>
        </div>
        <div className="nb-phone-post">
          <div className="nb-phone-who">
            <span className="nb-phone-avatar" />
            <span className="nb-phone-name">{PHONE.business}<small>{PHONE.platform}</small></span>
          </div>
          <div className="nb-phone-pic"><PackFestivalArt /></div>
          <p className="nb-phone-caption">{PHONE.caption}</p>
          <p className="nb-phone-tags">{PHONE.tags}</p>
          <div className="nb-phone-actions">
            <span><PenLine size={12} strokeWidth={2.4} />{PHONE.edit}</span>
            <span><Check size={13} strokeWidth={3} />{PHONE.approve}</span>
          </div>
        </div>
        <div className="nb-phone-more"><span>{PHONE.waiting}</span><i><b /><b /></i></div>
      </div>
    </div>
    {PHONE.chips.map((c, i) => (
      <span key={c} className="nb-float-chip" data-i={i} aria-hidden="true"><Check size={14} strokeWidth={3} />{c}</span>
    ))}
  </div>
);

export default PhoneMock;
