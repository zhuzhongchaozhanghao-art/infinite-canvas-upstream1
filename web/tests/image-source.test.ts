import { expect, test } from "bun:test";
import { imageSourceUrl } from "../src/lib/image-source";

const bucket = "pub-6596bc5cca674cebb5dd69f09f901285";

test("reads R2 generated images through the same origin, preserving query strings", () => {
    expect(imageSourceUrl(`https://${bucket}.r2.dev/generated/image.png?version=2`)).toBe(`/image-source/${bucket}/generated/image.png?version=2`);
});

test("does not forward other hosts, credentials, protocols or local images", () => {
    for (const url of [
        `http://${bucket}.r2.dev/generated/image.png`,
        `https://${bucket}.r2.dev.evil.test/generated/image.png`,
        `https://user@${bucket}.r2.dev/generated/image.png`,
        `https://${bucket}.r2.dev/private/image.png`,
        "https://example.com/image.png", "blob:https://localhost/image", "data:image/png;base64,AAAA",
    ]) expect(imageSourceUrl(url)).toBe(url);
});
