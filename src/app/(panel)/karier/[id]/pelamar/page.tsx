"use client"

/** Admin — Karier: daftar pelamar per lowongan (/karier/[id]/pelamar). */

import { useParams } from "next/navigation"

import { PelamarList } from "../../_components/pelamar-list"

export default function PelamarPerLowonganPage() {
  const params = useParams<{ id?: string }>()
  const postingId = typeof params?.id === "string" ? params.id : undefined
  return <PelamarList lockedPostingId={postingId} />
}
