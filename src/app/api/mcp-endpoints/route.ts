import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, getMcpEndpoints, createMcpEndpoint, deleteMcpEndpoint, toggleMcpEndpoint } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";

export async function GET(req: NextRequest) {
    try {
        const user = await getAuthUser(req);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const endpoints = await getMcpEndpoints(user.id, user.accessToken);
        return NextResponse.json({ endpoints });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const user = await getAuthUser(req);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { url } = await req.json();
        if (!url) return NextResponse.json({ error: "Missing required fields" }, { status: 400 });

        const newId = uuidv4();
        await createMcpEndpoint(user.id, { id: newId, url }, user.accessToken);

        const endpoints = await getMcpEndpoints(user.id, user.accessToken);
        return NextResponse.json({ endpoints, newEndpointId: newId });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const user = await getAuthUser(req);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { endpointId } = await req.json();
        if (!endpointId) return NextResponse.json({ error: "Missing endpoint ID" }, { status: 400 });

        await deleteMcpEndpoint(user.id, endpointId, user.accessToken);
        const endpoints = await getMcpEndpoints(user.id, user.accessToken);
        return NextResponse.json({ endpoints });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

export async function PATCH(req: NextRequest) {
    try {
        const user = await getAuthUser(req);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { endpointId, isActive } = await req.json();
        if (!endpointId) return NextResponse.json({ error: "Missing endpoint ID" }, { status: 400 });

        await toggleMcpEndpoint(user.id, endpointId, isActive, user.accessToken);
        const endpoints = await getMcpEndpoints(user.id, user.accessToken);
        return NextResponse.json({ endpoints });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
