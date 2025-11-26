export async function GET() {
  return new Response(JSON.stringify({ events: [] }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
