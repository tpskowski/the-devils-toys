import sharp from "sharp";
import { runSmoke } from "./harness.mjs";

const assets = [
  ["Silver Spire", "#8b3f2f"],
  ["Seahorse Mine", "#315665"],
  ["Inside the Shattered Visage", "#6f6140"],
  ["The Shattered Visage", "#5c334d"],
  ["Krieg Ranch", "#45613c"],
  ["Larstown Street", "#5d554d"]
];

await runSmoke("Tab thumbnail visual fixture", async ({ base, setup, request, upload }) => {
  const gm = await setup("ThumbnailGM", "thumbnail-password");
  const created = await request(
    "/api/rooms",
    {
      method: "POST",
      headers: gm.headers,
      body: JSON.stringify({ name: "The Border March", system: "toybox" })
    },
    201
  );
  for (const [name, background] of assets) {
    const image = await sharp({ create: { width: 160, height: 96, channels: 3, background } }).png().toBuffer();
    await upload(`/api/rooms/${created.room.id}/media`, gm.cookie, {
      kind: "scene",
      file: new File([image], `${name}.png`, { type: "image/png" })
    });
  }

  console.log(`TAB_THUMBNAIL_FIXTURE=${base}/room/${created.room.id}`);
  await new Promise((resolve) => process.once("SIGINT", resolve));
});
