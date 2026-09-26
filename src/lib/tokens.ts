/**
 * Kahade Design System — Design Tokens v2 (Soft & Presisi)
 * ------------------------------------------------------------------
 * Single source of truth untuk semua nilai visual sistem:
 * warna, mode (light/dark), tipografi, spacing, radius, border,
 * z-index, ikon, motion, dan breakpoint.
 *
 * Framework-agnostic: bisa dikonsumsi oleh
 * - tailwind.config.js (NativeWind / Tailwind web) via `toTailwindTheme()`
 * - StyleSheet / Reanimated di React Native secara langsung
 * - CSS variables di web via `toCssVariables()`
 *
 * Prinsip inti: Soft. Modern. Minimalis. Presisi.
 * v2 berevolusi dari v1.1 (flat monokrom, nol shadow): basis netral hangat
 * "Kertas", satu aksen Pinus untuk momen trust/escrow, info berwarna, depth
 * lembut bertingkat (konsumsi via lib/elevation.ts — bukan utility shadow
 * generik), dan motion yang lebih kaya namun tetap disengaja per konteks.
 * Disiplin v1.1 dipertahankan: tanpa angka sembarang, kontras AA
 * terdokumentasi, semua motion punya fallback reduced-motion.
 *
 * v2.1 (penyempurnaan optis) merevisi tiga hal yang membuat v2 terasa
 * "berat di mata" tanpa mengubah struktur sistem:
 *   1. Netral: chroma "Kertas" (S 20–33%) dipangkas ke "Porselen" (S 5–9%)
 *      — lihat §2.2. Latar krem membuat kartu kusam dan aksen hijau bergeser
 *      ke zaitun; lightness ladder tidak disentuh sehingga kontras tetap.
 *   2. Irama horizontal: screen padding 24 → 20px (§4) — di ponsel 360dp
 *      gutter 24px + card 20px menyisakan kolom teks 272dp (75,6%); 20px
 *      mengembalikan kolom ke 280dp tanpa turun ke 16px yang terasa sempit.
 *   3. Elevasi & tracking: shadow lebih difus (radius naik, opacity turun)
 *      dan display/H1/H2 diberi letter-spacing optis negatif (§3.2).
 *
 * v2.2 (2026-09-17) — RETINT monokrom palet brand. Roda warna resmi
 * (docs/image/f739a1072b861fa6f9ae25e44ee7628e.jpg, "Designing Emotions
 * Through Color Harmony") menyebut HEX eksplisit: #FFFFFF · #F3F4F6 ·
 * #525252 · #262626 · #000000 — dan aksen pink #F85382 digugurkan pemilik
 * produk ("warna merahnya ganti jadi hitam saja"). Akibatnya:
 *   1. Netral hangat Porselen diganti ramp abu NETRAL MURNI yang meng-anchor
 *      kelima HEX brand itu di peran yang terlihat (§2.2).
 *   2. Aksen "Pinus" hijau menjadi hitam/putih — accent == primary (§2.3b).
 *   3. Dark mode dibalik dari brand black: background #000000, surface
 *      #1A1A1A, elevated #262626 — splash/adaptiveIcon (brand.black) kini
 *      seamless dengan background dark.
 * Struktur token, tangga lightness, dan semua ambang kontras check-tokens
 * dipertahankan; warna status semantik (§2.3) tetap berfungsi sebagai status.
 */

// ==================================================================
// 2. COLOR SYSTEM
// ==================================================================

/** 2.1 Brand — #000000 dipakai sengaja terbatas (primary action, border-focus, ikon aktif) */
export const brand = {
  black: "#000000",
  white: "#FFFFFF",
} as const

/**
 * 2.2 Neutral Scale — Monokrom brand (v2.2)
 *
 * KENAPA DIGANTI dari "Porselen" v2.1 (penting, jangan dikembalikan):
 * palet brand resmi (docs/image/f739a1072b861fa6f9ae25e44ee7628e.jpg)
 * menyebut HEX eksplisit — #FFFFFF, #F3F4F6, #525252, #262626, #000000 —
 * dan satu-satunya warna jenuh di roda itu, pink #F85382, dicoret pemilik
 * produk menjadi hitam. Jadi skala netral kini NOL chroma (hue 0, S 0%):
 * kehangatan Porselen dipangkas total supaya app identik dengan palet brand.
 *
 * Roda hanya memberi 5 anak tangga, jadi 5 HEX brand di-anchor di peran
 * yang terlihat dan runge tengah diinterpolasi netral murni (keluarga
 * Tailwind gray/neutral) agar tangga 11 langkah — dan semua token turunan —
 * tidak berubah strukturnya:
 *   gray.100 = #F3F4F6 (surface) · gray.600 = #525252 (text-tertiary +
 *   border-control) · gray.800 = #262626 (chart light step 3 + surface
 *   elevated dark) · background/primary = #FFFFFF / #000000.
 *
 * Angka kontras di komentar dihitung ulang terhadap background/surface baru
 * (light #FFFFFF / #F3F4F6 · dark #000000 / #1A1A1A).
 */
export const gray = {
  50: "#FAFAFA", // App background tint (jarang dipakai langsung)
  100: "#F3F4F6", // ← HEX brand — Surface / card fill
  200: "#E5E7EB", // Cadangan + bgSoft aksen
  300: "#D1D5DB", // Divider sangat halus (1.50 vs bg, dekoratif murni)
  400: "#9CA3AF", // Border alternatif + chart dark langkah 2 (7.65 vs #000000)
  500: "#6B7280", // border-control (light, v2.3), teks disabled, langkah chart dark pertama (3.94 vs #000000)
  600: "#525252", // ← HEX brand — text-tertiary (light): 7.82 vs bg, 7.10 vs surface
  700: "#404040", // text-secondary (light): 10.37 vs bg, 9.42 vs surface
  800: "#262626", // ← HEX brand — Chart dark (light step 3) / surface fill gelap
  900: "#171717", // Surface fill alternatif (dark)
  950: "#0A0A0A", // Teks di atas fill danger dark (6.94) — tinta shadow light
} as const

