# Gemini RAG & MCP Platform

A premium, enterprise-grade Retrieval-Augmented Generation (RAG) platform powered by **Google Gemini 2.0/3.0** and **Supabase**. This platform allows users to upload documents, create specialized "File Search Stores", and query them through a beautiful cinematic dark-mode interface.

Beyond a simple chat interface, it includes a built-in **MCP (Model Context Protocol) Server** that exposes your RAG capabilities to external AI agents like Dify, Claude Desktop, and more.

---

## ✨ Key Features

### 🧠 Advanced RAG Capabilities
- **Google File Search Integration**: Leverages Google's high-speed vector retrieval for precise document grounding.
- **Dynamic Store Management**: Create multiple document stores (datasets) to isolate knowledge bases for different projects.
- **Support for 30+ File Formats**: Natively processes PDF, DOCX, ZIP, SQL, Markdown, and even Source Code (JS/PY/TS).
- **Multi-Model Support**: Switch between Gemini 3.1 Pro, 3.0 Flash, and 2.5 Pro on the fly.

### 🔌 Model Context Protocol (MCP) Server
- **Native SSE Integration**: Built-in Server-Sent Events (SSE) MCP server.
- **External Integration**: Connect your private knowledge base directly to **Dify**, **Claude**, or **LangChain**.
- **Secure API Key Management**: Generate and rotate multiple API keys for external authentication.
- **Custom Endpoint Overrides**: Map your local server to public IPs or custom domains directly from the UI.

### 🎨 Premium UI/UX
- **Cinematic Dark Mode**: A high-contrast OLED-optimized interface with glass-morphic panels.
- **Global Administration**: Dedicated system-wide settings for platform owners.
- **Registration Lock**: Ability to close public signups once a primary user is registered, protected by a database-level trigger.
- **Responsive Header**: Real-time display of Google AI Account Tier (Free/Pro), token usage, and active model.
- **Live Markdown Support**: Rich text rendering with syntax highlighting, tables, and auto-generated citations.
- **Fully Responsive**: Optimized for Desktop, Tablet, and Mobile workflows.

---

## 🛠 Tech Stack

- **Framework**: [Next.js 15](https://nextjs.org/) (App Router)
- **Language**: TypeScript
- **Frontend**: [React 19](https://react.dev/)
- **Backend/Auth/DB**: [Supabase](https://supabase.com/) (using `@supabase/ssr`)
- **AI Engine**: [Google Generative AI SDK](https://www.npmjs.com/package/@google/genai) (Gemini 1.5, 2.0, 2.5, and 3.1 Pro support)
- **Protocol**: [MCP SDK](https://modelcontextprotocol.io/) (`@modelcontextprotocol/sdk`)
- **External Server**: [Express 5](https://expressjs.com/) (providing SSE transport for MCP)
- **Styling**: Vanilla CSS (Premium Design System)
- **Content**: `react-markdown` with `remark-gfm`

---

## 🚀 Getting Started

### 1. Prerequisites
- Node.js 18.x or higher
- A Supabase Project
- A Google AI Studio API Key

### 2. Environment Variables
Create a `.env.local` file in the root directory:

```env
GEMINI_API_KEY=your_gemini_api_key
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### 3. Database Setup (Supabase)
Navigate to the `supabase/` directory and execute the following SQL scripts in your Supabase SQL Editor in order:
1. `migration.sql` (Core Schema)
2. `supabase-account-tier.sql` (Tier Detection)
3. `supabase-mcp-endpoints.sql` (MCP Overrides)
4. `supabase-registration-lock.sql` (Global Admin Features)

### 4. Installation
```bash
npm install
```

### 5. Running the App
```bash
npm run dev
```
The app will be available at `http://localhost:3000`.
The MCP SSE server will be active at `http://localhost:3001/sse`.

---

## 📁 Project Structure

```text
src/
├── app/
│   ├── api/             # RAG, MCP, and State management endpoints
│   ├── login/           # Authentication layouts
│   └── globals.css      # Core design system & glassmorphism
├── components/          # Tab-based UI modules (Chat, Docs, Settings, etc.)
└── lib/                 # Core logic (Supabase, Gemini RAG, State)
supabase/                # SQL migrations and schema definitions
```

---

## 🔗 MCP Integration Guide

This platform is designed to be consumed by other AI tools. To connect it to **Dify** or **Claude**:

1.  Navigate to the **Settings** tab.
2.  Generate a new **API Key** under the MCP section.
3.  Copy the **SSE Endpoint URL**.
4.  In your client (e.g. Dify), add a new MCP tool using:
    - **Type**: SSE
    - **URL**: `[Your SSE Endpoint Provider]`
    - **Authorization**: `Bearer [Your API Key]`

---

## 📊 Account Tiers & Quotas
The platform includes an auto-detection system for your Google AI Studio account.
- **Free Tier**: 1GB total store storage.
- **Pro/Paid Tier**: Incremental storage up to 1TB and higher rate limits.

Monitor your usage and citations directly from the **Stores** and **Chat** interfaces.

---

## 📜 License
Integrated proprietary software. All rights reserved.
