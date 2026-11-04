import { browserBridge } from "../src/daemon/browser-bridge";
import { getDatabase } from "../src/daemon/db";
import { checkAndReplyMessengerOnce, getMessengerListenerStatus } from "../src/daemon/fb-sales";

async function main() {
  console.log("=== Testing checkAndReplyMessengerOnce ===");
  const db = getDatabase();
  console.log("Current listener status:", getMessengerListenerStatus());

  try {
    const page = await browserBridge.execute("read_page");
    console.log("read_page ok:", !!page);
    console.log("url:", page?.url);
    console.log("title:", page?.title);
    console.log("summaryText (first 800 chars):", page?.summaryText?.slice(0, 800));
    console.log("elements count:", page?.elements?.length);

    // Thử chạy checkAndReplyMessengerOnce
    const result = await checkAndReplyMessengerOnce(db, (ev) => {
      console.log("[EVENT]", ev);
    });
    console.log("checkAndReplyMessengerOnce result:", result);
  } catch (err: any) {
    console.error("Error executing read_page:", err);
  }
}

main().catch(console.error);

