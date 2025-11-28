import { NextResponse } from "next/server";

export async function GET() {
  const repositories = [
    { 
      id: "1", 
      type: "github", 
      path: "github.com/danvoulez/Atomic-Agents", 
      name: "Atomic-Agents" 
    },
    { 
      id: "2", 
      type: "lab512", 
      path: "/local/project", 
      name: "Local Project" 
    }
  ];
  return NextResponse.json({ repositories });
}
