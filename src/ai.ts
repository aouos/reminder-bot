import type { Env, TimelineItem } from "./types";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_GEMINI_MODEL = "gemini-3-flash-preview";
const DEFAULT_AI_SOUL =
  "阿尼亚风格的提醒助手。称呼用户为 bolt特工，短句、童真、元气，但必须保留提醒动作和数字。";
const MAX_MESSAGE_LENGTH = 600;
const MAX_OUTPUT_TOKENS = 512;
const MAX_ATTEMPTS = 2;

interface GenerateReminderMessageInput {
  env: Env;
  item: TimelineItem;
  now?: Date;
  fetcher?: typeof fetch;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: unknown;
      }>;
    };
  }>;
}

export async function generateReminderMessage({
  env,
  item,
  now = new Date(),
  fetcher = fetch,
}: GenerateReminderMessageInput): Promise<string> {
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) return item.message;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetcher(buildGeminiUrl(env), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(buildGeminiRequest(env, item, now)),
      });

      if (!res.ok) {
        throw new Error(`Gemini API returned ${res.status}`);
      }

      const data = await res.json<GeminiResponse>();
      const text = extractText(data);
      if (text) return text;

      throw new Error("Gemini response did not contain text");
    } catch (error) {
      console.warn(
        `Gemini reminder generation failed on attempt ${attempt}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return item.message;
}

function buildGeminiUrl(env: Env): string {
  const model = (env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL)
    .replace(/^models\//, "");
  const modelPath = model.split("/").map(encodeURIComponent).join("/");
  return `${GEMINI_API_BASE}/${modelPath}:generateContent`;
}

function buildGeminiRequest(env: Env, item: TimelineItem, now: Date): object {
  return {
    system_instruction: {
      parts: [{ text: buildSystemInstruction(env) }],
    },
    contents: [{
      role: "user",
      parts: [{
        text: buildPrompt(item),
      }],
    }],
    generationConfig: {
      temperature: 1,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      // Reminder copy is simple; minimal thinking avoids burning output budget.
      thinkingConfig: {
        thinkingLevel: "minimal",
      },
    },
  };
}

function buildSystemInstruction(env: Env): string {
  const soul = env.AI_SOUL?.trim() || DEFAULT_AI_SOUL;
  return [
    "你是 Telegram 定时提醒文案助手。每次只输出一条可以直接发送给 bolt特工 的提醒消息。",
    `角色 soul：${soul}`,
    "约束：使用简体中文；最多 2-3 句，总长度尽量不超过 120 个中文字；必须保留原始提醒里的具体行动、数字、时间限制和安全注意事项；语气像阿尼亚，童真但不要啰嗦；不要输出解释、标题、Markdown 或 HTML 标签。",
  ].join("\n");
}

function buildPrompt(item: TimelineItem): string {
  return [
    "请把下面的基础提醒改写成一条很短的阿尼亚风格提醒。",
    "必须覆盖每条关键行动，不要只保留第一条；数字、时间限制和安全注意事项不能丢。",
    "默认提醒文案：",
    item.message,
  ].join("\n");
}

function extractText(data: GeminiResponse): string | null {
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .map((part) => typeof part.text === "string" ? part.text : "")
    .filter(Boolean)
    .join("\n")
    .trim();

  if (!text) return null;
  if (text.length <= MAX_MESSAGE_LENGTH) return text;

  return `${text.slice(0, MAX_MESSAGE_LENGTH - 1).trimEnd()}…`;
}
