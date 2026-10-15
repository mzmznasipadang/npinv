import Link from "next/link";
import { requireSession } from "@/lib/session";
import { connection } from "next/server";
import { Plus } from "lucide-react";
import { ClientDialog } from "@/components/client-dialog";
import { ConfirmButton } from "@/components/confirm-button";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { deleteClientAction } from "@/lib/actions";
import { listClients } from "@/lib/repo";

export default async function ClientsPage() {
  await connection();
  await requireSession();
  const clients = listClients();

  return (
    <>
      <PageHeader title="Clients">
        <ClientDialog>
          <Button>
            <Plus /> New client
          </Button>
        </ClientDialog>
      </PageHeader>

      {clients.length === 0 ? (
        <EmptyState title="No clients yet" text="Add a client to fill in the “To” block of an invoice with one click." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clients.map((client) => (
              <TableRow key={client.id}>
                <TableCell className="font-semibold">{client.name}<div className="mt-2 flex gap-3 text-xs font-normal"><Link href={`/projects?clientId=${client.id}`} className="underline underline-offset-4">Projects</Link><Link href={`/invoices?clientId=${client.id}`} className="underline underline-offset-4">Invoices</Link></div></TableCell>
                <TableCell>{client.company}</TableCell>
                <TableCell>{client.email}</TableCell>
                <TableCell>{client.phone}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-2">
                    <ClientDialog client={client}>
                      <Button variant="outline" size="sm">
                        Edit
                      </Button>
                    </ClientDialog>
                    <ConfirmButton
                      label="Delete"
                      title={`Delete ${client.name}?`}
                      description="Their invoices are kept, with the bill-to details already on them."
                      confirmLabel="Delete client"
                      action={deleteClientAction.bind(null, client.id)}
                    />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
