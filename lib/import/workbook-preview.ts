import { posix } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";

export type StagedWorkbookRow = {
  sheet: string;
  row: number;
  status: "valid" | "warning" | "rejected";
  raw: Record<string, string | null>;
  normalized: Record<string, string | null> | null;
  messages: string[];
};

const definitions = [
  {
    sheet: "Current Inventory",
    required: ["Ingredient", "Category", "Location"],
    known: [
      "Ingredient",
      "Brand / Variety",
      "Category",
      "Quantity",
      "Unit",
      "Location",
      "Storage Detail",
      "Package State",
      "Best Before",
      "Priority",
      "Notes",
      "Last Verified",
    ],
  },
  {
    sheet: "Food Profile",
    required: ["Person", "Food / Dish / Rule", "Classification"],
    known: [
      "Person",
      "Food / Dish / Rule",
      "Classification",
      "Details",
      "Context",
      "Effective Date",
      "Record Status",
    ],
  },
  {
    sheet: "Meal Feedback",
    required: ["Date", "Dish", "Person", "Rating"],
    known: [
      "Date",
      "Dish",
      "Meal Type",
      "Recipe URL",
      "Person",
      "Rating",
      "Feedback",
      "Next-Time Changes",
      "Repeat Decision",
    ],
  },
  {
    sheet: "Staples",
    required: ["Ingredient"],
    known: [
      "Ingredient",
      "Category",
      "Target Minimum",
      "Unit",
      "Preferred Brand",
      "Current Status",
      "Reorder Rule",
      "Notes",
      "Last Reviewed",
    ],
  },
  {
    sheet: "Shopping List",
    required: ["Item"],
    known: [
      "Item",
      "Category",
      "Quantity",
      "Unit",
      "Preferred Store",
      "Priority",
      "Status",
      "Notes",
      "Date Added",
    ],
  },
  {
    sheet: "Meal Plan Data",
    required: ["Meal", "Dish"],
    known: [
      "Week Start",
      "Date",
      "Meal",
      "Person",
      "Dish",
      "Recipe URL",
      "Planned Yield",
      "Packed Lunch?",
      "Leftover / Prep Link",
      "Status",
      "Notes",
      "Last Updated",
      "Calendar Label",
      "Status Label",
    ],
  },
] as const;

type XmlValue = Record<string, unknown> | string | number | boolean | null | undefined;
type CellMap = Map<number, string | null>;
type SheetMap = Map<number, CellMap>;
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: false,
});
const array = <T>(value: T | T[] | undefined): T[] =>
  value == null ? [] : Array.isArray(value) ? value : [value];
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

function xmlText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    return String(value);
  const node = object(value);
  if (node["#text"] != null) return String(node["#text"]);
  if (node.t != null) return xmlText(node.t);
  if (node.r != null)
    return array(node.r)
      .map((part) => xmlText(object(part).t))
      .join("");
  return "";
}

