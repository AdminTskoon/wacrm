import { describe, expect, it } from "vitest";
import { parseProductCsv } from "./parse-produits-csv";
import { dedupeByTitle } from "./dedupe";

describe("parseProductCsv", () => {
  it("keeps apostrophes inside French values", () => {
    const { rows } = parseProductCsv(
      'titre;marque;description\n"Pull d\'hiver";L\'Oréal;"Laine d\'agneau"'
    );

    expect(rows[0]).toMatchObject({
      title: "Pull d'hiver",
      brand: "L'Oréal",
      description: "Laine d'agneau",
    });
  });

  it("parses French-formatted prices with thousands separators", () => {
    const { rows } = parseProductCsv('title,brand,price,quantity\nVélo,Btwin,"1 299,90",3');

    expect(rows[0]).toMatchObject({ price: 1299.9, quantity: 3 });
  });

  it("reports the missing required column", () => {
    expect(parseProductCsv("title,price\nA,1").missingRequiredColumn).toBe("brand");
  });
});

describe("dedupeByTitle", () => {
  it("keeps the first row per normalized title", () => {
    const { unique, duplicates } = dedupeByTitle([
      { title: "Pull  Rouge" },
      { title: "pull rouge " },
      { title: "Pull bleu" },
    ]);

    expect(unique.map((r) => r.title)).toEqual(["Pull  Rouge", "Pull bleu"]);
    expect(duplicates).toBe(1);
  });
});
