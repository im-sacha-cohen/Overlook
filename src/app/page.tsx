import { Suspense } from "react";
import { listConnections } from "@/lib/store/metadata";
import { Workspace } from "@/components/Workspace";
import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import { LandingContent } from "./landing/LandingContent";

export const dynamic = "force-dynamic";

export default function Home() {
  if (process.env.OVERLOOK_LANDING_MODE) {
    return <LandingContent lang="en" />;
  }

  const connections = listConnections();
  return (
    <LanguageProvider>
      <Suspense fallback={null}>
        <Workspace initialConnections={connections} />
      </Suspense>
    </LanguageProvider>
  );
}