/**
 * 2.3 Semantic Colors — status transaksi TETAP BERWARNA (v2.2): roda warna
 * brand adalah palet identitas, bukan kosakata status — sukses/gagal/warning
 * harus tetap terbedakan tanpa membaca label. Rasio light (text/bgSoft ·
 * fill/surface, dihitung ulang v2.2 di atas surface #F3F4F6): success
 * 4.58/3.10, danger 5.83/4.39, warning 4.99/3.17, info 7.32/5.75. Dark
 * (fill/bgSoft · fill/surface, di atas #1A1A1A): success 9.20/9.99, danger
 * 6.20/6.29, warning 9.49/10.42, info 7.63/7.88. Info v2 berwarna "Sungai"
 * (biru sungai) — keluar dari abu monokrom v1.1.
 *
 * Dark mode: `text` SENGAJA == `fill` (bukan bug). Dokumen §2.3 hanya punya
 * satu kolom "Fill (dark)"; fill terang di atas bgSoft gelap sudah > AA di
 * semua ukuran teks, jadi tidak perlu dipisah — sama seperti keputusan
 * text-tertiary == text-secondary di dark mode.
 */
export const semantic = {
  success: {
    /**
     * fill digelapkan #16A34A → #15A047 (v2.2): nilai lama hanya 2.99:1 vs
     * surface brand baru #F3F4F6 — di bawah ambang 3:1 (1.4.11) yang dijaga
     * check-tokens. #15A047 = 3.10:1; selisihnya nyaris tak terlihat.
     */
    light: { fill: "#15A047", text: "#15803D", bgSoft: "#EDF7F0" },
    dark: { fill: "#4ADE80", text: "#4ADE80", bgSoft: "#14251A" },
  },
  danger: {
    light: { fill: "#D92D20", text: "#B42318", bgSoft: "#FDEEEC" },
    dark: { fill: "#F87171", text: "#F87171", bgSoft: "#2A1616" },
  },
  warning: {
    light: { fill: "#DC6803", text: "#B54708", bgSoft: "#FEF4E8" },
    dark: { fill: "#FBBF24", text: "#FBBF24", bgSoft: "#2A2113" },
  },
  info: {
    light: { fill: "#1D5FB0", text: "#174E92", bgSoft: "#EBF2FA" },
    dark: { fill: "#7FB3E8", text: "#7FB3E8", bgSoft: "#131E2A" },
  },
} as const

/**
 * 2.3b Accent — v2.2 MONOKROM (dulu "Pinus" hijau #0C6B4E).
 * Roda warna brand baru tidak punya warna jenuh: pink #F85382 dicoret
 * pemilik produk dan diganti hitam, jadi aksen trust & escrow kini memakai
 * tinta brand — fill #000000 (light) / #FFFFFF (dark), sama dengan
 * `primary`. Konsekuensi yang DITERIMA: Button/Badge/Icon/Text tone
 * "accent" tampil identik dengan primary — pembeda momen escrow tetap ada
 * pada label dan konteks, bukan warna.
 *
 * Rasio light (v2.2, di atas surface #F3F4F6): text/bgSoft 16.96 (#000000
 * di #E5E7EB), fill/surface 19.08 (ikon), onFill/fill 21.00 (label tombol
 * solid). Dark: fill/bgSoft 15.13, fill/surface 17.40, onFill/fill 21.00.
 */
export const accent = {
  light: { fill: "#000000", text: "#000000", bgSoft: "#E5E7EB", onFill: "#FFFFFF" },
  // onFill dark = hitam brand yang sama dengan `dark.background`.
  dark: { fill: "#FFFFFF", text: "#FFFFFF", bgSoft: "#262626", onFill: "#000000" },
} as const

/**
 * Chart / data-viz untuk kategori non-status (>2 kategori).
 * 3-step monokrom — semantic color eksklusif untuk status transaksi.
 *
 * Langkah terendah wajib >= 3:1 terhadap background (WCAG 1.4.11): batang
 * chart adalah "graphical object required to understand the content", jadi
 * pengecualian border dekoratif §6 TIDAK berlaku. Tangga dimulai dari
 * gray.600 (#525252 = 7.82:1 vs bg, 7.10:1 vs surface).
 *
 * `chartMono` mendeskripsikan LIGHT. Dark mode harus dibaca lewat
 * `chartMonoDark`: di atas #000000 urutannya dibalik (abu lebih terang =
 * lebih menonjol).
 */
export const chartMono = [gray[600], gray[700], gray[800]] as const

/** Padanan dark dari `chartMono` — langkah terendah gray.500 = 5.10:1 vs #141412. */
export const chartMonoDark = [gray[500], gray[400], gray[300]] as const

