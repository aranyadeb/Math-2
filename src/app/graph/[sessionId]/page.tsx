import { GraphWorkspace } from "@/components/graph/graph-workspace";

export default async function GraphPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return <GraphWorkspace sessionId={sessionId} />;
}
