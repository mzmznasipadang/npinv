import { connection } from "next/server";
import { PageHeader } from "@/components/page-header";
import { SettingsForm } from "@/components/settings-form";
import { settingsToValues } from "@/lib/invoice-form";
import { getSettings } from "@/lib/repo";
import { listDeviceSessions } from "@/lib/mobile-sessions";
import { revokeDeviceSessionAction } from "@/lib/actions";
import { requireSession } from "@/lib/session";
import { ConfirmButton } from "@/components/confirm-button";

export default async function SettingsPage() {
  await connection();
  await requireSession();
  const sessions = listDeviceSessions();
  return (
    <>
      <PageHeader title="Settings" />
      <SettingsForm initial={settingsToValues(getSettings())} />
      <section className="mt-10 space-y-4" aria-labelledby="devices">
        <h2 id="devices" className="text-lg font-semibold">Mobile devices</h2>
        <p className="text-sm text-muted-foreground">Revoke a lost or unused device to stop its next API request. Device sessions expire after 30 days.</p>
        {sessions.length === 0 ? <p className="text-sm text-muted-foreground">No active mobile sessions.</p> : (
          <ul className="divide-y rounded-lg border px-4">
            {sessions.map(session => <li key={session.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div><p className="font-medium">{session.deviceName}</p><p className="text-sm text-muted-foreground">Signed in {new Date(session.createdAt).toLocaleString("en-GB", { timeZone: "Asia/Jakarta" })} · Expires {new Date(session.expiresAt).toLocaleDateString("en-GB", { timeZone: "Asia/Jakarta" })} (Jakarta)</p></div>
              <ConfirmButton label="Revoke" title={`Revoke ${session.deviceName}?`} description="This device will need to sign in again. Other devices keep their access." confirmLabel="Revoke access" action={revokeDeviceSessionAction.bind(null, session.id)} />
            </li>)}
          </ul>
        )}
      </section>
    </>
  );
}
