# Kontrak UI — halaman moderasi (untuk koordinator fondasi)

Dokumen ini mendefinisikan komponen `src/components/ui/` dan util yang
diasumsikan oleh halaman-halaman area moderasi di `src/app/(panel)/`.
Tujuannya agar fondasi yang dibangun kompatibel — bukan untuk mengikat
implementasi detail (styling bebas, yang penting props-nya cocok).

Jika sebuah komponen belum ada saat halaman ditulis, halaman akan memakai
fallback HTML + Tailwind langsung dan kontrak ini diperbarui.

## Komponen UI yang dipakai halaman moderasi

### `Button` — `src/components/ui/button.tsx`
```tsx
import { Button } from "@/components/ui/button"
<Button variant="primary" | "secondary" | "destructive" | "ghost"
        size="sm" | "md"            // default "md"
        loading?: boolean           // tampilkan spinner, disable otomatis
        disabled?: boolean
        type?: "button" | "submit"
        onClick?: (e) => void
        className?: string>
```

### `Card` — `src/components/ui/card.tsx`
```tsx
import { Card } from "@/components/ui/card"
<Card className?: string>           // klik tidak dipakai di web (pakai <Link>)
```

### `Badge` — `src/components/ui/badge.tsx`
```tsx
import { Badge } from "@/components/ui/badge"
<Badge tone="neutral" | "info" | "success" | "warning" | "danger" | "accent">
```

### `Input` — `src/components/ui/input.tsx`
```tsx
import { Input } from "@/components/ui/input"
<Input label?: string
       value: string
       onChange: (value: string) => void   // NOTE: string langsung, bukan event
       placeholder?: string
       type?: "text" | "password"
       required?: boolean
       disabled?: boolean
       error?: string                     // pesan error di bawah input
       helperText?: string
       className?: string />
```

### `Textarea` — `src/components/ui/textarea.tsx`
Props sama seperti `Input` (tanpa `type`), plus `rows?: number`, `maxLength?: number`.

### `Select` — `src/components/ui/select.tsx`
```tsx
import { Select } from "@/components/ui/select"
<Select label?: string
        value: string
        onChange: (value: string) => void
        options: Array<{ value: string; label: string }>
        disabled?: boolean
        className?: string />
```
Dipakai untuk: filter status tabel, pilihan keputusan resolve sengketa,
pilihan status tiket, aksi review moderasi.

### `Dialog` — `src/components/ui/dialog.tsx`
```tsx
import { Dialog } from "@/components/ui/dialog"
<Dialog open: boolean
        onClose: () => void
        title: string
        description?: string
        footer?: ReactNode            // tombol aksi (Batal / Konfirmasi)
        children: ReactNode />
```
Dipakai untuk: konfirmasi approve/reject/revoke KYC & bisnis (dengan form
alasan wajib), resolve sengketa, ubah status tiket, dismiss/resolve laporan,
review moderasi chat, award/revoke/hapus badge. Harus bisa memuat form
(input password dokumen, textarea alasan).

### `Pagination` — `src/components/ui/pagination.tsx`
```tsx
import { Pagination } from "@/components/ui/pagination"
<Pagination page: number              // 1-based
            totalPages: number
            total?: number             // total item, untuk label "x dari y"
            onPageChange: (page: number) => void
            disabled?: boolean />
```

### `KeyValue` — `src/components/ui/key-value.tsx` (opsional)
```tsx
<KeyValue label: string value: ReactNode mono?: boolean />
```
Baris label–nilai untuk halaman detail. Boleh tidak ada — fallback mudah.

### Toast — `src/components/ui/toast.tsx` atau `src/lib/toast.ts`
```tsx
import { useToast } from "@/components/ui/toast"   // atau sejenisnya
const toast = useToast()
toast.success("KYC disetujui")
toast.error("Gagal memproses KYC", detailPesan?)
```
Jika fondasi memakai pola lain (mis. `toast.success()` global), halaman
akan menyesuaikan — yang penting ada feedback sukses/gagal.

## Util non-UI yang diasumsikan

### `src/lib/api/admin/*` (koordinator fondasi — copy dari frontend)
Halaman moderasi memakai fungsi & tipe ini TANPA perubahan kontrak:
- `dashboard.ts`: `getDashboardSummary`, `getDashboardOrderStats`,
  `getRecentActivity`, tipe `DashboardSummary`, `OrderStats`, `RecentActivityItem`
