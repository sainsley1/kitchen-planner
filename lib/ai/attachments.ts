import type { ResponseInput, ResponseInputContent } from "openai/resources/responses/responses";

export type AiAttachment = { filename: string; mimeType: string; bytes: Buffer };

export function attachmentInput(text: string, attachment: AiAttachment): ResponseInput {
  const content: ResponseInputContent[] = [];
  content.push({ type: "input_text", text });
  if (attachment.mimeType.startsWith("image/"))
    content.push({
      type: "input_image",
      detail: "high",
      image_url: `data:${attachment.mimeType};base64,${attachment.bytes.toString("base64")}`,
    });
  else
    content.push({
      type: "input_file",
      detail: "low",
      filename: attachment.filename,
      file_data: `data:${attachment.mimeType};base64,${attachment.bytes.toString("base64")}`,
    });
  return [{ role: "user", content }];
}
