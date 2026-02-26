import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
    title: 'Gemini RAG System',
    description: 'Self-hosted RAG application using Google Gemini File Search',
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="en">
            <body>
                <div className="app-container">
                    {children}
                </div>
            </body>
        </html>
    );
}