- `kyc.ts`: `getKycQueue`, `getKycDetail`, `getKycDocumentUrls`,
  `approveKyc`, `rejectKyc`, `revokeKyc`, tipe `KycQueueItem`, `KycDetail`,
  `KycDocumentUrls`, `KycStatus`, `Paginated`
- `business.ts`: `getBusinessQueue`, `getBusinessDetail`,
  `getBusinessDocumentUrls`, `approveBusiness`, `rejectBusiness`,
  `revokeBusiness`, tipe `BusinessVerificationItem`, `BusinessVerificationStatus`
- `disputes.ts`: `listDisputes`, `getDisputeDetail`, `assignDispute`,
  `markDisputeUnderReview`, `getDisputeMessages`, `sendDisputeMessage`,
  `resolveDispute`, tipe `AdminDisputeItem`, `DisputeMessage`, `DisputeStatus`
- `support.ts`: `listTickets`, `getTicketDetail`, `replyToTicket`,
  `updateTicketStatus`, tipe `SupportTicket`, `TicketStatus`, `TicketReply`
- `reports.ts`: `listReports`, `getReportDetail`, `dismissReport`,
  `resolveReport`, tipe `UserReport`, `ReportStatus`
- `chat.ts`: `listModerationEvents`, `getModerationEventDetail`,
  `reviewModerationEvent`, `getModerationStats`, `getRoomMessages`,
  tipe `ModerationEvent`
- `badges.ts`: `listBadges`, `getBadgeDetail`, `createBadge`, `deleteBadge`,
  `awardBadge`, `revokeBadge`, tipe `AdminBadge`, `BadgeHolder`

### `src/lib/rbac.ts` (koordinator fondasi)
Halaman butuh salah satu bentuk ini:
```tsx
// Opsi A (hook) — dipakai di tiap halaman:
import { useRequireRole } from "@/lib/rbac"
useRequireRole(["SUPER_ADMIN", "KYC_ADMIN"])   // redirect /403 bila tak punya role

// Opsi B (komponen):
import { RequireRole } from "@/components/ui/require-role"
<RequireRole roles={["SUPER_ADMIN", "DISPUTE_ADMIN"]}>…</RequireRole>
```
Pemetaan role per halaman (dari kontrak backend):
| Halaman | Role yang boleh |
|---|---|
| Dasbor `/` | semua role admin |
| KYC `/kyc` | `SUPER_ADMIN`, `KYC_ADMIN` |
| Verifikasi bisnis `/business` | `SUPER_ADMIN`, `KYC_ADMIN` |
| Sengketa `/disputes` | `SUPER_ADMIN`, `DISPUTE_ADMIN` |
| Tiket `/tickets` | `SUPER_ADMIN`, `CUSTOMER_SUPPORT` |
| Laporan `/reports` | `SUPER_ADMIN`, `CUSTOMER_SUPPORT` |
| Moderasi chat `/chat` | `SUPER_ADMIN`, `CUSTOMER_SUPPORT` |
| Badge `/badges` | `SUPER_ADMIN` |

### Error handling API
Frontend memakai `handleAdminApiError(e)` (redirect login bila 401).
Halaman web mengasumsikan `adminHttp` sudah menangani 401 secara global
(redirect ke `/login`) sehingga halaman cukup menampilkan pesan error
via `userMessage(e)` / `getErrorMessage(e)`.

## Perilaku web yang disengaja BERBEDA dari mobile
- Tabel `<table>` + pagination bernomor (bukan infinite scroll / "muat lagi").
- Dialog menggantikan BottomSheet; `Alert.alert` → Dialog konfirmasi.
- `Linking.openURL` → `<a href target="_blank" rel="noopener">`.
- Dokumen KYC/bisnis: setelah URL 5-menit didapat, tampilkan sebagai
  link "Buka di tab baru" (bukan auto-open) — lebih aman untuk dokumen sensitif.
- Tanpa i18n: string Indonesia langsung.
- Refresh data: tombol "Muat ulang" + refetch setelah aksi (tanpa `useIsFocused`).
