import { NextRequest, NextResponse } from "next/server";
import { insertMessage, appendEventToLedger } from "@ai-coding-team/db";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { content } = await req.json();
  
  await insertMessage({
    id: crypto.randomUUID(),
    conversation_id: params.id,
    role: 'user',
    content,
    created_at: new Date().toISOString()
  });

  await appendEventToLedger(
    params.id, 
    params.id, 
    'user_message', 
    'User sent message', 
    { content }, 
    'user'
  );

  return NextResponse.json({ messageId: crypto.randomUUID() });
}
