/* GENERATED FROM tokens.json -- DO NOT EDIT. Run scripts/build-tokens.mjs. */
// Portable design tokens (colors as hex). Web consumes the theme via
// src/index.css; mobile (Expo) and any other platform import this object so the
// whole product shares one source of truth.
export const tokens = {
  "color": {
    "light": {
      "background": "#f6f8fa",
      "foreground": "#1f2328",
      "card": "#ffffff",
      "cardForeground": "#1f2328",
      "popover": "#ffffff",
      "popoverForeground": "#1f2328",
      "primary": "#0969da",
      "primaryForeground": "#ffffff",
      "secondary": "#eaeef2",
      "secondaryForeground": "#1f2328",
      "muted": "#f3f4f6",
      "mutedForeground": "#57606a",
      "accent": "#2da44e",
      "accentForeground": "#ffffff",
      "destructive": "#cf222e",
      "destructiveForeground": "#ffffff",
      "border": "#d0d7de",
      "input": "#d0d7de",
      "ring": "#0969da",
      "chart1": "#0969da",
      "chart2": "#1a7f37",
      "chart3": "#8250df",
      "chart4": "#bc4c00",
      "chart5": "#0598a0",
      "sidebar": "#ffffff",
      "sidebarForeground": "#1f2328",
      "sidebarBorder": "#d0d7de",
      "sidebarPrimary": "#0969da",
      "sidebarPrimaryForeground": "#ffffff",
      "sidebarAccent": "#eaeef2",
      "sidebarAccentForeground": "#1f2328",
      "sidebarRing": "#0969da"
    },
    "dark": {
      "background": "#090b11",
      "foreground": "#fafafa",
      "card": "#0e1017",
      "cardForeground": "#fafafa",
      "popover": "#0e1017",
      "popoverForeground": "#fafafa",
      "primary": "#58a6ff",
      "primaryForeground": "#090b11",
      "secondary": "#1a1d27",
      "secondaryForeground": "#fafafa",
      "muted": "#1a1d27",
      "mutedForeground": "#8b949e",
      "accent": "#3fb950",
      "accentForeground": "#090b11",
      "destructive": "#f78166",
      "destructiveForeground": "#fafafa",
      "border": "#242530",
      "input": "#242530",
      "ring": "#58a6ff",
      "chart1": "#58a6ff",
      "chart2": "#3fb950",
      "chart3": "#bc8cff",
      "chart4": "#f78166",
      "chart5": "#39d8c8",
      "sidebar": "#060810",
      "sidebarForeground": "#fafafa",
      "sidebarBorder": "#1a1d27",
      "sidebarPrimary": "#58a6ff",
      "sidebarPrimaryForeground": "#090b11",
      "sidebarAccent": "#1a1d27",
      "sidebarAccentForeground": "#fafafa",
      "sidebarRing": "#58a6ff"
    }
  },
  "fontFamily": {
    "sans": [
      "JetBrains Mono",
      "monospace"
    ],
    "serif": [
      "Georgia",
      "serif"
    ],
    "mono": [
      "JetBrains Mono",
      "monospace"
    ]
  },
  "radius": "0.25rem",
  "spacing": "0.25rem"
} as const;

export type Tokens = typeof tokens;
export default tokens;
