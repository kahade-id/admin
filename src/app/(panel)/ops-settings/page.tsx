"use client"

/**
 * Admin — Pengaturan Operasional (OPS).
 *
 * Route: `/ops-settings` — SUPER_ADMIN ONLY.
 *
 * Halaman paling sensitif di admin panel: token integrasi (Fonnte dsb.)
 * dikelola di sini tanpa SSH ke server. Nilai secret TIDAK PERNAH
 * dikembalikan utuh oleh API — hanya mask "••••ab12".
 *
 * Aturan:
 * - Ubah → test koneksi dulu (untuk yang testable) → simpan.
 * - Setiap perubahan & test tercatat di audit (riwayat per setting).
 * - Boot secret (DATABASE_URL, JWT_*, AES_*) TIDAK ADA di sini by design.
 */

import { useCallback, useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Dialog } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Field, Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { useToast } from "@/components/ui/toast"
// ADM-408: lapis UI kedua — tolak role non-SUPER_ADMIN dengan pesan jelas
// (backend sudah SUPER_ADMIN-only; ini konsistensi tampilan).
import { RoleGate } from "@/components/admin/role-gate"
// H05/BAI-115: step-up re-auth sebelum aksi kritis (parsial — enforcement
// server per-aksi belum ada, tercatat sebagai backlog di reauth-gate.tsx;
// backend tetap menegakkan RBAC yang ada). Copy UI tidak mengklaim
// verifikasi per-aksi: yang dibuka adalah jendela konfirmasi 10 menit.
import { ReauthDialog, useReauthGate } from "@/components/admin/batch139/reauth-gate"
import { useStepUp } from "@/components/admin/step-up-gate"
import { useAuth } from "@/lib/auth-context"
import { formatDateTimeWIB } from "@/lib/format"
import { userMessage } from "@/lib/api/response"
import {
  listOpsSettings,
  updateOpsSetting,
  deleteOpsSetting,
  testOpsSetting,
  getOpsSettingHistory,
  getMaintenanceStatus,
  updateMaintenance,
  getPendingApprovals,
  approvePendingApproval,
  rejectPendingApproval,
  getTranslationHealth,
  isFinancialKey,
  isUpdatePending,
  OpsSettingsNotSupportedError,
  type OpsSettingView,
  type OpsSettingAuditItem,
  type MaintenanceStatus,
  type PendingApproval,
  type TranslationHealth,
} from "@/lib/api/admin/ops-settings"

