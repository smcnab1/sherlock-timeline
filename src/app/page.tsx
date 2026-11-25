import { EmptyCaseStart } from "@/components/empty-case-start";
import { SherlockApp } from "@/components/sherlock-app";
import { getCaseWorkspace } from "@/lib/data";
import type { WorkspaceCase, WorkspaceData } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Home() {
  const workspace = await getCaseWorkspace();

  if (!workspace.activeCase) {
    return <EmptyCaseStart />;
  }

  const data = JSON.parse(JSON.stringify(workspace)) as WorkspaceData & {
    activeCase: WorkspaceCase;
  };

  return <SherlockApp initialData={data} initialNow={new Date().toISOString()} />;
}
