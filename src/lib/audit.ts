// Audit logging — every privileged action leaves an immutable trail.

import { db } from "./db";

export type ActorType = "SUPER_ADMIN" | "SHOP_ADMIN" | "CUSTOMER" | "SYSTEM" | "AGENT";

export async function audit(entry: {
  actorType: ActorType;
  actorId?: string | null;
  actorLabel?: string | null;
  shopId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  meta?: Record<string, unknown> | null;
  ip?: string | null;
}): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        actorType: entry.actorType,
        actorId: entry.actorId ?? null,
        actorLabel: entry.actorLabel ?? null,
        shopId: entry.shopId ?? null,
        action: entry.action,
        entityType: entry.entityType ?? null,
        entityId: entry.entityId ?? null,
        meta: entry.meta ? JSON.stringify(entry.meta) : null,
        ip: entry.ip ?? null,
      },
    });
  } catch (e) {
    // Audit must never break the main flow, but must be visible in logs.
    console.error("[audit] failed to write audit log:", entry.action, e);
  }
}
