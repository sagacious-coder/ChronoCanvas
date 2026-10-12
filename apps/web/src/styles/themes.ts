/**
 * ChronoCanvas Dynamic Theme Registry
 * Preserves the original Apple Creamy Daylight palette as default
 * and provides 11 curated dark/light developer themes.
 */

export interface ThemeColors {
  bg: string;
  cardBg: string;
  headerBg: string;
  border: string;
  borderHover: string;
  text: string;
  textMuted: string;
  accent: string;
  accentBg: string;
  editorBg: string;
  editorGutter: string;
  editorGutterText: string;
  editorSelection: string;
  badgeBg: string;
  badgeText: string;
  badgeBorder: string;
}

export interface ThemeConfig {
  id: string;
  name: string;
  isDark: boolean;
  colors: ThemeColors;
}

export const THEMES: Record<string, ThemeConfig> = {
  daylight: {
    id: "daylight",
    name: "Creamy Daylight (Original)",
    isDark: false,
    colors: {
      bg: "#FDFBF7",
      cardBg: "#FAF8F5",
      headerBg: "#F7F4EB",
      border: "#E6E2D8",
      borderHover: "#D8D2C4",
      text: "#1F2328",
      textMuted: "#656D76",
      accent: "#2563EB",
      accentBg: "#EFF6FF",
      editorBg: "#FAF8F5",
      editorGutter: "#F4EFE6",
      editorGutterText: "#8C8273",
      editorSelection: "#DDE5F5",
      badgeBg: "#EFEAD9",
      badgeText: "#4B515D",
      badgeBorder: "#E2DCCF",
    },
  },
  night: {
    id: "night",
    name: "Night / Dark",
    isDark: true,
    colors: {
      bg: "#0D1117",
      cardBg: "#161B22",
      headerBg: "#21262D",
      border: "#30363D",
      borderHover: "#484F58",
      text: "#E6EDF3",
      textMuted: "#8B949E",
      accent: "#58A6FF",
      accentBg: "#1F242C",
      editorBg: "#0D1117",
      editorGutter: "#161B22",
      editorGutterText: "#6E7681",
      editorSelection: "#264F78",
      badgeBg: "#21262D",
      badgeText: "#C9D1D9",
      badgeBorder: "#30363D",
    },
  },
  catppuccin: {
    id: "catppuccin",
    name: "Catppuccin (Mocha)",
    isDark: true,
    colors: {
      bg: "#1E1E2E",
      cardBg: "#181825",
      headerBg: "#313244",
      border: "#45475A",
      borderHover: "#585B70",
      text: "#CDD6F4",
      textMuted: "#A6ADC8",
      accent: "#CBA6F7",
      accentBg: "#2E2540",
      editorBg: "#1E1E2E",
      editorGutter: "#181825",
      editorGutterText: "#6C7086",
      editorSelection: "#45475A",
      badgeBg: "#313244",
      badgeText: "#B4BEFE",
      badgeBorder: "#45475A",
    },
  },
  "tokyo-night": {
    id: "tokyo-night",
    name: "Tokyo Night",
    isDark: true,
    colors: {
      bg: "#1A1B26",
      cardBg: "#16161E",
      headerBg: "#24283B",
      border: "#414868",
      borderHover: "#565F89",
      text: "#C0CAF5",
      textMuted: "#7AA2F7",
      accent: "#7AA2F7",
      accentBg: "#202A44",
      editorBg: "#1A1B26",
      editorGutter: "#16161E",
      editorGutterText: "#565F89",
      editorSelection: "#364A82",
      badgeBg: "#24283B",
      badgeText: "#BB9AF7",
      badgeBorder: "#414868",
    },
  },
  dracula: {
    id: "dracula",
    name: "Dracula",
    isDark: true,
    colors: {
      bg: "#282A36",
      cardBg: "#21222C",
      headerBg: "#44475A",
      border: "#6272A4",
      borderHover: "#BD93F9",
      text: "#F8F8F2",
      textMuted: "#BD93F9",
      accent: "#FF79C6",
      accentBg: "#3B263C",
      editorBg: "#282A36",
      editorGutter: "#21222C",
      editorGutterText: "#6272A4",
      editorSelection: "#44475A",
      badgeBg: "#44475A",
      badgeText: "#50FA7B",
      badgeBorder: "#6272A4",
    },
  },
  ayu: {
    id: "ayu",
    name: "Ayu (Dark)",
    isDark: true,
    colors: {
      bg: "#0F1419",
      cardBg: "#14191F",
      headerBg: "#1B2129",
      border: "#25303D",
      borderHover: "#3B4757",
      text: "#E6E1CF",
      textMuted: "#707A8C",
      accent: "#FFB454",
      accentBg: "#332616",
      editorBg: "#0F1419",
      editorGutter: "#14191F",
      editorGutterText: "#5C6773",
      editorSelection: "#253340",
      badgeBg: "#1B2129",
      badgeText: "#F07178",
      badgeBorder: "#25303D",
    },
  },
  dainty: {
    id: "dainty",
    name: "Dainty",
    isDark: true,
    colors: {
      bg: "#1B1D1E",
      cardBg: "#222426",
      headerBg: "#2D3033",
      border: "#3E4247",
      borderHover: "#545A61",
      text: "#E0E2E4",
      textMuted: "#899097",
      accent: "#00B4D8",
      accentBg: "#142833",
      editorBg: "#1B1D1E",
      editorGutter: "#222426",
      editorGutterText: "#6C737A",
      editorSelection: "#34495E",
      badgeBg: "#2D3033",
      badgeText: "#90E0EF",
      badgeBorder: "#3E4247",
    },
  },
  "github-dark": {
    id: "github-dark",
    name: "GitHub Theme (Dark)",
    isDark: true,
    colors: {
      bg: "#0D1117",
      cardBg: "#161B22",
      headerBg: "#21262D",
      border: "#30363D",
      borderHover: "#484F58",
      text: "#F0F6FC",
      textMuted: "#8B949E",
      accent: "#238636",
      accentBg: "#1A2B20",
      editorBg: "#0D1117",
      editorGutter: "#161B22",
      editorGutterText: "#6E7681",
      editorSelection: "#264F78",
      badgeBg: "#21262D",
      badgeText: "#58A6FF",
      badgeBorder: "#30363D",
    },
  },
  "atom-one-dark": {
    id: "atom-one-dark",
    name: "Atom One Dark",
    isDark: true,
    colors: {
      bg: "#282C34",
      cardBg: "#21252B",
      headerBg: "#2C313A",
      border: "#3E4451",
      borderHover: "#4B5263",
      text: "#ABB2BF",
      textMuted: "#5C6370",
      accent: "#61AFEF",
      accentBg: "#1F2E40",
      editorBg: "#282C34",
      editorGutter: "#21252B",
      editorGutterText: "#5C6370",
      editorSelection: "#3E4451",
      badgeBg: "#2C313A",
      badgeText: "#98C379",
      badgeBorder: "#3E4451",
    },
  },
  houston: {
    id: "houston",
    name: "Houston (Astro)",
    isDark: true,
    colors: {
      bg: "#12161F",
      cardBg: "#181E2B",
      headerBg: "#232B3E",
      border: "#323E56",
      borderHover: "#4A5B7D",
      text: "#E2E8F0",
      textMuted: "#94A3B8",
      accent: "#BC52EE",
      accentBg: "#331E3D",
      editorBg: "#12161F",
      editorGutter: "#181E2B",
      editorGutterText: "#64748B",
      editorSelection: "#384666",
      badgeBg: "#232B3E",
      badgeText: "#F43F5E",
      badgeBorder: "#323E56",
    },
  },
  "night-owl": {
    id: "night-owl",
    name: "Night Owl",
    isDark: true,
    colors: {
      bg: "#011627",
      cardBg: "#0B2942",
      headerBg: "#0D3354",
      border: "#1D3B53",
      borderHover: "#2A4E6D",
      text: "#D6DEEB",
      textMuted: "#7FDBCA",
      accent: "#82AAFF",
      accentBg: "#142845",
      editorBg: "#011627",
      editorGutter: "#0B2942",
      editorGutterText: "#4B6479",
      editorSelection: "#1D3B53",
      badgeBg: "#0D3354",
      badgeText: "#ADDB67",
      badgeBorder: "#1D3B53",
    },
  },
  matcha: {
    id: "matcha",
    name: "Matcha (Tea Green)",
    isDark: false,
    colors: {
      bg: "#F5F7F2",
      cardBg: "#EDF1E8",
      headerBg: "#E2E8DA",
      border: "#CAD4C1",
      borderHover: "#B5C2AA",
      text: "#24331E",
      textMuted: "#586B50",
      accent: "#4A7C38",
      accentBg: "#D8E5CE",
      editorBg: "#EDF1E8",
      editorGutter: "#E2E8DA",
      editorGutterText: "#6F8565",
      editorSelection: "#CFDEC2",
      badgeBg: "#E2E8DA",
      badgeText: "#3C5A2D",
      badgeBorder: "#CAD4C1",
    },
  },
};

export const DEFAULT_THEME_ID = "daylight";

export function getTheme(id?: string): ThemeConfig {
  if (id && THEMES[id]) {
    return THEMES[id];
  }
  return THEMES[DEFAULT_THEME_ID];
}
