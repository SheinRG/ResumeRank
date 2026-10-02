import { describe, expect, it } from "vitest";
import { csvField, csvRow } from "../../src/csv";

describe("csvField", () => {
  it("leaves plain values untouched", () => {
    expect(csvField("Ada Lovelace")).toBe("Ada Lovelace");
    expect(csvField("")).toBe("");
  });

  it("quotes values containing commas, quotes or line breaks", () => {
    expect(csvField("Smith, Jane")).toBe('"Smith, Jane"');
    expect(csvField('Say "hi"')).toBe('"Say ""hi"""');
    expect(csvField("line\nbreak")).toBe('"line\nbreak"');
    expect(csvField("carriage\rreturn")).toBe('"carriage\rreturn"');
  });

  it.each(["=", "+", "-", "@", "\t", "\r"])(
    "neutralises a leading %j so spreadsheets don't evaluate it",
    (trigger) => {
      const field = csvField(`${trigger}HYPERLINK("http://evil")`);
      expect(field.replace(/^"/, "").startsWith("'")).toBe(true);
    },
  );

  it("quotes a neutralised formula that also contains a comma", () => {
    expect(csvField("=SUM(A1,A2)")).toBe(`"'=SUM(A1,A2)"`);
  });

  it("only treats the first character as a trigger", () => {
    expect(csvField("Senior Engineer - Platform")).toBe("Senior Engineer - Platform");
  });
});

describe("csvRow", () => {
  it("joins escaped fields with commas", () => {
    expect(csvRow(["a", "b,c", "=1+1"])).toBe(`a,"b,c",'=1+1`);
  });
});
