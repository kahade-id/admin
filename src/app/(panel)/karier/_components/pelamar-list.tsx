"use client"

/**
 * Admin — Karier: daftar pelamar (Fase F4).
 *
 * Filter per lowongan + per status (BARU/DIREVIEW/WAWANCARA/DITERIMA/DITOLAK),
 * pencarian nama/email (q), pagination. Dipakai dari /karier (per lowongan)
 * maupun dari /karier/pelamar (semua lowongan).
 */

import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardBody } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { Field, Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { DataTable } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"
import { Pagination } from "@/components/admin/pagination"
import { RoleGate } from "@/components/admin/role-gate"
import {
  listApplications,
  listPostings,
  type JobApplicationItem,
  type JobApplicationStatus,
  type JobPosting,
} from "@/lib/api/admin/karier"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB } from "@/lib/format"
import {
  FieldSelect,
  JOB_APPLICATION_STATUS_LABEL,
  JOB_APPLICATION_STATUS_TONE,
  PageHeader,
  StatusBadge,
} from "@/app/(panel)/_components/admin-ui"

const PAGE_SIZE = 20

const STATUS_FILTER_OPTIONS = [
  { value: "", label: "Semua status" },
  { value: "BARU", label: JOB_APPLICATION_STATUS_LABEL.BARU },
  { value: "DIREVIEW", label: JOB_APPLICATION_STATUS_LABEL.DIREVIEW },
  { value: "WAWANCARA", label: JOB_APPLICATION_STATUS_LABEL.WAWANCARA },
  { value: "DITERIMA", label: JOB_APPLICATION_STATUS_LABEL.DITERIMA },
  { value: "DITOLAK", label: JOB_APPLICATION_STATUS_LABEL.DITOLAK },
]

export function PelamarList({ lockedPostingId }: { lockedPostingId?: string }) {
  const [items, setItems] = useState<JobApplicationItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<"" | JobApplicationStatus>("")
  const [postingId, setPostingId] = useState<string>(lockedPostingId ?? "")
  const [qInput, setQInput] = useState("")
  const [q, setQ] = useState("")
  const [postings, setPostings] = useState<JobPosting[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const toast = useToast()

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // Judul lowongan untuk konteks (bila dari /karier/[id]/pelamar).
  useEffect(() => {
    let alive = true
    listPostings({ page: 1, limit: 100 })
      .then((res) => {
        if (alive) setPostings(res.data)
      })
      .catch((e) => {
        toast.show({ title: "Gagal memuat daftar lowongan", description: userMessage(e), tone: "danger" })
      })
    return () => {
      alive = false
    }
  }, [toast])

  // Debounce pencarian nama/email.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setQ(qInput.trim())
      setPage(1)
    }, 500)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [qInput])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await listApplications({
        page,
        limit: PAGE_SIZE,
        postingId: postingId || undefined,
        status: status || undefined,
        q: q || undefined,
      })
      setItems(res.data)
      setTotal(res.total ?? 0)
    } catch (e) {
      setError(userMessage(e))
    } finally {
      setLoading(false)
    }
  }, [page, postingId, status, q])

  useEffect(() => {
    void load()
  }, [load])

  const lockedPosting = useMemo(
    () => (lockedPostingId ? postings.find((p) => p.id === lockedPostingId) : undefined),
    [lockedPostingId, postings],
  )

  return (
    <RoleGate href="/karier">
      <PageHeader
        title={lockedPosting ? `Pelamar — ${lockedPosting.title}` : "Semua Pelamar"}
        description={
          lockedPostingId && !lockedPosting
            ? "Memuat info lowongan…"
            : "Kelola lamaran masuk: filter status, cari nama/email, ubah pipeline."
        }
        actions={
          lockedPostingId ? (
            <Link href="/karier">
              <Button variant="secondary" size="sm">
                ← Kembali ke lowongan
              </Button>
            </Link>
          ) : (
            <Link href="/karier">
              <Button variant="secondary" size="sm">
                Kelola Lowongan
              </Button>
            </Link>
          )
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        {!lockedPostingId && (
          <FieldSelect
            label="Lowongan"
            value={postingId}
            onChange={(v) => {
              setPostingId(v)
              setPage(1)
            }}
            options={[
              { value: "", label: "Semua lowongan" },
              ...postings.map((p) => ({ value: p.id, label: p.title })),
            ]}
          />
        )}
        <FieldSelect
          label="Status"
          value={status}
          onChange={(v) => {
            setStatus(v as "" | JobApplicationStatus)
            setPage(1)
          }}
          options={STATUS_FILTER_OPTIONS}
        />
        <Field label="Pencarian">
          <Input
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Nama atau email…"
            className="min-w-56"
          />
        </Field>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner size="md" />
        </div>
      ) : error ? (
        <EmptyState title="Gagal memuat pelamar" description={error} action={
          <Button variant="secondary" onClick={() => void load()}>Coba lagi</Button>
        } />
      ) : items.length === 0 ? (
        <EmptyState
          title="Belum ada pelamar"
          description="Belum ada lamaran yang cocok dengan filter."
        />
      ) : (
        <Card>
          <CardBody>
            <DataTable<JobApplicationItem & Record<string, unknown>>
              columns={[
                {
                  key: "fullName",
                  header: "Nama",
                  render: (a) => (
                    <Link
                      href={`/karier/pelamar/${a.id}`}
                      className="font-semibold text-text-primary underline-offset-2 hover:underline"
                    >
                      {a.fullName}
                    </Link>
                  ),
                },
                { key: "email", header: "Email", render: (a) => <span className="break-all">{a.email}</span> },
                { key: "phone", header: "Telepon", render: (a) => a.phone },
                ...(!lockedPostingId
                  ? [
                      {
                        key: "posting" as const,
                        header: "Lowongan",
                        render: (a: JobApplicationItem) => a.posting?.title ?? "—",
                      },
                    ]
                  : []),
                {
                  key: "status",
                  header: "Status",
                  render: (a) => (
                    <StatusBadge
                      status={a.status}
                      labels={JOB_APPLICATION_STATUS_LABEL}
                      tones={JOB_APPLICATION_STATUS_TONE}
                    />
                  ),
                },
                {
                  key: "createdAt",
                  header: "Melamar",
                  render: (a) => (
                    <span className="text-caption text-text-secondary">
                      {formatDateTimeWIB(a.createdAt)}
                    </span>
                  ),
                },
                {
                  key: "actions",
                  header: "Aksi",
                  render: (a) => (
                    <Link href={`/karier/pelamar/${a.id}`}>
                      <Button variant="secondary" size="sm">
                        Lihat
                      </Button>
                    </Link>
                  ),
                },
              ]}
              rows={items}
              rowKey={(a) => a.id}
            />
            <div className="mt-4">
              <Pagination
                page={page}
                totalPages={totalPages}
                total={total}
                pageSize={PAGE_SIZE}
                onPageChange={setPage}
              />
            </div>
          </CardBody>
        </Card>
      )}
    </RoleGate>
  )
}