/** 2.4 Mode Tokens */
export const light = {
  background: "#FFFFFF", // ← HEX brand
  /**
   * v2.2: #F3F4F6 — HEX brand abu terang di roda warna. Pemisahan kartu vs
   * background 1.10:1 — lebih halus dari v2.1 (#F7F6F4); pemisah UTAMA kartu
   * tetap border (§6.1), surface hanya penguat.
   */
  surface: "#F3F4F6", // ← HEX brand: card, input fill
  surfaceElevated: "#FFFFFF", // dengan border + elevasi low/high (v2)
  /**
   * border-default: card, divider, separator — border STRUKTURAL/dekoratif.
   * Kontras vs background 1.50:1 — SENGAJA di bawah 3:1. WCAG 1.4.11 hanya
   * berlaku untuk komponen UI interaktif dan bagian yang dibutuhkan untuk
   * mengenali komponen; pembatas dekoratif dikecualikan (§6).
   * JANGAN pakai untuk outline form control — pakai `borderControl`.
   */
  borderDefault: "#D1D5DB", // gray.300 netral (1.50 vs bg)
  /**
   * border-control: outline resting form control (Input, Select, DateField,
   * Checkbox, Radio, Switch off, NumberStepper, SegmentedControl, ToggleGroup
   * belum terpilih) DAN indikator state non-teks (dot PIN kosong, track
   * Slider, bintang Rating kosong). WCAG 1.4.11 non-text contrast >= 3:1:
   * #6B7280 vs #FFFFFF = 4.83:1, vs surface #F3F4F6 = 4.40:1.
   * Daftar lengkap + pengecualian: docs/audit/findings/06-non-text-contrast.md
   * Bukan untuk Button secondary (dikenali dari label) atau border kartu.
   *
   * v2.3 (2026-09-21) — diturunkan dari gray.600 #525252 ke gray.500 #6B7280.
   * Alasan (permintaan pemilik produk: "bordernya harusnya abu abu bukan
   * hitam, hitam ketika aktif"): #525252 di atas putih terbaca hampir sama
   * gelapnya dengan `borderFocus` #000000, sehingga keadaan resting dan fokus
   * sebuah field nyaris tidak berbeda — hierarki state mati. gray.500 tetap
   * "abu-abu" yang jelas sekaligus lolos ambang 3:1 yang dijaga
   * scripts/check-tokens.mjs, jadi kontras state fokus (hitam 1.5px) kembali
   * menjadi pembeda utama. Dark mode tidak berubah: di sana resting memang
   * harus terang (#9CA3AF) agar terlihat di atas #000000.
   */
  borderControl: "#6B7280", // gray.500 netral (4.83 vs bg, 4.40 vs surface)
  borderFocus: "#000000", // ← HEX brand: fokus/aktif pada elemen interaktif
  borderError: "#D92D20", // == danger.fill
  textPrimary: "#000000", // ← HEX brand: 21.00 vs bg, 19.08 vs surface
  textSecondary: "#404040", // gray.700 — body, caption, label: 10.37/9.42
  textTertiary: "#525252", // ← HEX brand gray.600 — ikon, teks besar >=18px: 7.82/7.10
  textDisabled: "#A1A1AA",
  primary: "#000000", // ← HEX brand
  primaryForeground: "#FFFFFF",
  /**
   * Scrim di belakang overlay (BottomSheet, Modal, ActionSheet). Selalu hitam
   * (bukan invert seperti `primary`) karena tugasnya meredupkan konten, dan
   * di dark mode alpha dinaikkan supaya sheet tetap terpisah dari background
   * yang sudah gelap. Pakai lewat class `bg-overlay`.
   */
  overlay: "rgba(0, 0, 0, 0.4)",
  /**
   * Scrim di atas MEDIA (thumbnail, galeri). `overlay` 0.4 terlalu lemah di
   * sini: di atas foto terang ia tersusun jadi #999999, sehingga teks putih
   * hanya 2.85:1 — di bawah 3:1 objek grafis apalagi 4.5:1 teks. 0.7 memberi
   * 8.45:1 pada kasus terburuk (foto putih polos).
   */
  overlayMedia: "rgba(0, 0, 0, 0.7)",
  /**
   * Umpan balik SENTUH (v2.3, 2026-09-21) — satu token untuk dua mekanisme:
   *   1. warna ripple Android (`android_ripple` di <PressableScale>), dan
   *   2. underlay tekan di iOS/web (rgba yang sama, digambar sebagai lapisan
   *      di atas baris) karena kedua platform itu tidak punya ripple native.
   * Alpha rendah (0.08 di atas putih) supaya baris yang SUDAH berfill
   * `bg-surface` (notifikasi belum dibaca, kartu terpilih) tetap menunjukkan
   * perubahan saat ditekan tanpa menjadi blok abu pekat. Bukan warna status,
   * jadi tidak diuji kontrasnya — ini lapisan sementara di atas permukaan.
   */
  pressed: "rgba(0, 0, 0, 0.08)",
} as const

export const dark = {
  /**
   * v2.2: #000000 — brand black yang sama dengan splash/adaptiveIcon
   * (brand.black), jadi handoff native→JS tidak berkedip sama sekali.
   */
  background: "#000000",
  surface: "#1A1A1A",
  /**
   * #262626 (HEX brand) vs #000000 = 1.39:1 — dijaga di atas ambang 1.3
   * yang diuji check-tokens (tanpa itu skeleton/sheet tak terbedakan dari
   * background). Elevated tetap butuh border-default (+ shadow high di
   * overlay).
   */
  surfaceElevated: "#262626",
  borderDefault: "#3F3F3F", // struktural/dekoratif — 2.00 vs bg, lihat `light`
  /** WCAG 1.4.11: #9CA3AF vs #000000 = 7.65:1, vs surface #1A1A1A = 6.34:1 */
  borderControl: "#9CA3AF",
  borderFocus: "#FFFFFF",
  borderError: "#F87171", // == danger.fill
  textPrimary: "#FFFFFF", // 21.00 vs bg, 17.41 vs surface
  textSecondary: "#9CA3AF", // 7.65 vs bg, 6.34 vs surface
  textTertiary: "#9CA3AF", // sama dgn secondary — kontras di dark sudah aman
  textDisabled: "#525252", // ← HEX brand — disabled, tanpa ambang kontras
  primary: "#FFFFFF", // invert di dark mode
  primaryForeground: "#000000",
  overlay: "rgba(0, 0, 0, 0.6)",
  /** Lihat `overlayMedia` di light — alasan dan aritmetika kontrasnya sama. */
  overlayMedia: "rgba(0, 0, 0, 0.7)",
  /** Lihat `pressed` di light — di dark underlay-nya putih agar terbaca di atas #000. */
  pressed: "rgba(255, 255, 255, 0.12)",
} as const

