async function main() {
  const base = "http://127.0.0.1:1993";

  // 1. Tạo loop zero-risk
  const created = await fetch(`${base}/api/page-loops`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ goal: "Zero-risk test mục A9 trên daemon thật", mode: "zero_risk" })
  }).then(r => r.json());

  console.log("1. Created zero-risk loop:", {
    id: created.loop?.id,
    mode: created.loop?.mode,
    status: created.loop?.status,
    hasPreparedPrompt: !!created.preparedPrompt,
    leaseId: created.lease?.id
  });

  const loopId = created.loop.id;

  // 2. Xác nhận gửi tay (confirm-sent)
  const confirmed = await fetch(`${base}/api/page-loops/${loopId}/confirm-sent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  }).then(r => r.json());

  console.log("2. Confirmed sent:", {
    id: confirmed.loop?.id,
    status: confirmed.loop?.status
  });

  // 3. Chuẩn bị prompt tiếp theo
  const prep = await fetch(`${base}/api/page-loops/${loopId}/prepare-next`, {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  }).then(r => r.json());

  console.log("3. Prepare next prompt:", {
    hasPrompt: !!prep.prompt,
    promptSnippet: prep.prompt?.slice(0, 80)
  });

  // 4. Dừng loop
  const stopped = await fetch(`${base}/api/page-loops/${loopId}/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason: "Hoàn tất test A9 zero-risk" })
  }).then(r => r.json());

  console.log("4. Stopped loop:", {
    id: stopped.loop?.id,
    status: stopped.loop?.status
  });
}

main().catch(console.error);

