import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cfListOutstandingAwards } from "@/lib/apiClient";
import { formatMoney } from "@/lib/money";
import type { OutstandingAward } from "@/types";

/**
 * Funding awards with money still owed, across every client and program, including participations
 * that have been archived: closing a program never makes an unpaid award disappear.
 */
export function AwardFollowUpCard() {
  const [rows, setRows] = useState<OutstandingAward[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    cfListOutstandingAwards()
      .then((result) => !cancelled && setRows(result))
      .catch((reason: unknown) => {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : "Unable to load awards.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const totalOwed = (rows ?? []).reduce((sum, row) => sum + row.outstanding, 0);

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="font-display text-base">Award follow-up</CardTitle>
        <p className="text-xs text-muted-foreground">
          Funding awards not yet paid in full
          {rows && rows.length > 0 ? ` · ${formatMoney(totalOwed)} still owed` : ""}.
        </p>
      </CardHeader>
      <CardContent>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : rows === null ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading...</p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Every award is paid in full.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Program</TableHead>
                <TableHead>Award</TableHead>
                <TableHead>Awarded</TableHead>
                <TableHead>Received</TableHead>
                <TableHead>Still owed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Link
                      to="/clients/$clientId"
                      params={{ clientId: row.clientId }}
                      search={{ enrollmentId: row.enrollmentId, tab: "funding" }}
                      className="hover:text-primary"
                    >
                      {row.businessName}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {row.programName}{" "}
                    {row.enrollmentArchived && <Badge variant="outline">Archived</Badge>}
                  </TableCell>
                  <TableCell>
                    {row.title}
                    <span className="block text-xs text-muted-foreground">{row.source}</span>
                  </TableCell>
                  <TableCell>{formatMoney(row.amountAwarded)}</TableCell>
                  <TableCell>{formatMoney(row.received)}</TableCell>
                  <TableCell className="font-medium">{formatMoney(row.outstanding)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