export type ModeTokens = { readonly [K in keyof typeof light]: string }
export type ColorMode = "light" | "dark"

export const modes: Record<ColorMode, ModeTokens> = { light, dark }

export const colors = {
  brand,
  gray,
  semantic,
  accent,
  chartMono,
  chartMonoDark,
  light,
  dark,
} as const

// ==================================================================
// 3. TYPOGRAPHY
// ==================================================================

/**
 * 3.1 Font Roles
 * - Plus Jakarta Sans: UI & body (default 95% layar) — modern geometric sans,
 *                     proporsional dan bersih untuk antarmuka finansial.
 * - EB Garamond     : Display/editorial — hero, konfirmasi besar, onboarding (terbatas)
 * - Azeret Mono     : Data presisi — nominal uang, ID transaksi, OTP, rekening.
 *                     Pengganti JetBrains Mono (keputusan produk): nol Azeret
 *                     POLOS tanpa diakali (tanpa titik/garis miring di dalam 0)
 *                     sehingga tidak tertukar dengan huruf O secara visual namun
 *                     juga bebas "matahari" di tengah angka — deret nominal
 *                     lebih bersih. O/A/huruf kapital tetap terbedakan dari
 *                     angka lewat bentuk (O lebih lebar & bundar).
 *
 * Semua font di-bundle offline via expo-font; tidak butuh fallback network.
 */
export const fontFamily = {
  sans: "Plus Jakarta Sans",
  serif: "EB Garamond",
  mono: "Azeret Mono",
} as const

/**
 * Nama asset font per weight untuk expo-font / StyleSheet.
 * (RN membutuhkan family name spesifik per weight, bukan fontWeight.)
 * Nama key = nama file di assets/fonts tanpa ekstensi (kontrak lib/fonts.ts).
 */
export const fontFamilyByWeight = {
  sans: {
    400: "PlusJakartaSans-Regular",
    500: "PlusJakartaSans-Medium",
    600: "PlusJakartaSans-SemiBold",
    700: "PlusJakartaSans-Bold",
  },
  serif: {
    500: "EBGaramond-Medium",
  },
  mono: {
    500: "AzeretMono-Medium",
    600: "AzeretMono-SemiBold",
  },
} as const

export const fontWeight = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
} as const

/**
 * Letter-spacing skala global.
 * - mono +0.5px: Azeret Mono dipakai untuk nominal/ID/OTP — sedikit
 *   renggang membuat deret angka & huruf kapital mudah dipindai.
 * - Tracking headline (display/H1/H2) TIDAK ada di sini melainkan per varian
 *   di `typography` (v2.1) karena nilainya optis: proporsional ke ukuran,
 *   bukan konstanta tunggal.
 */
export const letterSpacing = {
  normal: 0,
  mono: 0.5,
} as const

export type TypeStyle = {
  fontFamily: (typeof fontFamily)[keyof typeof fontFamily]
  fontSize: number
  lineHeight: number
  fontWeight: (typeof fontWeight)[keyof typeof fontWeight]
  /** Weight override di dark mode (H1/H2 turun satu tingkat, 700 -> 600) */
  fontWeightDark?: (typeof fontWeight)[keyof typeof fontWeight]
  letterSpacing?: number
  /** Angka dalam Chivo pakai tabular figures agar rapi di list/tabel */
  fontVariantNumeric?: "tabular-nums"
}

/** 3.2 Type Scale — spacious line-height, fixed (tidak mengikuti Dynamic Type OS) */
export const typography = {
  display: {
    fontFamily: fontFamily.serif,
    fontSize: 34,
    lineHeight: 42,
    fontWeight: 500,
    /**
     * Tracking optis negatif (v2.1). Di >= 22px jarak antar-huruf bawaan font
     * terlihat renggang — headline terasa "mengeja" alih-alih jadi satu
     * bentuk. -0,5px di 34px = -1,5%, cukup merapatkan tanpa menyatukan
     * glyph (EB Garamond punya sidebearing lebar). Body/caption tetap 0:
     * di <= 16px tracking negatif justru menurunkan keterbacaan.
     */
    letterSpacing: -0.5,
  },
  h1: {
    fontFamily: fontFamily.sans,
    fontSize: 28,
    lineHeight: 36,
    fontWeight: 700,
    fontWeightDark: 600,
    fontVariantNumeric: "tabular-nums",
    letterSpacing: -0.4, // -1,4% di 28px
  },
  h2: {
    fontFamily: fontFamily.sans,
    fontSize: 22,
    lineHeight: 30,
    fontWeight: 700,
    fontWeightDark: 600,
    fontVariantNumeric: "tabular-nums",
    letterSpacing: -0.3, // -1,4% di 22px — di bawah ini tidak lagi terukur
  },
  h3: {
    fontFamily: fontFamily.sans,
    fontSize: 18,
    lineHeight: 26,
    fontWeight: 600,
    fontVariantNumeric: "tabular-nums",
  },
  bodyLarge: {
    fontFamily: fontFamily.sans,
    fontSize: 16,
    lineHeight: 26,
    fontWeight: 400,
    fontVariantNumeric: "tabular-nums",
  },
  body: {
    fontFamily: fontFamily.sans,
    fontSize: 14,
    lineHeight: 22,
    fontWeight: 400,
    fontVariantNumeric: "tabular-nums",
  },
  caption: {
    fontFamily: fontFamily.sans,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: 400, // boleh 500 untuk penekanan ringan
    fontVariantNumeric: "tabular-nums",
  },
  label: {
    fontFamily: fontFamily.sans,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: 600, // jangan ALL CAPS — cukup weight 600 + ukuran kecil
    fontVariantNumeric: "tabular-nums",
  },
  monoLarge: {
    fontFamily: fontFamily.mono,
    fontSize: 24,
    lineHeight: 32,
    fontWeight: 600,
    letterSpacing: letterSpacing.mono,
  },
  monoBody: {
    fontFamily: fontFamily.mono,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: 500,
    letterSpacing: letterSpacing.mono,
  },
} as const satisfies Record<string, TypeStyle>