function columnIndex(reference: string): number {
  const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase();
  if (!letters) return -1;
  return [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function resolveTarget(base: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  return posix.normalize(posix.join(posix.dirname(base), target));
}

function parseDateStyles(files: Record<string, Uint8Array>): Set<number> {
  const bytes = files["xl/styles.xml"];
  if (!bytes) return new Set();
  const root = object(parser.parse(strFromU8(bytes)).styleSheet);
  const customFormats = new Map<number, string>();
  for (const entry of array(object(root.numFmts).numFmt)) {
    const format = object(entry);
    customFormats.set(Number(format.numFmtId), String(format.formatCode ?? ""));
  }
  const builtInDates = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
  const result = new Set<number>();
  array(object(root.cellXfs).xf).forEach((entry, index) => {
    const numFmtId = Number(object(entry).numFmtId ?? 0);
    const custom = customFormats.get(numFmtId)?.replaceAll(/\[[^\]]*\]|"[^"]*"/g, "") ?? "";
    if (builtInDates.has(numFmtId) || /[ymdhis]/i.test(custom)) result.add(index);
  });
  return result;
}

function excelDate(serial: number, date1904: boolean): string {
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  return new Date(epoch + serial * 86_400_000).toISOString().slice(0, 10);
}

function parseSheet(
  bytes: Uint8Array,
  sharedStrings: string[],
  dateStyles: Set<number>,
  date1904: boolean,
): SheetMap {
  const root = object(parser.parse(strFromU8(bytes)).worksheet);
  const rows = new Map<number, CellMap>();
  for (const rowValue of array(object(root.sheetData).row)) {
    const row = object(rowValue);
    const rowNumber = Number(row.r || rows.size + 1);
    if (rowNumber > 20_000) throw new Error("Workbook sheet exceeds the 20,000-row preview limit.");
    const cells = new Map<number, string | null>();
    for (const cellValue of array(row.c)) {
      const cell = object(cellValue);
      const index = columnIndex(String(cell.r ?? ""));
      if (index < 0 || index > 200) continue;
      const type = String(cell.t ?? "");
      const raw = xmlText(cell.v);
      let value: string | null;
      if (type === "s") value = sharedStrings[Number(raw)] ?? null;
      else if (type === "inlineStr") value = xmlText(cell.is) || null;
      else if (type === "b") value = raw === "1" ? "true" : "false";
      else if (raw === "") value = null;
      else if (dateStyles.has(Number(cell.s ?? -1)) && Number.isFinite(Number(raw)))
        value = excelDate(Number(raw), date1904);
      else value = raw.trim() || null;
      cells.set(index, value);
    }
    rows.set(rowNumber, cells);
  }
  return rows;
}

export async function parseWorkbookPreview(bytes: Buffer): Promise<StagedWorkbookRow[]> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(bytes));
  } catch {
    throw new Error("The file is not a readable .xlsx workbook.");
  }
  if (Object.keys(files).some((name) => /vbaProject\.bin$/i.test(name)))
    throw new Error("Macro-enabled workbooks are not accepted.");
  const uncompressedBytes = Object.values(files).reduce(
    (total, file) => total + file.byteLength,
    0,
  );
  if (uncompressedBytes > 40 * 1024 * 1024)
    throw new Error("Workbook expands beyond the 40 MB preview limit.");
  const workbookBytes = files["xl/workbook.xml"];
  const relationBytes = files["xl/_rels/workbook.xml.rels"];
  if (!workbookBytes || !relationBytes) throw new Error("Workbook structure is incomplete.");

  const workbook = object(parser.parse(strFromU8(workbookBytes)).workbook);
  const date1904 =
    String(object(workbook.workbookPr).date1904 ?? "false") === "1" ||
    String(object(workbook.workbookPr).date1904 ?? "false") === "true";
  const relationships = object(parser.parse(strFromU8(relationBytes)).Relationships);
  const targets = new Map(
    array(relationships.Relationship).map((entry) => {
      const relation = object(entry);
      return [String(relation.Id), resolveTarget("xl/workbook.xml", String(relation.Target))];
    }),
  );
  const sheetPaths = new Map(
    array(object(workbook.sheets).sheet).map((entry) => {
      const sheet = object(entry);
      return [String(sheet.name), targets.get(String(sheet.id))];
    }),
  );

  const sharedBytes = files["xl/sharedStrings.xml"];
  const sharedRoot = sharedBytes ? object(parser.parse(strFromU8(sharedBytes)).sst) : {};
  const sharedStrings = array(sharedRoot.si).map((entry) => xmlText(entry));
  const dateStyles = parseDateStyles(files);
  const staged: StagedWorkbookRow[] = [];

  for (const definition of definitions) {
    const path = sheetPaths.get(definition.sheet);
    if (!path || !files[path]) {
      staged.push({
        sheet: definition.sheet,
        row: 0,
        status: "warning",
        raw: {},
        normalized: null,
        messages: [`Sheet “${definition.sheet}” was not found.`],
      });
      continue;
    }
    const rows = parseSheet(files[path], sharedStrings, dateStyles, date1904);
    const headers = new Map<string, number>();
    for (const [column, value] of rows.get(4) ?? []) if (value) headers.set(value, column);
    const missingHeaders = definition.required.filter((header) => !headers.has(header));
    if (missingHeaders.length) {
      staged.push({
        sheet: definition.sheet,
        row: 4,
        status: "rejected",
        raw: {},
        normalized: null,
        messages: [`Required headers missing: ${missingHeaders.join(", ")}`],
      });
      continue;
    }
    const lastRow = Math.max(4, ...rows.keys());
    for (let rowNumber = 5; rowNumber <= lastRow; rowNumber += 1) {
      const row = rows.get(rowNumber) ?? new Map();
      const raw = Object.fromEntries(
        definition.known
          .filter((header) => headers.has(header))
          .map((header) => [header, row.get(headers.get(header)!) ?? null]),
      );
      if (!Object.values(raw).some(Boolean)) continue;
      const missing = definition.required.filter((header) => !raw[header]);
      const messages: string[] = [];
      if (missing.length) messages.push(`Missing required value: ${missing.join(", ")}`);
      if (definition.sheet === "Current Inventory" && !raw.Quantity)
        messages.push("Quantity is unknown and will not be treated as available.");
      if (definition.sheet === "Meal Plan Data" && !raw.Date)
        messages.push(
          "No exact date is recorded; choose whether to import this into Unscheduled items for the recorded week.",
        );
      const status = missing.length ? "rejected" : messages.length ? "warning" : "valid";
      const normalized =
        status === "rejected"
          ? null
          : Object.fromEntries(
              Object.entries(raw).map(([key, value]) => [
                key
                  .replaceAll(/[^A-Za-z0-9]+/g, "_")
                  .replaceAll(/^_|_$/g, "")
                  .toLowerCase(),
                value,
              ]),
            );
      staged.push({ sheet: definition.sheet, row: rowNumber, status, raw, normalized, messages });
    }
  }
  return staged;
}
