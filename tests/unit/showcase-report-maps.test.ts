/**
 * ADM-05/ADM-08 (audit etalase 2026-10-10) — pemetaan tampilan laporan etalase.
 */
import { describe, expect, it } from "vitest"

import {
  MODERATION_EVENT_ACTION_LABEL,
  RISK_TIER_LABEL,
  riskTierFromScore,
} from "@/app/(panel)/reports/showcase/maps"

/** Cerminan enum `ModerationEventAction` backend (prisma/schema.prisma). */
const BACKEND_MODERATION_EVENT_ACTIONS = [
  "REOPENED",
  "NOTE_ADDED",
  "APPEAL_FILED",
  "APPEAL_DECIDED",
  "RESTORED",
  "RESTRICTED",
  "TAKEDOWN",
  "ASSIGNED",
  "ESCALATED",
  "EXPORTED",
  "DISMISSED",
  "NO_ACTION",
  "UNDER_REVIEW",
] as const

describe("MODERATION_EVENT_ACTION_LABEL (ADM-08)", () => {
  it("setiap aksi enum backend punya label Indonesia (tidak ada enum mentah di histori)", () => {
    for (const action of BACKEND_MODERATION_EVENT_ACTIONS) {
      expect(MODERATION_EVENT_ACTION_LABEL[action], action).toBeTruthy()
      expect(MODERATION_EVENT_ACTION_LABEL[action]).not.toBe(action)
    }
  })
})

describe("riskTierFromScore (ADM-05) — ambang sama dengan backend riskTier()", () => {
  it("≥70 HIGH, ≥40 MEDIUM, selain itu LOW", () => {
    expect(riskTierFromScore(100)).toBe("HIGH")
    expect(riskTierFromScore(70)).toBe("HIGH")
    expect(riskTierFromScore(69)).toBe("MEDIUM")
    expect(riskTierFromScore(40)).toBe("MEDIUM")
    expect(riskTierFromScore(39)).toBe("LOW")
    expect(riskTierFromScore(0)).toBe("LOW")
  })

  it("hasilnya selalu punya label tampilan", () => {
    for (const score of [0, 39, 40, 69, 70, 100]) {
      expect(RISK_TIER_LABEL[riskTierFromScore(score)]).toBeTruthy()
    }
  })
})
