import { describe, expect, it } from "vitest";
import { attachmentInput } from "@/lib/ai/attachments";

describe("AI attachment inputs", () => {
  it("sends PDF bytes as an application/pdf data URL", () => {
    const input = attachmentInput("Extract this flyer", {
      filename: "weekly-flyer.pdf",
      mimeType: "application/pdf",
      bytes: Buffer.from("%PDF-1.7"),
    });

    expect(input).toEqual([
      {
        role: "user",
        content: [
          { type: "input_text", text: "Extract this flyer" },
          {
            type: "input_file",
            detail: "low",
            filename: "weekly-flyer.pdf",
            file_data: "data:application/pdf;base64,JVBERi0xLjc=",
          },
        ],
      },
    ]);
  });

  it("keeps image attachments on the image data URL path", () => {
    const input = attachmentInput("Read this image", {
      filename: "flyer.png",
      mimeType: "image/png",
      bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    });

    expect(input).toEqual([
      {
        role: "user",
        content: [
          { type: "input_text", text: "Read this image" },
          { type: "input_image", detail: "high", image_url: "data:image/png;base64,iVBORw==" },
        ],
      },
    ]);
  });
});
