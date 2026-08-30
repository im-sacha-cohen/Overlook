import { Suspense } from "react";
import { listConnections } from "@/lib/store/metadata";
import { Workspace } from "@/components/Workspace";

export const dynamic = "force-dynamic";

export default function Home() {
  const connections = listConnections();
  return (
    <Suspense fallback={null}>
      <Workspace initialConnections={connections} />
    </Suspense>
  );
}
