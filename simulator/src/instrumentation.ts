export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { engine } = await import("./server/engine");
    engine().start().catch((e) => console.error("simulator engine failed to start:", e));
  }
}