export type TypographyKey = keyof typeof typography

// ==================================================================
// 4. SPACING & LAYOUT
// ==================================================================

/** Base unit 4px. Density: Spacious. */
export const space = {
  0: 0,
  /**
   * 2px — setengah unit dasar. Dipakai HANYA untuk celah vertikal rapat
   * judul→subjudul di dalam satu baris list (26 komponen menulisnya sebagai
   * `gap-[2px]` sebelum langkah ini ada). Bukan pengganti `1` (4px) untuk
   * gap antar elemen.
   */
  "0.5": 2,
  1: 4, // Gap ikon-teks rapat
  2: 8, // Gap internal komponen kecil
  3: 12, // Padding input vertikal
  4: 16, // Gap standar antar elemen
  5: 20, // Card padding default + SCREEN PADDING horizontal (v2.1)
  6: 24, // Jarak antar section, thumb Slider (24), offset FAB
  8: 32, // Gap antar section besar
  10: 40, // Padding card besar / hero
  12: 48, // Jarak antar blok konten besar
  16: 64, // Top spacing layar penuh (splash, empty state)
} as const

export const layout = {
  /**
   * Screen padding horizontal — v2.1: 24 → 20px.
   *
   * Kenapa 24 terlalu lebar: di ponsel 360dp (lebar Android paling umum)
   * gutter 24px + card padding 20px menyisakan kolom teks 272dp = 75,6%
   * lebar layar. Untuk layar berisi baris nominal + status + waktu, 24%
   * lebar yang hilang untuk margin membuat angka terpotong/terpaksa wrap.
   * Kenapa tidak 16: 16px hanya dipakai Material untuk list rapat; di kartu
   * finansial ia membuat konten menempel ke tepi dan terasa sempit.
   * 20px = margin halaman standar iOS HIG, kolom teks kembali ke 280dp
   * (77,8%) dan di web (kolom di-cap 520px) tetap proporsional.
   * Kelas Tailwind-nya `px-5`; nilai runtime via token ini.
   */
  screenPaddingX: space[5], // 20px kiri-kanan
  cardPadding: space[5], // 20px semua sisi
  cardGap: space[3], // 12px antar card dalam list
  iconTextGap: space[2], // 8px ikon ke teks
  /**
   * Inset kiri divider di dalam baris list, supaya garis mulai sejajar TEKS
   * (bukan ikon/avatar). Nilainya turunan komposisi, bukan angka bebas:
   *   icon     : px-5 (20) + IconBox md (40) + gap-3 (12) = 72
   *   avatar   : px-5 (20) + Avatar md (40) + gap-3 (12)  = 72
   *   listItem : px-5 (20) + Icon md (24)   + gap-3 (12) = 56
   *   leading  : Avatar/IconBox md (40) + gap-3 (12)      = 52  ← TANPA gutter
   *
   * `icon`/`avatar`/`listItem` untuk komponen full-bleed yang barisnya
   * memasang gutter sendiri (`px-5`) dan divider-nya berada DI LUAR wrapper
   * ber-padding. `leading` untuk baris yang dirender di dalam parent yang
   * SUDAH ber-gutter (PaginatedList `padded`, Screen `padded`, atau komponen
   * yang dipanggil dengan `padded={false}`) — gutter tidak boleh dihitung dua
   * kali, kalau tidak divider tergeser 20px ke kanan dari teks.
   *
   * Sejarah (v2.1): nilai lama `avatar: 64` dan `listItem: 60` diturunkan dari
   * asumsi leading yang sudah tidak dipakai siapa pun (Avatar sm 32 + gap-2),
   * padahal semua pemakai memakai leading 40px + gap-3 — divider chat & hasil
   * cari mulai 12px di kiri teks. Angka di atas dihitung ulang dari anatomi
   * baris yang benar-benar dirender sekarang.
   */
  rowDividerInset: { icon: 72, avatar: 72, listItem: 56, leading: 52 },
  /** §11 Web: satu breakpoint ~768px; di atasnya konten di-cap 520px & center */
  breakpoint: 768,
  maxContentWidth: 520,
  gridColumns: 12,
} as const

// ==================================================================
// 5. RADIUS — sharp/minim rounded; v2 menambah lg khusus kartu besar
// ==================================================================

export const radius = {
  none: 0,
  xs: 4, // Badge, chip, input kecil, tooltip
  sm: 6, // Button, input — kontrol TETAP di sini (v2 tidak mengubah)
  md: 8, // Card biasa, bottom sheet handle area, modal
  /**
   * lg 12px (v2 BARU) — HANYA untuk kartu besar/hero dan sheet di web lebar.
   * Alasan dibatasi: radius besar di semua card (= "kit SaaS" generik) justru
   * menghilangkan hierarki; kontrol dan kartu biasa tetap sm/md.
   */
  lg: 12,
  full: 999, // Avatar, dot indicator, pill khusus
} as const

// ==================================================================
// 6. ELEVATION & BORDER — depth lembut bertingkat (v2)
// ==================================================================

/**
 * 6.1 Border Roles — 4 role terpisah (fix collision "border-strong" di v1.0;
 * `control` ditambahkan di audit #6 untuk WCAG 1.4.11).
 *
 * - default : card, divider, separator (struktural, dikecualikan dari 1.4.11)
 * - control : outline resting form control — wajib >= 3:1 vs background
 * - focus   : fokus/aktif elemen interaktif
 * - error   : validasi error
 */
