import { getDatabase } from "../src/daemon/db";
import { checkAndReplyMessengerOnce, getMessengerListenerStatus } from "../src/daemon/fb-sales";

async function main() {
  const db = getDatabase();
  console.log("Checking Messenger once...");
  const result = await checkAndReplyMessengerOnce(db, (ev) => {
    console.log("[Activity Event]", ev);
  });
  console.log("Result:", result);
  console.log("Status:", getMessengerListenerStatus());
}

main().catch(console.error);

