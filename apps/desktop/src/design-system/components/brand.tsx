import { useId } from "react";

import { cx } from "./cx";

/* ---------- BrandMark and BrandLogo ---------- */

// The swept F from docs/brand/fundedflow-mark.svg (same outline, same gradient axes). The gradient colours are the
// --brand-mark-start/--brand-mark-end tokens, so the mark follows the theme without a second file.
const UPPER_STROKE = "M74 238.8C74 238.8 73.2 238 73.2 238C73.2 238 73.9 235.3 74.4 234C75.9 230.3 77.7 226.7 79.2 223C97.1 178.7 114.3 134.2 132.4 90C133.7 86.8 135.6 83.9 137.5 81C139.4 77.9 141.5 74.8 143.8 72C146.3 68.8 149.1 65.9 152 63C153.6 61.5 155.2 60 157 58.7C159.9 56.5 162.9 54.3 166 52.4C169.5 50.3 173.2 48.5 177 46.8C180.2 45.4 183.6 44.4 187 43.4C190 42.6 193 41.8 196 41.4C201 40.7 206 40.2 211 40.1C245.3 39.7 279.7 40.4 314 40C316.2 40 318.3 39.5 320.5 39C323.7 38.3 326.8 36.9 330 36.4C330.5 36.3 331.4 37 331.4 37C331.4 37 331.7 38.3 331.6 39C331.4 40.4 331.1 41.7 330.7 43C329.4 47 328.2 51.1 326.6 55C325.5 57.8 324 60.4 322.5 63C321.3 65.1 319.8 67.1 318.3 69C317.2 70.4 316.1 71.7 314.8 73C312.6 75.2 310.4 77.4 308 79.3C306.1 80.9 304.1 82.3 302 83.5C299.4 85 296.7 86.3 294 87.5C291.7 88.4 289.4 89.2 287 89.7C283 90.5 279 91.3 275 91.4C251.3 91.9 227.7 91.2 204 91.4C201.4 91.4 198.9 91.6 196.3 92C193.2 92.5 190.2 93.2 187.2 94C185.3 94.5 183.6 95.2 181.8 96C179.8 96.9 177.8 97.9 175.9 99C173.9 100.2 171.9 101.5 170.1 103C168.6 104.1 167.3 105.4 166 106.8C164.2 108.7 162.5 110.6 161 112.8C159.1 115.5 157.3 118.4 156 121.5C152.8 128.8 150.4 136.5 147.4 144C143.5 153.7 139.6 163.4 135.3 173C135.1 173.5 134.5 173.9 134 174.2C131.7 175.5 129.2 176.4 127 177.8C123.6 179.9 120.2 182.1 117 184.6C113.5 187.2 110 189.9 106.9 193C103 196.8 99.5 200.9 96 205C94.3 206.9 92.8 208.9 91.4 211C88.2 215.6 84.9 220.2 81.9 225C79.1 229.5 74 238.8 74 238.8Z";
const MIDDLE_ARM = "M160 165.5C159.4 165.7 158 165.8 158 165.8C158 165.8 157.8 165.2 157.9 165C159.7 160.6 161.8 156.4 163.6 152C165.8 146.4 167.5 140.6 169.7 135C170.6 132.9 171.6 130.9 172.8 129C173.7 127.6 174.7 126.2 175.8 125C177.1 123.6 178.5 122.2 180 121C181.6 119.7 183.3 118.6 185 117.6C186.9 116.5 188.9 115.5 191 114.8C193.9 113.9 197 113.2 200 112.7C202 112.3 204 112.3 206 112.3C233 112 260 112.5 287 111.8C291 111.7 295.1 111 299 110C303.5 108.8 307.5 106.4 312 105.1C312.5 105 313.3 106 313.3 106C313.3 106 312.4 110.7 311.7 113C310.4 117.1 309 121.1 307.3 125C306.3 127.4 304.9 129.7 303.5 132C302.2 134.1 300.9 136.1 299.3 138C297.4 140.4 295.2 142.6 293 144.7C291.1 146.5 289.1 148.1 287 149.7C285.7 150.6 284.4 151.6 283 152.3C280.4 153.8 277.8 155.2 275 156.2C271.8 157.4 268.4 158.4 265 159.1C261.7 159.8 258.4 160.3 255 160.5C245.7 160.8 236.3 160.7 227 160.5C210 160.3 190 160.4 176 160.7C173 161 169.9 161.6 167 162.5C164.6 163.2 162.4 164.6 160 165.5Z";

export interface BrandMarkProps {
  /** Width and height of the square box the mark is centred in, in px. Default 32 (the sidebar brand row). */
  size?: number;
  className?: string;
}

/** The FundedFlow mark. Decorative: always aria-hidden, so whatever sits beside it carries the name. */
export function BrandMark({ size = 32, className }: BrandMarkProps) {
  // useId output can hold characters that break url(#…) references; each instance needs its own gradient ids.
  const id = useId().replace(/[^\w-]/g, "");
  return (
    <svg className={cx("ds-brand-mark", className)} width={size} height={size} viewBox="70 5 265 265" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-upper`} gradientUnits="userSpaceOnUse" x1="330" y1="36" x2="74" y2="238">
          <stop offset="0" className="ds-brand-mark-start" />
          <stop offset="1" className="ds-brand-mark-end" />
        </linearGradient>
        <linearGradient id={`${id}-middle`} gradientUnits="userSpaceOnUse" x1="313" y1="106" x2="158" y2="166">
          <stop offset="0" className="ds-brand-mark-start" />
          <stop offset="1" className="ds-brand-mark-end" />
        </linearGradient>
      </defs>
      <path fill={`url(#${id}-upper)`} d={UPPER_STROKE} />
      <path fill={`url(#${id}-middle)`} d={MIDDLE_ARM} />
    </svg>
  );
}

export interface BrandLogoProps {
  /** false shows the mark alone (the collapsed icon rail). */
  showName?: boolean;
  /** Mark box size in px; the name is set at the display title size beside it. */
  markSize?: number;
  className?: string;
}

/** Mark plus the "FundedFlow" wordmark: "Funded" in ink, "Flow" in the flow blue. Its text reads "FundedFlow". */
export function BrandLogo({ showName = true, markSize, className }: BrandLogoProps) {
  return (
    <span className={cx("ds-brand", className)}>
      <BrandMark size={markSize} />
      {showName && <span className="ds-brand-name">Funded<span className="ds-brand-name-accent">Flow</span></span>}
    </span>
  );
}
