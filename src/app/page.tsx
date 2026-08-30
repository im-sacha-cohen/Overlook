import { Suspense } from "react";
import { listConnections } from "@/lib/store/metadata";
import { Workspace } from "@/components/Workspace";
import { LanguageProvider } from "@/lib/i18n/LanguageProvider";

export const dynamic = "force-dynamic";

export default function Home() {
  const connections = listConnections();
  return (
    <LanguageProvider>
      <Suspense fallback={null}>
        <Workspace initialConnections={connections} />
      </Suspense>
    </LanguageProvider>
  );
}