export default function OpsSettingsPage() {
  const toast = useToast()
  const [settings, setSettings] = useState<OpsSettingView[]>([])
  const [loading, setLoading] = useState(true)

  // Item 9 (batch 2026-09-28): Mode maintenance — kartu khusus di atas daftar
  // setting (toggle + pesan), memakai endpoint PUT /v1/admin/maintenance.
  const [maintenance, setMaintenance] = useState<MaintenanceStatus | null>(null)
  const [maintenanceLoading, setMaintenanceLoading] = useState(true)
  const [maintenanceSaving, setMaintenanceSaving] = useState(false)
  const [maintenanceDraft, setMaintenanceDraft] = useState(false)
  const [maintenanceMessage, setMaintenanceMessage] = useState("")
  // BAI-105: lacak apakah field pesan disentuh — "disentuh + kosong" = reset
  // ke default, "tidak disentuh" = pertahankan pesan lama (tidak dikirim).
  const [messageTouched, setMessageTouched] = useState(false)
  // BAI-118: versi MAINTENANCE_MODE saat dimuat (optimistic locking).
  const [maintenanceVersion, setMaintenanceVersion] = useState(0)

  // H05: re-auth gate untuk simpan setting & maintenance.
  const reauth = useReauthGate()
  // FAL-003/SEC-506: step-up gate untuk aksi sensitif (tutup polling,
  // setujui/tolak perubahan finansial). Stub W4 — diganti implementasi W2.
  const stepUp = useStepUp()
  const { profile } = useAuth()

  // Dialog ubah
  const [editing, setEditing] = useState<OpsSettingView | null>(null)
  const [newValue, setNewValue] = useState("")
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  // Dialog riwayat
  const [historyFor, setHistoryFor] = useState<OpsSettingView | null>(null)
  const [history, setHistory] = useState<OpsSettingAuditItem[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  // BAI-118: konflik optimistic locking — admin lain mengubah setting yang
  // sama setelah halaman dimuat. Dialog meminta muat ulang sebelum mengulang.
  const [conflict, setConflict] = useState<{ key: string; detail: string } | null>(null)
  // BAI-104: key yang sedang di-reset ke default.
  const [resettingKey, setResettingKey] = useState<string | null>(null)

  // SEC-506: antrean persetujuan two-person rule untuk key finansial/kritis.
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([])
  const [pendingLoading, setPendingLoading] = useState(true)
  // true bila endpoint pending-approvals 404 → backend belum siap; tampilkan
  // banner jujur (bukan diam-diam single-approval).
  const [twoPersonUnsupported, setTwoPersonUnsupported] = useState(false)
  const [approvalBusyId, setApprovalBusyId] = useState<string | null>(null)

  // FAL-006: indikator health layanan terjemahan chat (CHAT_TRANSLATION_*).
  const [translationHealth, setTranslationHealth] = useState<TranslationHealth | null>(null)

  /** true bila error adalah 409 konflik versi (BAI-118). */
  const isConflictError = (e: unknown) =>
    typeof e === "object" && e !== null && (e as { status?: number }).status === 409

  const load = useCallback(async () => {
    setLoading(true)
    setMaintenanceLoading(true)
    try {
      setSettings(await listOpsSettings())
    } catch (e) {
      toast.show({ title: "Gagal", description: userMessage(e), tone: "danger" })
    } finally {
      setLoading(false)
    }
    try {
      const m = await getMaintenanceStatus()
      setMaintenance(m)
      setMaintenanceDraft(m.enabled)
      setMaintenanceMessage(m.message ?? "")
      setMessageTouched(false)
      setMaintenanceVersion(m.version ?? 0)
    } catch (e) {
      toast.show({ title: "Gagal memuat status maintenance", description: userMessage(e), tone: "danger" })
    } finally {
      setMaintenanceLoading(false)
    }
    // SEC-506: antrean persetujuan (defensif 404 → banner, bukan crash).
    setPendingLoading(true)
    try {
      setPendingApprovals(await getPendingApprovals())
      setTwoPersonUnsupported(false)
    } catch (e) {
      if (e instanceof OpsSettingsNotSupportedError) {
        setTwoPersonUnsupported(true)
      } else {
        toast.show({ title: "Gagal memuat antrean persetujuan", description: userMessage(e), tone: "danger" })
      }
    } finally {
      setPendingLoading(false)
    }
    // FAL-006: health layanan terjemahan (defensif 404 → "tak diketahui").
    try {
      setTranslationHealth(await getTranslationHealth())
    } catch (e) {
      toast.show({ title: "Gagal memuat status terjemahan", description: userMessage(e), tone: "danger" })
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  /** BAI-110: kunci boolean yang dialog ubahnya memakai select true/false. */
  const isBooleanKey = (key: string) => key === "WALLET_ENABLED" || key === "MAINTENANCE_MODE"

  /**
   * Hint format/validasi per key di dialog ubah.
   * BAD-004: FONNTE_WEBHOOK_IPS — daftar IP dipisah koma, harus IP valid.
   */
  const editHint = (key: string): string | undefined => {
    if (key === "FONNTE_API_URL") {
      return "URL divalidasi anti-SSRF saat disimpan (wajib HTTPS, tanpa kredensial, bukan IP privat) dan dinormalisasi — nilai tersimpan bisa berbeda dari yang diketik."
    }
    if (key === "FONNTE_WEBHOOK_IPS") {
      return "Daftar IP dipisah koma, contoh: 103.52.212.5 — harus IP valid, typo membuat webhook ditolak."
    }
    // SEC-506: key finansial/kritis bisa masuk antrean two-person rule.
    if (isFinancialKey(key)) {
      return "Key finansial/kritis — perubahan bisa memerlukan persetujuan admin kedua (two-person rule) sebelum berlaku."
    }
    return undefined
  }

  /** true bila admin saat ini adalah pengusul perubahan tertunda. */
  const isOwnProposal = (a: PendingApproval): boolean => {
    const proposer = a.proposedById ?? a.proposedBy
    if (!proposer || !profile) return false
    return proposer === profile.id || proposer === profile.adminId
  }

  /** SEC-506: setujui perubahan tertunda — wajib step-up; pengusul tidak
   *  boleh menyetujui usulannya sendiri (tombol nonaktif + backend wajib
   *  menegakkan). */
  const doApprove = async (a: PendingApproval) => {
    if (isOwnProposal(a) || approvalBusyId) return
    const token = await stepUp.requestStepUp({
      action: "ops-setting.approve",
      targetId: a.id,
      title: "Setujui perubahan setting",
      description: `Menyetujui perubahan ${a.key} yang diusulkan ${a.proposedBy ?? "admin lain"}. Aksi ini dicatat di audit.`,
    })
    if (!token) return
    setApprovalBusyId(a.id)
    try {
      await approvePendingApproval(a.id, token)
      toast.show({ title: "Disetujui", description: `${a.key} kini berlaku.`, tone: "success" })
      setPendingApprovals(await getPendingApprovals())
      setSettings(await listOpsSettings())
    } catch (e) {
      toast.show({ title: "Gagal menyetujui", description: userMessage(e), tone: "danger" })
    } finally {
      setApprovalBusyId(null)
    }
  }

  /** SEC-506: tolak perubahan tertunda — wajib step-up. */
  const doReject = async (a: PendingApproval) => {
    if (approvalBusyId) return
    const token = await stepUp.requestStepUp({
      action: "ops-setting.reject",
      targetId: a.id,
      title: "Tolak perubahan setting",
      description: `Menolak perubahan ${a.key} yang diusulkan ${a.proposedBy ?? "admin lain"}. Aksi ini dicatat di audit.`,
    })
    if (!token) return
    setApprovalBusyId(a.id)
    try {
      await rejectPendingApproval(a.id, token)
      toast.show({ title: "Ditolak", description: `Perubahan ${a.key} dibatalkan.`, tone: "success" })
      setPendingApprovals(await getPendingApprovals())
    } catch (e) {
      toast.show({ title: "Gagal menolak", description: userMessage(e), tone: "danger" })
    } finally {
      setApprovalBusyId(null)
    }
  }

  const openEdit = (s: OpsSettingView) => {
    setEditing(s)
    // BAI-110: kunci boolean memakai select eksplisit — inisialisasi dari
    // nilai efektif saat ini, bukan string kosong.
    setNewValue(isBooleanKey(s.key) ? (s.displayValue === "true" ? "true" : "false") : "")
    setTestResult(null)
  }

  const doTest = async () => {
    if (!editing) return
    if (!newValue.trim() && !editing.configured) {
      toast.show({ title: "Belum bisa test", description: "Isi nilai baru dulu untuk di-test.", tone: "danger" })
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const r = await testOpsSetting(editing.key, newValue.trim() || undefined)
      setTestResult(r)
      if (r.ok) toast.show({ title: "Test koneksi", description: "Berhasil terhubung.", tone: "success" })
      else toast.show({ title: "Test koneksi", description: "Gagal. Periksa kembali nilainya.", tone: "danger" })
    } catch (e) {
      const msg = userMessage(e)
      setTestResult({ ok: false, message: msg })
      toast.show({ title: "Test koneksi", description: msg, tone: "danger" })
    } finally {
      setTesting(false)
    }
  }

  const doSave = async () => {
    if (!editing || !newValue.trim()) {
      toast.show({ title: "Belum bisa simpan", description: "Nilai tidak boleh kosong.", tone: "danger" })
      return
    }
    if (editing.testable && testResult && !testResult.ok) {
      toast.show({ title: "Belum bisa simpan", description: "Test koneksi gagal — perbaiki token sebelum menyimpan.", tone: "danger" })
      return
    }
    setSaving(true)
    try {
      // BAI-118: kirim versi yang ditampilkan saat dialog dibuka.
      const result = await updateOpsSetting(editing.key, newValue.trim(), editing.version)
      // SEC-506: backend menjawab 202 + pendingApproval (two-person rule) —
      // perubahan BELUM berlaku; jangan anggap sukses.
      if (isUpdatePending(result)) {
        toast.show({
          title: result.pendingApproval.key,
          description: "Perubahan menunggu persetujuan admin kedua (two-person rule) — belum berlaku.",
          tone: "info",
        })
        setEditing(null)
        try {
          setPendingApprovals(await getPendingApprovals())
        } catch {
          /* antrean mungkin belum didukung backend — banner sudah menangani */
        }
        return
      }
      const updated = result
      setSettings((prev) => prev.map((s) => (s.key === updated.key ? updated : s)))
      toast.show({ title: updated.label, description: "Diperbarui. Berlaku maks ~60 detik tanpa restart.", tone: "success" })
      setEditing(null)
    } catch (e) {
      // BAI-118: 409 → dialog konflik, bukan error generik.
      if (isConflictError(e)) {
        setEditing(null)
        setConflict({ key: editing.key, detail: userMessage(e) })
      } else {
        toast.show({ title: "Gagal", description: userMessage(e), tone: "danger" })
      }
    } finally {
      setSaving(false)
    }
  }

  /** BAI-104: kembalikan setting ke default/.env (hapus override panel). */
  const doResetSetting = async (s: OpsSettingView) => {
    setResettingKey(s.key)
    try {
      const updated = await deleteOpsSetting(s.key)
      setSettings((prev) => prev.map((x) => (x.key === updated.key ? updated : x)))
      toast.show({ title: s.label, description: "Override panel dihapus — kembali ke default.", tone: "success" })
    } catch (e) {
      toast.show({ title: "Gagal", description: userMessage(e), tone: "danger" })
    } finally {
      setResettingKey(null)
    }
  }

  const doSaveMaintenance = async () => {
    setMaintenanceSaving(true)
    try {
      // BAI-105: kirim pesan HANYA bila field disentuh. String kosong eksplisit
      // = reset ke pesan default; tidak disentuh = pertahankan (tidak dikirim).
      const updated = await updateMaintenance(
        maintenanceDraft,
        messageTouched ? maintenanceMessage.trim() : undefined,
        maintenanceVersion,
      )
      setMaintenance(updated)
      setMaintenanceDraft(updated.enabled)
      setMaintenanceMessage(updated.message ?? "")
      setMessageTouched(false)
      setMaintenanceVersion(updated.version ?? 0)
      // BAI-106: refresh daftar setting agar kartu MAINTENANCE_MODE /
      // MAINTENANCE_MESSAGE menampilkan nilai/badge/source terbaru.
      try {
        setSettings(await listOpsSettings())
      } catch (e) {
        toast.show({ title: "Peringatan", description: `Status maintenance tersimpan, tetapi daftar setting gagal dimuat ulang: ${userMessage(e)}`, tone: "info" })
      }
      toast.show({
        title: updated.enabled ? "Mode maintenance AKTIF" : "Mode maintenance nonaktif",
        description: updated.enabled
          ? "Semua request non-admin kini dijawab 503. Admin panel tetap bisa diakses."
          : "Layanan kembali normal.",
        tone: updated.enabled ? "danger" : "success",
      })
    } catch (e) {
      // BAI-118: 409 → dialog konflik.
      if (isConflictError(e)) {
        setConflict({ key: "MAINTENANCE_MODE", detail: userMessage(e) })
      } else {
        toast.show({ title: "Gagal", description: userMessage(e), tone: "danger" })
      }
    } finally {
      setMaintenanceSaving(false)
    }
  }

  const openHistory = async (s: OpsSettingView) => {
    setHistoryFor(s)
    setHistoryLoading(true)
    try {
      setHistory(await getOpsSettingHistory(s.key))
    } catch (e) {
      toast.show({ title: "Gagal", description: userMessage(e), tone: "danger" })
    } finally {
      setHistoryLoading(false)
    }
  }

  /** BAI-118: muat ulang data terbaru setelah konflik, lalu buka lagi dialog
   *  ubah untuk setting yang sama (bila dari daftar generik). */
  const reloadAfterConflict = async () => {
    const key = conflict?.key
    setConflict(null)
    try {
      const [list, m] = await Promise.all([listOpsSettings(), getMaintenanceStatus()])
      setSettings(list)
      setMaintenance(m)
      setMaintenanceDraft(m.enabled)
      setMaintenanceMessage(m.message ?? "")
      setMessageTouched(false)
      setMaintenanceVersion(m.version ?? 0)
      if (key && key !== "MAINTENANCE_MODE") {
        const s = list.find((x) => x.key === key)
        if (s) openEdit(s)
      }
      toast.show({ title: "Dimuat ulang", description: "Data terbaru sudah dimuat. Silakan ulangi perubahan Anda.", tone: "success" })
    } catch (e) {
      toast.show({ title: "Gagal", description: userMessage(e), tone: "danger" })
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner />
      </div>
    )
  }

  // BAD-026: secret Fonnte (token) terisi sementara allowlist IP webhook kosong.
  const fonnteSecretConfigured = settings.some(
    (x) =>
      /fonnte/i.test(x.key) &&
      x.key !== "FONNTE_WEBHOOK_IPS" &&
      x.isSecret &&
      x.configured,
  )

  return (
    <RoleGate href="/ops-settings">
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Pengaturan Operasional</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Token integrasi & konfigurasi operasional. Nilai yang diubah di halaman ini
          berlaku untuk request berikutnya (maks ~60 detik) <strong>tanpa restart</strong>.
          Secret tersimpan terenkripsi dan tidak pernah ditampilkan utuh.
          Yang <strong>tidak dikelola di sini</strong> (tetap perlu SSH + edit .env + restart):
          kredensial DANA, Midtrans, Twilio, SMTP, dan boot secret (database, JWT, kunci enkripsi).
        </p>
      </div>

      {/* Item 9 (batch 2026-09-28): Mode maintenance — toggle + pesan.
          PUT /v1/admin/maintenance (SUPER_ADMIN). Saat aktif, semua request
          non-admin dijawab 503 + Retry-After; admin panel tetap bisa diakses. */}
      <Card className={`p-4 space-y-3 ${maintenance?.enabled ? "border-red-500" : ""}`}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-medium">Mode Maintenance</div>
            <div className="text-xs text-muted-foreground font-mono">MAINTENANCE_MODE / MAINTENANCE_MESSAGE</div>
          </div>
          {maintenanceLoading ? (
            <Spinner />
          ) : (
            <Badge variant="soft" tone={maintenance?.enabled ? "danger" : "neutral"}>
              {maintenance?.enabled ? "AKTIF" : "Nonaktif"}
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Saat aktif, aplikasi mobile & semua request non-admin menerima 503
          (coba lagi nanti). Splash screen membaca status via{" "}
          <code className="font-mono text-xs">GET /v1/public/maintenance</code> tanpa auth.
          {/* BAI-114: kapan maintenance terakhir diubah (dari baris DB). */}
          {maintenance?.updatedAt && (
            <span className="block mt-1 text-xs">
              Terakhir diubah {formatDateTimeWIB(maintenance.updatedAt)}
              {maintenance.updatedBy ? ` oleh ${maintenance.updatedBy}` : ""}
            </span>
          )}
        </p>
        {!maintenanceLoading && maintenance && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={maintenanceDraft}
                aria-label="Aktifkan mode maintenance"
                onClick={() => setMaintenanceDraft((v) => !v)}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                  maintenanceDraft ? "bg-red-600" : "bg-muted"
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                    maintenanceDraft ? "translate-x-5" : "translate-x-0.5"
                  }`}
                />
              </button>
              <span className="text-sm">{maintenanceDraft ? "Aktif" : "Nonaktif"}</span>
            </div>
            {/* BAI-105: label "kosong = default" kini akurat — field yang dikosongkan
                lalu disimpan MENGHAPUS pesan kustom (kembali ke default).
                Field yang tidak disentuh mempertahankan pesan lama. */}
            <Field label="Pesan untuk user (maks 500 karakter, kosong = default)">
              <Input
                type="text"
                value={maintenanceMessage}
                onChange={(e) => {
                  setMaintenanceMessage(e.target.value)
                  setMessageTouched(true)
                }}
                placeholder="cth: Aplikasi sedang upgrade. Kembali dalam ±30 menit."
                maxLength={500}
                autoComplete="off"
              />
            </Field>
            <div>
              <Button
                size="sm"
                variant={maintenanceDraft ? "destructive" : "primary"}
                onClick={() =>
                  reauth.require(() => void doSaveMaintenance(), "Simpan mode maintenance")
                }
                disabled={maintenanceSaving}
              >
                {maintenanceSaving ? "Menyimpan…" : "Simpan mode maintenance"}
              </Button>
              {/* SEC-503: tiap aksi kritis meminta verifikasi ulang kata sandi —
                  server menerbitkan token sekali pakai khusus aksi tersebut. */}
              <p className="mt-1 text-xs text-muted-foreground">
                Setiap aksi kritis meminta verifikasi ulang kata sandi; server
                menerbitkan token sekali pakai khusus untuk aksi tersebut.
              </p>
            </div>
          </div>
        )}
      </Card>

      {/* SEC-506: two-person rule — antrean persetujuan perubahan finansial/kritis. */}
      {twoPersonUnsupported ? (
        <Card className="p-4 border-yellow-500">
          <p className="text-sm text-yellow-800">
            ⚠️ Two-person rule belum aktif di backend — perubahan finansial saat
            ini single-approval. Membutuhkan backend terbaru
            (GET /v1/admin/ops-settings/pending-approvals).
          </p>
        </Card>
      ) : (
        <Card className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-medium">Menunggu persetujuan</div>
              <p className="text-xs text-muted-foreground">
                Perubahan key finansial/kritis memerlukan persetujuan admin kedua.
                Pengusul tidak boleh menyetujui usulannya sendiri (ditegakkan di UI
                dan wajib di backend).
              </p>
            </div>
            {!pendingLoading && pendingApprovals.length > 0 && (
              <Badge variant="soft" tone="warning">
                {pendingApprovals.length} menunggu
              </Badge>
            )}
          </div>
          {pendingLoading ? (
            <Spinner />
          ) : pendingApprovals.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Tidak ada perubahan yang menunggu persetujuan.
            </p>
          ) : (
            <div className="space-y-2">
              {pendingApprovals.map((a) => {
                const own = isOwnProposal(a)
                const busy = approvalBusyId === a.id
                return (
                  <div key={a.id} className="border rounded p-3 text-sm space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <code className="font-mono text-xs font-semibold">{a.key}</code>
                      <span className="text-xs text-muted-foreground">
                        {a.proposedAt ? formatDateTimeWIB(a.proposedAt) : ""}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Nilai lama: <code className="font-mono">{a.oldValue ?? "—"}</code>
                      {" → "}
                      Nilai baru: <code className="font-mono">{a.newValue ?? "—"}</code>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Diusulkan oleh <code className="font-mono">{a.proposedBy ?? "—"}</code>
                      {own ? " (Anda)" : ""}
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Button
                        size="sm"
                        disabled={busy || own}
                        title={own ? "Pengusul tidak boleh menyetujui usulannya sendiri" : undefined}
                        onClick={() => void doApprove(a)}
                      >
                        {busy ? "Memproses…" : "Setuju"}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => void doReject(a)}
                      >
                        Tolak
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      )}

      {/* FAL-006: indikator health layanan terjemahan chat (CHAT_TRANSLATION_*). */}
      <Card className="p-4 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-medium">Terjemahan Chat</div>
            <div className="text-xs text-muted-foreground font-mono">CHAT_TRANSLATION_*</div>
          </div>
          {!translationHealth ? (
            <Spinner />
          ) : !translationHealth.supported ? (
            <Badge variant="soft" tone="neutral">Status tak diketahui</Badge>
          ) : translationHealth.configured ? (
            <Badge variant="soft" tone="success">Terkonfigurasi</Badge>
          ) : (
            <Badge variant="outline">Belum diset</Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {!translationHealth
            ? "Memuat status…"
            : !translationHealth.supported
              ? "Status tak diketahui — membutuhkan backend terbaru (GET /v1/admin/ops-settings/translation/health)."
              : translationHealth.configured
                ? `Provider: ${translationHealth.provider ?? "tidak diketahui"}. Key secret dirender sebagai input password dan tersimpan terenkripsi.`
                : "Key CHAT_TRANSLATION_* belum terdaftar di registry ops-settings — terjemahan chat nonaktif."}
        </p>
      </Card>

      {settings.length === 0 ? (
        <EmptyState title="Tidak ada pengaturan" description="Daftar pengaturan operasional kosong." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {settings.map((s) => (
            <Card key={s.key} className="p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium">{s.label}</div>
                  <div className="text-xs text-muted-foreground font-mono">{s.key}</div>
                </div>
                <div className="flex gap-1 shrink-0">
                  {/* BAI-117: bedakan "belum diset" dari "gagal didekripsi". */}
                  {s.status === "decrypt_failed" ? (
                    <Badge variant="soft" tone="danger">
                      Gagal didekripsi
                    </Badge>
                  ) : (
                    <Badge variant={s.configured ? "soft" : "outline"}>
                      {s.configured ? "Terkonfigurasi" : "Belum diset"}
                    </Badge>
                  )}
                  {s.source && (
                    <Badge variant="soft">{s.source === "db" ? "Panel" : ".env"}</Badge>
                  )}
                  {/* BAD-026: badge "Metode utama" pada kartu FONNTE_WEBHOOK_IPS. */}
                  {s.key === "FONNTE_WEBHOOK_IPS" && (
                    <Badge variant="soft" tone="info">
                      Metode utama
                    </Badge>
                  )}
                  {/* SEC-506: penanda key finansial/kritis (kandidat two-person rule). */}
                  {isFinancialKey(s.key) && (
                    <Badge variant="soft" tone="warning">
                      Finansial
                    </Badge>
                  )}
                </div>
              </div>
              <p className="text-sm text-muted-foreground">{s.description}</p>
              {/* BAD-026: peringatan inline bila IP kosong sementara secret terisi. */}
              {s.key === "FONNTE_WEBHOOK_IPS" && !s.configured && fonnteSecretConfigured && (
                <p className="text-xs text-yellow-700">
                  ⚠️ Daftar IP kosong sementara secret Fonnte terisi — webhook berisiko
                  ditolak bila backend mewajibkan allowlist IP. Isi daftar IP yang valid.
                </p>
              )}
              {s.status === "decrypt_failed" && (
                <p className="text-xs text-red-600">
                  Baris database ada tetapi gagal didekripsi (mis. kunci enkripsi berubah) —
                  set ulang nilainya untuk memperbaiki.
                </p>
              )}
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Nilai saat ini:</span>
                <code className="font-mono bg-muted px-2 py-0.5 rounded">
                  {s.displayValue ?? "—"}
                </code>
              </div>
              {s.updatedAt && (
                <div className="text-xs text-muted-foreground">
                  Diubah {formatDateTimeWIB(s.updatedAt)}
                  {s.updatedBy ? ` oleh ${s.updatedBy}` : ""} · v{s.version}
                </div>
              )}
              <div className="flex gap-2 pt-1">
                <Button size="sm" onClick={() => openEdit(s)}>
                  Ubah
                </Button>
                <Button size="sm" variant="secondary" onClick={() => void openHistory(s)}>
                  Riwayat
                </Button>
                {/* BAI-104: hapus override panel → kembali ke default/.env. */}
                {s.source === "db" && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={resettingKey === s.key}
                    onClick={() =>
                      reauth.require(
                        () => void doResetSetting(s),
                        `Kembalikan ${s.key} ke default`,
                      )
                    }
                  >
                    {resettingKey === s.key ? "Menghapus…" : "Kembalikan ke default"}
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Dialog ubah */}
      <Dialog
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? `Ubah ${editing.label}` : ""}
        description="Nilai baru berlaku untuk pengiriman berikutnya (maks ~60 detik) tanpa restart."
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Batal
            </Button>
            {/* SEC-503: ubah setting operasional wajib verifikasi ulang per
                aksi (token step-up sekali pakai dari server). */}
            <Button
              onClick={() => reauth.require(() => void doSave(), `Ubah setting ${editing?.key ?? ""}`)}
              disabled={saving || !newValue.trim()}
            >
              {saving ? "Menyimpan…" : "Simpan"}
            </Button>
          </>
        }
      >
        {editing && (
          <div className="space-y-4">
            {isBooleanKey(editing.key) ? (
              // BAI-110: select eksplisit — tidak ada lagi free-text yang
              // diam-diam berarti nonaktif ("1"/"ya"/"on" tanpa peringatan).
              <Field
                label="Nilai baru"
                hint='Hanya "true" (persis) yang mengaktifkan; nilai lain = nonaktif (fail-closed).'
              >
                <select
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  className="w-full rounded-sm border border-border-control bg-surface px-4 min-h-12 text-body text-text-primary outline-none focus:border-focus"
                  aria-label="Nilai baru"
                >
                  <option value="true">true — Aktif</option>
                  <option value="false">false — Nonaktif (default)</option>
                </select>
              </Field>
            ) : (
              <Field
                label="Nilai baru"
                // BAI-112/BAD-004/SEC-506: aturan validasi/normalisasi terlihat
                // SEBELUM submit (hint per key via editHint).
                hint={editHint(editing.key)}
              >
                <Input
                  type={editing.isSecret ? "password" : "text"}
                  value={newValue}
                  onChange={(e) => {
                    setNewValue(e.target.value)
                    setTestResult(null)
                  }}
                  placeholder={editing.isSecret ? "Token baru (tidak ditampilkan)" : "Nilai baru"}
                  autoComplete="off"
                />
              </Field>
            )}
            {editing.isSecret && (
              <p className="text-xs text-muted-foreground">
                Nilai saat ini: <code className="font-mono">{editing.displayValue ?? "—"}</code>.
                Secret lama tidak bisa dilihat kembali — hanya bisa diganti.
              </p>
            )}
            {editing.testable && (
              <div className="space-y-2">
                <Button variant="secondary" size="sm" onClick={doTest} disabled={testing}>
                  {testing ? "Mengetest…" : "Test koneksi dulu"}
                </Button>
                {testResult && (
                  <p className={`text-sm ${testResult.ok ? "text-green-600" : "text-red-600"}`}>
                    {testResult.ok ? "✓" : "✗"} {testResult.message}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </Dialog>

      {/* Dialog riwayat */}
      <Dialog
        open={!!historyFor}
        onClose={() => setHistoryFor(null)}
        title={historyFor ? `Riwayat ${historyFor.label}` : ""}
        description="Audit: siapa mengubah/mengetest apa dan kapan. Nilai secret hanya tampil sebagai mask."
      >
        {historyLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : history.length === 0 ? (
          <EmptyState title="Belum ada riwayat" description="Belum ada perubahan tercatat." />
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {history.map((h) => (
              <div key={h.id} className="border rounded p-3 text-sm space-y-1">
                <div className="flex items-center justify-between">
                  <Badge variant={h.action === "TEST" ? "outline" : "soft"}>{h.action}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTimeWIB(h.createdAt)}
                  </span>
                </div>
                <div>
                  Oleh <code className="font-mono text-xs">{h.changedBy}</code>
                  {h.success !== null && (
                    <span className={h.success ? "text-green-600" : "text-red-600"}>
                      {" "}· {h.success ? "berhasil" : "gagal"}
                    </span>
                  )}
                </div>
                {h.valueHint && (
                  <div className="text-xs text-muted-foreground">
                    Nilai: <code className="font-mono">{h.valueHint}</code>
                  </div>
                )}
                {h.detail && <div className="text-xs text-muted-foreground">{h.detail}</div>}
              </div>
            ))}
          </div>
        )}
      </Dialog>
      {/* BAI-118: dialog konflik optimistic locking. */}
      <Dialog
        open={!!conflict}
        onClose={() => setConflict(null)}
        title="Setting berubah saat Anda mengedit"
        description="Admin lain mengubah setting ini setelah halaman dimuat. Perubahan Anda TIDAK disimpan (last-write-wins dicegah). Muat ulang untuk melihat nilai terbaru."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConflict(null)}>
              Tutup
            </Button>
            <Button onClick={() => void reloadAfterConflict()}>
              Muat ulang & edit lagi
            </Button>
          </>
        }
      >
        {conflict && (
          <p className="text-sm text-muted-foreground">
            <code className="font-mono text-xs">{conflict.key}</code>: {conflict.detail}
          </p>
        )}
      </Dialog>
      {/* H05: dialog verifikasi ulang untuk aksi kritis. */}
      <ReauthDialog {...reauth.dialog} />
      {/* SEC-506: dialog step-up untuk setujui/tolak perubahan finansial. */}
      {stepUp.stepUpDialog}
    </div>
    </RoleGate>
  )
}
