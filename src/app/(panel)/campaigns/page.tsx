/**
 * Admin — Kampanye (thin wrapper).
 *
 * Menu sidebar "Kampanye" tidak boleh 404: halaman ini memakai ulang
 * komponen tab Kampanye dari halaman voucher.
 */
"use client"

import { RoleGate } from "@/components/admin/role-gate"
import { CampaignsTab } from "../vouchers/page"

export default function CampaignsPage() {
  return (
    <RoleGate href="/campaigns">
      <div className="flex flex-col gap-5">
        <div>
          <h1 className="text-h2 font-semibold text-text-primary">Kampanye</h1>
          <p className="mt-1 text-body text-text-secondary">
            Kelola kampanye penerbitan voucher personal kepada pengguna.
          </p>
        </div>
        <CampaignsTab />
      </div>
    </RoleGate>
  )
}
