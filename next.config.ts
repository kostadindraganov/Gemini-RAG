import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    serverExternalPackages: ["@google/genai"],
    async rewrites() {
        return [
            {
                source: "/sse",
                destination: "http://localhost:3001/sse",
            },
            {
                source: "/mcp",
                destination: "http://localhost:3001/mcp",
            },
            {
                source: "/messages",
                destination: "http://localhost:3001/messages",
            },

        ];
    },
};

export default nextConfig;
