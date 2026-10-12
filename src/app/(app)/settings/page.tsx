import { connection } from "next/server";
import { PageHeader } from "@/components/page-header";
import { SettingsForm } from "@/components/settings-form";
import { settingsToValues } from "@/lib/invoice-form";
import { getSettings } from "@/lib/repo";

export default async function SettingsPage() {
  await connection();
  return (
    <>
      <PageHeader title="Settings" />
      <SettingsForm initial={settingsToValues(getSettings())} />
    </>
  );
}