export const borderWidth = {
  none: 0,
  default: 1,
  control: 1,
  focus: 1.5,
  error: 1.5,
  /**
   * Cincin pemisah badge/lencana yang menumpuk di atas elemen lain (seal
   * verifikasi Avatar). 2px: 1px hilang secara optis di atas foto, 3px
   * mulai memakan diameter avatar `xs`.
   */
  badge: 2,
} as const

export const border = {
  default: {
    width: borderWidth.default,
    light: light.borderDefault,
    dark: dark.borderDefault,
  },
  control: {
    width: borderWidth.control,
    light: light.borderControl,
    dark: dark.borderControl,
  },
  focus: {
    width: borderWidth.focus,
    light: light.borderFocus,
    dark: dark.borderFocus,
  },
  error: {
    width: borderWidth.error,
    light: light.borderError,
    dark: dark.borderError,
  },
} as const

/**
 * 6.2 Shadow scale — "terangkat lembut", bukan drop tebal (v2 BARU).
 * Konsumsi SELALU via `elevationStyle()` dari lib/elevation.ts — satu titik
 * yang me-resolve warna/opacity per mode + boxShadow web + elevation Android.
 * Jangan tulis `shadow*`/`elevation`/`boxShadow` manual di komponen, dan
 * jangan pernah tempel level yang sama ke semua card (anti "kit SaaS"):
 *   - flat/none : list row, divider, input resting — struktural, border saja.
 *   - low       : kartu interaktif resting, chip terpilih.
 *   - medium    : toast, FAB, popover/dropdown.
 *   - high      : bottom sheet, modal/dialog.
 *
 * Warna shadow netral murni (#0A0A0A — gray.950 v2.2) di
 * light agar menyatu dengan ramp monokrom brand; di dark menghitam (#000000)
 * karena shadow berwarna tak terlihat di atas background gelap — di dark,
 * BORDER tetap pemisah utama, shadow hanya penguat. Opacity dark = light +
 * 0.28 (low 0.34 / medium 0.38 / high 0.44): tanpa boost, shadow iOS lenyap
 * total di atas #141412. Android tidak bisa mewarnai shadow (selalu netral)
 * — opacity dijaga kecil agar tidak kotor.
 *
 * v2.1 — geometri lebih difus: radius blur naik (8→10, 16→18, 32→36) dan
 * opacity light turun tipis (0.06→0.055, 0.10→0.09, 0.16→0.15). Shadow yang
 * kecil-pekat terlihat seperti garis abu di bawah kartu ("stiker"); blur
 * lebih lebar dengan alpha lebih rendah meniru cahaya ruang nyata sehingga
 * kartu terasa terangkat, bukan ditempel. Offset tidak diubah: offset adalah
 * arah cahaya, dan mengubahnya membuat seluruh app terlihat disinari dari
 * sudut berbeda.
 */
