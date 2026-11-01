"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2 } from "lucide-react";
import { formatIST } from "@/lib/format";

interface Log {
  id: string; actorType: string; actorLabel?: string | null; shop?: { name: string; slug: string } | null;
  action: string; entityType?: string | null; entityId?: string | null; meta?: Record<string, unknown> | null;
  ip?: string | null; createdAt: string;
}

export default function AdminAudit() {
  const [logs, setLogs] = useState<Log[] | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const load = useCallback((p: number) => {
    fetch(`/api/admin/audit-logs?page=${p}`).then(async (r) => {
      const data = await r.json();
      setLogs(data.logs); setTotal(data.total);
    });
  }, []);
  useEffect(() => { load(page); }, [load, page]);

  if (!logs) return <div className="grid place-items-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  const pages = Math.max(1, Math.ceil(total / 50));

  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-bold">Audit logs</h1><p className="text-sm text-muted-foreground">Immutable trail of privileged actions across the platform.</p></div>
      <Card><CardContent className="p-0 overflow-x-auto">
        <Table>
          <TableHeader><TableRow><TableHead>When (IST)</TableHead><TableHead>Actor</TableHead><TableHead>Action</TableHead><TableHead>Shop</TableHead><TableHead>Details</TableHead></TableRow></TableHeader>
          <TableBody>
            {logs.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="text-xs whitespace-nowrap">{formatIST(l.createdAt)}</TableCell>
                <TableCell><Badge variant="outline" className="mr-1">{l.actorType}</Badge><span className="text-xs">{l.actorLabel ?? "—"}</span></TableCell>
                <TableCell className="font-mono text-xs">{l.action}</TableCell>
                <TableCell className="text-xs">{l.shop?.name ?? "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground max-w-xs truncate">{l.entityType ? `${l.entityType} ${l.entityId} · ` : ""}{l.meta ? JSON.stringify(l.meta) : ""}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{total} entries</span>
        <div className="space-x-2">
          <button className="underline disabled:opacity-40" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
          <span>Page {page} / {pages}</span>
          <button className="underline disabled:opacity-40" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      </div>
    </div>
  );
}
