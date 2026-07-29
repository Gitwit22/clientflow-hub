import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAppState } from "@/lib/store";
import { createClient } from "@/lib/api";
import { STAFF } from "@/types";

export const Route = createFileRoute("/intake")({
  head: () => ({
    meta: [
      { title: "New intake — ClientFlow" },
      { name: "description", content: "Capture a new client intake and route them into the right program." },
      { property: "og:title", content: "New intake — ClientFlow" },
      { property: "og:description", content: "Capture a new client intake and route them into the right program." },
    ],
  }),
  component: IntakePage,
});

function IntakePage() {
  const { programs } = useAppState();
  const navigate = useNavigate();
  const [v, setV] = useState({
    contactName: "", businessName: "", email: "", phone: "", website: "", socialLinks: "",
    businessDescription: "", assistanceRequested: "", programId: "", budgetNeed: "",
    preferredContact: "Email", heardAboutUs: "", additionalComments: "",
    assignedStaff: STAFF[0], intakeSource: "Website",
  });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });

  async function submit() {
    if (!v.businessName || !v.contactName || !v.email) { toast.error("Business name, contact and email are required"); return; }
    const program = programs.find((p) => p.id === v.programId);
    const client = await createClient({
      businessName: v.businessName, contactName: v.contactName, email: v.email, phone: v.phone,
      website: v.website, socialLinks: v.socialLinks ? v.socialLinks.split(",").map((x) => x.trim()) : [],
      programId: v.programId || null, status: "New Intake", assignedStaff: v.assignedStaff,
      intakeSource: v.intakeSource, nextFollowUpDate: new Date(Date.now() + 3 * 864e5).toISOString(),
      intake: {
        businessDescription: v.businessDescription, assistanceRequested: v.assistanceRequested,
        programOfInterest: program?.name ?? "Interest", budgetNeed: v.budgetNeed,
        preferredContact: v.preferredContact, heardAboutUs: v.heardAboutUs,
        additionalComments: v.additionalComments, uploadedFiles: [],
      },
    });
    toast.success("Intake created");
    navigate({ to: "/clients/$clientId", params: { clientId: client.id } });
  }

  return (
    <div className="space-y-6">
      <PageHeader title="New intake" description="One record per client — reused by every form, contract and report." />
      <Card className="shadow-card"><CardContent className="grid gap-4 p-6 sm:grid-cols-2">
        {([["contactName","Client name"],["businessName","Business name"],["email","Email"],["phone","Phone"],["website","Website"],["socialLinks","Social media links"],["budgetNeed","Budget or funding need"],["heardAboutUs","How did you hear about us?"]] as const).map(([k,l]) => (
          <div key={k} className="space-y-1.5"><Label>{l}</Label><Input value={v[k]} onChange={set(k)} /></div>
        ))}
        <div className="space-y-1.5"><Label>Program of interest</Label>
          <Select value={v.programId} onValueChange={(x) => setV({ ...v, programId: x })}>
            <SelectTrigger><SelectValue placeholder="Select program" /></SelectTrigger>
            <SelectContent>{programs.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
          </Select></div>
        <div className="space-y-1.5"><Label>Preferred contact method</Label>
          <Select value={v.preferredContact} onValueChange={(x) => setV({ ...v, preferredContact: x })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{["Email","Phone","Text","Snapchat"].map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
          </Select></div>
        <div className="space-y-1.5"><Label>Assigned staff</Label>
          <Select value={v.assignedStaff} onValueChange={(x) => setV({ ...v, assignedStaff: x })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{STAFF.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
          </Select></div>
        <div className="space-y-1.5"><Label>Intake source</Label>
          <Select value={v.intakeSource} onValueChange={(x) => setV({ ...v, intakeSource: x })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{["Website","Wix Form","Google Form","Referral","Partner Outreach","Walk-in"].map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
          </Select></div>
        {([["businessDescription","Business description"],["assistanceRequested","Type of assistance requested"],["additionalComments","Additional comments"]] as const).map(([k,l]) => (
          <div key={k} className="space-y-1.5 sm:col-span-2"><Label>{l}</Label><Textarea rows={3} value={v[k]} onChange={set(k)} /></div>
        ))}
        <div className="sm:col-span-2"><Button onClick={submit}>Create intake</Button></div>
      </CardContent></Card>
    </div>
  );
}
