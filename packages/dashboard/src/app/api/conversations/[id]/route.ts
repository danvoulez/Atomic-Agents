import { NextRequest, NextResponse } from "next/server";
import { getConversationMessages, ensureConversation } from "@ai-coding-team/db";
import { Message } from "@/lib/types";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  await ensureConversation(params.id);
  const rows = await getConversationMessages(params.id, 100);
  
  const messages: Message[] = rows.map(r => ({
    id: r.id || crypto.randomUUID(),
    role: r.role as 'user' | 'assistant',
    content: r.content,
    timestamp: r.timestamp
  }));

  return NextResponse.json({ id: params.id, messages });
}
