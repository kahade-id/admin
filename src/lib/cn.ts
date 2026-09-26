/**
 * Kahade Admin Web — `cn()`: gabung className.
 *
 * Versi sederhana untuk web (tanpa tailwind-merge): menggabung string
 * dan memfilter nilai falsy. Untuk konflik utility yang disengaja,
 * urutan argumen menentukan — className terakhir menang di cascade
 * bila spesifisitas sama, jadi letakkan override di akhir.
 */
export function cn(...inputs: Array<string | false | null | undefined>): string {
  return inputs.filter(Boolean).join(" ")
}
