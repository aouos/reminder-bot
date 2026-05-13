import { getStickerCandidates } from "./db";
import { sendSticker } from "./telegram";
import type { Env } from "./types";

export async function sendStickerForScene(
  env: Env,
  chatId: number,
  scene: string,
): Promise<void> {
  try {
    const candidates = await getStickerCandidates(env, scene);
    const sticker = chooseWeightedSticker(candidates);
    if (!sticker) return;

    await sendSticker(env.TG_BOT_TOKEN, chatId, sticker);
  } catch {
    // Sticker delivery is decorative; never block the reminder itself.
  }
}

function chooseWeightedSticker(candidates: Array<{ fileId: string; weight: number }>): string | null {
  const total = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
  if (total <= 0) return null;

  let point = Math.random() * total;
  for (const candidate of candidates) {
    point -= candidate.weight;
    if (point <= 0) return candidate.fileId;
  }

  return candidates.at(-1)?.fileId ?? null;
}
