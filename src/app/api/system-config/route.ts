import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { getRegistrationLock, toggleRegistrationLock, getUserCount } from "@/lib/db";

async function getUser(req: NextRequest) {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return null;
    const token = authHeader.replace("Bearer ", "");
    const sb = getSupabaseServer(token);
    const { data: { user } } = await sb.auth.getUser();
    if (user) return { id: user.id, token };
    return null;
}

export async function GET(req: NextRequest) {
    try {
        const locked = await getRegistrationLock();
        const userCount = await getUserCount();
        return NextResponse.json({ registrationLocked: locked, userCount });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const user = await getUser(req);
        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { locked } = await req.json();
        const userCount = await getUserCount();

        // Safety check: Don't allow locking if zero users (though the UI should prevent this too)
        if (locked && userCount === 0) {
            return NextResponse.json({ error: "Cannot lock registration with 0 active users." }, { status: 400 });
        }

        await toggleRegistrationLock(locked, user.token);
        return NextResponse.json({ success: true, registrationLocked: locked });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
