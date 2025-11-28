import { NextRequest, NextResponse } from "next/server";
import { requestJobCancel } from "@ai-coding-team/db";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  await requestJobCancel(params.id);
  return NextResponse.json({ success: true, newStatus: 'stopped' });
}
