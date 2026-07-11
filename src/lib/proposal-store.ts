import { getSupabaseAdminClient } from "@/lib/supabase-server";

export type SourceProposal = {
  id: string;
  type: "add" | "remove";
  sourceId: string;
  name: string;
  url: string | null;
  category: string | null;
  language: string | null;
  weight: number | null;
  reason: string;
  createdAt: string;
};

function proposalFromRow(row: Record<string, unknown>): SourceProposal | null {
  const type = row.type === "add" || row.type === "remove" ? row.type : null;
  if (!type || typeof row.id !== "string") return null;

  return {
    id: row.id,
    type,
    sourceId: String(row.source_id ?? ""),
    name: String(row.name ?? ""),
    url: row.url == null ? null : String(row.url),
    category: row.category == null ? null : String(row.category),
    language: row.language == null ? null : String(row.language),
    weight: row.weight == null ? null : Number(row.weight),
    reason: String(row.reason ?? ""),
    createdAt: String(row.created_at ?? ""),
  };
}

export async function loadPendingProposals(): Promise<SourceProposal[]> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("trendlens_source_proposals")
    .select("id,type,source_id,name,url,category,language,weight,reason,created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) {
    // 表尚未创建（迁移未执行）时按无提案处理，不影响设置页其余功能。
    console.warn(`Failed to load TrendLens source proposals from Supabase: ${error.message}`);
    return [];
  }

  return ((data ?? []) as unknown as Record<string, unknown>[])
    .map(proposalFromRow)
    .filter((proposal): proposal is SourceProposal => Boolean(proposal));
}

// 采纳/忽略一条提案。采纳 add → 插入信源（并清掉同 id 墓碑）；采纳 remove → 删除信源并写墓碑。
export async function resolveProposal(
  proposalId: string,
  action: "accept" | "dismiss",
): Promise<{ ok: boolean; error?: string }> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return { ok: false, error: "Supabase is not configured." };

  const { data: row, error: loadError } = await supabase
    .from("trendlens_source_proposals")
    .select("id,type,source_id,name,url,category,language,weight,status")
    .eq("id", proposalId)
    .maybeSingle();

  if (loadError) return { ok: false, error: loadError.message };
  if (!row) return { ok: false, error: "Proposal not found." };
  if (row.status !== "pending") return { ok: false, error: "Proposal is already resolved." };

  if (action === "accept") {
    if (row.type === "add") {
      const { error } = await supabase.from("trendlens_sources").upsert(
        {
          id: String(row.source_id),
          name: String(row.name),
          url: String(row.url ?? ""),
          category: String(row.category ?? "analysis"),
          language: String(row.language ?? "en"),
          weight: Number(row.weight ?? 1),
          enabled: true,
          raw: { addedFrom: "proposal", proposalId },
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );
      if (error) return { ok: false, error: error.message };

      await supabase.from("trendlens_source_tombstones").delete().eq("id", String(row.source_id));
    } else {
      const { error } = await supabase.from("trendlens_sources").delete().eq("id", String(row.source_id));
      if (error) return { ok: false, error: error.message };

      const { error: tombstoneError } = await supabase
        .from("trendlens_source_tombstones")
        .upsert({ id: String(row.source_id), deleted_at: new Date().toISOString() }, { onConflict: "id" });
      if (tombstoneError) {
        console.warn(`Failed to record TrendLens source tombstone: ${tombstoneError.message}`);
      }
    }
  }

  const { error: updateError } = await supabase
    .from("trendlens_source_proposals")
    .update({
      status: action === "accept" ? "accepted" : "dismissed",
      resolved_at: new Date().toISOString(),
    })
    .eq("id", proposalId);

  if (updateError) return { ok: false, error: updateError.message };
  return { ok: true };
}
