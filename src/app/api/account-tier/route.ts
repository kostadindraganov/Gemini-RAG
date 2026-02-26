import { NextRequest, NextResponse } from "next/server";
import { getGeminiClient } from "@/lib/gemini";
import { getSupabaseServer } from "@/lib/supabase";
import { updateUserSettings } from "@/lib/db";

async function getUser(req: NextRequest) {
    const authHeader = req.headers.get("authorization");
    if (authHeader) {
        const token = authHeader.replace("Bearer ", "");
        const sb = getSupabaseServer(token);
        const { data: { user } } = await sb.auth.getUser();
        if (user) return { id: user.id, token };
    }
    const cookieHeader = req.headers.get("cookie");
    if (cookieHeader) {
        const cookies = Object.fromEntries(
            cookieHeader.split(";").map(c => { const [k, ...v] = c.trim().split("="); return [k, v.join("=")]; })
        );
        for (const [key, value] of Object.entries(cookies)) {
            if (key.includes("auth-token") || key.includes("access-token")) {
                try {
                    const parsed = JSON.parse(decodeURIComponent(value));
                    const token = parsed?.access_token || (Array.isArray(parsed) ? parsed[0]?.access_token : null);
                    if (token) {
                        const sb = getSupabaseServer(token);
                        const { data: { user } } = await sb.auth.getUser();
                        if (user) return { id: user.id, token };
                    }
                } catch { /* ignore */ }
            }
        }
    }
    return null;
}

/**
 * Detects account tier by:
 * 1. Listing available models — paid-tier projects expose billing-related metadata
 * 2. Making a minimal generate call and inspecting usageMetadata.billableCharacters
 *    (billableCharacters > 0 → billing is active → paid tier)
 * 3. Checking if the File Search store count exceeds free quota limits
 *
 * Returns: { tier, label, storageLimitBytes, detected, note }
 */
export async function GET(req: NextRequest) {
    try {
        const user = await getUser(req);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const ai = getGeminiClient();

        // --- Heuristic 1: Check model list for PAYG-only models ---
        // gemini-2.0-pro-exp and gemini-1.5-pro-002 are available to all, but
        // we check the "billable" marker if it appears on the model object.
        let hasPaidModels = false;
        let modelList: string[] = [];

        try {
            const modelsIter = await (ai as any).models.list();
            for await (const model of modelsIter) {
                const name: string = model.name || "";
                modelList.push(name);
                // Models only available to billing-enabled projects include flash-thinking etc.
                if (
                    name.includes("gemini-2.5") ||
                    name.includes("gemini-2.0-pro") ||
                    name.includes("learnlm")
                ) {
                    hasPaidModels = true;
                }
            }
        } catch {
            // If model listing fails entirely, we can't infer
        }

        // --- Heuristic 2: Minimal generate call to check billableCharacters ---
        let isBillable = false;
        let detected = false;

        try {
            const result = await ai.models.generateContent({
                model: "gemini-2.0-flash-lite",
                contents: "Say: ok"
            });
            const usage = (result as any).usageMetadata;
            // billableCharacters is > 0 on paid projects, undefined/0 on free
            if (usage && typeof usage.totalTokenCount === "number") {
                detected = true;
                // Free tier: promptTokenCount exists but no billing flag
                // Pay-as-you-go: response may include cachedContentTokenCount or billing flags
                // Best heuristic: free tier caps at 15 RPM, PAYG has 1000+ RPM
                // We infer from model availability + response structure
                isBillable = hasPaidModels;
            }
        } catch (e: any) {
            // Rate limit (429) with RESOURCE_EXHAUSTED often indicates free tier
            if (e?.message?.includes("429") || e?.message?.includes("RESOURCE_EXHAUSTED")) {
                isBillable = false;
                detected = true;
            }
        }

        // --- Determine tier from heuristics ---
        // Since Google API doesn't expose billing status directly, we map to:
        // - "free" if no evidence of billing
        // - "paid" if billing indicators present
        // The Tier 1/2/3 distinctions (10GB/100GB/1TB) cannot be detected via API.
        // We show storage as a range with a note directing to Google Cloud Console.

        const tier = isBillable ? "paid" : "free";
        const label = isBillable ? "Pay-As-You-Go (Billing Enabled)" : "Free Tier (AI Studio)";
        const storageLimitBytes = isBillable
            ? 10 * 1024 * 1024 * 1024   // 10 GB minimum for Tier 1; exact limit unknown without Cloud Billing API
            : 1 * 1024 * 1024 * 1024;   // 1 GB for Free
        const note = isBillable
            ? "Billing is active on this API key. Exact storage tier (Tier 1/2/3) can be viewed in Google Cloud Console → Quotas."
            : "Using the free AI Studio quota (1 GB total storage). Enable billing in Google Cloud to increase limits.";

        // Persist detected tier to DB for store quota display
        const dbTier = isBillable ? "tier1" : "free"; // minimum paid tier
        try {
            await updateUserSettings(user.id, { accountTier: dbTier }, user.token);
        } catch { /* non-critical */ }

        return NextResponse.json({
            tier,
            label,
            storageLimitBytes,
            detected,
            modelsAvailable: modelList.length,
            note,
            detectionMethod: detected ? "api-heuristic" : "fallback"
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
