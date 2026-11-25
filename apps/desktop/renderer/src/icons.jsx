// The window's own glyphs (the design's). The type icons and the library icon are the page package's.
const glyph = (size) => ({ width: size, height: size, display: 'block', flex: 'none' });

export const SidebarIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" style={glyph(17)}>
    <rect x="3" y="4.5" width="14" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.4" />
    <path d="M7.5 4.5v11" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

export const BackIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" style={glyph(14)}>
    <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const ForwardIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" style={glyph(14)}>
    <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const PlusIcon = ({ size = 16 }) => (
  <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" style={glyph(size)}>
    <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

export const SearchIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" style={glyph(16)}>
    <circle cx="9" cy="9" r="5.2" stroke="currentColor" strokeWidth="1.6" />
    <path d="M13 13l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

export const ChevronIcon = ({ open }) => (
  <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" style={{ ...glyph(11), transform: open ? 'none' : 'rotate(-90deg)' }}>
    <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const CloseIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 12 12" fill="none" style={glyph(9)}>
    <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

export const SettingsIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" style={glyph(16)}>
    <path d="M3 6h8M15.5 6H17M3 14h1.5M9 14h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <circle cx="13.2" cy="6" r="2" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="6.8" cy="14" r="2" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);
