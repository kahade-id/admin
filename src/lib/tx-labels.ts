/**
 * Label Indonesia untuk enum tipe transaksi wallet — dipakai ulang di tabel
 * transaksi (finance/page.tsx), panel jejak audit, dan dialog koreksi ledger
 * (ADM-230) agar tidak ada lagi raw enum Inggris seperti `TOP_UP`.
 */

export type TxMeta = { label: string; sign: "+" | "−" | "" }

export const TX_META: Record<string, TxMeta> = {
  TOP_UP: { label: "Top up", sign: "+" },
  WITHDRAW: { label: "Penarikan", sign: "−" },
  ORDER_LOCK: { label: "Escrow dikunci", sign: "−" },
  ORDER_RELEASE: { label: "Dana dicairkan ke penjual", sign: "+" },
  ORDER_REFUND: { label: "Dana order dikembalikan", sign: "+" },
  FEE_DEDUCT: { label: "Fee platform", sign: "−" },
  REFERRAL_REWARD: { label: "Reward referral", sign: "+" },
  SUBSCRIPTION_PAYMENT: { label: "Langganan", sign: "−" },
  ADMIN_CREDIT: { label: "Kredit admin", sign: "+" },
  ADMIN_DEBIT: { label: "Debit admin", sign: "−" },
  DISPUTE_RELEASE: { label: "Cair sengketa", sign: "+" },
  TRANSFER_SENT: { label: "Transfer keluar", sign: "−" },
  TRANSFER_RECEIVED: { label: "Transfer masuk", sign: "+" },
  CAMPAIGN_CASHBACK: { label: "Cashback", sign: "+" },
  TOPUP_BONUS: { label: "Bonus top up", sign: "+" },
}

/** Label Indonesia untuk tipe transaksi; fallback ke raw enum bila tak dikenal. */
export function txLabel(type: string): string {
  return TX_META[type]?.label ?? String(type)
}