export const shadow = {
  none: {
    shadowColor: "transparent",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  color: {
    light: "#0A0A0A", // == gray.950 — tinta netral murni (ramp monokrom v2.2)
    dark: "#000000",
  },
  low: {
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 10,
    shadowOpacity: { light: 0.055, dark: 0.34 },
    elevation: 2,
  },
  medium: {
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 18,
    shadowOpacity: { light: 0.09, dark: 0.38 },
    elevation: 4,
  },
  high: {
    shadowOffset: { width: 0, height: 12 },
    shadowRadius: 36,
    shadowOpacity: { light: 0.15, dark: 0.44 },
    elevation: 8,
  },
} as const

/** Level elevasi untuk `elevationStyle()` — "flat" == shadow.none. */
export type ElevationLevel = "flat" | "low" | "medium" | "high"

/** 6.2 Layering / Z-index */
export const zIndex = {
  base: 0, // Konten & scroll
  sticky: 10, // Sticky header / Bottom Tab Bar
  backdrop: 40,
  bottomSheet: 50,
  modal: 60, // Modal / Dialog
  banner: 70, // Di atas modal — status/error kritikal harus tetap terlihat
} as const

// ==================================================================
// 7. ICONOGRAPHY — Phosphor Icons
// ==================================================================

export const icon = {
  size: {
    xs: 16,
    sm: 20,
    md: 24, // default
    lg: 28,
    xl: 32,
  },
  /** Weight Phosphor: default Regular, aktif/selected Fill atau Bold */
  weight: {
    default: "regular",
    active: "fill",
    activeAlt: "bold",
  },
  /** Warna ikon default = text-tertiary; aktif = text-primary / primary */
  color: {
    light: { default: light.textTertiary, active: light.textPrimary },
    dark: { default: dark.textTertiary, active: dark.textPrimary },
  },
  textGap: space[2], // 8px
} as const

// ==================================================================
// 8. MOTION & ANIMATION
// ==================================================================

export const motion = {
  duration: {
    press: 150, // Button press (satu-satunya exception cepat)
    fast: 250,
    base: 300, // Page transition push
    slow: 350,
    /**
     * moment 800 (v2 BARU) — signature moments yang memang harus DITONTON:
     * ring mengisi, angka count-up. Bukan untuk transisi rutin (terlalu lama).
     */
    moment: 800,
  },
  /**
   * Tiga kurva sesuai tujuan (v2): masuk soft-decelerate, keluar cepat,
   * standard untuk transisi rutin. Pasangan Css untuk web/framer.
   */
  easing: {
    standard: [0.4, 0, 0.2, 1] as const,
    standardCss: "cubic-bezier(0.4, 0, 0.2, 1)",
    /** easeOutCubic — konten masuk, reveal, expand. */
    enter: [0.33, 1, 0.68, 1] as const,
    enterCss: "cubic-bezier(0.33, 1, 0.68, 1)",
    /** easeInCubic — konten keluar; keluar harus terasa segera. */
    exit: [0.32, 0, 0.67, 0] as const,
    exitCss: "cubic-bezier(0.32, 0, 0.67, 0)",
  },
  /** Konfigurasi spring bersama untuk bottom sheet dan settle pull-to-refresh. */
  spring: {
    damping: 20,
    stiffness: 200,
    mass: 1,
  },
  /**
   * Spring playful (v2 BARU) — overshoot halus untuk momen yang layak terasa
   * ekspresif: unlock badge, toast masuk, sukses OTP/PIN, thumb slider aktif.
   * JANGAN dipakai untuk bottom sheet & settle pull-to-refresh (utilitarian).
   */
  springPlayful: {
    damping: 14,
    stiffness: 170,
    mass: 0.9,
  },
  scale: {
    press: 0.97, // Button pressed
  },
  opacity: {
    disabled: 0.4, // Button disabled — opacity, bukan token solid
  },
  /**
   * Overlay non-sheet (Modal/Dialog, Tooltip, Popover). §8 hanya mendefinisikan
   * spring untuk Bottom Sheet; overlay yang muncul "di tempat" (bukan dari tepi
   * layar) memakai fade + geser kecil + scale, meminjam bahasa Button press
   * (scale 0.97) supaya satu kosakata gerak. Durasi masuk `fast` (250ms) dan
   * keluar lebih singkat: keluar harus terasa segera setelah user memutuskan.
   */
  overlay: {
    enterDuration: 250,
    exitDuration: 200,
    translateY: 8, // = space[2]
    scaleFrom: 0.97, // = scale.press
    /** Tooltip: geser lebih kecil karena elemennya kecil dan dekat trigger */
    tooltipTranslateY: 4,
    tooltipMaxWidth: 260,
    tooltipMaxWidthMd: 320,
  },
  /** Spinner inline/pagination: monokrom text-tertiary, 16–20px */
  inlineSpinnerSize: { min: icon.size.xs, max: icon.size.sm },
} as const

// ==================================================================
// 9. AKSESIBILITAS
// ==================================================================

/**
 * Konstanta a11y non-visual. BUKAN token CSS: tidak ikut ke tailwind.config /
 * global.css (audit #12 tidak perlu menyinkronkannya). Dipakai lewat
 * `lib/hit-slop.ts` untuk menghitung `hitSlop`, dan sebagai rujukan angka di
 * komentar/komponen (mis. range-slider, text-link).
 */
export const a11y = {
  /**
   * Target sentuh minimum (audit #1): 44pt mengikuti iOS HIG; Android 48dp
   * dicapai komponen yang perlu lewat slop tambahan (Checkbox, Radio,
   * IconButton sm). Kelas Tailwind padanannya: `min-h-11 min-w-11` (44px).
   */
  minHitTarget: 44,
} as const

// ==================================================================
// AGGREGATE
// ==================================================================

export const tokens = {
  colors,
  fontFamily,
  fontFamilyByWeight,
  fontWeight,
  letterSpacing,
  typography,
  space,
  layout,
  radius,
  borderWidth,
  border,
  shadow,
  zIndex,
  icon,
  motion,
  a11y,
} as const

export type Tokens = typeof tokens

// ==================================================================
// ADAPTERS
// ==================================================================

const px = (n: number) => `${n}px`

/**
 * Konversi ke `theme.extend` untuk tailwind.config.js (NativeWind & web).
 *
 * Mode-aware tokens (background, surface, text-*, border-*, primary)
 * memakai CSS variables agar dark mode bisa di-switch via class/`vars()`
 * NativeWind. Gunakan `toCssVariables()` untuk mengisi nilainya.
 *
 * @example
 * // tailwind.config.js
 * const { toTailwindTheme } = require("./lib/tokens")
 * module.exports = { theme: { extend: toTailwindTheme() } }
 */
export function toTailwindTheme() {
  return {
    colors: {
      black: brand.black,
      white: brand.white,
      gray,
      // Mode-aware (CSS variables)
      background: "var(--color-background)",
      surface: {
        DEFAULT: "var(--color-surface)",
        elevated: "var(--color-surface-elevated)",
      },
      border: {
        DEFAULT: "var(--color-border-default)",
        control: "var(--color-border-control)",
        focus: "var(--color-border-focus)",
        error: "var(--color-border-error)",
      },
      text: {
        primary: "var(--color-text-primary)",
        secondary: "var(--color-text-secondary)",
        tertiary: "var(--color-text-tertiary)",
        disabled: "var(--color-text-disabled)",
      },
      primary: {
        DEFAULT: "var(--color-primary)",
        foreground: "var(--color-primary-foreground)",
      },
      overlay: "var(--color-overlay)",
      "overlay-media": "var(--color-overlay-media)",
      pressed: "var(--color-pressed)",
      success: {
        DEFAULT: "var(--color-success-fill)",
        text: "var(--color-success-text)",
        soft: "var(--color-success-soft)",
      },
      danger: {
        DEFAULT: "var(--color-danger-fill)",
        text: "var(--color-danger-text)",
        soft: "var(--color-danger-soft)",
      },
      warning: {
        DEFAULT: "var(--color-warning-fill)",
        text: "var(--color-warning-text)",
        soft: "var(--color-warning-soft)",
      },
      info: {
        DEFAULT: "var(--color-info-fill)",
        text: "var(--color-info-text)",
        soft: "var(--color-info-soft)",
      },
      // Aksen v2 (Pinus) — momen trust & escrow. Lihat §2.3b untuk aturan pakai.
      accent: {
        DEFAULT: "var(--color-accent-fill)",
        text: "var(--color-accent-text)",
        soft: "var(--color-accent-soft)",
        foreground: "var(--color-accent-foreground)",
      },
    },
    fontFamily: {
      sans: [fontFamily.sans, "system-ui", "sans-serif"],
      serif: [fontFamily.serif, "Georgia", "serif"],
      mono: [fontFamily.mono, "ui-monospace", "monospace"],
    },
    // Utility type-scale (text-h1, text-body, …) HANYA membawa size + lineHeight
    // (+ letterSpacing untuk mono). Weight TIDAK disertakan: di RN weight sudah
    // implisit di file font (font-sans-700), dan fontWeight "700" di atas file
    // Bold memicu faux-bold di Android. Weight dark-mode H1/H2 (700 -> 600)
    // ditangani komponen Text lewat `dark:font-sans-600`.
    fontSize: Object.fromEntries(
      Object.entries(typography).map(([key, t]) => {
        const opts: Record<string, string> = {
          lineHeight: px(t.lineHeight),
        }
        if ("letterSpacing" in t && t.letterSpacing) {
          opts.letterSpacing = px(t.letterSpacing)
        }
        return [key, [px(t.fontSize), opts]]
      }),
    ) as Record<TypographyKey, [string, Record<string, string>]>,
    letterSpacing: {
      mono: px(letterSpacing.mono),
    },
    spacing: Object.fromEntries(
      Object.entries(space).map(([k, v]) => [k, px(v)]),
    ) as Record<keyof typeof space, string>,
    borderRadius: {
      none: px(radius.none),
      xs: px(radius.xs),
      sm: px(radius.sm),
      md: px(radius.md),
      lg: px(radius.lg),
      DEFAULT: px(radius.sm),
      full: px(radius.full),
    },
    borderWidth: {
      DEFAULT: px(borderWidth.default),
      0: "0px",
      focus: px(borderWidth.focus),
      error: px(borderWidth.error),
      badge: px(borderWidth.badge),
    },
    boxShadow: { none: "none", DEFAULT: "none" },
    zIndex: Object.fromEntries(
      Object.entries(zIndex).map(([k, v]) => [k, String(v)]),
    ) as Record<keyof typeof zIndex, string>,
    maxWidth: {
      content: px(layout.maxContentWidth),
    },
    screens: {
      md: px(layout.breakpoint),
    },
    transitionDuration: {
      press: `${motion.duration.press}ms`,
      fast: `${motion.duration.fast}ms`,
      DEFAULT: `${motion.duration.base}ms`,
      slow: `${motion.duration.slow}ms`,
      moment: `${motion.duration.moment}ms`,
    },
    transitionTimingFunction: {
      DEFAULT: motion.easing.standardCss,
      standard: motion.easing.standardCss,
      enter: motion.easing.enterCss,
      exit: motion.easing.exitCss,
    },
    scale: {
      press: String(motion.scale.press),
    },
    opacity: {
      disabled: String(motion.opacity.disabled),
    },
  }
}

/**
 * CSS variables per mode — untuk `:root` / `.dark` di web,
 * atau `vars()` di NativeWind.
 *
 * @example
 * // NativeWind
 * import { vars } from "nativewind"
 * <View style={vars(toCssVariables("dark"))} />
 */
export function toCssVariables(mode: ColorMode): Record<string, string> {
  const m = modes[mode]
  return {
    "--color-background": m.background,
    "--color-surface": m.surface,
    "--color-surface-elevated": m.surfaceElevated,
    "--color-border-default": m.borderDefault,
    "--color-border-control": m.borderControl,
    "--color-border-focus": m.borderFocus,
    "--color-border-error": m.borderError,
    "--color-text-primary": m.textPrimary,
    "--color-text-secondary": m.textSecondary,
    "--color-text-tertiary": m.textTertiary,
    "--color-text-disabled": m.textDisabled,
    "--color-primary": m.primary,
    "--color-primary-foreground": m.primaryForeground,
    "--color-overlay": m.overlay,
    "--color-overlay-media": m.overlayMedia,
    "--color-pressed": m.pressed,
    "--color-success-fill": semantic.success[mode].fill,
    "--color-success-text": semantic.success[mode].text,
    "--color-success-soft": semantic.success[mode].bgSoft,
    "--color-danger-fill": semantic.danger[mode].fill,
    "--color-danger-text": semantic.danger[mode].text,
    "--color-danger-soft": semantic.danger[mode].bgSoft,
    "--color-warning-fill": semantic.warning[mode].fill,
    "--color-warning-text": semantic.warning[mode].text,
    "--color-warning-soft": semantic.warning[mode].bgSoft,
    "--color-info-fill": semantic.info[mode].fill,
    "--color-info-text": semantic.info[mode].text,
    "--color-info-soft": semantic.info[mode].bgSoft,
    "--color-accent-fill": accent[mode].fill,
    "--color-accent-text": accent[mode].text,
    "--color-accent-soft": accent[mode].bgSoft,
    "--color-accent-foreground": accent[mode].onFill,
  }
}

/**
 * Resolve type style ke object siap pakai di RN `StyleSheet` / web CSS,
 * dengan weight yang sudah disesuaikan untuk dark mode (H1/H2 -> 600).
 */
export function getTypeStyle(key: TypographyKey, mode: ColorMode = "light") {
  const t = typography[key]
  const weight =
    mode === "dark" && "fontWeightDark" in t && t.fontWeightDark
      ? t.fontWeightDark
      : t.fontWeight
  return {
    fontFamily: t.fontFamily,
    fontSize: t.fontSize,
    lineHeight: t.lineHeight,
    fontWeight: String(weight) as "400" | "500" | "600" | "700",
    letterSpacing: "letterSpacing" in t ? t.letterSpacing ?? 0 : 0,
  }
}

export default tokens
