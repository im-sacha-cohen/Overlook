import { existsSync } from "fs";
import { Suspense } from "react";
import { listConnections } from "@/lib/store/metadata";
import { Workspace } from "@/components/Workspace";
import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import { LandingContent } from "./landing/LandingContent";

export const dynamic = "force-dynamic";

// Standard marker file created by the Docker runtime in every Linux
// container; a reliable way to tell "the app itself is running inside
// Docker" from "the app can just see Docker on the host".
function isRunningInDocker(): boolean {
  return existsSync("/.dockerenv");
}

export default function Home() {
  if (process.env.OVERLOOK_LANDING_MODE) {
    return <LandingContent lang="en" />;
  }

  const connections = listConnections();
  return (
    <LanguageProvider>
      <Suspense fallback={null}>
        <Workspace initialConnections={connections} dockerDetected={isRunningInDocker()} />
      </Suspense>
    </LanguageProvider>
  );
}
