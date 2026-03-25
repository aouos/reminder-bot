const TG_API = "https://api.telegram.org/bot";

export async function sendMessage(
  token: string,
  chatId: number | string,
  text: string,
  parseMode: string = "HTML",
): Promise<boolean> {
  const url = `${TG_API}${token}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: parseMode,
    }),
  });
  return res.ok;
}

export async function setWebhook(
  token: string,
  webhookUrl: string,
): Promise<boolean> {
  const url = `${TG_API}${token}/setWebhook`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: webhookUrl }),
  });
  return res.ok;
}

export async function deleteWebhook(token: string): Promise<boolean> {
  const url = `${TG_API}${token}/deleteWebhook`;
  const res = await fetch(url, { method: "POST" });
  return res.ok;
}

export async function setMyCommands(token: string): Promise<boolean> {
  const url = `${TG_API}${token}/setMyCommands`;
  const commands = [
    { command: "start", description: "开启每日提醒" },
    { command: "stop", description: "关闭每日提醒" },
    { command: "test", description: "发送一条测试消息" },
    { command: "list", description: "查看今日提醒时间表" },
    { command: "status", description: "查看当前提醒状态" },
  ];
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commands }),
  });
  return res.ok;
}
