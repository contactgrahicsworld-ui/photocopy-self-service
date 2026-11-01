"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatIST } from "@/lib/format";
import { Loader2, ExternalLink } from "lucide-react";

interface Doc { id: string; originalName: string; pageCount: number; sizeBytes: number; createdAt: string; orderNumber?: string; orderStatus?: string; downloadUrl: string }

export default function ShopDocuments() {
  const [data, setData] = useState<{ documents: Doc[]; storageUsedBytes: number; storageLimitMb: number | null } | null>(null);
  useEffect(() => { fetch("/api/shop/documents").then(async (r) => r.ok && setData(await r.json())); }, []);

  if (!data) return <div className="grid place-items-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-bold">Customer documents</h1><p className="text-sm text-muted-foreground">Private storage — files open only through short-lived signed links (5 minutes).</p></div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Storage</CardTitle></CardHeader>
        <CardContent>
          <Progress value={data.storageLimitMb ? Math.min(100, (data.storageUsedBytes / (data.storageLimitMb * 1048576)) * 100) : 2} className="h-2" />
          <p className="text-xs text-muted-foreground mt-2">{(data.storageUsedBytes / 1048576).toFixed(1)} MB used{data.storageLimitMb ? ` of ${data.storageLimitMb} MB` : " · unlimited"}</p>
        </CardContent>
      </Card>

      <Card><CardContent className="p-0 overflow-x-auto">
        <Table>
          <TableHeader><TableRow><TableHead>File</TableHead><TableHead>Pages</TableHead><TableHead>Size</TableHead><TableHead>Order</TableHead><TableHead>Uploaded (IST)</TableHead><TableHead className="text-right">Open</TableHead></TableRow></TableHeader>
          <TableBody>
            {data.documents.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="text-sm font-medium max-w-[240px] truncate">{d.originalName}</TableCell>
                <TableCell>{d.pageCount}</TableCell>
                <TableCell className="text-xs">{(d.sizeBytes / 1024).toFixed(0)} KB</TableCell>
                <TableCell className="text-xs">{d.orderNumber ? <span>{d.orderNumber} <Badge variant="outline">{d.orderStatus?.replace(/_/g, " ")}</Badge></span> : "—"}</TableCell>
                <TableCell className="text-xs">{formatIST(d.createdAt)}</TableCell>
                <TableCell className="text-right">
                  <a href={d.downloadUrl} target="_blank" rel="noreferrer"><Badge variant="outline" className="cursor-pointer hover:bg-slate-100"><ExternalLink className="h-3 w-3 mr-1" />View</Badge></a>
                </TableCell>
              </TableRow>
            ))}
            {data.documents.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No documents yet</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}
